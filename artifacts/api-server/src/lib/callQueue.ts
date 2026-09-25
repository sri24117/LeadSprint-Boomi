/**
 * The speed-to-lead path.
 *
 * This is the single implementation of "a lead should be called" and "a
 * queued call should now be dialed". Everything that can cause an outbound
 * call goes through here:
 *
 *   - POST /api/webhooks/intake      (automatic — this is what makes the
 *                                     product "LeadSprint" rather than an
 *                                     operator-assisted response desk)
 *   - POST /api/calls/start          (operator, console)
 *   - POST /api/cron/process-jobs    (worker draining the queue / retries)
 *
 * Two hard rules, both enforced here rather than at each call site:
 *
 * 1. **Idempotency.** A replayed intake webhook, a double-clicked console
 *    button, and a retried cron job must never produce two phone calls.
 *    The call row's (business_id, idempotency_key) unique index is the
 *    enforcement point, and the workflow job shares the same key.
 *
 * 2. **The policy gate runs immediately before the provider request**, not
 *    just at enqueue time. A lead can be suppressed, have consent revoked,
 *    or cross into quiet hours between being queued and being dialed.
 */

import crypto from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  activitiesTable,
  businessesTable,
  callsTable,
  contactsTable,
  db as defaultDb,
  leadsTable,
  workflowJobsTable,
} from "@workspace/db";
import { evaluateCallPolicy, nextAllowedCallTime } from "./policy";
import { hasRetellConfigForMarket, startRetellCall } from "./providers";
import { liveCallingBlockedReason } from "./onboarding";
import { logger } from "./logger";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}

/**
 * The database handle these functions use. Overridable so the acceptance
 * tests can exercise the real SQL (unique indexes, tenant scoping, gate
 * ordering) against an embedded PostgreSQL instead of mocking it away —
 * the idempotency guarantees here are enforced by constraints, so a
 * mocked database would prove nothing.
 */
export type Database = typeof defaultDb;

let db: Database = defaultDb;

export function __setCallQueueDb(next: Database): void {
  db = next;
}

export function __resetCallQueueDb(): void {
  db = defaultDb;
}

export type CallSource = "intake" | "console" | "cron";

export interface EnqueueResult {
  /** The call row that represents this attempt (existing one if duplicate). */
  call: typeof callsTable.$inferSelect;
  /** False when an identical request had already been queued. */
  created: boolean;
}

/**
 * Creates (at most) one queued call and one workflow job for a lead.
 *
 * `idempotencyKey` must be stable for "the same reason to call": for
 * intake it is derived from the lead id, so replaying the intake webhook
 * for the same lead can never enqueue a second call.
 */
export async function enqueueCallForLead(input: {
  businessId: string;
  leadId: string;
  idempotencyKey: string;
  source: CallSource;
}): Promise<EnqueueResult | null> {
  const { businessId, leadId, idempotencyKey, source } = input;

  const [lead] = await db
    .select({ contactId: leadsTable.contactId })
    .from(leadsTable)
    .where(and(eq(leadsTable.id, leadId), eq(leadsTable.businessId, businessId)));
  if (!lead) return null;

  const callId = id("call");
  const [created] = await db
    .insert(callsTable)
    .values({
      id: callId,
      businessId,
      contactId: lead.contactId,
      leadId,
      provider: "Retell",
      idempotencyKey,
      status: "queued",
      outcome: "Queued for provider",
      summary: "Call queued for the approved qualification script.",
    })
    .onConflictDoNothing({
      target: [callsTable.businessId, callsTable.idempotencyKey],
    })
    .returning();

  if (!created) {
    // Same reason to call, already queued — return the original attempt.
    const [existing] = await db
      .select()
      .from(callsTable)
      .where(
        and(
          eq(callsTable.businessId, businessId),
          eq(callsTable.idempotencyKey, idempotencyKey),
        ),
      );
    return existing ? { call: existing, created: false } : null;
  }

  // The workflow job is the durable retry record. It shares the call's
  // idempotency key so the cron worker can find the call it belongs to and
  // so a replay cannot create a second job either.
  await db
    .insert(workflowJobsTable)
    .values({
      id: id("job"),
      businessId,
      type: "initiate_call",
      idempotencyKey,
    })
    .onConflictDoNothing({
      target: [workflowJobsTable.businessId, workflowJobsTable.idempotencyKey],
    });

  await db.insert(activitiesTable).values({
    id: id("activity"),
    businessId,
    type: "call",
    title: "Call queued",
    detail:
      source === "intake"
        ? "New enquiry received — qualification call queued automatically."
        : source === "console"
          ? "Operator queued a qualification call."
          : "Scheduler queued a qualification call.",
  });

  return { call: created, created: true };
}

export type DispatchOutcome =
  | "started"
  | "policy_blocked"
  | "setup_incomplete"
  | "provider_not_configured"
  | "provider_uncertain"
  | "already_handled";

/**
 * Reasons that a retry can actually clear.
 *
 * Quiet hours pass with the clock, and a half-configured workspace is a
 * deployment being finished. Everything else — no consent, suppressed,
 * unknown location, attempt budget exhausted, kill switch — is a decision,
 * not a delay, and re-dispatching it would either place a call that must
 * not happen or burn an attempt to prove the same answer.
 */
export function isRetryableBlock(reason: string | undefined): boolean {
  return reason === "quiet_hours";
}

export interface DispatchResult {
  outcome: DispatchOutcome;
  call?: typeof callsTable.$inferSelect;
  /** Operator-readable reason, present for every non-"started" outcome. */
  message?: string;
  /** Set when the policy gate blocked the call. */
  policyReason?: string;
  /** True when it is worth trying this call again later. */
  retryable?: boolean;
  /** For a time-based block: the instant at which the retry may be made. */
  retryAt?: Date;
}

/**
 * Attempts to actually place a queued call. Safe to call repeatedly: a
 * call that is no longer `queued` is reported as `already_handled` rather
 * than dialed twice.
 */
export async function dispatchQueuedCall(input: {
  businessId: string;
  callId: string;
}): Promise<DispatchResult> {
  const { businessId, callId } = input;

  const [call] = await db
    .select()
    .from(callsTable)
    .where(and(eq(callsTable.id, callId), eq(callsTable.businessId, businessId)));
  if (!call) {
    return { outcome: "already_handled", message: "Call not found." };
  }
  // A call can be re-dispatched only if it is still queued, or if it was
  // blocked for a reason that time itself clears. Without the second case
  // the retry queue was decorative: a call blocked by quiet hours is
  // written as `policy_blocked`, and every later dispatch of that same row
  // returned `already_handled` — so the worker marked the retry job
  // completed and an enquiry that arrived in the evening was never called
  // at all. The block stays visible on the row; the row is simply eligible
  // again once the window it hit has passed.
  let attempt = call;
  if (attempt.status !== "queued") {
    if (!(attempt.status === "policy_blocked" && isRetryableBlock(attempt.errorState ?? undefined))) {
      return {
        outcome: "already_handled",
        call: attempt,
        message: `Call is already ${attempt.status}; not dialing again.`,
      };
    }
    const [reopened] = await db
      .update(callsTable)
      .set({ status: "queued" })
      .where(
        and(
          eq(callsTable.id, attempt.id),
          eq(callsTable.businessId, businessId),
          eq(callsTable.status, "policy_blocked"),
        ),
      )
      .returning();
    if (!reopened) {
      // Someone else re-opened or finished it between the read and here.
      return {
        outcome: "already_handled",
        call: attempt,
        message: "Another worker is already handling this call.",
      };
    }
    attempt = reopened;
  }

  const [business] = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.id, businessId));
  const market = business?.market === "IN" ? "IN" : "US";

  // Gate 1 — setup. Never dial from a half-configured workspace.
  const setupBlocked = liveCallingBlockedReason(business);
  if (setupBlocked) {
    return {
      outcome: "setup_incomplete",
      call: attempt,
      message: setupBlocked,
      retryable: true,
    };
  }

  if (!hasRetellConfigForMarket(market)) {
    return {
      outcome: "provider_not_configured",
      call: attempt,
      message: `Retell is not configured for the ${market} market.`,
      retryable: true,
    };
  }

  const [contact] = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.id, attempt.contactId));

  // Prior attempts = other non-blocked calls for this lead. A
  // policy-blocked row is not an attempt to reach anybody, so it must not
  // consume the attempt budget.
  const priorAttempts = (
    await db
      .select({ id: callsTable.id })
      .from(callsTable)
      .where(
        and(
          eq(callsTable.businessId, businessId),
          eq(callsTable.leadId, attempt.leadId),
          ne(callsTable.id, attempt.id),
          sql`${callsTable.status} != 'policy_blocked'`,
        ),
      )
  ).length;

  // Gate 2 — safety policy, re-evaluated here (NOT reused from enqueue
  // time) because consent, suppression and the clock all move.
  const decision = evaluateCallPolicy({
    business: {
      timezone: business?.timezone ?? "UTC",
      quietHours: business?.quietHours,
      maxCallAttempts: business?.maxCallAttempts ?? 2,
    },
    contact: {
      consentStatus: contact?.consentStatus ?? "unknown",
      suppressedAt: contact?.suppressedAt ?? null,
      timezone: contact?.timezone,
    },
    attemptsSoFar: priorAttempts,
  });

  if (!decision.allowed) {
    const [blocked] = await db
      .update(callsTable)
      .set({
        status: "policy_blocked",
        outcome: `Blocked — ${decision.reason}`,
        summary: decision.message ?? "Blocked by call policy.",
        errorState: decision.reason ?? "policy_blocked",
      })
      .where(and(eq(callsTable.id, attempt.id), eq(callsTable.businessId, businessId)))
      .returning();
    await db.insert(activitiesTable).values({
      id: id("activity"),
      businessId,
      type: "policy",
      title: "Call blocked by safety policy",
      detail: decision.message ?? "Blocked by call policy.",
    });
    return {
      outcome: "policy_blocked",
      call: blocked ?? attempt,
      message: decision.message,
      policyReason: decision.reason,
      // Quiet hours resolve themselves with time; nothing else does.
      retryable: isRetryableBlock(decision.reason),
      // And this is when: the opening of the next allowed window. A retry
      // on a fixed timer cannot cross a night, so without this a lead who
      // enquired at 22:00 was never called at all.
      retryAt:
        decision.reason === "quiet_hours"
          ? nextAllowedCallTime(business?.quietHours, contact?.timezone ?? "", new Date())
          : undefined,
    };
  }

  // Gate 3 — claim the attempt atomically, then dial.
  //
  // Everything above is a read followed by a decision, which is safe to
  // repeat. This is not: the provider request places a real phone call.
  // Two dispatching workers (the internal scheduler and an external cron,
  // or two replicas during a rolling deploy) can both get this far for the
  // same queued call, and the plain `status !== "queued"` check at the top
  // cannot stop them, because both read the row before either writes it.
  //
  // A conditional UPDATE is the mutual exclusion: exactly one caller can
  // move the row out of `queued`, and only that caller may dial. The
  // loser reports `already_handled` rather than placing a second call.
  const [claimed] = await db
    .update(callsTable)
    .set({ status: "in_progress", startedAt: new Date() })
    .where(
      and(
        eq(callsTable.id, attempt.id),
        eq(callsTable.businessId, businessId),
        eq(callsTable.status, "queued"),
      ),
    )
    .returning();

  if (!claimed) {
    const [current] = await db
      .select()
      .from(callsTable)
      .where(and(eq(callsTable.id, attempt.id), eq(callsTable.businessId, businessId)));
    return {
      outcome: "already_handled",
      call: current ?? call,
      message: `Another worker already started this call (${current?.status ?? "handled"}); not dialing again.`,
    };
  }

  // From here on, a failure is "uncertain", never "didn't happen": Retell
  // may have accepted the call even if we never saw the response.
  try {
    const live = await startRetellCall({
      toNumber: contact?.phone ?? "",
      market,
      metadata: {
        business_id: businessId,
        lead_id: attempt.leadId,
        call_id: attempt.id,
      },
    });
    const [started] = await db
      .update(callsTable)
      .set({
        providerCallId: live.callId,
        outcome: "Live call started with Retell",
        summary:
          "Retell accepted the call and will report the final outcome by webhook.",
      })
      .where(and(eq(callsTable.id, attempt.id), eq(callsTable.businessId, businessId)))
      .returning();
    await db.insert(activitiesTable).values({
      id: id("activity"),
      businessId,
      type: "call",
      title: "Qualification call started",
      detail: "Retell accepted the call · awaiting the signed callback.",
    });
    return { outcome: "started", call: started ?? claimed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retell request failed";
    logger.error({ callId: attempt.id, businessId, err: message }, "Retell call start failed");
    const [uncertain] = await db
      .update(callsTable)
      .set({
        status: "uncertain",
        errorState: message,
        outcome: "Provider state uncertain",
        summary:
          "The call request could not be confirmed. Reconcile against the provider before retrying.",
      })
      .where(and(eq(callsTable.id, attempt.id), eq(callsTable.businessId, businessId)))
      .returning();
    return {
      outcome: "provider_uncertain",
      call: uncertain ?? claimed,
      message,
      retryable: true,
    };
  }
}

/**
 * Stable idempotency key for the automatic call triggered by a lead
 * arriving. One per lead, forever — a replayed intake event for the same
 * lead resolves to the same key and therefore the same single call.
 */
export function intakeIdempotencyKey(leadId: string): string {
  return `intake_${leadId}`;
}
