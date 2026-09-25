/**
 * /usage + /today honesty tests.
 *
 * Two of the Day 11–14 gaps were invented numbers served as data: /usage
 * hard-coded `period_label: "September 2026"`, and /today hard-coded
 * `unresolved_messages: 1`. These tests hit the real endpoints against a
 * real embedded PostgreSQL and assert the numbers come from the rows.
 */

import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  activitiesTable,
  appointmentsTable,
  businessesTable,
  contactsTable,
  leadsTable,
  usageTable,
} from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import { currentPeriodBounds, periodLabel } from "../lib/usage";
import leadsprintRouter, {
  __resetLeadsprintDb,
  __setLeadsprintDb,
} from "./leadsprint";

const BUSINESS = "business_pilot";
const DAY_MS = 24 * 60 * 60 * 1000;

let db: TestDb;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // Same scope the demo-auth shortcut in routes/index.ts would resolve:
  // every request acts as the pilot workspace's operator.
  app.use((_req, _res, next) => {
    _req.leadSprintUserId = "user_pilot";
    _req.leadSprintBusinessId = BUSINESS;
    next();
  });
  app.use("/api", leadsprintRouter);
  return app;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(businessesTable).values(pilotBusiness());
  __setLeadsprintDb(db as never);
});

afterEach(() => {
  __resetLeadsprintDb();
});

describe("GET /api/usage", () => {
  it("labels the current period and starts at zero when no row exists", async () => {
    const res = await request(buildApp()).get("/api/usage");
    expect(res.status).toBe(200);
    expect(res.body.period_label).toBe(periodLabel(currentPeriodBounds().start));
    expect(res.body.voice_minutes).toBe(0);
    expect(res.body.booking_count).toBe(0);

    // ...and the read created the current month's row for later writers.
    const rows = await db.select().from(usageTable).where(eq(usageTable.businessId, BUSINESS));
    expect(rows).toHaveLength(1);
  });

  it("serves the current month's numbers even when a legacy row holds history", async () => {
    const { start, end } = currentPeriodBounds();
    // Pre-rollover row shape: fixed id, creation-month period, real spend.
    await db.insert(usageTable).values({
      id: `usage_${BUSINESS}`,
      businessId: BUSINESS,
      periodStart: new Date(start.getFullYear() - 1, start.getMonth(), 1),
      periodEnd: new Date(end.getFullYear() - 1, end.getMonth() + 1, 0, 23, 59, 59),
      voiceMinutes: "999.9",
      bookingCount: 99,
    });

    const res = await request(buildApp()).get("/api/usage");
    expect(res.status).toBe(200);
    expect(res.body.period_label).toBe(periodLabel(start));
    // The current month genuinely has no spend yet — the endpoint must
    // not leak another period's numbers into it.
    expect(res.body.voice_minutes).toBe(0);
    expect(res.body.booking_count).toBe(0);

    const legacy = await db
      .select()
      .from(usageTable)
      .where(eq(usageTable.id, `usage_${BUSINESS}`));
    expect(Number(legacy[0]?.voiceMinutes)).toBe(999.9);
  });
});

describe("GET /api/today", () => {
  it("counts trailing-7-day message activities as unresolved messages", async () => {
    const now = Date.now();
    await db.insert(activitiesTable).values([
      {
        id: "activity_msg_recent_1",
        businessId: BUSINESS,
        type: "message",
        title: "Message captured mid-call",
        detail: "Call abc: please call back",
        createdAt: new Date(now - 1 * DAY_MS),
      },
      {
        id: "activity_msg_recent_2",
        businessId: BUSINESS,
        type: "message",
        title: "Transfer failed — message captured",
        detail: "Human transfer did not connect",
        createdAt: new Date(now - 6 * DAY_MS),
      },
      {
        id: "activity_msg_stale",
        businessId: BUSINESS,
        type: "message",
        title: "Message captured mid-call",
        detail: "Old item outside the trailing window",
        createdAt: new Date(now - 8 * DAY_MS),
      },
      {
        id: "activity_call_recent",
        businessId: BUSINESS,
        type: "call",
        title: "Call completed",
        detail: "Not a message",
        createdAt: new Date(now - 1 * DAY_MS),
      },
    ]);

    const res = await request(buildApp()).get("/api/today");
    expect(res.status).toBe(200);
    expect(res.body.metrics.unresolved_messages).toBe(2);
  });

  it("reports zero unresolved messages for a quiet workspace", async () => {
    const res = await request(buildApp()).get("/api/today");
    expect(res.status).toBe(200);
    expect(res.body.metrics.unresolved_messages).toBe(0);
  });
});

describe("GET /api/today", () => {
  it("counts only appointments inside the business's local day", async () => {
    // 13:00 America/New_York on the frozen day these tests run in.
    await db.insert(contactsTable).values({
      id: "contact_today",
      businessId: BUSINESS,
      name: "Ava Williams",
      phone: "+19175550184",
      consentStatus: "valid",
      consentSource: "web_form:listing-enquiry",
      consentAt: new Date(),
      timezone: "America/New_York",
    });
    await db.insert(leadsTable).values({
      id: "lead_today",
      businessId: BUSINESS,
      contactId: "contact_today",
      project: "Spring buyer campaign",
      propertyType: "Condo",
      budgetLabel: "$850k – $1.1M",
      location: "Williamsburg",
      timeline: "0–3 months",
    });

    const now = new Date();
    const todayStart = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const nextMonth = new Date(now.getTime() + 30 * DAY_MS);

    await db.insert(appointmentsTable).values([
      {
        id: "appointment_today",
        businessId: BUSINESS,
        contactId: "contact_today",
        leadId: "lead_today",
        serviceOrProperty: "Buyer consultation",
        startTime: todayStart,
        endTime: new Date(todayStart.getTime() + 30 * 60 * 1000),
        timezone: "America/New_York",
        externalId: "cal_today",
        status: "confirmed",
      },
      {
        id: "appointment_next_month",
        businessId: BUSINESS,
        contactId: "contact_today",
        leadId: "lead_today",
        serviceOrProperty: "Buyer consultation",
        startTime: nextMonth,
        endTime: new Date(nextMonth.getTime() + 30 * 60 * 1000),
        timezone: "America/New_York",
        externalId: "cal_next_month",
        status: "confirmed",
      },
    ]);

    const res = await request(buildApp()).get("/api/today");
    expect(res.status).toBe(200);
    // A booking for next month is not a booking today; the metric used to
    // count every confirmed appointment ever made.
    expect(res.body.metrics.appointments_today).toBe(1);
    // The console still lists what is coming up.
    expect(res.body.upcoming).toHaveLength(2);
  });
});

describe("GET /api/reports/weekly", () => {
  it("reads voice minutes from the current month's row", async () => {
    const { start } = currentPeriodBounds();
    await db.insert(usageTable).values({
      id: `usage_${BUSINESS}`,
      businessId: BUSINESS,
      periodStart: new Date(start.getFullYear() - 1, start.getMonth(), 1),
      periodEnd: new Date(start.getFullYear() - 1, start.getMonth() + 1, 0, 23, 59, 59),
      voiceMinutes: "999.9",
      estimatedCost: "120",
    });

    const res = await request(buildApp()).get("/api/reports/weekly");
    expect(res.status).toBe(200);
    expect(res.body.voice_minutes).toBe(0);
    expect(res.body.estimated_provider_cost).toBe(0);
  });
});
