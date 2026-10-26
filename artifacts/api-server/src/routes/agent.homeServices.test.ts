/**
 * The voice agent's record_qualification tool for a home-services workspace
 * (spec §5.6): answers go into the lead's details, urgency updates the column,
 * and the tool tells the agent whether the address is inside the service area.
 * Real estate keeps writing its legacy columns exactly as before.
 */

import crypto from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activitiesTable, businessesTable, contactsTable, leadsTable } from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import agentRouter, { __resetAgentDb, __setAgentDb } from "./agent";

const BUSINESS_ID = "business_pilot";
const LEAD_ID = "lead_hs";
const RETELL_KEY = "retell_test_secret";

let db: TestDb;

function buildApp(): Express {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use("/api", agentRouter);
  return app;
}

/** A mid-call tool request, signed the way Retell signs them. */
function qualify(args: Record<string, unknown>) {
  const raw = JSON.stringify({
    name: "record_qualification",
    args,
    call: { call_id: "retell_call_hs", metadata: { business_id: BUSINESS_ID, lead_id: LEAD_ID } },
  });
  const ts = String(Date.now());
  const digest = crypto.createHmac("sha256", RETELL_KEY).update(raw + ts).digest("hex");
  return request(buildApp())
    .post("/api/agent/qualify")
    .set("content-type", "application/json")
    .set("x-retell-signature", `v=${ts},d=${digest}`)
    .send(raw);
}

async function seed(businessOverrides: Record<string, unknown> = {}, leadOverrides: Record<string, unknown> = {}) {
  await db.insert(businessesTable).values(pilotBusiness({ vertical: "home_services", ...businessOverrides }) as never);
  await db.insert(contactsTable).values({
    id: "contact_hs",
    businessId: BUSINESS_ID,
    name: "Sam Rivera",
    phone: "+15125550142",
    consentStatus: "valid",
    consentSource: "web form",
    consentAt: new Date(),
    timezone: "America/Chicago",
  });
  await db.insert(leadsTable).values({
    id: LEAD_ID,
    businessId: BUSINESS_ID,
    contactId: "contact_hs",
    project: "Spring tune-up",
    propertyType: "Not specified",
    budgetLabel: "Not specified",
    location: "Not specified",
    timeline: "Not specified",
    ...leadOverrides,
  } as never);
}

async function lead() {
  const [row] = await db.select().from(leadsTable).where(eq(leadsTable.id, LEAD_ID));
  return row!;
}

beforeEach(async () => {
  db = await createTestDb();
  __setAgentDb(db as never);
  process.env.RETELL_WEBHOOK_SECRET = RETELL_KEY;
});

afterEach(() => {
  __resetAgentDb();
  delete process.env.RETELL_WEBHOOK_SECRET;
});

describe("record_qualification, home services", () => {
  it("stores the job's answers in details, urgency in its column, and qualifies the lead", async () => {
    await seed();
    const res = await qualify({
      service_type: "ac_repair",
      problem: "No cooling since this morning",
      zip: "78701",
      address: "12 Oak St",
      property_type: "home",
      preferred_time: "tomorrow morning",
      urgency: "same_day",
      qualification_status: "Qualified",
      intent_score: 80,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: true, in_service_area: true });
    const row = await lead();
    expect(row.details).toEqual({
      service_type: "ac_repair",
      problem: "No cooling since this morning",
      zip: "78701",
      address: "12 Oak St",
      property_type: "home",
      preferred_time: "tomorrow morning",
    });
    expect(row.urgency).toBe("same_day");
    expect(row.status).toBe("qualified");
    expect(row.intentScore).toBe(80);
  });

  it("merges into what intake already captured instead of replacing it", async () => {
    await seed({}, { details: { zip: "78701", problem: "old description" } });
    await qualify({ problem: "Compressor is making a grinding noise" });
    expect((await lead()).details).toEqual({ zip: "78701", problem: "Compressor is making a grinding noise" });
  });

  it("ignores anything outside the profile: unknown keys, bad enum values, non-strings", async () => {
    await seed({}, { urgency: "this_week" });
    await qualify({
      evil: "x",
      service_type: "teleport",
      urgency: "whenever",
      zip: 78701,
      problem: "valid problem text",
    });
    const row = await lead();
    expect(row.details).toEqual({ problem: "valid problem text" });
    expect(row.urgency).toBe("this_week");
  });

  it("caps long free text at 500 characters rather than failing the agent's tool call", async () => {
    await seed();
    const res = await qualify({ problem: "x".repeat(900) });
    expect(res.status).toBe(200);
    expect(String((await lead()).details.problem)).toHaveLength(500);
  });

  it("tells the agent when the ZIP is outside the service area, and flags the lead for review", async () => {
    await seed({ serviceAreaZips: ["787"] });
    const res = await qualify({ zip: "10001", problem: "leak" });
    expect(res.body).toMatchObject({ updated: true, in_service_area: false });
    expect((await lead()).nextAction).toBe("Out of service area — review");
    const activities = await db.select().from(activitiesTable);
    expect(activities.some((a) => /service area/i.test(`${a.title} ${a.detail}`))).toBe(true);
  });

  it("reports in_service_area true and leaves the next action alone for an in-area ZIP", async () => {
    await seed({ serviceAreaZips: ["787"] }, { nextAction: "Call lead" });
    const res = await qualify({ zip: "78704" });
    expect(res.body.in_service_area).toBe(true);
    expect((await lead()).nextAction).toBe("Call lead");
  });

  it("judges coverage from the ZIP intake captured when the agent does not repeat it", async () => {
    await seed({ serviceAreaZips: ["787"] }, { details: { zip: "10001" } });
    const res = await qualify({ problem: "leak" });
    expect(res.body.in_service_area).toBe(false);
  });

  it("is in service area when the business has none configured", async () => {
    await seed();
    expect((await qualify({ zip: "99999" })).body.in_service_area).toBe(true);
  });
});

describe("record_qualification, real estate (unchanged)", () => {
  it("still writes the legacy columns and leaves details empty", async () => {
    await seed({ vertical: "real_estate" });
    const res = await qualify({
      location: "Brooklyn",
      property_type: "Condo",
      budget_label: "$700k",
      timeline: "3 months",
      qualification_status: "Qualified",
      zip: "78701",
    });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
    const row = await lead();
    expect(row).toMatchObject({ location: "Brooklyn", propertyType: "Condo", budgetLabel: "$700k", timeline: "3 months", status: "qualified" });
    expect(row.details).toEqual({});
    expect(row.urgency).toBeNull();
  });
});
