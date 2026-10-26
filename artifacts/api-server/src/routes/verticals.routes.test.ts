/**
 * Vertical profile wiring through the operator API (spec §5.2, §5.3, §5.8):
 * the session carries the workspace's profile, settings can change the
 * vertical and its service area, and a lead exposes its industry details.
 */

import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { businessesTable, contactsTable, leadsTable, usersTable } from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import leadsprintRouter, { __resetLeadsprintDb, __setLeadsprintDb } from "./leadsprint";

const BUSINESS_ID = "business_pilot";

let db: TestDb;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.leadSprintUserId = "user_pilot";
    req.leadSprintBusinessId = BUSINESS_ID;
    next();
  });
  app.use("/api", leadsprintRouter);
  return app;
}

async function seedBusiness(overrides: Record<string, unknown> = {}) {
  await db.insert(businessesTable).values(pilotBusiness(overrides) as never);
  await db.insert(usersTable).values({
    id: "user_pilot",
    businessId: BUSINESS_ID,
    name: "Pat Operator",
    email: "pat@example.com",
    role: "owner",
  });
}

async function seedLead(opts: { details?: Record<string, unknown>; urgency?: string | null; consentEvidence?: string | null } = {}) {
  await db.insert(contactsTable).values({
    id: "contact_1",
    businessId: BUSINESS_ID,
    name: "Dana Reyes",
    phone: "+15125550142",
    consentStatus: "valid",
    consentSource: "meta_lead_form:form_1",
    consentAt: new Date(),
    consentEvidence: opts.consentEvidence ?? null,
    timezone: "America/Chicago",
  });
  await db.insert(leadsTable).values({
    id: "lead_1",
    businessId: BUSINESS_ID,
    contactId: "contact_1",
    project: "Spring tune-up",
    propertyType: "Not specified",
    budgetLabel: "Not specified",
    location: "Not specified",
    timeline: "Not specified",
    details: (opts.details ?? {}) as never,
    urgency: opts.urgency ?? null,
  });
}

beforeEach(async () => {
  db = await createTestDb();
  __setLeadsprintDb(db as never);
});

afterEach(() => {
  __resetLeadsprintDb();
});

describe("GET /api/auth/me", () => {
  it("returns the real-estate profile for a default workspace, with today's fields", async () => {
    await seedBusiness();
    const res = await request(buildApp()).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.business.vertical).toBe("real_estate");
    expect(res.body.profile.id).toBe("real_estate");
    expect(res.body.profile.appointment_label).toBe("Viewing");
    expect(res.body.profile.fields.map((f: { key: string }) => f.key)).toEqual(["property_type", "budget_label", "location", "timeline"]);
    expect(res.body.profile.urgency_levels).toEqual([]);
  });

  it("returns the home-services profile for a home-services workspace", async () => {
    await seedBusiness({ vertical: "home_services" });
    const res = await request(buildApp()).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.business.vertical).toBe("home_services");
    expect(res.body.profile.id).toBe("home_services");
    expect(res.body.profile.appointment_label).toBe("Service visit");
    expect(res.body.profile.urgency_levels.map((u: { value: string }) => u.value)).toEqual(["emergency", "same_day", "this_week", "quote"]);
    expect(JSON.stringify(res.body.profile)).not.toMatch(/emergencyKeywords|gas leak/);
  });

  it("falls back to real estate if a stored vertical is unknown, rather than failing the session", async () => {
    await seedBusiness();
    await db.update(businessesTable).set({ vertical: "plumber_v2" }).where(eq(businessesTable.id, BUSINESS_ID));
    const res = await request(buildApp()).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.profile.id).toBe("real_estate");
    expect(res.body.business.vertical).toBe("real_estate");
  });
});

describe("business settings: vertical, notify email, service area, pricing policy", () => {
  it("are readable with safe defaults", async () => {
    await seedBusiness();
    const res = await request(buildApp()).get("/api/business-settings");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ vertical: "real_estate", notify_email: null, service_area_zips: [], pricing_policy: null });
  });

  it("can be changed together and read back", async () => {
    await seedBusiness();
    const app = buildApp();
    const patch = await request(app).patch("/api/business-settings").send({
      vertical: "home_services",
      notify_email: "dispatch@frostline.example",
      service_area_zips: ["787", "78660"],
      pricing_policy: "Our diagnostic visit is $89, applied to the repair.",
    });
    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({
      vertical: "home_services",
      notify_email: "dispatch@frostline.example",
      service_area_zips: ["787", "78660"],
      pricing_policy: "Our diagnostic visit is $89, applied to the repair.",
    });
    const read = await request(app).get("/api/business-settings");
    expect(read.body).toMatchObject({ vertical: "home_services", service_area_zips: ["787", "78660"] });
  });

  it("can be cleared again (null email and policy, empty service area)", async () => {
    await seedBusiness({ notifyEmail: "a@b.example", serviceAreaZips: ["787"], pricingPolicy: "x" });
    const res = await request(buildApp()).patch("/api/business-settings").send({ notify_email: null, pricing_policy: null, service_area_zips: [] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ notify_email: null, pricing_policy: null, service_area_zips: [] });
  });

  it("rejects values the system cannot use", async () => {
    await seedBusiness();
    const app = buildApp();
    const bad: Array<Record<string, unknown>> = [
      { vertical: "plumber" },
      { service_area_zips: ["abc"] },
      { service_area_zips: ["12"] },
      { service_area_zips: ["123456"] },
      { notify_email: "not-an-email" },
      { notify_email: "a@b" },
      { pricing_policy: "x".repeat(501) },
    ];
    for (const body of bad) {
      const res = await request(app).patch("/api/business-settings").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // Nothing was half-applied.
    const read = await request(app).get("/api/business-settings");
    expect(read.body).toMatchObject({ vertical: "real_estate", notify_email: null, service_area_zips: [] });
  });

  it("does not disturb the settings it was not asked to change", async () => {
    await seedBusiness();
    const res = await request(buildApp()).patch("/api/business-settings").send({ vertical: "home_services" });
    expect(res.status).toBe(200);
    expect(res.body.quiet_hours).toBe("21:00–08:00");
    expect(res.body.approved_faq).toBe("We help buyers in Manhattan and Brooklyn.");
  });
});

describe("lead DTO", () => {
  it("exposes details, urgency and consent evidence", async () => {
    await seedBusiness({ vertical: "home_services" });
    await seedLead({
      details: { service_type: "ac_repair", problem: "No cooling", zip: "78701" },
      urgency: "emergency",
      consentEvidence: "I agree to be contacted by an automated assistant by phone.",
    });
    const res = await request(buildApp()).get("/api/leads/lead_1");
    expect(res.status).toBe(200);
    expect(res.body.details).toEqual({ service_type: "ac_repair", problem: "No cooling", zip: "78701" });
    expect(res.body.urgency).toBe("emergency");
    expect(res.body.consent_evidence).toBe("I agree to be contacted by an automated assistant by phone.");
  });

  it("defaults to empty details and null urgency for a real-estate lead", async () => {
    await seedBusiness();
    await seedLead();
    const res = await request(buildApp()).get("/api/leads/lead_1");
    expect(res.status).toBe(200);
    expect(res.body.details).toEqual({});
    expect(res.body.urgency).toBeNull();
    expect(res.body.consent_evidence).toBeNull();
  });

  it("can be found by a ZIP or problem word held in details", async () => {
    await seedBusiness({ vertical: "home_services" });
    await seedLead({ details: { problem: "water heater leaking", zip: "78701" } });
    const app = buildApp();
    expect((await request(app).get("/api/leads").query({ search: "78701" })).body).toHaveLength(1);
    expect((await request(app).get("/api/leads").query({ search: "heater" })).body).toHaveLength(1);
    expect((await request(app).get("/api/leads").query({ search: "99999" })).body).toHaveLength(0);
  });
});
