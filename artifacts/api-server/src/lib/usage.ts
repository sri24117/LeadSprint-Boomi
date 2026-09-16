import { eq, sql } from "drizzle-orm";
import { db as defaultDb, usageTable } from "@workspace/db";

/**
 * Monthly usage periods.
 *
 * GET /usage used to hard-code `period_label: "September 2026"` while the
 * numbers came from a single accumulate-forever row per business — after
 * the first month both the label and the "x / 300 included minutes" bar
 * would have been fiction. Usage is now one row per business per calendar
 * month, created lazily on first use:
 *
 * - Reads and writers always go through getCurrentUsageRow(), which
 *   find-or-creates the current month's row. A new month starts at zero;
 *   prior months' rows stay in the database as the audit trail.
 * - The row id is deterministic (`usage_<business>_<YYYY-MM>`), so two
 *   concurrent first-of-month requests collapse onto one row via the
 *   primary key instead of double-creating.
 * - Rows created before this change (id `usage_<business>`) keep their
 *   creation-month periodStart and remain readable history; new spend
 *   lands on the monthly rows.
 *
 * Every function takes the database handle as a parameter (rather than a
 * module-level seam) so callers pass their own already-overridable handle
 * and tests keep injecting through a single seam.
 */

type DbHandle = typeof defaultDb;
type UsageRow = typeof usageTable.$inferSelect;

export interface PeriodBounds {
  start: Date;
  end: Date;
}

/** Calendar-month boundaries containing `now`, in server-local time. */
export function currentPeriodBounds(now: Date = new Date()): PeriodBounds {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
  };
}

/** "September 2026" — derived from the row's own period, never hard-coded. */
export function periodLabel(periodStart: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(periodStart);
}

export function usageRowId(businessId: string, now: Date = new Date()): string {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `usage_${businessId}_${month}`;
}

/** The current month's usage row for a business, creating it at zero if needed. */
export async function getCurrentUsageRow(
  dbHandle: DbHandle,
  businessId: string,
  now: Date = new Date(),
): Promise<UsageRow> {
  const rowId = usageRowId(businessId, now);
  const [existing] = await dbHandle
    .select()
    .from(usageTable)
    .where(eq(usageTable.id, rowId))
    .limit(1);
  if (existing) return existing;

  const { start, end } = currentPeriodBounds(now);
  const [created] = await dbHandle
    .insert(usageTable)
    .values({ id: rowId, businessId, periodStart: start, periodEnd: end })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a first-of-month race with another request — re-read the winner.
  const [winner] = await dbHandle
    .select()
    .from(usageTable)
    .where(eq(usageTable.id, rowId))
    .limit(1);
  if (!winner) {
    throw new Error(`Usage row ${rowId} could not be created or read`);
  }
  return winner;
}

/** Add completed-call minutes (and their estimated cost) to the current month. */
export async function recordVoiceUsage(
  dbHandle: DbHandle,
  businessId: string,
  minutes: number,
  costPerMinute: number,
  now: Date = new Date(),
): Promise<void> {
  const row = await getCurrentUsageRow(dbHandle, businessId, now);
  await dbHandle
    .update(usageTable)
    .set({
      voiceMinutes: sql`${usageTable.voiceMinutes} + ${minutes}`,
      estimatedCost: sql`${usageTable.estimatedCost} + ${minutes * costPerMinute}`,
    })
    .where(eq(usageTable.id, row.id));
}

/** Count one confirmed booking against the current month. */
export async function recordBooking(
  dbHandle: DbHandle,
  businessId: string,
  now: Date = new Date(),
): Promise<void> {
  const row = await getCurrentUsageRow(dbHandle, businessId, now);
  await dbHandle
    .update(usageTable)
    .set({ bookingCount: sql`${usageTable.bookingCount} + 1` })
    .where(eq(usageTable.id, row.id));
}
