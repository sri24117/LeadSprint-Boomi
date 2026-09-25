import crypto from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { businessesTable } from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import webhooksRouter, {
  isTimestampFresh,
  __resetWebhooksDb,
  __setWebhooksDb,
} from "./webhooks";
import { __resetCallQueueDb, __setCallQueueDb } from "../lib/callQueue";

const INTAKE_SECRET = "test_intake_webhook_secret";
const CALCOM_SECRET = "test_calcom_webhook_secret";
const BUSINESS_ID = "business_pilot";

let db: TestDb;

const ENV = {
  LEAD_INTAKE_WEBHOOK_SECRET: INTAKE_SECRET,
  CALCOM_WEBHOOK_SECRET: CALCOM_SECRET,
};

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

function signIntake(body: Record<string, unknown>): string {
  const raw = Buffer.from(JSON.stringify(body));
  return `sha256=${crypto.createHmac("sha256", INTAKE_SECRET).update(raw).digest("hex")}`;
}

function signCal(body: Record<string, unknown>): string {
  const raw = Buffer.from(JSON.stringify(body));
  return `sha256=${crypto.createHmac("sha256", CALCOM_SECRET).update(raw).digest("hex")}`;
}

describe("isTimestampFresh helper", () => {
  it("accepts recent Date, ISO string, milliseconds, and seconds", () => {
    const now = new Date();
    expect(isTimestampFresh(now)).toBe(true);
    expect(isTimestampFresh(now.toISOString())).toBe(true);
    expect(isTimestampFresh(Date.now())).toBe(true);
    expect(isTimestampFresh(Math.floor(Date.now() / 1000))).toBe(true);
    expect(isTimestampFresh(String(Date.now()))).toBe(true);
    expect(isTimestampFresh(String(Math.floor(Date.now() / 1000)))).toBe(true);
  });

  it("rejects timestamps older than maxAgeSeconds (default 300s)", () => {
    const tenMinutesAgo = new Date(Date.now() - 600 * 1000);
    expect(isTimestampFresh(tenMinutesAgo)).toBe(false);
    expect(isTimestampFresh(tenMinutesAgo.toISOString())).toBe(false);
    expect(isTimestampFresh(tenMinutesAgo.getTime())).toBe(false);
    expect(isTimestampFresh(Math.floor(tenMinutesAgo.getTime() / 1000))).toBe(false);
  });

  it("rejects future timestamps skewed by more than maxAgeSeconds", () => {
    const tenMinutesFuture = new Date(Date.now() + 600 * 1000);
    expect(isTimestampFresh(tenMinutesFuture)).toBe(false);
  });

  it("rejects invalid, null, undefined, or empty values", () => {
    expect(isTimestampFresh(undefined)).toBe(false);
    expect(isTimestampFresh(null)).toBe(false);
    expect(isTimestampFresh("")).toBe(false);
    expect(isTimestampFresh("not-a-date")).toBe(false);
  });
});

describe("Webhook freshness & replay defense HTTP endpoints", () => {
  beforeEach(async () => {
    db = await createTestDb();
    __setWebhooksDb(db as never);
    __setCallQueueDb(db as never);
    for (const [key, value] of Object.entries(ENV)) {
      process.env[key] = value;
    }
    await db.insert(businessesTable).values(pilotBusiness() as never);
  });

  afterEach(() => {
    __resetWebhooksDb();
    __resetCallQueueDb();
    for (const key of Object.keys(ENV)) {
      delete process.env[key];
    }
  });

  it("POST /api/webhooks/intake rejects expired body.timestamp", async () => {
    const app = buildApp();
    const staleTime = new Date(Date.now() - 600 * 1000).toISOString();
    const payload = {
      business_id: BUSINESS_ID,
      name: "Old Lead",
      phone: "+19175550189",
      consent_status: "valid",
      consent_source: "web_form",
      timestamp: staleTime,
    };

    const res = await request(app)
      .post("/api/webhooks/intake")
      .set("x-leadsprint-signature", signIntake(payload))
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Webhook timestamp expired" });
  });

  it("POST /api/webhooks/intake rejects expired x-webhook-timestamp header", async () => {
    const app = buildApp();
    const staleTime = String(Math.floor((Date.now() - 600 * 1000) / 1000));
    const payload = {
      business_id: BUSINESS_ID,
      name: "Header Lead",
      phone: "+19175550190",
      consent_status: "valid",
      consent_source: "web_form",
    };

    const res = await request(app)
      .post("/api/webhooks/intake")
      .set("x-leadsprint-signature", signIntake(payload))
      .set("x-webhook-timestamp", staleTime)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Webhook timestamp expired" });
  });

  it("POST /api/webhooks/intake accepts fresh timestamp", async () => {
    const app = buildApp();
    const payload = {
      business_id: BUSINESS_ID,
      name: "Fresh Lead",
      phone: "+19175550191",
      consent_status: "valid",
      consent_source: "web_form",
      timestamp: new Date().toISOString(),
    };

    const res = await request(app)
      .post("/api/webhooks/intake")
      .set("x-leadsprint-signature", signIntake(payload))
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(true);
  });

  it("POST /api/webhooks/calcom rejects stale createdAt timestamp", async () => {
    const app = buildApp();
    const staleTime = new Date(Date.now() - 600 * 1000).toISOString();
    const payload = {
      triggerEvent: "BOOKING_CREATED",
      createdAt: staleTime,
      payload: {
        metadata: { business_id: BUSINESS_ID },
      },
    };

    const res = await request(app)
      .post("/api/webhooks/calcom")
      .set("x-cal-signature-256", signCal(payload))
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Stale Cal.com webhook timestamp" });
  });

  it("POST /api/webhooks/calcom accepts fresh createdAt timestamp", async () => {
    const app = buildApp();
    const payload = {
      triggerEvent: "BOOKING_CREATED",
      createdAt: new Date().toISOString(),
      payload: {
        metadata: { business_id: BUSINESS_ID },
        bookingId: "cal_123",
      },
    };

    const res = await request(app)
      .post("/api/webhooks/calcom")
      .set("x-cal-signature-256", signCal(payload))
      .send(payload);

    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
  });
});
