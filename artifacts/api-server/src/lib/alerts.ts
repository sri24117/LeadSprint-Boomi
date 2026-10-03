import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { callsTable, workflowJobsTable, type db as defaultDb } from "@workspace/db";

type Db = typeof defaultDb;

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_FAILED_CALL_THRESHOLD = 3;
// A queued job whose availableAt is in the future is a deliberate retry
// (e.g. waiting for the recipient's quiet hours to end). Only a job that
// is overdue by this much means the worker has stopped draining the queue.
const STALLED_AFTER_MS = 30 * 60 * 1000;

export interface BusinessAlert {
  business_id: string;
  failed_calls_24h: number;
  stalled_jobs: number;
}

export function failedCallThreshold(): number {
  const raw = Number(process.env["ALERT_FAILED_CALLS_THRESHOLD"]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_FAILED_CALL_THRESHOLD;
}

/**
 * The two failure modes this product cannot afford to hide: calls that end
 * `failed`/`uncertain` (the operator thinks a lead was handled and it was
 * not) and a job queue nothing is draining (leads silently waiting).
 * Grouped per business so a problem always names the tenant it belongs to.
 */
export async function collectHealthAlerts(db: Db, now: Date = new Date()): Promise<BusinessAlert[]> {
  const since = new Date(now.getTime() - 24 * HOUR_MS);
  const stalledBefore = new Date(now.getTime() - STALLED_AFTER_MS);
  const threshold = failedCallThreshold();

  const failed = await db
    .select({ businessId: callsTable.businessId, n: count() })
    .from(callsTable)
    .where(and(inArray(callsTable.status, ["failed", "uncertain"]), gte(callsTable.createdAt, since)))
    .groupBy(callsTable.businessId);

  const stalled = await db
    .select({ businessId: workflowJobsTable.businessId, n: count() })
    .from(workflowJobsTable)
    .where(and(eq(workflowJobsTable.status, "queued"), lt(workflowJobsTable.availableAt, stalledBefore)))
    .groupBy(workflowJobsTable.businessId);

  const byBusiness = new Map<string, BusinessAlert>();
  const entry = (id: string): BusinessAlert => {
    let e = byBusiness.get(id);
    if (!e) {
      e = { business_id: id, failed_calls_24h: 0, stalled_jobs: 0 };
      byBusiness.set(id, e);
    }
    return e;
  };
  for (const row of failed) entry(row.businessId).failed_calls_24h = Number(row.n);
  for (const row of stalled) entry(row.businessId).stalled_jobs = Number(row.n);

  return [...byBusiness.values()].filter(
    (e) => e.failed_calls_24h >= threshold || e.stalled_jobs > 0,
  );
}
