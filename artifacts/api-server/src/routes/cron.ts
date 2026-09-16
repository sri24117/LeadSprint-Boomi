import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, eq, lte, lt, ne } from "drizzle-orm";
import {
  activitiesTable,
  appointmentsTable,
  businessesTable,
  callsTable,
  contactsTable,
  db as defaultDb,
  leadsTable,
  providerEventsTable,
  usersTable,
  workflowJobsTable,
} from "@workspace/db";
import { dispatchQueuedCall } from "../lib/callQueue";
import { sendWeeklyReportEmail } from "../lib/mailer";
import { getCurrentUsageRow } from "../lib/usage";
import { createCronLimiter } from "../middlewares/rateLimit";

const router: IRouter = Router();

// Overridable database handle — see lib/callQueue.ts for why the
// acceptance tests run against a real embedded PostgreSQL rather than a
// mock.
let db: typeof defaultDb = defaultDb;

export function __setCronDb(next: typeof defaultDb): void {
  db = next;
}

export function __resetCronDb(): void {
  db = defaultDb;
}

// The scheduler calls each endpoint a few times an hour; anything more is
// a misconfiguration or a flood, and the per-IP ceiling is set for that.
router.use(createCronLimiter());

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
 * POST /api/cron/process-jobs — the worker that drains the outbound call
 * queue. Every "initiate_call" job created by the intake webhook, the
 * operator console, or a previous deferred attempt is retried here under
 * its original idempotency key, so a retry can never place a second call.
 *
 * Every attempt re-runs the setup gate and the full safety policy gate
 * via lib/callQueue.ts's dispatchQueuedCall — a job never bypasses
 * consent, suppression, quiet hours, attempt limits or the kill switch
 * just because it is old.
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

  let started = 0;
  let blocked = 0;
  let deferred = 0;
  let failed = 0;
  let alreadyHandled = 0;

  for (const job of jobs) {
    // The job's idempotency key IS the call id it was created for (see
    // lib/callQueue.ts). One shared dispatcher runs the setup gate, the
    // full safety policy gate, and the provider request — a job being old
    // never bypasses any of them.
    const result = await dispatchQueuedCall({ businessId: job.businessId, callId: job.idempotencyKey });
    const nextAttempts = job.attempts + 1;

    switch (result.outcome) {
      case "started":
        started += 1;
        await db.update(workflowJobsTable).set({ status: "completed" }).where(eq(workflowJobsTable.id, job.id));
        break;

      case "already_handled":
        alreadyHandled += 1;
        await db.update(workflowJobsTable).set({ status: "completed" }).where(eq(workflowJobsTable.id, job.id));
        break;

      case "setup_incomplete":
      case "provider_not_configured":
        // Not the lead's fault and not a wasted attempt — leave the job
        // queued so the backlog drains by itself once the workspace is
        // finished being configured.
        deferred += 1;
        await db.update(workflowJobsTable).set({ availableAt: new Date(now.getTime() + 15 * 60 * 1000), lastError: result.message }).where(eq(workflowJobsTable.id, job.id));
        break;

      case "policy_blocked":
        blocked += 1;
        if (result.retryable && nextAttempts < MAX_JOB_ATTEMPTS) {
          // Quiet hours resolve themselves with time — worth another look.
          await db.update(workflowJobsTable).set({ attempts: nextAttempts, availableAt: new Date(now.getTime() + 30 * 60 * 1000), lastError: result.message }).where(eq(workflowJobsTable.id, job.id));
        } else {
          await db.update(workflowJobsTable).set({ status: "failed", attempts: nextAttempts, lastError: result.message }).where(eq(workflowJobsTable.id, job.id));
        }
        break;

      case "provider_uncertain":
      default:
        failed += 1;
        if (nextAttempts < MAX_JOB_ATTEMPTS) {
          await db.update(workflowJobsTable).set({ attempts: nextAttempts, availableAt: new Date(now.getTime() + 10 * 60 * 1000), lastError: result.message }).where(eq(workflowJobsTable.id, job.id));
        } else {
          await db.update(workflowJobsTable).set({ status: "failed", attempts: nextAttempts, lastError: result.message }).where(eq(workflowJobsTable.id, job.id));
        }
        break;
    }
  }

  res.json({ jobs_seen: jobs.length, started, blocked, deferred, failed, already_handled: alreadyHandled });
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
    const usage = await getCurrentUsageRow(db, business.id);

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
