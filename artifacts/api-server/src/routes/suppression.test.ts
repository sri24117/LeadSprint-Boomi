/**
 * Do-not-call handling, end to end.
 *
 * Each test pins a way an opted-out person could previously still be called,
 * or a way recording the opt-out broke the console:
 *
 *   - the operator "Suppress" button wrote a consent value the API schema
 *     rejects, so the lead — and the whole Leads page — returned 500;
 *   - the suppression list was written but never read, and numbers were
 *     compared as raw strings, so "(213) 555-0111" was a new, callable
 *     contact after "+12135550111" opted out;
 *   - a caller saying "stop calling me" on the call was filed as a message
 *     and the lead's next action became "Call back";
 *   - a lead source revoking consent for an existing contact was dropped as
 *     a duplicate.
 */

import crypto from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  businessesTable,
  callsTable,
  contactsTable,
  leadsTable,
  suppressionsTable,
} from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import leadsprintRouter, { __resetLeadsprintDb, __setLeadsprintDb } from "./leadsprint";
import webhooksRouter, { __resetWebhooksDb, __setWebhooksDb } from "./webhooks";
import agentRouter, { __resetAgentDb, __setAgentDb } from "./agent";
import { __resetCallQueueDb, __setCallQueueDb } from "../lib/callQueue";
import { normalizePhone } from "../lib/suppression";
import * as providers from "../lib/providers";

const BUSINESS_ID = "business_pilot";
const LEAD_ID = "lead_dnc";
const CONTACT_ID = "contact_dnc";
const PHONE = "+12135550111";
const OPEN = "2026-09-16T19:00:00Z"; // 12:00 Los Angeles, 15:00 New York — inside every window
const INTAKE_SECRET = "intake_test_secret";
const RETELL_KEY = "retell_test_secret";

const ENV = {
  RETELL_API_KEY: "key",
  RETELL_AGENT_ID: "agent_live",
  RETELL_FROM_NUMBER_US: "+12125550100",
  RETELL_WEBHOOK_SECRET: RETELL_KEY,
  CALCOM_API_KEY: "cal_key",
  CALCOM_EVENT_TYPE_ID: "12345",
  LEAD_INTAKE_WEBHOOK_SECRET: INTAKE_SECRET,
};

let db: TestDb;
const startRetellCall = vi.spyOn(providers, "startRetellCall");

function buildApp(): Express {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use("/api", webhooksRouter);
  app.use("/api", agentRouter);
  app.use((req, _res, next) => {
    req.leadSprintUserId = "user_pilot";
    req.leadSprintBusinessId = BUSINESS_ID;
    next();
  });
  app.use("/api", leadsprintRouter);
  return app;
}

function intake(body: Record<string, unknown>) {
  const raw = JSON.stringify({ business_id: BUSINESS_ID, ...body });
  const sig = crypto.createHmac("sha256", INTAKE_SECRET).update(raw).digest("hex");
  return request(buildApp())
    .post("/api/webhooks/intake")
    .set("content-type", "application/json")
    .set("x-leadsprint-signature", `sha256=${sig}`)
    .send(raw);
}

/** A mid-call tool request, signed the way Retell signs them. */
function agentTool(path: string, args: Record<string, unknown>) {
  const raw = JSON.stringify({
    name: path,
    args,
    call: { call_id: "retell_call_dnc", metadata: { business_id: BUSINESS_ID, lead_id: LEAD_ID } },
  });
  const ts = String(Date.now());
  const digest = crypto.createHmac("sha256", RETELL_KEY).update(raw + ts).digest("hex");
  return request(buildApp())
    .post(`/api/agent/${path}`)
    .set("content-type", "application/json")
    .set("x-retell-signature", `v=${ts},d=${digest}`)
    .send(raw);
}

async function seedLead(phone = PHONE) {
  await db.insert(contactsTable).values({
    id: CONTACT_ID,
    businessId: BUSINESS_ID,
    name: "Dana Reyes",
    phone,
    consentStatus: "valid",
    consentSource: "web_form:listing-enquiry",
    consentAt: new Date(),
    timezone: "America/Los_Angeles",
  });
  await db.insert(leadsTable).values({
    id: LEAD_ID,
    businessId: BUSINESS_ID,
    contactId: CONTACT_ID,
    project: "Spring buyer campaign",
    propertyType: "Condo",
    budgetLabel: "Not specified",
    location: "Not specified",
    timeline: "Not specified",
  });
}

async function contact() {
  const [row] = await db.select().from(contactsTable).where(eq(contactsTable.id, CONTACT_ID));
  return row;
}

async function suppressionRows() {
  return db.select().from(suppressionsTable).where(eq(suppressionsTable.businessId, BUSINESS_ID));
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(OPEN));
  db = await createTestDb();
  await db.insert(businessesTable).values(pilotBusiness() as never);
  __setLeadsprintDb(db as never);
  __setWebhooksDb(db as never);
  __setAgentDb(db as never);
  __setCallQueueDb(db as never);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  delete process.env.LEADSPRINT_KILL_SWITCH;
  startRetellCall.mockReset();
  startRetellCall.mockResolvedValue({ callId: "retell_call_new" });
});

afterEach(() => {
  vi.useRealTimers();
  __resetLeadsprintDb();
  __resetWebhooksDb();
  __resetAgentDb();
  __resetCallQueueDb();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

describe("normalizePhone", () => {
  it("puts every spelling of a US number in E.164", () => {
    for (const spelling of ["(213) 555-0111", "213-555-0111", "213.555.0111", "12135550111", "+1 213 555 0111"]) {
      expect(normalizePhone(spelling)).toBe(PHONE);
    }
  });

  it("keeps international numbers international", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
  });

  it("leaves things that are not phone numbers alone rather than inventing one", () => {
    expect(normalizePhone("12345")).toBe("12345");
  });
});

describe("operator Suppress button", () => {
  it("suppresses the lead without breaking the lead or the Leads page", async () => {
    await seedLead();
    const app = buildApp();

    const res = await request(app).post(`/api/leads/${LEAD_ID}/suppress`).send({ reason: "Asked to stop" });
    expect(res.status).toBe(200);
    expect(res.body.suppressed).toBe(true);
    expect(res.body.consent_status).toBe("revoked");
    expect(res.body.callable).toBe(false);

    expect((await request(app).get(`/api/leads/${LEAD_ID}`)).status).toBe(200);
    expect((await request(app).get("/api/leads")).status).toBe(200);
    expect((await request(app).get("/api/activity")).status).toBe(200);

    const rows = await suppressionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.phone).toBe(PHONE);
  });

  it("is idempotent: suppressing twice records one do-not-call entry", async () => {
    await seedLead();
    const app = buildApp();
    await request(app).post(`/api/leads/${LEAD_ID}/suppress`).send({});
    await request(app).post(`/api/leads/${LEAD_ID}/suppress`).send({});
    expect(await suppressionRows()).toHaveLength(1);
  });
});

describe("intake", () => {
  const lead = (phone: string, extra: Record<string, unknown> = {}) => ({
    name: "Dana Reyes",
    phone,
    consent_status: "valid",
    consent_source: "web form",
    ...extra,
  });

  it("stores numbers in E.164 and treats a reformatted number as the same person", async () => {
    const first = await intake(lead("(213) 555-0111"));
    expect(first.body.accepted).toBe(true);
    const [stored] = await db.select().from(contactsTable).where(eq(contactsTable.businessId, BUSINESS_ID));
    expect(stored?.phone).toBe(PHONE);

    const again = await intake(lead("+1 213-555-0111"));
    expect(again.body).toMatchObject({ accepted: false, reason: "duplicate" });
  });

  it("never dials a number on the do-not-call list, even arriving as a brand-new lead", async () => {
    await db.insert(suppressionsTable).values({ id: "suppression_1", businessId: BUSINESS_ID, phone: PHONE, reason: "Opted out", source: "operator" });

    const res = await intake(lead("(213) 555-0111"));
    expect(res.body.accepted).toBe(true);
    expect(res.body.call.status).toBe("policy_blocked");
    expect(startRetellCall).not.toHaveBeenCalled();

    const [call] = await db.select().from(callsTable).where(eq(callsTable.businessId, BUSINESS_ID));
    expect(call?.errorState).toBe("suppressed");
  });

  it("matches a do-not-call entry recorded before numbers were normalized", async () => {
    // Rows written by older code hold whatever the lead source sent.
    await db.insert(suppressionsTable).values({ id: "suppression_legacy", businessId: BUSINESS_ID, phone: "(213) 555-0111", reason: "Opted out", source: "operator" });
    const res = await intake(lead(PHONE));
    expect(res.body.call.status).toBe("policy_blocked");
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("applies a consent revocation for a contact it already holds", async () => {
    await seedLead();
    const res = await intake({ name: "Dana Reyes", phone: "213 555 0111", consent_status: "revoked" });
    expect(res.body).toMatchObject({ accepted: true, reason: "consent_revoked" });

    const row = await contact();
    expect(row?.consentStatus).toBe("revoked");
    expect(row?.suppressedAt).not.toBeNull();
    expect(await suppressionRows()).toHaveLength(1);
  });
});

describe("voice agent", () => {
  it("opt_out stops all future calls to the caller", async () => {
    await seedLead();
    const res = await agentTool("opt_out", { reason: "please stop calling me" });
    expect(res.status).toBe(200);
    expect(res.body.opted_out).toBe(true);

    const row = await contact();
    expect(row?.consentStatus).toBe("revoked");
    expect(row?.suppressedAt).not.toBeNull();
    const [leadRow] = await db.select().from(leadsTable).where(eq(leadsTable.id, LEAD_ID));
    expect(leadRow?.status).toBe("suppressed");
    expect(leadRow?.nextAction).not.toMatch(/call back/i);

    const retry = await request(buildApp()).post("/api/calls/start").send({ lead_id: LEAD_ID });
    expect(retry.status).toBe(409);
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("treats a do-not-call request filed via capture_message as an opt-out, not a callback", async () => {
    await seedLead();
    const res = await agentTool("message", { message: "Take me off your list, don't call again" });
    expect(res.body).toMatchObject({ captured: true, opted_out: true });

    const row = await contact();
    expect(row?.consentStatus).toBe("revoked");
    const [leadRow] = await db.select().from(leadsTable).where(and(eq(leadsTable.id, LEAD_ID), eq(leadsTable.businessId, BUSINESS_ID)));
    expect(leadRow?.nextAction).not.toMatch(/call back/i);
  });

  it("still files an ordinary message as a callback", async () => {
    await seedLead();
    const res = await agentTool("message", { message: "Call me after 5, I'm at work" });
    expect(res.body).toEqual({ captured: true });
    expect((await contact())?.consentStatus).toBe("valid");
  });
});

describe("quiet-hours setting", () => {
  it("rejects a value the safety gate cannot read instead of silently ignoring it", async () => {
    const app = buildApp();
    for (const bad of ["9pm-8am", "21:00", "21:00-21:00", "25:00-08:00", ""]) {
      const res = await request(app).patch("/api/business-settings").send({ quiet_hours: bad });
      expect(res.status, bad).toBe(400);
    }
    const ok = await request(app).patch("/api/business-settings").send({ quiet_hours: "20:00-09:00" });
    expect(ok.status).toBe(200);
  });
});
