/**
 * The demo workspaces (spec §5.9): the default real-estate demo is unchanged,
 * and LEADSPRINT_DEMO_VERTICAL=home_services seeds "Frostline HVAC & Plumbing".
 */

import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../test/testDb";
import leadsprintRouter, { DEMO_BUSINESS_ID, DEMO_USER_ID, __resetLeadsprintDb, __setLeadsprintDb } from "./leadsprint";

let db: TestDb;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.leadSprintUserId = DEMO_USER_ID;
    req.leadSprintBusinessId = DEMO_BUSINESS_ID;
    next();
  });
  app.use("/api", leadsprintRouter);
  return app;
}

beforeEach(async () => {
  db = await createTestDb();
  __setLeadsprintDb(db as never);
});

afterEach(() => {
  __resetLeadsprintDb();
  vi.unstubAllEnvs();
});

describe("default demo (real estate)", () => {
  it("is unchanged: Northstar Realty, four leads, no urgency", async () => {
    const app = buildApp();
    const me = await request(app).get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.business.name).toBe("Northstar Realty");
    expect(me.body.business.vertical).toBe("real_estate");
    const leads = await request(app).get("/api/leads");
    expect(leads.body).toHaveLength(4);
    expect(leads.body.every((l: { urgency: unknown }) => l.urgency === null)).toBe(true);
  });
});

describe("home-services demo", () => {
  beforeEach(() => {
    vi.stubEnv("LEADSPRINT_DEMO_VERTICAL", "home_services");
  });

  it("seeds Frostline HVAC & Plumbing as a home-services workspace that is ready to call", async () => {
    const app = buildApp();
    const me = await request(app).get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.business).toMatchObject({ name: "Frostline HVAC & Plumbing", vertical: "home_services", timezone: "America/Chicago" });
    expect(me.body.profile.id).toBe("home_services");
    const settings = await request(app).get("/api/business-settings");
    expect(settings.body).toMatchObject({
      notify_email: "dispatch@frostline.example",
      service_area_zips: ["787", "78660", "78664"],
    });
    expect(settings.body.pricing_policy).toMatch(/\$89/);
    // Every workspace-level setup item is complete. (Retell and Cal.com
    // readiness come from environment variables, which `pnpm demo` sets to its
    // stubs; a unit test has none.)
    const checklist = await request(app).get("/api/onboarding/checklist");
    const missing = checklist.body.missing_required as string[];
    expect(missing.filter((key) => !key.startsWith("provider_"))).toEqual([]);
  });

  it("seeds five leads that tell the story: same-day, emergency, quote, out of area, needs consent", async () => {
    const app = buildApp();
    await request(app).get("/api/auth/me");
    const leads = (await request(app).get("/api/leads")).body as Array<{
      name: string; urgency: string | null; details: Record<string, string>; next_action: string; consent_status: string; source: string;
    }>;
    expect(leads).toHaveLength(5);
    const by = Object.fromEntries(leads.map((l) => [l.name, l]));
    expect(by["Marisol Vega"]).toMatchObject({ urgency: "same_day", source: "Facebook lead ad", consent_status: "valid" });
    expect(by["Marisol Vega"]!.details).toMatchObject({ service_type: "ac_repair", zip: "78704" });
    expect(by["Jordan Blake"]).toMatchObject({ urgency: "emergency" });
    expect(by["Jordan Blake"]!.details.problem).toMatch(/burst pipe/i);
    expect(by["Chen Wei"]).toMatchObject({ urgency: "quote" });
    expect(by["Tom Becker"]!.next_action).toBe("Out of service area — review");
    expect(by["Tom Becker"]!.details.zip).toBe("10001");
    expect(by["Lena Ortiz"]).toMatchObject({ consent_status: "unknown" });
  });

  it("shows consent wording as evidence for the Meta leads that gave it", async () => {
    const app = buildApp();
    await request(app).get("/api/auth/me");
    const leads = (await request(app).get("/api/leads")).body as Array<{ name: string; consent_evidence: string | null }>;
    expect(leads.find((l) => l.name === "Marisol Vega")?.consent_evidence).toMatch(/automated assistant/i);
    expect(leads.find((l) => l.name === "Lena Ortiz")?.consent_evidence).toBeNull();
  });

  it("has a booked service visit, a live emergency call, and a Today page that renders", async () => {
    const app = buildApp();
    await request(app).get("/api/auth/me");
    const appointments = (await request(app).get("/api/appointments")).body as Array<{ service_or_property: string }>;
    expect(appointments).toHaveLength(1);
    expect(appointments[0]!.service_or_property).toMatch(/^Service visit/);
    const calls = (await request(app).get("/api/calls")).body as Array<{ status: string; lead_name: string }>;
    expect(calls.some((c) => c.status === "in_progress" && c.lead_name === "Jordan Blake")).toBe(true);
    expect((await request(app).get("/api/today")).status).toBe(200);
    expect((await request(app).get("/api/activity")).status).toBe(200);
    expect((await request(app).get("/api/usage")).status).toBe(200);
  });

  it("is idempotent: loading the session again does not duplicate anything", async () => {
    const app = buildApp();
    await request(app).get("/api/auth/me");
    await request(app).get("/api/auth/me");
    await request(app).get("/api/leads");
    expect((await request(app).get("/api/leads")).body).toHaveLength(5);
    expect((await request(app).get("/api/appointments")).body).toHaveLength(1);
  });

  it("is ignored when the value is anything else, leaving the real-estate demo", async () => {
    vi.stubEnv("LEADSPRINT_DEMO_VERTICAL", "plumber_v2");
    const me = await request(buildApp()).get("/api/auth/me");
    expect(me.body.business.name).toBe("Northstar Realty");
  });
});
