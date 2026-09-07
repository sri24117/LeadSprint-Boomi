import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { lt } from "drizzle-orm";
import { activitiesTable, db, providerEventsTable } from "@workspace/db";

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

export default router;
