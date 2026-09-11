import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import express from "express";
import supertest from "supertest";

// In-memory data store for integration tests
interface AppointmentRow {
  id: string;
  businessId: string;
  contactId: string;
  leadId: string;
  serviceOrProperty: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  calendarProvider: string;
  externalId: string;
  status: string;
  createdAt: Date;
}

interface ProviderEventRow {
  id: string;
  businessId: string;
  provider: string;
  externalEventId: string;
  payloadHash: string;
  eventType: string;
  payload: any;
  processedAt: Date;
}

interface CallRow {
  id: string;
  businessId: string;
  contactId: string;
  leadId: string;
  providerCallId: string;
  status: string;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  endedAt?: Date;
  errorState?: string;
  transferred?: boolean;
  summary?: string;
  outcome?: string;
}

interface UsageRow {
  id: string;
  businessId: string;
  voiceMinutes: number;
  estimatedCost: number;
}

let appointmentsStore: AppointmentRow[] = [];
let providerEventsStore: ProviderEventRow[] = [];
let callsStore: CallRow[] = [];
let businessesStore: Array<{ id: string; name: string }> = [];
let contactsStore: Array<{ id: string; businessId: string; phone: string }> = [];
let usageStore: UsageRow[] = [];

function extractValues(obj: any): any[] {
  const values: any[] = [];
  if (!obj) return values;
  if ("value" in obj && obj.value !== undefined) {
    values.push(obj.value);
  }
  if (Array.isArray(obj.queryChunks)) {
    for (const chunk of obj.queryChunks) {
      values.push(...extractValues(chunk));
    }
  }
  return values;
}

// Build a chainable select mock that works with and without .limit()
function makeSelectChain(actual: any) {
  return (_fields?: any) => ({
    from: (table: any) => ({
      where: (condition: any) => {
        const vals = extractValues(condition);
        let result: any[] = [];
        if (table === actual.appointmentsTable) {
          result = appointmentsStore.filter((a) => vals.includes(a.externalId) || vals.includes(a.id));
        } else if (table === actual.callsTable) {
          result = callsStore.filter((c) => vals.includes(c.providerCallId) || vals.includes(c.id));
        } else if (table === actual.businessesTable) {
          result = businessesStore.filter((b) => vals.includes(b.id));
        } else if (table === actual.contactsTable) {
          result = contactsStore.filter((c) => vals.some((v: string) => v === c.phone || v === c.businessId));
        } else if (table === actual.usageTable) {
          result = usageStore.filter((u) => vals.includes(u.businessId) || vals.includes(u.id));
        }
        // Make the result thenable (awaitable) AND have .limit()
        const promise = Promise.resolve(result);
        (promise as any).limit = (_n: number) => Promise.resolve(result.slice(0, _n));
        return promise;
      },
    }),
  });
}

// Mock @workspace/db — factory must not reference outer `let` variables directly
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<any>("@workspace/db");

  const mockDb = {
    select: makeSelectChain(actual),
    insert: (table: any) => ({
      values: (vals: any) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            if (table === actual.providerEventsTable) {
              const exists = providerEventsStore.some(
                (e) => e.provider === vals.provider && e.externalEventId === vals.externalEventId,
              );
              if (exists) return Promise.resolve([]);
              const newRow = { id: `pe_${Date.now()}_${Math.random()}`, ...vals, processedAt: new Date() };
              providerEventsStore.push(newRow);
              return Promise.resolve([{ id: newRow.id }]);
            }
            return Promise.resolve([{ id: `ins_${Date.now()}` }]);
          },
        }),
        returning: () => {
          return Promise.resolve([{ id: `ins_${Date.now()}` }]);
        },
      }),
    }),
    update: (_table: any) => ({
      set: (_setVals: any) => ({
        where: (_condition: any) => {
          return Promise.resolve([{ id: "updated" }]);
        },
      }),
    }),
    delete: (_table: any) => ({
      where: () => Promise.resolve(),
    }),
    transaction: async (callback: (tx: any) => Promise<any>) => {
      const tx = {
        select: makeSelectChain(actual),
        insert: (_table: any) => ({
          values: (_val: any) => {
            const ret = {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve([{ id: `tx_ins_${Date.now()}` }]),
              }),
              returning: () => Promise.resolve([{ id: `tx_ins_${Date.now()}` }]),
            };
            return Object.assign(Promise.resolve([{ id: `tx_ins_${Date.now()}` }]), ret);
          },
        }),
        update: (_table: any) => ({
          set: (_setVals: any) => ({
            where: (_condition: any) => Promise.resolve([{ id: "updated" }]),
          }),
        }),
      };
      return callback(tx);
    },
  };

  return {
    ...actual,
    db: mockDb,
  };
});

// Mock getActiveUsageRow to avoid real DB calls in Retell handler
vi.mock("./lib/usage", async () => {
  const actual = await vi.importActual<any>("./lib/usage");
  return {
    ...actual,
    getActiveUsageRow: vi.fn().mockResolvedValue({
      id: "usage_mock_1",
      businessId: "biz_1",
      voiceMinutes: 0,
      estimatedCost: 0,
    }),
  };
});

// Import after vi.mock
import webhooksRouter, { verifyTimestampFreshness, MAX_WEBHOOK_AGE_MS } from "./routes/webhooks";

const TEST_RETELL_SECRET = "retell_webhook_secret_test_xyz";
const TEST_CALCOM_SECRET = "calcom_webhook_secret_test_123";
const TEST_INTAKE_SECRET = "intake_webhook_secret_test_456";

function createWebhookApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buffer) => {
        (req as any).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use("/api", webhooksRouter);
  return app;
}

function computeHmac(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("Phase 3 Milestone 4: Webhook Freshness Enforcement", () => {
  const FIXED_NOW = 1726050000000; // Deterministic epoch ms

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    process.env.RETELL_WEBHOOK_SECRET = TEST_RETELL_SECRET;
    process.env.CALCOM_WEBHOOK_SECRET = TEST_CALCOM_SECRET;
    // Correct env var name for intake webhook secret
    process.env.LEAD_INTAKE_WEBHOOK_SECRET = TEST_INTAKE_SECRET;

    appointmentsStore = [
      {
        id: "appt_1",
        businessId: "biz_1",
        contactId: "contact_1",
        leadId: "lead_1",
        serviceOrProperty: "Service 1",
        startTime: new Date("2026-10-01T10:00:00.000Z"),
        endTime: new Date("2026-10-01T10:30:00.000Z"),
        timezone: "America/New_York",
        calendarProvider: "Cal.com",
        externalId: "cal_uid_100",
        status: "unconfirmed",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ];
    providerEventsStore = [];
    callsStore = [
      {
        id: "call_1",
        businessId: "biz_1",
        contactId: "contact_1",
        leadId: "lead_1",
        providerCallId: "retell_call_100",
        status: "in_progress",
      },
    ];
    businessesStore = [{ id: "biz_1", name: "Acme Corp" }];
    contactsStore = [];
    usageStore = [
      { id: "usage_1", businessId: "biz_1", voiceMinutes: 0, estimatedCost: 0 },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- UNIT TESTS FOR verifyTimestampFreshness() ---

  describe("Unit: verifyTimestampFreshness() semantics", () => {
    it("1. Fresh ISO 8601 timestamp is accepted", () => {
      const nowIso = new Date(FIXED_NOW - 30 * 1000).toISOString(); // 30s ago
      const result = verifyTimestampFreshness(nowIso);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("2. Fresh Unix epoch seconds is accepted", () => {
      const epochSeconds = Math.floor(FIXED_NOW / 1000) - 60; // 1 minute ago
      const result = verifyTimestampFreshness(epochSeconds);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("3. Fresh Unix epoch milliseconds is accepted", () => {
      const epochMs = FIXED_NOW - 15 * 1000; // 15 seconds ago
      const result = verifyTimestampFreshness(epochMs);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("4. Fresh numeric string epoch is accepted", () => {
      const epochSecondsStr = String(Math.floor(FIXED_NOW / 1000) - 45);
      const result = verifyTimestampFreshness(epochSecondsStr);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("5. Missing timestamp (undefined) is rejected", () => {
      const result = verifyTimestampFreshness(undefined);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Missing timestamp");
    });

    it("6. Missing timestamp (null) is rejected", () => {
      const result = verifyTimestampFreshness(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Missing timestamp");
    });

    it("7. Empty string timestamp is rejected", () => {
      const result = verifyTimestampFreshness("");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Missing timestamp");
    });

    it("8. Whitespace-only string timestamp is rejected", () => {
      const result = verifyTimestampFreshness("   ");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Missing timestamp");
    });

    it("9. Malformed timestamp string is rejected", () => {
      const result = verifyTimestampFreshness("not-a-timestamp-123xyz");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Unparseable timestamp string");
    });

    it("10. Malformed timestamp NaN is rejected", () => {
      const result = verifyTimestampFreshness(NaN);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Unparseable timestamp number");
    });

    it("11. Stale timestamp (older than MAX_WEBHOOK_AGE_MS) is rejected", () => {
      const staleMs = FIXED_NOW - (MAX_WEBHOOK_AGE_MS + 1000); // 5m 1s ago
      const result = verifyTimestampFreshness(new Date(staleMs).toISOString());
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Timestamp outside freshness window");
    });

    it("12. Future timestamp beyond allowed clock-skew is rejected", () => {
      const futureMs = FIXED_NOW + (MAX_WEBHOOK_AGE_MS + 1000); // 5m 1s in future
      const result = verifyTimestampFreshness(new Date(futureMs).toISOString());
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Timestamp outside freshness window");
    });

    it("13. Freshness boundary behavior: within window is valid, outside window is invalid", () => {
      // 4 minutes 59 seconds ago → within 5 minutes → valid
      const justInside = FIXED_NOW - (MAX_WEBHOOK_AGE_MS - 1000);
      expect(verifyTimestampFreshness(justInside).valid).toBe(true);

      // 5 minutes 1 second ago → outside 5 minutes → invalid
      const justOutside = FIXED_NOW - (MAX_WEBHOOK_AGE_MS + 1000);
      expect(verifyTimestampFreshness(justOutside).valid).toBe(false);

      // 4 minutes 59 seconds in future → within skew window → valid
      const futureInside = FIXED_NOW + (MAX_WEBHOOK_AGE_MS - 1000);
      expect(verifyTimestampFreshness(futureInside).valid).toBe(true);

      // 5 minutes 1 second in future → outside skew window → invalid
      const futureOutside = FIXED_NOW + (MAX_WEBHOOK_AGE_MS + 1000);
      expect(verifyTimestampFreshness(futureOutside).valid).toBe(false);
    });
  });

  // --- INTEGRATION & WEBHOOK ROUTE REGRESSION TESTS ---

  describe("Integration: Webhook Routes Freshness & Signature Enforcement", () => {
    const app = createWebhookApp();

    it("14. Retell webhook: valid signature + fresh event_timestamp is accepted (202)", async () => {
      const payload = {
        event: "call_ended",
        call_id: "retell_call_100",
        event_timestamp: Math.floor(FIXED_NOW / 1000) - 10,
        call_status: "completed",
        duration_ms: 45000,
        metadata: { business_id: "biz_1", call_id: "call_1" },
      };
      const bodyStr = JSON.stringify(payload);
      const signature = computeHmac(bodyStr, TEST_RETELL_SECRET);

      const res = await supertest(app)
        .post("/api/webhooks/retell")
        .set("Content-Type", "application/json")
        .set("x-retell-signature", signature)
        .send(payload);

      expect(res.status).toBe(202);
      expect(res.body.accepted).toBe(true);
    });

    it("15. Retell webhook: missing timestamp is rejected with 400 Stale webhook", async () => {
      const payload = {
        event: "call_ended",
        call_id: "retell_call_100",
        call_status: "completed",
        metadata: { business_id: "biz_1" },
      };
      const bodyStr = JSON.stringify(payload);
      const signature = computeHmac(bodyStr, TEST_RETELL_SECRET);

      const res = await supertest(app)
        .post("/api/webhooks/retell")
        .set("Content-Type", "application/json")
        .set("x-retell-signature", signature)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Stale webhook: Missing timestamp");
    });

    it("16. Retell webhook: stale timestamp is rejected with 400 Stale webhook", async () => {
      const payload = {
        event: "call_ended",
        call_id: "retell_call_100",
        event_timestamp: Math.floor(FIXED_NOW / 1000) - 600, // 10 minutes ago
        call_status: "completed",
        metadata: { business_id: "biz_1" },
      };
      const bodyStr = JSON.stringify(payload);
      const signature = computeHmac(bodyStr, TEST_RETELL_SECRET);

      const res = await supertest(app)
        .post("/api/webhooks/retell")
        .set("Content-Type", "application/json")
        .set("x-retell-signature", signature)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Stale webhook: Timestamp outside freshness window");
    });

    it("17. Cal.com webhook: valid signature + fresh createdAt is accepted (202)", async () => {
      const payload = {
        triggerEvent: "BOOKING_CONFIRMED",
        createdAt: new Date(FIXED_NOW - 10 * 1000).toISOString(),
        metadata: { business_id: "biz_1" },
        payload: {
          uid: "cal_uid_100",
        },
      };
      const bodyStr = JSON.stringify(payload);
      const signature = computeHmac(bodyStr, TEST_CALCOM_SECRET);

      const res = await supertest(app)
        .post("/api/webhooks/calcom")
        .set("Content-Type", "application/json")
        .set("x-cal-signature-256", signature)
        .send(payload);

      expect(res.status).toBe(202);
      expect(res.body.accepted).toBe(true);
    });

    it("18. Cal.com webhook: missing timestamp is rejected with 400 Stale webhook", async () => {
      const payload = {
        triggerEvent: "BOOKING_CONFIRMED",
        metadata: { business_id: "biz_1" },
        payload: {
          uid: "cal_uid_100",
        },
      };
      const bodyStr = JSON.stringify(payload);
      const signature = computeHmac(bodyStr, TEST_CALCOM_SECRET);

      const res = await supertest(app)
        .post("/api/webhooks/calcom")
        .set("Content-Type", "application/json")
        .set("x-cal-signature-256", signature)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Stale webhook: Missing timestamp");
    });

    it("19. Cal.com webhook: stale timestamp is rejected with 400 Stale webhook", async () => {
      const payload = {
        triggerEvent: "BOOKING_CONFIRMED",
        createdAt: new Date(FIXED_NOW - 600 * 1000).toISOString(), // 10 minutes ago
        metadata: { business_id: "biz_1" },
        payload: {
          uid: "cal_uid_100",
        },
      };
      const bodyStr = JSON.stringify(payload);
      const signature = computeHmac(bodyStr, TEST_CALCOM_SECRET);

      const res = await supertest(app)
        .post("/api/webhooks/calcom")
        .set("Content-Type", "application/json")
        .set("x-cal-signature-256", signature)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Stale webhook: Timestamp outside freshness window");
    });

    it("20. Invalid signature is rejected with 401 before processing payload", async () => {
      const payload = {
        triggerEvent: "BOOKING_CONFIRMED",
        createdAt: new Date(FIXED_NOW).toISOString(),
        metadata: { business_id: "biz_1" },
        payload: { uid: "cal_uid_100" },
      };

      const res = await supertest(app)
        .post("/api/webhooks/calcom")
        .set("Content-Type", "application/json")
        .set("x-cal-signature-256", "invalid_signature_hex")
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid Cal.com signature");
    });

    it("21. Intake webhook: valid signature + fresh timestamp is accepted (201)", async () => {
      const payload = {
        business_id: "biz_1",
        name: "Alice Smith",
        phone: "+12024561111",
        timestamp: new Date(FIXED_NOW - 5000).toISOString(),
      };
      const bodyStr = JSON.stringify(payload);
      const signature = computeHmac(bodyStr, TEST_INTAKE_SECRET);

      const res = await supertest(app)
        .post("/api/webhooks/intake")
        .set("Content-Type", "application/json")
        .set("x-leadsprint-signature", signature)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.accepted).toBe(true);
    });

    it("22. Intake webhook: missing timestamp is rejected with 400", async () => {
      const payload = {
        business_id: "biz_1",
        name: "Alice Smith",
        phone: "+12024561111",
      };
      const bodyStr = JSON.stringify(payload);
      const signature = computeHmac(bodyStr, TEST_INTAKE_SECRET);

      const res = await supertest(app)
        .post("/api/webhooks/intake")
        .set("Content-Type", "application/json")
        .set("x-leadsprint-signature", signature)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Stale webhook: Missing timestamp");
    });
  });
});
