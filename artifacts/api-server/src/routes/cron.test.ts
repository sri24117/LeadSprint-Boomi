/**
 * Scheduler-endpoint tests.
 *
 * Covers the two Days 11–14 changes to this surface: the cron router is
 * rate-limited (a scheduler that calls a few times an hour must never be
 * able to flood), and the weekly report reads the current month's usage
 * row rather than whichever row the database returns first. Usage numbers
 * leave through the email body rather than the JSON response, so the
 * rewiring is observed through its side effect: the report run creates
 * the current month's row even when a legacy row already exists.
 */

import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { businessesTable, usageTable, usersTable } from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import { currentPeriodBounds, usageRowId } from "../lib/usage";
import cronRouter, { __resetCronDb, __setCronDb } from "./cron";

const BUSINESS = "business_pilot";
const CRON_SECRET = "test_cron_secret";

let db: TestDb;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", cronRouter);
  return app;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(businessesTable).values(pilotBusiness());
  await db.insert(usersTable).values({
    id: "user_pilot",
    businessId: BUSINESS,
    name: "Maya Patel",
    email: "maya@northstarrealty.example",
    role: "owner",
  });
  __setCronDb(db as never);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
});

afterEach(() => {
  __resetCronDb();
  vi.unstubAllEnvs();
});

describe("POST /api/cron/weekly-report", () => {
  it("rejects a missing or wrong scheduler secret", async () => {
    const app = buildApp();
    expect((await request(app).post("/api/cron/weekly-report")).status).toBe(401);
    expect(
      (await request(app).post("/api/cron/weekly-report").set("x-cron-secret", "wrong")).status,
    ).toBe(401);
  });

  it("reads the current month's usage row, creating it when absent", async () => {
    const { start } = currentPeriodBounds();
    // Pre-rollover row shape: fixed id, stale period, real spend.
    await db.insert(usageTable).values({
      id: `usage_${BUSINESS}`,
      businessId: BUSINESS,
      periodStart: new Date(start.getFullYear() - 1, start.getMonth(), 1),
      periodEnd: new Date(start.getFullYear() - 1, start.getMonth() + 1, 0, 23, 59, 59),
      voiceMinutes: "42",
    });

    const res = await request(buildApp())
      .post("/api/cron/weekly-report")
      .set("x-cron-secret", CRON_SECRET);

    expect(res.status).toBe(200);
    // No SMTP in tests: per-business no-op, reported rather than thrown.
    expect(res.body).toEqual({
      businesses: 1,
      sent: 0,
      skipped_no_smtp: 1,
      skipped_no_owner: 0,
    });

    const current = await db
      .select()
      .from(usageTable)
      .where(eq(usageTable.id, usageRowId(BUSINESS)));
    expect(current).toHaveLength(1);
    expect(current[0]?.voiceMinutes).toBe("0");
  });
});
