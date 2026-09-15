import crypto from "node:crypto";
import { and, asc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import {
  activitiesTable,
  businessesTable,
  callsTable,
  contactsTable,
  db,
  workflowJobsTable,
} from "@workspace/db";
import { evaluateCallPolicy, isKillSwitchEngaged } from "./policy";
import { hasRetellConfigForMarket, startRetellCall } from "./providers";
import { normalizeToE164 } from "./phone";
import { getActiveUsageRow } from "./usage";
import { logger } from "./logger";

export const MAX_JOB_ATTEMPTS = 5;
export const LEASE_DURATION_MINUTES = 5;

export interface ProcessJobsOptions {
  batchSize?: number;
  workerId?: string;
  now?: Date;
}

export interface ProcessJobsResult {
  recovered_stale_leases: number;
  jobs_seen: number;
  attempted: number;
  started: number;
  blocked: number;
  deferred_quiet_hours: number;
  skipped_not_configured: number;
  reconciled_existing: number;
  failed: number;
}

/**
 * Recovers jobs stuck in 'dispatching' whose lease has expired.
 * Resets status to 'queued' so other workers can safely claim them.
 */
export async function recoverStaleLeases(now: Date = new Date()): Promise<number> {
  const staleThreshold = new Date(now.getTime() - LEASE_DURATION_MINUTES * 60 * 1000);

  const recovered = await db
    .update(workflowJobsTable)
    .set({
      status: "queued",
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(workflowJobsTable.status, "dispatching"),
        sql`(${workflowJobsTable.leaseExpiresAt} IS NOT NULL AND ${workflowJobsTable.leaseExpiresAt} < ${now}) OR (${workflowJobsTable.leaseExpiresAt} IS NULL AND ${workflowJobsTable.lockedAt} < ${staleThreshold})`,
      ),
    )
    .returning({ id: workflowJobsTable.id });

  if (recovered.length > 0) {
    logger.info({ count: recovered.length }, "Recovered stale workflow job leases");
  }

  return recovered.length;
}

/**
 * Atomically claims up to `batchSize` queued jobs using PostgreSQL row locking
 * (FOR UPDATE SKIP LOCKED) to prevent concurrent workers from claiming identical jobs.
 */
export async function claimQueuedJobs(
  workerId: string,
  batchSize: number = 25,
  now: Date = new Date(),
): Promise<Array<typeof workflowJobsTable.$inferSelect>> {
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MINUTES * 60 * 1000);

  const claimed = await db
    .update(workflowJobsTable)
    .set({
      status: "dispatching",
      lockedAt: now,
      lockedBy: workerId,
      leaseExpiresAt,
      attempts: sql`${workflowJobsTable.attempts} + 1`,
    })
    .where(
      sql`${workflowJobsTable.id} IN (
        SELECT id FROM ${workflowJobsTable}
        WHERE ${workflowJobsTable.type} = 'initiate_call'
          AND ${workflowJobsTable.status} IN ('queued', 'deferred')
          AND ${workflowJobsTable.availableAt} <= ${now}
        ORDER BY ${workflowJobsTable.availableAt} ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )`,
    )
    .returning();

  return claimed;
}

/**
 * Executes outbound workflow processing with:
 * - Stale lease recovery
 * - Atomic batch claiming (FOR UPDATE SKIP LOCKED)
 * - Durable stable operation / idempotency checks
 * - Pre-dispatch policy & quiet-hours gates
 * - Crash recovery & duplicate dispatch prevention
 * - Exponential backoff retry scheduling
 */
export async function processWorkflowJobs(
  opts: ProcessJobsOptions = {},
): Promise<ProcessJobsResult> {
  const now = opts.now ?? new Date();
  const workerId =
    opts.workerId ??
    `worker_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;
  const batchSize = opts.batchSize ?? 25;

  // 1. Recover stale leases from crashed workers
  const recoveredStaleLeases = await recoverStaleLeases(now);

  // 2. Atomically claim batch of queued/deferred jobs
  const jobs = await claimQueuedJobs(workerId, batchSize, now);

  let attempted = 0;
  let started = 0;
  let blocked = 0;
  let deferredQuietHours = 0;
  let skippedNotConfigured = 0;
  let reconciledExisting = 0;
  let failed = 0;

  for (const job of jobs) {
    // 3. Look up associated call record using durable operation key (job.idempotencyKey)
    const [call] = await db
      .select()
      .from(callsTable)
      .where(
        and(
          eq(callsTable.id, job.idempotencyKey),
          eq(callsTable.businessId, job.businessId),
        ),
      )
      .limit(1);

    if (!call) {
      await db
        .update(workflowJobsTable)
        .set({
          status: "failed",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: "Associated call record not found for operation key",
        })
        .where(eq(workflowJobsTable.id, job.id));
      failed += 1;
      continue;
    }

    // 4. Crash idempotency check: If call already accepted by provider, reconcile without duplicate dispatch
    const isAlreadyDispatched =
      Boolean(call.providerCallId) ||
      ["in_progress", "completed", "ringing", "connected"].includes(call.status);

    if (isAlreadyDispatched) {
      await db
        .update(workflowJobsTable)
        .set({
          status: "completed",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: null,
        })
        .where(eq(workflowJobsTable.id, job.id));
      reconciledExisting += 1;
      continue;
    }

    if (call.status === "policy_blocked") {
      await db
        .update(workflowJobsTable)
        .set({
          status: "blocked",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: call.summary,
        })
        .where(eq(workflowJobsTable.id, job.id));
      blocked += 1;
      continue;
    }

    if (call.status === "cancelled") {
      await db
        .update(workflowJobsTable)
        .set({
          status: "cancelled",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: "Call cancelled by operator",
        })
        .where(eq(workflowJobsTable.id, job.id));
      continue;
    }

    // 5. Check business & market readiness
    const [business] = await db
      .select()
      .from(businessesTable)
      .where(eq(businessesTable.id, job.businessId))
      .limit(1);

    if (!business) {
      await db
        .update(workflowJobsTable)
        .set({
          status: "failed",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: `Business tenant ${job.businessId} not found`,
        })
        .where(eq(workflowJobsTable.id, job.id));
      failed += 1;
      continue;
    }

    const market = business.market === "IN" ? "IN" : "US";
    const businessFromNumber = business.phoneNumber?.trim() || undefined;
    if (!hasRetellConfigForMarket(market, businessFromNumber)) {
      // Leave deferred; credentials missing, do not burn attempt
      await db
        .update(workflowJobsTable)
        .set({
          status: "deferred",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          availableAt: new Date(now.getTime() + 10 * 60 * 1000),
          lastError: "Retell provider credentials or business phone number not configured for market",
        })
        .where(eq(workflowJobsTable.id, job.id));
      skippedNotConfigured += 1;
      continue;
    }

    if (isKillSwitchEngaged()) {
      await db
        .update(workflowJobsTable)
        .set({
          status: "deferred",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          availableAt: new Date(now.getTime() + 15 * 60 * 1000),
          lastError: "LEADSPRINT_KILL_SWITCH is engaged",
        })
        .where(eq(workflowJobsTable.id, job.id));
      blocked += 1;
      continue;
    }

    attempted += 1;

    // 6. Pre-dispatch policy & quiet-hours checks
    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.id, call.contactId),
          eq(contactsTable.businessId, job.businessId),
        ),
      )
      .limit(1);

    const priorAttempts = (
      await db
        .select({ id: callsTable.id })
        .from(callsTable)
        .where(
          and(
            eq(callsTable.leadId, call.leadId),
            eq(callsTable.businessId, job.businessId),
            ne(callsTable.id, call.id),
          ),
        )
    ).length;

    const activeUsage = await getActiveUsageRow(job.businessId, now, db);
    const currentVoiceMinutes = Number(activeUsage.voiceMinutes);

    const decision = evaluateCallPolicy({
      business: {
        timezone: business.timezone ?? "UTC",
        quietHours: business.quietHours,
        maxCallAttempts: business.maxCallAttempts ?? 2,
        includedVoiceMinutes: business.includedVoiceMinutes ?? 300,
        currentVoiceMinutes,
        callingPaused: business.callingPaused,
      },
      contact: {
        consentStatus: contact?.consentStatus ?? "valid",
        suppressedAt: contact?.suppressedAt ?? null,
        recipientTimezone: contact?.recipientTimezone ?? null,
        timezoneProvenance: contact?.timezoneProvenance ?? "business_fallback",
      },
      attemptsSoFar: priorAttempts,
      now,
    });

    if (!decision.allowed) {
      if (decision.reason === "quiet_hours") {
        deferredQuietHours += 1;
        const nextAttempts = job.attempts;
        if (nextAttempts < MAX_JOB_ATTEMPTS) {
          await db
            .update(workflowJobsTable)
            .set({
              status: "deferred",
              lockedAt: null,
              lockedBy: null,
              leaseExpiresAt: null,
              availableAt: new Date(now.getTime() + 30 * 60 * 1000),
              lastError: decision.message,
            })
            .where(eq(workflowJobsTable.id, job.id));
        } else {
          await db
            .update(callsTable)
            .set({
              status: "policy_blocked",
              outcome: `Blocked — ${decision.reason}`,
              summary: decision.message ?? "Blocked by call policy.",
              errorState: decision.reason,
            })
            .where(eq(callsTable.id, call.id));
          await db
            .update(workflowJobsTable)
            .set({
              status: "failed",
              lockedAt: null,
              lockedBy: null,
              leaseExpiresAt: null,
              lastError: decision.message,
            })
            .where(eq(workflowJobsTable.id, job.id));
        }
      } else {
        blocked += 1;
        await db
          .update(callsTable)
          .set({
            status: "policy_blocked",
            outcome: `Blocked — ${decision.reason}`,
            summary: decision.message ?? "Blocked by call policy.",
            errorState: decision.reason,
          })
          .where(eq(callsTable.id, call.id));
        await db
          .update(workflowJobsTable)
          .set({
            status: "blocked",
            lockedAt: null,
            lockedBy: null,
            leaseExpiresAt: null,
            lastError: decision.message,
          })
          .where(eq(workflowJobsTable.id, job.id));
        await db.insert(activitiesTable).values({
          id: `activity_${crypto.randomUUID().slice(0, 12)}`,
          businessId: job.businessId,
          type: "policy",
          title: "Call blocked by policy gate",
          detail: decision.message ?? "Blocked by safety policy",
        });
      }
      continue;
    }

    // 7. E.164 phone normalization check
    const phoneNorm = normalizeToE164(contact?.phone);
    if (!phoneNorm.valid) {
      blocked += 1;
      const errorMsg = `Invalid contact phone number: ${phoneNorm.error}`;
      await db
        .update(callsTable)
        .set({
          status: "policy_blocked",
          outcome: "Blocked — invalid phone number",
          summary: errorMsg,
          errorState: "invalid_phone",
        })
        .where(eq(callsTable.id, call.id));
      await db
        .update(workflowJobsTable)
        .set({
          status: "blocked",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: errorMsg,
        })
        .where(eq(workflowJobsTable.id, job.id));
      await db.insert(activitiesTable).values({
        id: `activity_${crypto.randomUUID().slice(0, 12)}`,
        businessId: job.businessId,
        type: "policy",
        title: "Call blocked — invalid phone number",
        detail: `Cannot place queued call to ${contact?.name ?? "contact"}: ${phoneNorm.error} (raw: "${contact?.phone ?? ""}")`,
      });
      continue;
    }

    // 7.5. Same-contact active-call protection lock
    let shouldDispatch = true;
    if (call.contactId) {
      await db.transaction(async (tx) => {
        const [lockedContact] = await tx
          .select({ id: contactsTable.id })
          .from(contactsTable)
          .where(
            and(
              eq(contactsTable.id, call.contactId),
              eq(contactsTable.businessId, job.businessId),
            ),
          )
          .for("update");

        if (!lockedContact) return;

        const staleThreshold = new Date(now.getTime() - 5 * 60 * 1000);
        const activeCalls = await tx
          .select({ id: callsTable.id, status: callsTable.status })
          .from(callsTable)
          .where(
            and(
              eq(callsTable.businessId, job.businessId),
              eq(callsTable.contactId, call.contactId),
              ne(callsTable.id, call.id),
              or(
                inArray(callsTable.status, ["in_progress", "provider_accepted", "ringing", "connected"]),
                and(
                  eq(callsTable.status, "provider_requesting"),
                  gte(callsTable.createdAt, staleThreshold),
                ),
              ),
            ),
          );

        if (activeCalls.length > 0) {
          shouldDispatch = false;
        } else {
          await tx
            .update(callsTable)
            .set({
              status: "provider_requesting",
              startedAt: now,
            })
            .where(eq(callsTable.id, call.id));
          shouldDispatch = true;
        }
      });
    }

    if (!shouldDispatch) {
      await db
        .update(workflowJobsTable)
        .set({
          status: "deferred",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          availableAt: new Date(now.getTime() + 2 * 60 * 1000),
          lastError: "Deferred: active call already in progress for this contact",
        })
        .where(eq(workflowJobsTable.id, job.id));
      continue;
    }

    // 8. Retell dispatch & durable state updates
    try {
      const live = await startRetellCall({
        toNumber: phoneNorm.e164,
        market,
        agentId: business.retellAgentId ?? undefined,
        fromNumber: business.phoneNumber?.trim() || undefined,
        metadata: {
          business_id: job.businessId,
          lead_id: call.leadId,
          call_id: call.id,
        },
      });

      started += 1;

      await db
        .update(callsTable)
        .set({
          providerCallId: live.callId,
          status: "in_progress",
          startedAt: new Date(),
          outcome: "Live call started with Retell",
          summary:
            "Retell accepted the call and will report the final outcome by webhook.",
        })
        .where(
          and(
            eq(callsTable.id, call.id),
            eq(callsTable.businessId, job.businessId),
          ),
        );

      await db
        .update(workflowJobsTable)
        .set({
          status: "completed",
          lockedAt: null,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: null,
        })
        .where(eq(workflowJobsTable.id, job.id));

      await db.insert(activitiesTable).values({
        id: `activity_${crypto.randomUUID().slice(0, 12)}`,
        businessId: job.businessId,
        type: "call",
        title: "Queued call started by scheduler",
        detail:
          "Retell credentials became available; the backlog job was processed.",
      });
    } catch (error) {
      failed += 1;
      const message =
        error instanceof Error ? error.message : "Retell request failed";

      await db
        .update(callsTable)
        .set({
          status: "uncertain",
          errorState: message,
          outcome: "Provider state uncertain",
        })
        .where(
          and(
            eq(callsTable.id, call.id),
            eq(callsTable.businessId, job.businessId),
          ),
        );

      const nextAttempts = job.attempts;
      if (nextAttempts < MAX_JOB_ATTEMPTS) {
        // Exponential backoff: 2^attempts minutes (max 60m)
        const backoffMinutes = Math.min(60, Math.pow(2, nextAttempts));
        await db
          .update(workflowJobsTable)
          .set({
            status: "deferred",
            lockedAt: null,
            lockedBy: null,
            leaseExpiresAt: null,
            availableAt: new Date(now.getTime() + backoffMinutes * 60 * 1000),
            lastError: message,
          })
          .where(eq(workflowJobsTable.id, job.id));
      } else {
        await db
          .update(workflowJobsTable)
          .set({
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            leaseExpiresAt: null,
            lastError: message,
          })
          .where(eq(workflowJobsTable.id, job.id));
      }
    }
  }

  return {
    recovered_stale_leases: recoveredStaleLeases,
    jobs_seen: jobs.length,
    attempted,
    started,
    blocked,
    deferred_quiet_hours: deferredQuietHours,
    skipped_not_configured: skippedNotConfigured,
    reconciled_existing: reconciledExisting,
    failed,
  };
}
