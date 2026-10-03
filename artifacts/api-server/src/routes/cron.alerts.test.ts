/**
 * Health-alert endpoint checks (written before the implementation).
 *
 * CHECK-01  A missing or wrong scheduler secret is rejected.
 * CHECK-02  A healthy system reports no alert.
 * CHECK-03  Failed/uncertain calls in the last 24h at or over the threshold alert.
 * CHECK-04  Failed calls older than 24h do not count.
 * CHECK-05  A queued job that is overdue (not a deliberate future retry) alerts as stalled.
 * CHECK-06  A quiet-hours retry scheduled for the future is NOT stalled.
 * CHECK-07  The summary is per business, so one tenant's problem names that tenant.
 * CHECK-08  With no SMTP/ALERT_EMAIL the endpoint still answers 200 and says it could not notify.
 */

import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  businessesTable,
  callsTable,
  contactsTable,
  leadsTable,
  workflowJobsTable,
} from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import cronRouter, { __resetCronDb, __setCronDb } from "./cron";

const BUSINESS = "business_pilot";
const CRON_SECRET = "test_cron_secret";
const HOUR = 60 * 60 * 1000;

let db: TestDb;
let seq = 0;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", cronRouter);
  return app;
}

async function seedCall(businessId: string, status: string, createdAt: Date): Promise<void> {
  seq += 1;
  const contactId = `contact_${seq}`;
  const leadId = `lead_${seq}`;
  await db.insert(contactsTable).values({
    id: contactId,
    businessId,
    name: `Lead ${seq}`,
    phone: `+1212555${String(1000 + seq)}`,
    email: null,
  } as never);
  await db.insert(leadsTable).values({
    id: leadId,
    businessId,
    contactId,
    source: "test",
    project: "Test project",
    propertyType: "Condo",
    budgetLabel: "$500k",
    location: "Manhattan",
    timeline: "3 months",
  } as never);
  await db.insert(callsTable).values({
    id: `call_${seq}`,
    businessId,
    contactId,
    leadId,
    idempotencyKey: `key_${seq}`,
    status,
    createdAt,
  } as never);
}

async function seedJob(businessId: string, availableAt: Date, status = "queued"): Promise<void> {
  seq += 1;
  await db.insert(workflowJobsTable).values({
    id: `job_${seq}`,
    businessId,
    type: "initiate_call",
    idempotencyKey: `job_key_${seq}`,
    status,
    availableAt,
  } as never);
}

async function runAlerts() {
  return request(buildApp()).post("/api/cron/health-alerts").set("x-cron-secret", CRON_SECRET);
}

beforeEach(async () => {
  seq = 0;
  db = await createTestDb();
  await db.insert(businessesTable).values(pilotBusiness());
  __setCronDb(db as never);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("ALERT_EMAIL", "");
});

afterEach(() => {
  __resetCronDb();
  vi.unstubAllEnvs();
});

describe("POST /api/cron/health-alerts", () => {
  it("CHECK-01 rejects a missing or wrong scheduler secret", async () => {
    const app = buildApp();
    expect((await request(app).post("/api/cron/health-alerts")).status).toBe(401);
    expect(
      (await request(app).post("/api/cron/health-alerts").set("x-cron-secret", "wrong")).status,
    ).toBe(401);
  });

  it("CHECK-02 reports no alert for a healthy system", async () => {
    await seedCall(BUSINESS, "completed", new Date());
    const res = await runAlerts();
    expect(res.status).toBe(200);
    expect(res.body.alert).toBe(false);
    expect(res.body.businesses).toEqual([]);
  });

  it("CHECK-03 alerts when failed/uncertain calls in 24h reach the threshold", async () => {
    await seedCall(BUSINESS, "failed", new Date());
    await seedCall(BUSINESS, "uncertain", new Date());
    expect((await runAlerts()).body.alert).toBe(false); // 2 < default threshold of 3
    await seedCall(BUSINESS, "failed", new Date());
    const res = await runAlerts();
    expect(res.body.alert).toBe(true);
    expect(res.body.businesses[0]).toMatchObject({ business_id: BUSINESS, failed_calls_24h: 3 });
  });

  it("CHECK-04 ignores failures older than 24 hours", async () => {
    const old = new Date(Date.now() - 30 * HOUR);
    for (let i = 0; i < 5; i += 1) await seedCall(BUSINESS, "failed", old);
    const res = await runAlerts();
    expect(res.body.alert).toBe(false);
  });

  it("CHECK-05 flags an overdue queued job as stalled", async () => {
    await seedJob(BUSINESS, new Date(Date.now() - 2 * HOUR));
    const res = await runAlerts();
    expect(res.body.alert).toBe(true);
    expect(res.body.businesses[0]).toMatchObject({ business_id: BUSINESS, stalled_jobs: 1 });
  });

  it("CHECK-06 does not flag a deliberate future retry (quiet hours) as stalled", async () => {
    await seedJob(BUSINESS, new Date(Date.now() + 6 * HOUR));
    const res = await runAlerts();
    expect(res.body.alert).toBe(false);
  });

  it("CHECK-07 attributes problems to the right tenant", async () => {
    await db.insert(businessesTable).values(pilotBusiness({ id: "business_other", name: "Other Co" }));
    await seedJob("business_other", new Date(Date.now() - 2 * HOUR));
    const res = await runAlerts();
    expect(res.body.businesses).toHaveLength(1);
    expect(res.body.businesses[0].business_id).toBe("business_other");
  });

  it("CHECK-08 answers 200 and says it could not notify when email is not configured", async () => {
    await seedJob(BUSINESS, new Date(Date.now() - 2 * HOUR));
    const res = await runAlerts();
    expect(res.status).toBe(200);
    expect(res.body.alert).toBe(true);
    expect(res.body.notified).toBe(false);
  });
});
