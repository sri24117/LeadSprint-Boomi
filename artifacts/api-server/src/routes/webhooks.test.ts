import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import express from "express";
import supertest from "supertest";

// In-memory data store for tests
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

interface LeadRow {
  id: string;
  businessId: string;
  contactId: string;
  nextAction: string;
  status: string;
  updatedAt: Date;
}

interface ActivityRow {
  id: string;
  businessId: string;
  type: string;
  title: string;
  detail: string;
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

let appointmentsStore: AppointmentRow[] = [];
let leadsStore: LeadRow[] = [];
let activitiesStore: ActivityRow[] = [];
let providerEventsStore: ProviderEventRow[] = [];
let simulateTxFailure = false;

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

// Mock @workspace/db
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<any>("@workspace/db");

  const mockDb = {
    insert: (table: any) => ({
      values: (val: any) => ({
        onConflictDoNothing: (_opts?: any) => ({
          returning: (_fields?: any) => {
            if (table === actual.providerEventsTable) {
              const duplicate = providerEventsStore.find(
                (e) =>
                  e.provider === val.provider &&
                  e.externalEventId === val.externalEventId,
              );
              if (duplicate) {
                return Promise.resolve([]);
              }
              const newRow: ProviderEventRow = {
                ...val,
                id: val.id ?? `event_${Date.now()}`,
                processedAt: val.processedAt ?? new Date(),
              };
              providerEventsStore.push(newRow);
              return Promise.resolve([{ id: newRow.id }]);
            }
            return Promise.resolve([]);
          },
        }),
      }),
    }),
    delete: (table: any) => ({
      where: (condition: any) => {
        if (table === actual.providerEventsTable) {
          const vals = extractValues(condition);
          const provider = vals.find((v) => v === "Cal.com" || v === "Retell" || v === "Twilio");
          const externalEventId = vals.find((v) => typeof v === "string" && v !== provider);
          if (provider && externalEventId) {
            providerEventsStore = providerEventsStore.filter(
              (e) => !(e.provider === provider && e.externalEventId === externalEventId),
            );
          }
        }
        return Promise.resolve();
      },
    }),
    transaction: async (callback: (tx: any) => Promise<any>) => {
      // Snapshot state for rollback on error
      const apptSnapshot = appointmentsStore.map((a) => ({ ...a }));
      const leadSnapshot = leadsStore.map((l) => ({ ...l }));
      const actSnapshot = activitiesStore.map((ac) => ({ ...ac }));

      const tx = {
        select: (_fields?: any) => ({
          from: (table: any) => ({
            where: (condition: any) => ({
              limit: (n: number) => {
                if (table === actual.appointmentsTable) {
                  const vals = extractValues(condition);
                  // Conditions: eq(businessId), eq(externalId)
                  const matching = appointmentsStore.filter((a) => {
                    // Match businessId
                    const matchBiz = vals.includes(a.businessId);
                    // Match externalId
                    const matchExt = vals.includes(a.externalId);
                    return matchBiz && matchExt;
                  });
                  return Promise.resolve(matching.slice(0, n));
                }
                return Promise.resolve([]);
              },
            }),
          }),
        }),
        update: (table: any) => ({
          set: (updates: any) => ({
            where: (condition: any) => {
              if (simulateTxFailure) {
                throw new Error("Simulated database transaction failure during update");
              }
              const vals = extractValues(condition);
              if (table === actual.appointmentsTable) {
                const apptId = vals.find((v) => typeof v === "string" && appointmentsStore.some((a) => a.id === v));
                const target = appointmentsStore.find((a) => a.id === apptId);
                if (target) {
                  Object.assign(target, updates);
                }
              } else if (table === actual.leadsTable) {
                const leadId = vals.find((v) => typeof v === "string" && leadsStore.some((l) => l.id === v));
                const target = leadsStore.find((l) => l.id === leadId);
                if (target) {
                  Object.assign(target, updates);
                }
              }
              return Promise.resolve();
            },
          }),
        }),
        insert: (table: any) => ({
          values: (val: any) => {
            if (simulateTxFailure) {
              throw new Error("Simulated database transaction failure during insert");
            }
            if (table === actual.activitiesTable) {
              activitiesStore.push({ ...val, createdAt: new Date() });
            }
            return Promise.resolve();
          },
        }),
      };

      try {
        return await callback(tx);
      } catch (err) {
        // Rollback snapshot on error
        appointmentsStore = apptSnapshot;
        leadsStore = leadSnapshot;
        activitiesStore = actSnapshot;
        throw err;
      }
    },
  };

  return {
    ...actual,
    db: mockDb,
  };
});

// Import router after mock
import webhooksRouter from "./webhooks";

const TEST_CALCOM_SECRET = "calcom_webhook_secret_test_123";

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

function computeCalSignature(body: string, secret = TEST_CALCOM_SECRET): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("Cal.com Webhook Lifecycle Reconciliation (Milestone 4)", () => {
  const app = createWebhookApp();

  beforeEach(() => {
    process.env.CALCOM_WEBHOOK_SECRET = TEST_CALCOM_SECRET;
    simulateTxFailure = false;
    appointmentsStore = [
      {
        id: "appt_1",
        businessId: "biz_1",
        contactId: "contact_1",
        leadId: "lead_1",
        serviceOrProperty: "Oak Ridge Phase 2",
        startTime: new Date("2026-10-01T10:00:00.000Z"),
        endTime: new Date("2026-10-01T10:30:00.000Z"),
        timezone: "America/New_York",
        calendarProvider: "Cal.com",
        externalId: "cal_uid_100",
        status: "confirmed",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      {
        id: "appt_2",
        businessId: "biz_1",
        contactId: "contact_2",
        leadId: "lead_2",
        serviceOrProperty: "Pine Crest Villa",
        startTime: new Date("2026-10-02T14:00:00.000Z"),
        endTime: new Date("2026-10-02T14:30:00.000Z"),
        timezone: "America/New_York",
        calendarProvider: "Cal.com",
        externalId: "cal_uid_200",
        status: "confirmed",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      {
        id: "appt_shared",
        businessId: "biz_A",
        contactId: "contact_shared",
        leadId: "lead_shared",
        serviceOrProperty: "Shared Property",
        startTime: new Date("2026-10-05T11:00:00.000Z"),
        endTime: new Date("2026-10-05T11:30:00.000Z"),
        timezone: "America/New_York",
        calendarProvider: "Cal.com",
        externalId: "cal_uid_shared",
        status: "confirmed",
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ];

    leadsStore = [
      {
        id: "lead_1",
        businessId: "biz_1",
        contactId: "contact_1",
        nextAction: "Call lead",
        status: "booked",
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      {
        id: "lead_2",
        businessId: "biz_1",
        contactId: "contact_2",
        nextAction: "Appointment confirmed",
        status: "booked",
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      {
        id: "lead_shared",
        businessId: "biz_A",
        contactId: "contact_shared",
        nextAction: "Appointment confirmed",
        status: "booked",
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ];

    activitiesStore = [];
    providerEventsStore = [];
  });

  // TEST 1 — BOOKING_CONFIRMED
  it("TEST 1: BOOKING_CONFIRMED updates appointment status to confirmed without duplicating or double-counting usage", async () => {
    // Modify appt_1 initial status to unconfirmed to verify state transition
    appointmentsStore[0].status = "unconfirmed" as any;

    const payloadBody = {
      triggerEvent: "BOOKING_CONFIRMED",
      createdAt: new Date().toISOString(),
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_100",
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, duplicate: false });

    // Status updated to confirmed
    const appt = appointmentsStore.find((a) => a.id === "appt_1");
    expect(appt?.status).toBe("confirmed");

    // No duplicate appointments
    expect(appointmentsStore.filter((a) => a.externalId === "cal_uid_100").length).toBe(1);
    expect(appointmentsStore.length).toBe(3);

    // No activity created for confirm (only for reschedule/cancel)
    expect(activitiesStore.length).toBe(0);
  });

  // TEST 2 — BOOKING_RESCHEDULED
  it("TEST 2: BOOKING_RESCHEDULED updates start/end time, status, lead.nextAction, and creates booking activity atomically", async () => {
    const newStart = new Date("2026-10-15T16:00:00.000Z");
    const newEnd = new Date("2026-10-15T16:30:00.000Z");

    const payloadBody = {
      triggerEvent: "BOOKING_RESCHEDULED",
      createdAt: new Date().toISOString(),
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_200",
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, duplicate: false });

    // Appointment timing updated
    const appt = appointmentsStore.find((a) => a.id === "appt_2");
    expect(appt?.startTime.toISOString()).toBe(newStart.toISOString());
    expect(appt?.endTime.toISOString()).toBe(newEnd.toISOString());
    expect(appt?.status).toBe("confirmed");

    // Lead nextAction updated
    const lead = leadsStore.find((l) => l.id === "lead_2");
    expect(lead?.nextAction).toBe("Appointment rescheduled");

    // Booking activity created
    expect(activitiesStore.length).toBe(1);
    expect(activitiesStore[0].type).toBe("booking");
    expect(activitiesStore[0].businessId).toBe("biz_1");
    expect(activitiesStore[0].title).toBe("Appointment rescheduled");
    expect(activitiesStore[0].detail).toContain(newStart.toISOString());
  });

  // TEST 3 — BOOKING_CANCELLED
  it("TEST 3: BOOKING_CANCELLED sets appointment status to cancelled, lead.nextAction to 'Reschedule showing', creates activity, and preserves record", async () => {
    const payloadBody = {
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: new Date().toISOString(),
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_100",
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, duplicate: false });

    // Appointment status is cancelled
    const appt = appointmentsStore.find((a) => a.id === "appt_1");
    expect(appt?.status).toBe("cancelled");

    // Appointment record is NOT deleted
    expect(appointmentsStore.some((a) => a.id === "appt_1")).toBe(true);

    // Lead nextAction updated to exact plan requirement: 'Reschedule showing'
    const lead = leadsStore.find((l) => l.id === "lead_1");
    expect(lead?.nextAction).toBe("Reschedule showing");
    // Lead is NOT deleted
    expect(leadsStore.some((l) => l.id === "lead_1")).toBe(true);

    // Activity created
    expect(activitiesStore.length).toBe(1);
    expect(activitiesStore[0].type).toBe("booking");
    expect(activitiesStore[0].businessId).toBe("biz_1");
    expect(activitiesStore[0].title).toBe("Appointment cancelled");
    expect(activitiesStore[0].detail).toContain("cal_uid_100");
  });

  // TEST 4 — TENANT ISOLATION
  it("TEST 4: TENANT ISOLATION prevents Business B webhook from modifying Business A appointment with same uid", async () => {
    const payloadBody = {
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: new Date().toISOString(),
      metadata: { business_id: "biz_B" }, // Target biz_B, while appt belongs to biz_A
      payload: {
        uid: "cal_uid_shared",
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res.status).toBe(202);

    // Business A's appointment remains confirmed and UNMODIFIED
    const apptA = appointmentsStore.find((a) => a.id === "appt_shared");
    expect(apptA?.businessId).toBe("biz_A");
    expect(apptA?.status).toBe("confirmed");

    // Lead in Business A remains unmodified
    const leadA = leadsStore.find((l) => l.id === "lead_shared");
    expect(leadA?.nextAction).toBe("Appointment confirmed");

    // No activity created in Business A
    expect(activitiesStore.length).toBe(0);
  });

  // TEST 5 — UNKNOWN APPOINTMENT
  it("TEST 5: UNKNOWN APPOINTMENT does not create fake appointments or alter state", async () => {
    const payloadBody = {
      triggerEvent: "BOOKING_RESCHEDULED",
      createdAt: new Date().toISOString(),
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_non_existent",
        startTime: new Date("2026-10-20T10:00:00.000Z").toISOString(),
        endTime: new Date("2026-10-20T10:30:00.000Z").toISOString(),
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, duplicate: false });

    // No fake appointment created
    expect(appointmentsStore.length).toBe(3);
    expect(appointmentsStore.some((a) => a.externalId === "cal_uid_non_existent")).toBe(false);

    // No activity created
    expect(activitiesStore.length).toBe(0);
  });

  // TEST 6 — DUPLICATE WEBHOOK
  it("TEST 6: DUPLICATE WEBHOOK is detected via provider_events deduplication without duplicate activities", async () => {
    const payloadBody = {
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: new Date().toISOString(),
      event_id: "evt_unique_12345",
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_100",
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    // 1st delivery
    const res1 = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res1.status).toBe(202);
    expect(res1.body).toEqual({ accepted: true, duplicate: false });
    expect(activitiesStore.length).toBe(1);

    // 2nd delivery (identical event)
    const res2 = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res2.status).toBe(202);
    expect(res2.body).toEqual({ accepted: true, duplicate: true });

    // Activity count is STILL 1 (no duplicate side effects)
    expect(activitiesStore.length).toBe(1);
  });

  // TEST 7 — MISSING START/END
  it("TEST 7: MISSING START/END in reschedule event preserves existing timestamps without crashing or inventing dates", async () => {
    const originalStart = appointmentsStore[1].startTime.toISOString();
    const originalEnd = appointmentsStore[1].endTime.toISOString();

    const payloadBody = {
      triggerEvent: "BOOKING_RESCHEDULED",
      createdAt: new Date().toISOString(),
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_200",
        // startTime and endTime intentionally omitted
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, duplicate: false });

    // Existing timestamps are preserved
    const appt = appointmentsStore.find((a) => a.id === "appt_2");
    expect(appt?.startTime.toISOString()).toBe(originalStart);
    expect(appt?.endTime.toISOString()).toBe(originalEnd);
  });

  // TEST 8 — SIGNATURE FAILURE
  it("TEST 8: SIGNATURE FAILURE rejects request with HTTP 401 and prevents DB mutation", async () => {
    const payloadBody = {
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: new Date().toISOString(),
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_100",
      },
    };

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", "invalid_hmac_hex_signature_here")
      .send(payloadBody);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid Cal.com signature" });

    // No DB mutations
    const appt = appointmentsStore.find((a) => a.id === "appt_1");
    expect(appt?.status).toBe("confirmed"); // Still confirmed, NOT cancelled
    expect(providerEventsStore.length).toBe(0);
    expect(activitiesStore.length).toBe(0);
  });

  // TEST 9 — FRESHNESS FAILURE
  it("TEST 9: FRESHNESS FAILURE rejects expired/stale webhook with HTTP 400 and prevents DB mutation", async () => {
    // 10 minutes in the past
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const payloadBody = {
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: staleTime,
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_100",
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Stale webhook");

    // No DB mutations
    const appt = appointmentsStore.find((a) => a.id === "appt_1");
    expect(appt?.status).toBe("confirmed");
    expect(providerEventsStore.length).toBe(0);
    expect(activitiesStore.length).toBe(0);
  });

  // TEST 10 — TRANSACTION FAILURE
  it("TEST 10: TRANSACTION FAILURE rolls back all mutations atomically without partial commitment", async () => {
    simulateTxFailure = true;

    const payloadBody = {
      triggerEvent: "BOOKING_CANCELLED",
      createdAt: new Date().toISOString(),
      event_id: "evt_tx_fail_1",
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_100",
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to process Cal.com event" });

    // Verify rollback: appointment status NOT modified
    const appt = appointmentsStore.find((a) => a.id === "appt_1");
    expect(appt?.status).toBe("confirmed");

    // Lead NOT modified
    const lead = leadsStore.find((l) => l.id === "lead_1");
    expect(lead?.nextAction).toBe("Call lead");

    // No activity created
    expect(activitiesStore.length).toBe(0);

    // Provider event was cleaned up on failure so that provider retry is permitted
    expect(providerEventsStore.some((e) => e.externalEventId === "evt_tx_fail_1")).toBe(false);
  });

  // BONUS TEST: Supported headers and metadata locations
  it("supports x-calcom-signature and payload.metadata.business_id", async () => {
    const payloadBody = {
      triggerEvent: "BOOKING_CREATED",
      createdAt: new Date().toISOString(),
      payload: {
        uid: "cal_uid_100",
        metadata: { business_id: "biz_1" },
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-calcom-signature", signature)
      .send(payloadBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, duplicate: false });
  });

  // BONUS TEST: Unknown event type does not mutate state
  it("handles unknown triggerEvent safely without mutating state", async () => {
    const payloadBody = {
      triggerEvent: "PING",
      createdAt: new Date().toISOString(),
      metadata: { business_id: "biz_1" },
      payload: {
        uid: "cal_uid_100",
      },
    };
    const bodyStr = JSON.stringify(payloadBody);
    const signature = computeCalSignature(bodyStr);

    const res = await supertest(app)
      .post("/api/webhooks/calcom")
      .set("Content-Type", "application/json")
      .set("x-cal-signature-256", signature)
      .send(payloadBody);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, duplicate: false });

    // Appt untouched
    const appt = appointmentsStore.find((a) => a.id === "appt_1");
    expect(appt?.status).toBe("confirmed");
    expect(activitiesStore.length).toBe(0);
  });
});
