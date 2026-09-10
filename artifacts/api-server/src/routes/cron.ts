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
import { normalizeToE164 } from "../lib/phone";
import { getActiveUsageRow } from "../lib/usage";
import { processWorkflowJobs } from "../lib/worker";

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

  const result = await processWorkflowJobs();
  res.json(result);
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
    const usage = await getActiveUsageRow(business.id);

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
