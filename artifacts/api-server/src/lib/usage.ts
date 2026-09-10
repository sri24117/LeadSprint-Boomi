import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, usageTable } from "@workspace/db";

export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface BillingPeriod {
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
}

/**
 * Deterministically calculates the calendar-month UTC billing period boundaries
 * and human-readable label for any given reference timestamp.
 */
export function getBillingPeriod(asOf: Date = new Date()): BillingPeriod {
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth();

  const periodStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  const periodLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(periodStart);

  return { periodStart, periodEnd, periodLabel };
}

/**
 * Retrieves the active billing period usage record for a given business.
 * If no record exists for the active billing period, safely provisions one.
 * Uses database-level concurrency protection (.onConflictDoNothing) to ensure
 * duplicate rows are never created under concurrent requests.
 */
export async function getActiveUsageRow(
  businessId: string,
  asOf: Date = new Date(),
  executor: DbExecutor = db,
): Promise<typeof usageTable.$inferSelect> {
  const { periodStart, periodEnd } = getBillingPeriod(asOf);

  // 1. Check for existing active period record
  const [existing] = await executor
    .select()
    .from(usageTable)
    .where(
      and(
        eq(usageTable.businessId, businessId),
        lte(usageTable.periodStart, asOf),
        gte(usageTable.periodEnd, asOf),
      ),
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  // 2. Safe provision with deterministic ID & conflict handling
  const year = asOf.getUTCFullYear();
  const monthPad = String(asOf.getUTCMonth() + 1).padStart(2, "0");
  const usageId = `usage_${businessId}_${year}_${monthPad}`;

  await executor
    .insert(usageTable)
    .values({
      id: usageId,
      businessId,
      periodStart,
      periodEnd,
      voiceMinutes: "0",
      smsCount: 0,
      bookingCount: 0,
      estimatedCost: "0",
    })
    .onConflictDoNothing();

  // 3. Re-select to guarantee returning the canonical row
  const [persisted] = await executor
    .select()
    .from(usageTable)
    .where(
      and(
        eq(usageTable.businessId, businessId),
        lte(usageTable.periodStart, asOf),
        gte(usageTable.periodEnd, asOf),
      ),
    )
    .limit(1);

  if (!persisted) {
    throw new Error(
      `Failed to resolve or provision active usage record for business ${businessId}`,
    );
  }

  return persisted;
}
