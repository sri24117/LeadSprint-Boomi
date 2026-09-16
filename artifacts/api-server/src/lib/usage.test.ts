/**
 * Monthly usage-period tests.
 *
 * GET /usage used to hard-code `period_label: "September 2026"` while the
 * numbers came from one accumulate-forever row per business. Usage is now
 * one row per business per calendar month with lazy rollover: a new month
 * starts at zero, prior months stay readable, and writers attribute to
 * the current month's row instead of updating every row the business has.
 */

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { businessesTable, usageTable } from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import {
  currentPeriodBounds,
  getCurrentUsageRow,
  periodLabel,
  recordBooking,
  recordVoiceUsage,
  usageRowId,
} from "./usage";

const BUSINESS = "business_pilot";
const SEPT = new Date(2026, 8, 15, 12, 0, 0);
const OCT = new Date(2026, 9, 15, 12, 0, 0);

async function dbWithBusiness(): Promise<TestDb> {
  const db = await createTestDb();
  await db.insert(businessesTable).values(pilotBusiness());
  return db;
}

describe("usage periods", () => {
  it("computes calendar-month boundaries", () => {
    const { start, end } = currentPeriodBounds(SEPT);
    expect(start).toEqual(new Date(2026, 8, 1, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 8, 30, 23, 59, 59));
  });

  it("labels a period from its own start date", () => {
    expect(periodLabel(new Date(2026, 8, 1))).toBe("September 2026");
    expect(periodLabel(new Date(2026, 0, 1))).toBe("January 2026");
  });

  it("derives a deterministic monthly row id", () => {
    expect(usageRowId(BUSINESS, SEPT)).toBe("usage_business_pilot_2026-09");
    expect(usageRowId(BUSINESS, OCT)).toBe("usage_business_pilot_2026-10");
  });

  it("creates the current month's row at zero and reuses it", async () => {
    const db = await dbWithBusiness();
    const first = await getCurrentUsageRow(db as never, BUSINESS, SEPT);
    expect(first.voiceMinutes).toBe("0");
    expect(first.bookingCount).toBe(0);

    const second = await getCurrentUsageRow(db as never, BUSINESS, SEPT);
    expect(second.id).toBe(first.id);
    const rows = await db.select().from(usageTable).where(eq(usageTable.businessId, BUSINESS));
    expect(rows).toHaveLength(1);
  });

  it("rolls over to a fresh row in a new month and preserves the old one", async () => {
    const db = await dbWithBusiness();
    await recordVoiceUsage(db as never, BUSINESS, 10, 0.12, SEPT);
    await recordBooking(db as never, BUSINESS, SEPT);

    const october = await getCurrentUsageRow(db as never, BUSINESS, OCT);
    expect(october.voiceMinutes).toBe("0");
    expect(october.bookingCount).toBe(0);

    const rows = await db.select().from(usageTable).where(eq(usageTable.businessId, BUSINESS));
    expect(rows).toHaveLength(2);
    const september = rows.find((row) => row.id === usageRowId(BUSINESS, SEPT));
    expect(Number(september?.voiceMinutes)).toBe(10);
    expect(september?.bookingCount).toBe(1);
  });

  it("attributes new spend to the current month without touching prior months", async () => {
    const db = await dbWithBusiness();
    await recordVoiceUsage(db as never, BUSINESS, 10, 0.12, SEPT);

    await recordVoiceUsage(db as never, BUSINESS, 5, 0.12, OCT);
    await recordBooking(db as never, BUSINESS, OCT);

    const rows = await db.select().from(usageTable).where(eq(usageTable.businessId, BUSINESS));
    const september = rows.find((row) => row.id === usageRowId(BUSINESS, SEPT));
    const october = rows.find((row) => row.id === usageRowId(BUSINESS, OCT));
    expect(Number(september?.voiceMinutes)).toBe(10);
    expect(september?.bookingCount).toBe(0);
    expect(Number(october?.voiceMinutes)).toBe(5);
    expect(october?.bookingCount).toBe(1);
    expect(Number(october?.estimatedCost)).toBeCloseTo(0.6, 5);
  });
});
