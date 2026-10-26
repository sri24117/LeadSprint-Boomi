/**
 * Home-services intake (spec §5.4, §5.5): industry details, Meta lead consent,
 * service area, emergency alerts, and the optional key authentication for
 * no-code senders. The safety gate itself is exercised elsewhere; here we only
 * prove that intake feeds it correctly and never weakens it.
 */

import crypto from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { activitiesTable, businessesTable, callsTable, contactsTable, leadsTable } from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import webhooksRouter, { __resetWebhooksDb, __setWebhooksDb } from "./webhooks";
import { __resetCallQueueDb, __setCallQueueDb } from "../lib/callQueue";
import * as providers from "../lib/providers";
import * as mailer from "../lib/mailer";

const BUSINESS_ID = "business_pilot";
const SECRET = "intake_test_secret";
const OPEN = "2026-09-16T19:00:00Z"; // 14:00 in Austin: inside the calling window
const ENV = {
  RETELL_API_KEY: "key",
  RETELL_AGENT_ID: "agent_live",
  RETELL_FROM_NUMBER_US: "+12125550100",
  RETELL_WEBHOOK_SECRET: "retell_secret",
  CALCOM_API_KEY: "cal_key",
  CALCOM_EVENT_TYPE_ID: "12345",
  LEAD_INTAKE_WEBHOOK_SECRET: SECRET,
};

let db: TestDb;
const startRetellCall = vi.spyOn(providers, "startRetellCall");
const sendAlert = vi.spyOn(mailer, "sendBusinessAlertEmail");

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
  return app;
}

/** A properly signed intake request (HMAC, the default). */
function intake(body: Record<string, unknown>) {
  const raw = JSON.stringify({ business_id: BUSINESS_ID, ...body });
  const sig = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  return request(buildApp())
    .post("/api/webhooks/intake")
    .set("content-type", "application/json")
    .set("x-leadsprint-signature", `sha256=${sig}`)
    .send(raw);
}

let phoneSeq = 0;
const nextPhone = () => `+1512555${String(1000 + ++phoneSeq)}`;
const consent = { consent_status: "valid", consent_source: "web form: test" };

/** The body a no-code connector would send for a Meta lead with consent. */
function metaLead(extra: Record<string, unknown> = {}) {
  return {
    name: "Dana Reyes",
    phone: nextPhone(),
    source: "meta_lead_ads",
    campaign: "AC tune-up spring",
    form_id: "form_1",
    consent_given: true,
    consent_text: "I agree to be contacted by an automated assistant by phone about my request.",
    details: { service_type: "ac_repair", problem: "AC not cooling", zip: "78701" },
    ...extra,
  };
}

async function onlyLead() {
  const [lead] = await db.select().from(leadsTable);
  const [contact] = await db.select().from(contactsTable);
  return { lead, contact };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(OPEN));
  db = await createTestDb();
  await db.insert(businessesTable).values(pilotBusiness({ vertical: "home_services", name: "Frostline HVAC" }) as never);
  __setWebhooksDb(db as never);
  __setCallQueueDb(db as never);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  delete process.env.LEADSPRINT_KILL_SWITCH;
  delete process.env.INTAKE_ALLOW_KEY_AUTH;
  startRetellCall.mockReset();
  startRetellCall.mockResolvedValue({ callId: "retell_call_new" });
  sendAlert.mockReset();
  sendAlert.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  __resetWebhooksDb();
  __resetCallQueueDb();
  for (const key of Object.keys(ENV)) delete process.env[key];
  delete process.env.INTAKE_ALLOW_KEY_AUTH;
});

describe("key authentication for no-code senders", () => {
  const keyed = (key: string | undefined, body: Record<string, unknown> = metaLead()) => {
    const req = request(buildApp()).post("/api/webhooks/intake").set("content-type", "application/json");
    if (key !== undefined) req.set("x-leadsprint-key", key);
    return req.send(JSON.stringify({ business_id: BUSINESS_ID, ...body }));
  };

  it("is OFF by default: the right key alone is refused", async () => {
    const res = await keyed(SECRET);
    expect(res.status).toBe(401);
    expect(startRetellCall).not.toHaveBeenCalled();
    expect(await db.select().from(leadsTable)).toHaveLength(0);
  });

  it("when enabled, accepts the exact secret and refuses anything else", async () => {
    process.env.INTAKE_ALLOW_KEY_AUTH = "true";
    expect((await keyed("wrong-secret")).status).toBe(401);
    expect((await keyed("")).status).toBe(401);
    expect((await keyed(undefined)).status).toBe(401);
    expect((await keyed(SECRET.slice(0, -1))).status).toBe(401);
    expect(await db.select().from(leadsTable)).toHaveLength(0);
    const ok = await keyed(SECRET);
    expect(ok.status).toBe(201);
    expect(ok.body.accepted).toBe(true);
  });

  it("when enabled, HMAC signing still works", async () => {
    process.env.INTAKE_ALLOW_KEY_AUTH = "true";
    expect((await intake(metaLead())).status).toBe(201);
  });

  it("never authenticates when no intake secret is configured, even with an empty key", async () => {
    process.env.INTAKE_ALLOW_KEY_AUTH = "true";
    delete process.env.LEAD_INTAKE_WEBHOOK_SECRET;
    expect((await keyed("")).status).toBe(401);
    expect((await keyed("anything")).status).toBe(401);
  });
});

describe("industry details and urgency", () => {
  it("stores details, and classifies a routine problem as this_week", async () => {
    const res = await intake({ name: "Dana Reyes", phone: nextPhone(), ...consent, details: { service_type: "ac_repair", problem: "AC not cooling as well as last year", zip: "78701" } });
    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(true);
    const { lead } = await onlyLead();
    expect(lead?.details).toEqual({ service_type: "ac_repair", problem: "AC not cooling as well as last year", zip: "78701" });
    expect(lead?.urgency).toBe("this_week");
    expect(startRetellCall).toHaveBeenCalledTimes(1);
  });

  it("flags a gas smell as an emergency from the problem text", async () => {
    await intake({ name: "Sam", phone: nextPhone(), ...consent, details: { problem: "I can smell gas near the furnace" } });
    expect((await onlyLead()).lead?.urgency).toBe("emergency");
  });

  it("lets a supplied valid urgency win, and ignores an invalid one", async () => {
    await intake({ name: "Sam", phone: nextPhone(), ...consent, urgency: "same_day", details: { problem: "burst pipe" } });
    expect((await onlyLead()).lead?.urgency).toBe("same_day");

    await db.delete(callsTable); await db.delete(leadsTable); await db.delete(contactsTable);
    await intake({ name: "Sam", phone: nextPhone(), ...consent, urgency: "whenever", details: { problem: "dripping tap" } });
    expect((await onlyLead()).lead?.urgency).toBe("this_week");
  });

  it("rejects malformed details with 400 and creates nothing", async () => {
    for (const details of [{ a: { nested: 1 } }, "text", [1], { a: null }]) {
      const res = await intake({ name: "Sam", phone: nextPhone(), ...consent, details });
      expect(res.status, JSON.stringify(details)).toBe(400);
    }
    expect(await db.select().from(leadsTable)).toHaveLength(0);
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("leaves a real-estate workspace exactly as before: no urgency, empty details", async () => {
    await db.update(businessesTable).set({ vertical: "real_estate" }).where(eq(businessesTable.id, BUSINESS_ID));
    await intake({ name: "Sam", phone: nextPhone(), ...consent, property_type: "Condo", budget_label: "$500k" });
    const { lead } = await onlyLead();
    expect(lead?.urgency).toBeNull();
    expect(lead?.details).toEqual({});
    expect(lead?.propertyType).toBe("Condo");
    expect(lead?.budgetLabel).toBe("$500k");
  });
});

describe("Meta lead consent", () => {
  it("is valid only with consent_given true, the consent wording, and the form id: then it records the evidence and calls", async () => {
    const res = await intake(metaLead());
    expect(res.body.accepted).toBe(true);
    const { contact } = await onlyLead();
    expect(contact?.consentStatus).toBe("valid");
    expect(contact?.consentSource).toBe("meta_lead_form:form_1");
    expect(contact?.consentEvidence).toBe("I agree to be contacted by an automated assistant by phone about my request.");
    expect(contact?.consentAt).not.toBeNull();
    expect(startRetellCall).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no consent wording", { consent_text: undefined }],
    ["blank consent wording", { consent_text: "   " }],
    ["no form id", { form_id: undefined }],
    ["consent_given false", { consent_given: false }],
    ["consent_given missing", { consent_given: undefined }],
    ["consent_given as the string 'true'", { consent_given: "true" }],
  ])("stays 'unknown' and is NOT called when there is %s", async (_label, change) => {
    const res = await intake(metaLead(change));
    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(true);
    const { contact } = await onlyLead();
    expect(contact?.consentStatus).toBe("unknown");
    expect(startRetellCall).not.toHaveBeenCalled();
    const [call] = await db.select().from(callsTable);
    expect(call?.errorState).toBe("consent_invalid");
  });

  it("does not let a careless consent_status of valid bypass the Meta rule", async () => {
    await intake(metaLead({ consent_given: undefined, consent_text: undefined, consent_status: "valid", consent_source: "zap" }));
    expect((await onlyLead()).contact?.consentStatus).toBe("unknown");
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("still lets a Meta source revoke consent", async () => {
    await intake(metaLead({ consent_status: "revoked" }));
    expect((await onlyLead()).contact?.consentStatus).toBe("revoked");
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("rejects consent wording longer than 1000 characters", async () => {
    const res = await intake(metaLead({ consent_text: "x".repeat(1001) }));
    expect(res.status).toBe(400);
    expect(await db.select().from(leadsTable)).toHaveLength(0);
  });

  it("does not change other sources: a signed lead with consent_status valid is still valid", async () => {
    await intake({ name: "Sam", phone: nextPhone(), source: "website", ...consent });
    const { contact } = await onlyLead();
    expect(contact?.consentStatus).toBe("valid");
    expect(contact?.consentSource).toBe("web form: test");
    expect(contact?.consentEvidence).toBeNull();
  });
});

describe("service area", () => {
  beforeEach(async () => {
    await db.update(businessesTable).set({ serviceAreaZips: ["787", "78660"] as never }).where(eq(businessesTable.id, BUSINESS_ID));
  });

  it("creates but does not call a lead whose ZIP is outside the area", async () => {
    const res = await intake({ name: "Far Away", phone: nextPhone(), ...consent, details: { problem: "leak", zip: "10001" } });
    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(true);
    expect(res.body.call.status).toBe("not_queued");
    expect(startRetellCall).not.toHaveBeenCalled();
    expect(await db.select().from(callsTable)).toHaveLength(0);
    const { lead } = await onlyLead();
    expect(lead?.nextAction).toBe("Out of service area — review");
    const activities = await db.select().from(activitiesTable);
    expect(activities.some((a) => /service area/i.test(`${a.title} ${a.detail}`))).toBe(true);
  });

  it("calls a lead inside the area, by exact ZIP and by prefix", async () => {
    await intake({ name: "A", phone: nextPhone(), ...consent, details: { zip: "78660" } });
    await intake({ name: "B", phone: nextPhone(), ...consent, details: { zip: "78704" } });
    expect(startRetellCall).toHaveBeenCalledTimes(2);
  });

  it("calls a lead that gave no ZIP: the agent asks", async () => {
    await intake({ name: "No Zip", phone: nextPhone(), ...consent, details: { problem: "drain" } });
    expect(startRetellCall).toHaveBeenCalledTimes(1);
  });

  it("reads the ZIP from an address when no zip field is sent", async () => {
    await intake({ name: "Addr", phone: nextPhone(), ...consent, details: { address: "9 Broadway, New York, NY 10004" } });
    expect(startRetellCall).not.toHaveBeenCalled();
  });
});

describe("emergency alerts", () => {
  const emergency = (extra: Record<string, unknown> = {}) => ({
    name: "Sam Rivera",
    phone: nextPhone(),
    source: "meta_lead_ads",
    form_id: "form_9",
    consent_given: true,
    consent_text: "I agree to automated calls.",
    details: { service_type: "plumbing_repair", problem: "Burst pipe in the kitchen", zip: "78701", address: "12 Oak St" },
    ...extra,
  });

  beforeEach(async () => {
    await db.update(businessesTable).set({ notifyEmail: "dispatch@frostline.example" }).where(eq(businessesTable.id, BUSINESS_ID));
  });

  it("emails the owner at intake with the job details", async () => {
    const res = await intake(emergency());
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(sendAlert).toHaveBeenCalledTimes(1));
    const [to, subject, lines] = sendAlert.mock.calls[0] as [string, string, string[]];
    expect(to).toBe("dispatch@frostline.example");
    expect(subject).toMatch(/emergency/i);
    const body = lines.join("\n");
    for (const expected of ["Sam Rivera", "Burst pipe in the kitchen", "78701", "12 Oak St", "meta_lead_ads"]) {
      expect(body).toContain(expected);
    }
    expect(body).toContain("+1512555");
  });

  it("does not email for a non-emergency", async () => {
    await intake(emergency({ details: { problem: "Faucet drips slowly" } }));
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("does not email when the business has no notify address", async () => {
    await db.update(businessesTable).set({ notifyEmail: null }).where(eq(businessesTable.id, BUSINESS_ID));
    await intake(emergency());
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it("never fails or blocks intake when the email cannot be sent", async () => {
    sendAlert.mockRejectedValue(new Error("SMTP down"));
    const res = await intake(emergency());
    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(true);
    expect(startRetellCall).toHaveBeenCalledTimes(1);
  });

  it("tells the owner when the AI will NOT call (no consent) so they can phone the customer", async () => {
    await intake(emergency({ consent_text: undefined }));
    await vi.waitFor(() => expect(sendAlert).toHaveBeenCalledTimes(1));
    const body = ((sendAlert.mock.calls[0] as [string, string, string[]])[2]).join("\n");
    expect(body).toMatch(/will not call|needs consent|no consent/i);
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("still emails for an out-of-area emergency, and says so", async () => {
    await db.update(businessesTable).set({ serviceAreaZips: ["787"] as never }).where(eq(businessesTable.id, BUSINESS_ID));
    await intake(emergency({ details: { problem: "flooding in the basement", zip: "10001" } }));
    await vi.waitFor(() => expect(sendAlert).toHaveBeenCalledTimes(1));
    expect(((sendAlert.mock.calls[0] as [string, string, string[]])[2]).join("\n")).toMatch(/out of (the )?service area/i);
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("sends one email per emergency lead, not per retry or duplicate", async () => {
    const lead = emergency();
    await intake(lead);
    await intake(lead); // duplicate phone
    await vi.waitFor(() => expect(sendAlert).toHaveBeenCalled());
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });
});

describe("per-call variables sent to Retell", () => {
  it("a home-services lead reaches Retell with its job details", async () => {
    await intake(metaLead());
    expect(startRetellCall).toHaveBeenCalledTimes(1);
    const sent = startRetellCall.mock.calls[0]?.[0];
    expect(sent?.dynamicVariables).toMatchObject({
      business_name: "Frostline HVAC",
      lead_name: "Dana Reyes",
      service_type: "AC repair",
      problem: "AC not cooling",
      zip: "78701",
      urgency: "This week",
      appointment_label: "Service visit",
    });
    expect(sent?.dynamicVariables?.recording_clause).toBeDefined();
    // The customer's number is the dial target, never a prompt variable.
    expect(JSON.stringify(sent?.dynamicVariables)).not.toContain("+1512555");
  });

  it("a real-estate lead now gets the placeholders its prompt already expects", async () => {
    await db.update(businessesTable).set({ vertical: "real_estate", name: "Northstar Realty" }).where(eq(businessesTable.id, BUSINESS_ID));
    await intake({ name: "Pat Buyer", phone: nextPhone(), ...consent, project: "Spring buyer campaign" });
    const sent = startRetellCall.mock.calls[0]?.[0];
    expect(sent?.dynamicVariables).toMatchObject({
      business_name: "Northstar Realty",
      lead_name: "Pat Buyer",
      project_name: "Spring buyer campaign",
      appointment_label: "Viewing",
    });
    expect(sent?.dynamicVariables).not.toHaveProperty("problem");
  });

  it("keeps the existing metadata that the agent tools and webhooks rely on", async () => {
    await intake(metaLead());
    const sent = startRetellCall.mock.calls[0]?.[0];
    expect(sent?.metadata).toMatchObject({ business_id: BUSINESS_ID });
    expect(sent?.metadata.lead_id).toMatch(/^lead_/);
    expect(sent?.metadata.call_id).toMatch(/^call_/);
  });
});
