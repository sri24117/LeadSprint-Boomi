/**
 * Twilio status-webhook tenant-isolation tests.
 *
 * These exist because of a real cross-tenant bug: the status handler
 * resolved WHICH workspace a callback belonged to by scanning
 * `provider_call_id` across every business in the database, and the
 * `calls_provider_call_unique` constraint was global rather than scoped
 * by `business_id`. A signed webhook for one tenant could therefore land
 * on another tenant's call row, and a second workspace holding the same
 * provider call id could not even insert it.
 *
 * The contract now: the tenant must travel with the webhook (a
 * `businessId` query parameter on the configured status-callback URL, or
 * a `BusinessId` field from an internal gateway). Unscoped callbacks are
 * rejected fail-closed — the tenant is never guessed from the database.
 */

import crypto from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  businessesTable,
  callsTable,
  contactsTable,
  leadsTable,
  providerEventsTable,
} from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import webhooksRouter, { __resetWebhooksDb, __setWebhooksDb } from "./webhooks";

const AUTH_TOKEN = "test_twilio_auth_token";
const BUSINESS_A = "business_pilot";
const BUSINESS_B = "business_other";
const CALL_SID = "CA1000000000000000000000000000000";
// A CallSid that exists only under workspace A — used to prove a callback
// pinned to workspace B cannot act on it.
const CALL_SID_A_ONLY = "CA2000000000000000000000000000000";

let db: TestDb;

const ENV = { TWILIO_AUTH_TOKEN: AUTH_TOKEN };

function buildApp(): Express {
  const app = express();
  // Same body parsers (and rawBody capture) as app.ts, so form-encoded
  // Twilio callbacks parse identically to production.
  app.use(express.json({
    verify: (req, _res, buffer) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }));
  app.use(express.urlencoded({
    extended: true,
    verify: (req, _res, buffer) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }));
  app.use("/api", webhooksRouter);
  return app;
}

/** Twilio's signature algorithm: HMAC-SHA1(authToken, url + sortedParams). */
function twilioSignature(url: string, params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return crypto.createHmac("sha1", AUTH_TOKEN).update(url + sorted).digest("base64");
}

async function postStatus(
  path: string,
  params: Record<string, string>,
  options: { sign?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = buildApp();
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    let req = request(server).post(path);
    if (options.sign !== false) {
      req = req.set(
        "X-Twilio-Signature",
        twilioSignature(`http://127.0.0.1:${port}${path}`, params),
      );
    }
    const response = await req.type("form").send(params);
    return { status: response.status, body: response.body as Record<string, unknown> };
  } finally {
    server.close();
  }
}

async function seedCall(input: {
  businessId: string;
  callId: string;
  contactId: string;
  leadId: string;
  providerCallId: string;
}) {
  await db.insert(contactsTable).values({
    id: input.contactId,
    businessId: input.businessId,
    name: "Ava Williams",
    phone: "+19175550184",
    consentStatus: "valid",
    consentSource: "web_form",
    consentAt: new Date(),
  });
  await db.insert(leadsTable).values({
    id: input.leadId,
    businessId: input.businessId,
    contactId: input.contactId,
    project: "Spring buyer campaign",
    propertyType: "Condo",
    budgetLabel: "$850k – $1.1M",
    location: "Williamsburg",
    timeline: "0–3 months",
  });
  await db.insert(callsTable).values({
    id: input.callId,
    businessId: input.businessId,
    contactId: input.contactId,
    leadId: input.leadId,
    provider: "Retell",
    providerCallId: input.providerCallId,
    idempotencyKey: `idem_${input.callId}`,
    status: "in_progress",
  });
}

async function getCall(businessId: string, callId: string) {
  const [row] = await db
    .select()
    .from(callsTable)
    .where(and(eq(callsTable.businessId, businessId), eq(callsTable.id, callId)));
  return row;
}

beforeEach(async () => {
  db = await createTestDb();
  __setWebhooksDb(db as never);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  delete process.env.TWILIO_WEBHOOK_SECRET;

  // Two workspaces, each with an in-flight call holding the SAME provider
  // call id. The old global unique index made this state impossible to
  // even represent; the old handler could not tell the two apart.
  await db.insert(businessesTable).values(pilotBusiness() as never);
  await db.insert(businessesTable).values(
    pilotBusiness({
      id: BUSINESS_B,
      name: "Harborview Homes",
      phoneNumber: "+13125550166",
      transferNumber: "+13125550177",
    }) as never,
  );
  await seedCall({
    businessId: BUSINESS_A,
    callId: "call_a",
    contactId: "contact_a",
    leadId: "lead_a",
    providerCallId: CALL_SID,
  });
  await seedCall({
    businessId: BUSINESS_B,
    callId: "call_b",
    contactId: "contact_b",
    leadId: "lead_b",
    providerCallId: CALL_SID,
  });
  await seedCall({
    businessId: BUSINESS_A,
    callId: "call_a2",
    contactId: "contact_a2",
    leadId: "lead_a2",
    providerCallId: CALL_SID_A_ONLY,
  });
});

afterEach(() => {
  __resetWebhooksDb();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

describe("POST /api/webhooks/twilio/status", () => {
  it("updates the tenant pinned by the callback URL's businessId", async () => {
    const result = await postStatus(
      `/api/webhooks/twilio/status?businessId=${BUSINESS_A}`,
      { CallSid: CALL_SID, CallStatus: "completed" },
    );

    expect(result.status).toBe(202);
    expect(result.body).toEqual({ accepted: true, duplicate: false });

    const callA = await getCall(BUSINESS_A, "call_a");
    expect(callA?.status).toBe("completed");
    expect(callA?.endedAt).not.toBeNull();
    // The other workspace's call with the same CallSid is untouched.
    const callB = await getCall(BUSINESS_B, "call_b");
    expect(callB?.status).toBe("in_progress");
    expect(callB?.endedAt).toBeNull();
  });

  it("accepts BusinessId from the signed body (internal gateway form)", async () => {
    const result = await postStatus("/api/webhooks/twilio/status", {
      CallSid: CALL_SID,
      CallStatus: "completed",
      BusinessId: BUSINESS_A,
    });

    expect(result.status).toBe(202);
    expect(result.body).toEqual({ accepted: true, duplicate: false });
    const callA = await getCall(BUSINESS_A, "call_a");
    expect(callA?.status).toBe("completed");
  });

  it("never resolves the tenant by scanning provider_call_id across workspaces", async () => {
    // No businessId anywhere on the request. The pre-fix handler looked the
    // business up globally by CallSid and updated workspace A's call.
    const result = await postStatus("/api/webhooks/twilio/status", {
      CallSid: CALL_SID,
      CallStatus: "completed",
    });

    expect(result.status).toBe(400);
    const callA = await getCall(BUSINESS_A, "call_a");
    expect(callA?.status).toBe("in_progress");
    expect(callA?.endedAt).toBeNull();
    const callB = await getCall(BUSINESS_B, "call_b");
    expect(callB?.status).toBe("in_progress");
    const events = await db.select().from(providerEventsTable);
    expect(events).toHaveLength(0);
  });

  it("rejects a CallSid that belongs to a different workspace than the pinned one", async () => {
    const result = await postStatus(
      `/api/webhooks/twilio/status?businessId=${BUSINESS_B}`,
      { CallSid: CALL_SID_A_ONLY, CallStatus: "completed" },
    );

    expect(result.status).toBe(400);
    // No provider event written under the wrong tenant, no state change.
    const events = await db.select().from(providerEventsTable);
    expect(events).toHaveLength(0);
    const callA2 = await getCall(BUSINESS_A, "call_a2");
    expect(callA2?.status).toBe("in_progress");
    expect(callA2?.endedAt).toBeNull();
  });

  it("rejects an unknown CallSid without recording a provider event", async () => {
    const result = await postStatus(
      `/api/webhooks/twilio/status?businessId=${BUSINESS_A}`,
      { CallSid: "CA9999999999999999999999999999999", CallStatus: "completed" },
    );

    expect(result.status).toBe(400);
    const events = await db.select().from(providerEventsTable);
    expect(events).toHaveLength(0);
  });

  it("treats a replayed callback as a duplicate and does not re-apply it", async () => {
    const params = { CallSid: CALL_SID, CallStatus: "completed" };
    const first = await postStatus(
      `/api/webhooks/twilio/status?businessId=${BUSINESS_A}`,
      params,
    );
    const replay = await postStatus(
      `/api/webhooks/twilio/status?businessId=${BUSINESS_A}`,
      params,
    );

    expect(first.body).toEqual({ accepted: true, duplicate: false });
    expect(replay.body).toEqual({ accepted: true, duplicate: true });
    const events = await db.select().from(providerEventsTable);
    expect(events).toHaveLength(1);
  });

  it("rejects unsigned requests", async () => {
    const result = await postStatus(
      `/api/webhooks/twilio/status?businessId=${BUSINESS_A}`,
      { CallSid: CALL_SID, CallStatus: "completed" },
      { sign: false },
    );

    expect(result.status).toBe(401);
  });
});

describe("calls_provider_call_unique", () => {
  it("is scoped by business: two workspaces may hold the same provider call id", async () => {
    // Seeded in beforeEach: workspace A and B both hold `CALL_SID`.
    const rows = await db
      .select()
      .from(callsTable)
      .where(eq(callsTable.providerCallId, CALL_SID));
    expect(rows).toHaveLength(2);
  });

  it("still rejects a duplicate provider call id within one workspace", async () => {
    await db.insert(contactsTable).values({
      id: "contact_a3",
      businessId: BUSINESS_A,
      name: "Second Contact",
      phone: "+19175550185",
      consentStatus: "valid",
      consentSource: "web_form",
      consentAt: new Date(),
    });
    await db.insert(leadsTable).values({
      id: "lead_a3",
      businessId: BUSINESS_A,
      contactId: "contact_a3",
      project: "Spring buyer campaign",
      propertyType: "Condo",
      budgetLabel: "$850k – $1.1M",
      location: "Williamsburg",
      timeline: "0–3 months",
    });

    let violated = false;
    try {
      await db.insert(callsTable).values({
        id: "call_a_dup",
        businessId: BUSINESS_A,
        contactId: "contact_a3",
        leadId: "lead_a3",
        provider: "Retell",
        providerCallId: CALL_SID,
        idempotencyKey: "idem_call_a_dup",
      });
    } catch {
      violated = true;
    }
    expect(violated).toBe(true);
  });
});
