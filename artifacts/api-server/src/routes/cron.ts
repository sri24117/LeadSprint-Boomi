import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, lte, lt, ne } from "drizzle-orm";
import {
  activitiesTable,
  appointmentsTable,
  businessesTable,
  callsTable,
  contactsTable,
  db,
  leadsTable,
  providerEventsTable,
  usageTable,
  usersTable,
  workflowJobsTable,
} from "@workspace/db";
import { evaluateCallPolicy } from "../lib/policy";
import { hasRetellConfigForMarket, startRetellCall } from "../lib/providers";
import { sendWeeklyReportEmail } from "../lib/mailer";

const router: IRouter = Router();

const DEFAULT_RETENTION_DAYS = 90;

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/cron/retention — matches the API surface in the product plan.
 * Intended to be called by an external scheduler (cron, Coolify scheduled
 * task, etc.), authenticated with a shared secret rather than an operator
 * session. Deletes raw provider-event payloads and stale activity-feed rows
 * past the retention window; it never touches leads, calls, contacts, or
 * appointments, which are the durable business record.
 */
router.post("/cron/retention", async (req, res): Promise<void> => {
  const secret = process.env["CRON_SECRET"];
  const provided = req.get("x-cron-secret") ?? "";
  if (!secret || !timingSafeEqualStrings(provided, secret)) {
    res.status(401).json({ error: "Invalid or missing cron secret" });
    return;
  }

  const days = Number(process.env["RETENTION_DAYS"] ?? DEFAULT_RETENTION_DAYS);
  const cutoff = new Date(Date.now() - (Number.isFinite(days) ? days : DEFAULT_RETENTION_DAYS) * 24 * 60 * 60 * 1000);

  const deletedEvents = await db.delete(providerEventsTable).where(lt(providerEventsTable.processedAt, cutoff)).returning({ id: providerEventsTable.id });
  const deletedActivities = await db.delete(activitiesTable).where(lt(activitiesTable.createdAt, cutoff)).returning({ id: activitiesTable.id });

  res.json({
    cutoff: cutoff.toISOString(),
    deleted_provider_events: deletedEvents.length,
    deleted_activities: deletedActivities.length,
  });
});

/**
 * POST /api/cron/process-jobs — processes the "initiate_call" workflow
 * jobs created when a call was queued while Retell wasn't configured yet
 * (see POST /calls/start in routes/leadsprint.ts). Without this, a job
 * created during Phase 1 demo mode sits in the queue forever, even after
 * real Retell credentials are added later — this is what actually drains
 * that backlog. Every attempt re-runs the full safety policy gate; it
 * never bypasses consent, suppression, quiet hours, or attempt limits
 * just because a job is old.
 */
router.post("/cron/process-jobs", async (req, res): Promise<void> => {
  const secret = process.env["CRON_SECRET"];
  const provided = req.get("x-cron-secret") ?? "";
  if (!secret || !timingSafeEqualStrings(provided, secret)) {
    res.status(401).json({ error: "Invalid or missing cron secret" });
    return;
  }

  const MAX_JOB_ATTEMPTS = 5;
  const now = new Date();
  const jobs = await db
    .select()
    .from(workflowJobsTable)
    .where(and(eq(workflowJobsTable.type, "initiate_call"), eq(workflowJobsTable.status, "queued"), lte(workflowJobsTable.availableAt, now)))
    .orderBy(asc(workflowJobsTable.availableAt))
    .limit(25);

  let attempted = 0;
  let started = 0;
  let blocked = 0;
  let skippedNotConfigured = 0;
  let failed = 0;

  for (const job of jobs) {
    const [call] = await db.select().from(callsTable).where(and(eq(callsTable.id, job.idempotencyKey), eq(callsTable.businessId, job.businessId)));
    if (!call || call.status !== "queued") {
      // Already handled through another path (manual retry, webhook, etc).
      await db.update(workflowJobsTable).set({ status: "completed" }).where(eq(workflowJobsTable.id, job.id));
      continue;
    }

    const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, job.businessId));
    const market = business?.market === "IN" ? "IN" : "US";
    if (!hasRetellConfigForMarket(market)) {
      skippedNotConfigured += 1;
      continue; // leave queued; no credentials yet, don't burn an attempt
    }

    attempted += 1;
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, call.contactId));
    const priorAttempts = (
      await db.select({ id: callsTable.id }).from(callsTable).where(
        and(eq(callsTable.leadId, call.leadId), eq(callsTable.businessId, job.businessId), ne(callsTable.id, call.id)),
      )
    ).length;

    const decision = evaluateCallPolicy({
      business: { timezone: business?.timezone ?? "UTC", quietHours: business?.quietHours, maxCallAttempts: business?.maxCallAttempts ?? 2 },
      contact: { consentStatus: contact?.consentStatus ?? "valid", suppressedAt: contact?.suppressedAt ?? null },
      attemptsSoFar: priorAttempts,
    });

    if (!decision.allowed) {
      blocked += 1;
      await db.update(callsTable).set({ status: "policy_blocked", outcome: `Blocked — ${decision.reason}`, summary: decision.message ?? "Blocked by call policy.", errorState: decision.reason }).where(eq(callsTable.id, call.id));
      const nextAttempts = job.attempts + 1;
      if (decision.reason === "quiet_hours" && nextAttempts < MAX_JOB_ATTEMPTS) {
        // Quiet hours resolve themselves with time — worth another look later.
        await db.update(workflowJobsTable).set({ attempts: nextAttempts, availableAt: new Date(now.getTime() + 30 * 60 * 1000), lastError: decision.message }).where(eq(workflowJobsTable.id, job.id));
      } else {
        await db.update(workflowJobsTable).set({ status: "failed", attempts: nextAttempts, lastError: decision.message }).where(eq(workflowJobsTable.id, job.id));
      }
      continue;
    }

    try {
      const live = await startRetellCall({ toNumber: contact?.phone ?? "", market, metadata: { business_id: job.businessId, lead_id: call.leadId, call_id: call.id } });
      started += 1;
      await db.update(callsTable).set({ providerCallId: live.callId, status: "in_progress", startedAt: new Date(), outcome: "Live call started with Retell", summary: "Retell accepted the call and will report the final outcome by webhook." }).where(eq(callsTable.id, call.id));
      await db.update(workflowJobsTable).set({ status: "completed" }).where(eq(workflowJobsTable.id, job.id));
      await db.insert(activitiesTable).values({ id: `activity_${crypto.randomUUID().slice(0, 12)}`, businessId: job.businessId, type: "call", title: "Queued call started by scheduler", detail: "Retell credentials became available; the backlog job was processed." });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Retell request failed";
      await db.update(callsTable).set({ status: "uncertain", errorState: message, outcome: "Provider state uncertain" }).where(eq(callsTable.id, call.id));
      const nextAttempts = job.attempts + 1;
      if (nextAttempts < MAX_JOB_ATTEMPTS) {
        await db.update(workflowJobsTable).set({ attempts: nextAttempts, availableAt: new Date(now.getTime() + 10 * 60 * 1000), lastError: message }).where(eq(workflowJobsTable.id, job.id));
      } else {
        await db.update(workflowJobsTable).set({ status: "failed", attempts: nextAttempts, lastError: message }).where(eq(workflowJobsTable.id, job.id));
      }
    }
  }

  res.json({ jobs_seen: jobs.length, attempted, started, blocked, skipped_not_configured: skippedNotConfigured, failed });
});

/**
 * POST /api/cron/weekly-report — emails each business's owner the same
 * numbers as GET /reports/weekly. No-ops per business (reported, not
 * thrown) when SMTP isn't configured yet, so this is safe to schedule
 * before email delivery is set up.
 */
router.post("/cron/weekly-report", async (req, res): Promise<void> => {
  const secret = process.env["CRON_SECRET"];
  const provided = req.get("x-cron-secret") ?? "";
  if (!secret || !timingSafeEqualStrings(provided, secret)) {
    res.status(401).json({ error: "Invalid or missing cron secret" });
    return;
  }

  const businesses = await db.select().from(businessesTable);
  let sent = 0;
  let skippedNoSmtp = 0;
  let skippedNoOwner = 0;

  for (const business of businesses) {
    const [owner] = await db.select().from(usersTable).where(and(eq(usersTable.businessId, business.id), eq(usersTable.role, "owner"))).limit(1);
    if (!owner?.email) { skippedNoOwner += 1; continue; }

    const leads = await db.select().from(leadsTable).where(eq(leadsTable.businessId, business.id));
    const calls = await db.select().from(callsTable).where(eq(callsTable.businessId, business.id));
    const appointments = await db.select().from(appointmentsTable).where(eq(appointmentsTable.businessId, business.id));
    const [usage] = await db.select().from(usageTable).where(eq(usageTable.businessId, business.id));

    const delivered = await sendWeeklyReportEmail({
      to: owner.email,
      businessName: business.name,
      periodLabel: "This week · pilot report",
      leadsReceived: leads.length,
      callsAttempted: calls.length,
      callsConnected: calls.filter((c) => c.status === "completed" || c.status === "in_progress").length,
      qualifiedLeads: leads.filter((l) => l.status === "qualified" || l.status === "booked").length,
      appointmentsBooked: appointments.length,
      transferRate: calls.length ? calls.filter((c) => c.transferred).length / calls.length : 0,
      failedActions: calls.filter((c) => c.status === "failed" || c.status === "uncertain").length,
      voiceMinutes: Number(usage?.voiceMinutes ?? 0),
      estimatedProviderCost: Number(usage?.estimatedCost ?? 0),
    });
    if (delivered) sent += 1; else skippedNoSmtp += 1;
  }

  res.json({ businesses: businesses.length, sent, skipped_no_smtp: skippedNoSmtp, skipped_no_owner: skippedNoOwner });
});

export default router;
