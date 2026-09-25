/**
 * Voice-usage accounting from the provider webhook.
 *
 * Usage is what the customer is invoiced for, so it has to count each call
 * exactly once. It did not: Retell sends the same talk time on `call_ended`
 * *and* again on `call_analyzed` (a separate event carrying the transcript
 * and post-call analysis), those two payloads differ, and provider-event
 * dedupe is keyed on the payload hash — so both events were accepted and
 * both accrued usage. Every call was billed twice.
 *
 * These tests replay a realistic Retell event pair against the real
 * handler and assert the meter moves once. They also pin the second half
 * of the rule: usage only accrues for calls LeadSprint actually placed,
 * because a signed event for a call_id we never issued must not create
 * billable minutes out of nothing.
 */

import crypto from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  businessesTable,
  callsTable,
  contactsTable,
  leadsTable,
  usageTable,
} from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import webhooksRouter, { __resetWebhooksDb, __setWebhooksDb } from "./webhooks";
import { __resetCallQueueDb, __setCallQueueDb } from "../lib/callQueue";
import { VOICE_COST_PER_MINUTE } from "../lib/usage";

const RETELL_KEY = "test_retell_webhook_key";
const BUSINESS_ID = "business_pilot";
const PROVIDER_CALL_ID = "retell_call_billed";

let db: TestDb;

const ENV = { RETELL_WEBHOOK_SECRET: RETELL_KEY };

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

/** Retell signs `v={unix_ms},d={hmac_sha256(rawBody + timestamp)}`. */
function retellEvent(body: Record<string, unknown>) {
  const raw = Buffer.from(JSON.stringify(body));
  const timestamp = String(Date.now());
  const digest = crypto
    .createHmac("sha256", RETELL_KEY)
    .update(raw.toString("utf8") + timestamp)
    .digest("hex");
  return { raw, signature: `v=${timestamp},d=${digest}` };
}

async function postRetell(body: Record<string, unknown>) {
  const { raw, signature } = retellEvent(body);
  return request(buildApp())
    .post("/api/webhooks/retell")
    .set("content-type", "application/json")
    .set("x-retell-signature", signature)
    .send(raw.toString("utf8"));
}

function callEnded(overrides: Record<string, unknown> = {}) {
  return {
    event: "call_ended",
    call: {
      call_id: PROVIDER_CALL_ID,
      call_status: "ended",
      duration_ms: 60_000,
      disconnection_reason: "agent_hangup",
      metadata: { business_id: BUSINESS_ID, lead_id: "lead_billed", call_id: "call_row_billed" },
      ...overrides,
    },
  };
}

function callAnalyzed(overrides: Record<string, unknown> = {}) {
  return {
    event: "call_analyzed",
    call: {
      call_id: PROVIDER_CALL_ID,
      call_status: "ended",
      duration_ms: 60_000,
      disconnection_reason: "agent_hangup",
      call_analysis: "Buyer is looking for a two-bedroom in Williamsburg.",
      metadata: { business_id: BUSINESS_ID, lead_id: "lead_billed", call_id: "call_row_billed" },
      ...overrides,
    },
  };
}

async function usage() {
  const [row] = await db
    .select()
    .from(usageTable)
    .where(eq(usageTable.businessId, BUSINESS_ID));
  return { minutes: Number(row?.voiceMinutes ?? 0), cost: Number(row?.estimatedCost ?? 0) };
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(businessesTable).values(pilotBusiness() as never);
  await db.insert(contactsTable).values({
    id: "contact_billed",
    businessId: BUSINESS_ID,
    name: "Ava Williams",
    phone: "+19175550184",
    consentStatus: "valid",
    consentSource: "web_form:listing-enquiry",
    consentAt: new Date(),
    timezone: "America/New_York",
  });
  await db.insert(leadsTable).values({
    id: "lead_billed",
    businessId: BUSINESS_ID,
    contactId: "contact_billed",
    project: "Spring buyer campaign",
    propertyType: "Condo",
    budgetLabel: "$850k – $1.1M",
    location: "Williamsburg",
    timeline: "0–3 months",
  });
  await db.insert(callsTable).values({
    id: "call_row_billed",
    businessId: BUSINESS_ID,
    contactId: "contact_billed",
    leadId: "lead_billed",
    provider: "Retell",
    providerCallId: PROVIDER_CALL_ID,
    idempotencyKey: "intake_lead_billed",
    status: "in_progress",
  });
  __setWebhooksDb(db as never);
  __setCallQueueDb(db as never);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
});

afterEach(() => {
  __resetWebhooksDb();
  __resetCallQueueDb();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

describe("Retell webhook usage accounting", () => {
  it("bills one minute for a one-minute call reported by both call_ended and call_analyzed", async () => {
    expect((await postRetell(callEnded())).status).toBe(202);
    const afterEnded = await usage();
    expect(afterEnded.minutes).toBe(1);
    expect(afterEnded.cost).toBeCloseTo(VOICE_COST_PER_MINUTE, 5);

    // The same call, reported again by the post-call analysis event. Not a
    // duplicate payload (so event dedupe lets it through) — but not a
    // second minute either.
    expect((await postRetell(callAnalyzed())).status).toBe(202);
    const afterAnalyzed = await usage();
    expect(afterAnalyzed.minutes).toBe(1);
    expect(afterAnalyzed.cost).toBeCloseTo(VOICE_COST_PER_MINUTE, 5);

    // The call row still ends up fully reconciled with the analysis text.
    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, "call_row_billed"));
    expect(call?.durationSeconds).toBe(60);
    expect(call?.status).toBe("completed");
    expect(call?.summary).toContain("Williamsburg");
  });

  it("does not bill a repeated terminal report in a later status update", async () => {
    await postRetell(callEnded());
    await postRetell(callAnalyzed());
    // A third event repeating the same terminal duration — e.g. a retried
    // delivery with a different event id, which dedupe cannot catch.
    await postRetell(callEnded({ disconnection_reason: "agent_hangup", duration_ms: 60_000 }));
    expect((await usage()).minutes).toBe(1);
  });

  it("does not bill a call LeadSprint never placed", async () => {
    const res = await postRetell(
      callEnded({
        call_id: "retell_call_we_never_made",
        metadata: { business_id: BUSINESS_ID, lead_id: "lead_billed", call_id: "unknown" },
      }),
    );
    // Accepted and archived (it is a signed provider event), but it must
    // not invent billable minutes for a call that is not ours.
    expect(res.status).toBe(202);
    expect((await usage()).minutes).toBe(0);
  });

  it("still reconciles the call row when it is ours", async () => {
    await postRetell(callEnded({ disconnection_reason: "dial_no_answer", transferred: false }));
    const [call] = await db.select().from(callsTable).where(eq(callsTable.id, "call_row_billed"));
    expect(call?.status).toBe("completed");
    expect(call?.endedAt).not.toBeNull();
    expect(call?.outcome).toBe("dial_no_answer");
  });
});
