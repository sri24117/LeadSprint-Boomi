/**
 * Operator-initiated calling (POST /api/calls/start, POST /api/calls/:id/retry).
 *
 * The bug these lock down: the console's "Call lead" button reported HTTP
 * 201 while placing no call. The call row was enqueued under a permanent
 * idempotency key (`console_<leadId>`), so once the first attempt ended
 * `policy_blocked` — quiet hours, most often — every later click resolved
 * to that same blocked row, `dispatchQueuedCall` did nothing, and the route
 * fell through to its success branch. The operator was told a prospect had
 * been called when the prospect had not been, and no retry was ever
 * scheduled.
 *
 * The rule now: 201 means the provider accepted a call, and nothing else
 * does. A blocked attempt is a 409 that carries the reason.
 */

import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { businessesTable, callsTable, contactsTable, leadsTable } from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import leadsprintRouter, {
  __resetLeadsprintDb,
  __setLeadsprintDb,
} from "./leadsprint";
import { __resetCallQueueDb, __setCallQueueDb } from "../lib/callQueue";
import * as providers from "../lib/providers";

const BUSINESS_ID = "business_pilot";
const LEAD_ID = "lead_console";
const QUIET = "2026-09-16T03:00:00Z"; // 23:00 America/New_York — inside quiet hours
const OPEN = "2026-09-16T17:00:00Z"; // 13:00 America/New_York — inside the calling window

let db: TestDb;
const startRetellCall = vi.spyOn(providers, "startRetellCall");

const ENV = {
  RETELL_API_KEY: "key",
  RETELL_AGENT_ID: "agent_live",
  RETELL_FROM_NUMBER_US: "+12125550100",
  CALCOM_API_KEY: "cal_key",
  CALCOM_EVENT_TYPE_ID: "12345",
};

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

async function seedLead(consentStatus = "valid") {
  await db.insert(contactsTable).values({
    id: "contact_console",
    businessId: BUSINESS_ID,
    name: "Ava Williams",
    phone: "+19175550184",
    consentStatus,
    consentSource: consentStatus === "valid" ? "web_form:listing-enquiry" : null,
    consentAt: consentStatus === "valid" ? new Date() : null,
    timezone: "America/New_York",
  });
  await db.insert(leadsTable).values({
    id: LEAD_ID,
    businessId: BUSINESS_ID,
    contactId: "contact_console",
    project: "Spring buyer campaign",
    propertyType: "Condo",
    budgetLabel: "$850k – $1.1M",
    location: "Williamsburg",
    timeline: "0–3 months",
  });
}

async function callLead() {
  return request(buildApp()).post("/api/calls/start").send({ lead_id: LEAD_ID });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(OPEN));
  db = await createTestDb();
  await db.insert(businessesTable).values(pilotBusiness() as never);
  __setLeadsprintDb(db as never);
  __setCallQueueDb(db as never);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  delete process.env.LEADSPRINT_KILL_SWITCH;
  startRetellCall.mockReset();
  startRetellCall.mockResolvedValue({ callId: "retell_call_console" });
});

afterEach(() => {
  vi.useRealTimers();
  __resetLeadsprintDb();
  __resetCallQueueDb();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

describe("POST /api/calls/start", () => {
  it("201 means the provider accepted the call", async () => {
    await seedLead();
    const res = await callLead();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("in_progress");
    expect(startRetellCall).toHaveBeenCalledTimes(1);
  });

  it("reports a quiet-hours block as 409, never as success", async () => {
    await seedLead();
    vi.setSystemTime(new Date(QUIET));

    const res = await callLead();
    expect(res.status).toBe(409);
    expect(res.body.status).toBe("policy_blocked");
    expect(res.body.error_state).toBe("quiet_hours");
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("never reports success for a repeated click inside the same minute", async () => {
    await seedLead();
    vi.setSystemTime(new Date(QUIET));

    const first = await callLead();
    const second = await callLead();
    expect(first.status).toBe(409);
    // The double-click dedupe must not become a lie: no second call row and
    // no success status for an attempt that never dialed.
    expect(second.status).toBe(409);
    expect(second.body.status).toBe("policy_blocked");
    expect(startRetellCall).not.toHaveBeenCalled();
    expect(
      (await db.select().from(callsTable).where(eq(callsTable.leadId, LEAD_ID))).length,
    ).toBe(1);
  });

  it("really re-dials once the block clears, instead of replaying the blocked row", async () => {
    await seedLead();
    vi.setSystemTime(new Date(QUIET));
    expect((await callLead()).status).toBe(409);

    // The window opens (a new minute, so a new attempt) — the operator is
    // entitled to a real second attempt, not the archived block.
    vi.setSystemTime(new Date(OPEN));
    const retry = await callLead();

    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe("in_progress");
    expect(startRetellCall).toHaveBeenCalledTimes(1);
  });

  it("refuses to dial a workspace that is not fully configured", async () => {
    await seedLead();
    // Half-configured deployment: the setup gate runs before any work.
    delete process.env.CALCOM_EVENT_TYPE_ID;
    const res = await callLead();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SETUP_INCOMPLETE");
    expect(startRetellCall).not.toHaveBeenCalled();
  });
});

describe("POST /api/calls/:id/retry", () => {
  it("re-queues a quiet-hours block", async () => {
    await seedLead();
    vi.setSystemTime(new Date(QUIET));
    const blocked = await callLead();
    const callId = blocked.body.id as string;

    vi.setSystemTime(new Date(OPEN));
    const res = await request(buildApp()).post(`/api/calls/${callId}/retry`).send();

    expect(res.status).toBe(201);
    expect(startRetellCall).toHaveBeenCalledTimes(1);
  });

  it("refuses to re-dial a decision — consent was never granted", async () => {
    await seedLead("unknown");
    const blocked = await callLead();
    expect(blocked.status).toBe(409);
    expect(blocked.body.error_state).toBe("consent_invalid");

    const res = await request(buildApp())
      .post(`/api/calls/${blocked.body.id as string}/retry`)
      .send();

    // A retry cannot clear missing consent, so it must not consume an
    // attempt or reach the provider — the operator gets told what to fix.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("POLICY_NOT_RETRYABLE");
    expect(startRetellCall).not.toHaveBeenCalled();
  });
});
