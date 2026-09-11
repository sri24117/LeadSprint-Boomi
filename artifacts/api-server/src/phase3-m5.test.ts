import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import express from "express";
import supertest from "supertest";

interface ContactRow {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  email?: string | null;
  consentStatus: string;
  consentCapturedAt?: Date | null;
  consentSource?: string | null;
  consentDisclosureVersion?: string | null;
  intakeIp?: string | null;
  recipientTimezone?: string | null;
  timezoneProvenance?: string;
}

interface LeadRow {
  id: string;
  businessId: string;
  contactId: string;
  source: string;
  campaign: string;
  project: string;
  propertyType: string;
  budgetMin?: string | null;
  budgetMax?: string | null;
  budgetLabel: string;
  location: string;
  timeline: string;
  qualificationStatus?: string;
  intentScore?: number;
  score: string;
  status: string;
  nextAction: string;
  createdAt: Date;
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

interface CallRow {
  id: string;
  businessId: string;
  contactId: string;
  leadId: string;
  provider: string;
  idempotencyKey: string;
  status: string;
  summary: string;
  outcome: string;
}

interface WorkflowJobRow {
  id: string;
  businessId: string;
  type: string;
  idempotencyKey: string;
  status: string;
  availableAt: Date;
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

interface ConsentEventRow {
  id: string;
  businessId: string;
  contactId: string;
  eventType: string;
  source: string;
  disclosureVersion?: string | null;
  disclosureText?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata: any;
  capturedAt: Date;
}

let contactsStore: ContactRow[] = [];
let leadsStore: LeadRow[] = [];
let activitiesStore: ActivityRow[] = [];
let callsStore: CallRow[] = [];
let workflowJobsStore: WorkflowJobRow[] = [];
let providerEventsStore: ProviderEventRow[] = [];
let consentEventsStore: ConsentEventRow[] = [];
let businessesStore: Array<{ id: string; name: string }> = [];

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

function makeSelectChain(actual: any) {
  return (_fields?: any) => ({
    from: (table: any) => ({
      where: (condition: any) => {
        const vals = extractValues(condition);
        let result: any[] = [];
        if (table === actual.businessesTable) {
          result = businessesStore.filter((b) => vals.includes(b.id));
        } else if (table === actual.contactsTable) {
          result = contactsStore.filter(
            (c) => vals.includes(c.id) || (vals.includes(c.businessId) && vals.includes(c.phone)),
          );
        } else if (table === actual.leadsTable) {
          result = leadsStore.filter(
            (l) =>
              vals.includes(l.id) ||
              (vals.includes(l.businessId) && (vals.includes(l.contactId) || vals.includes(l.status))),
          );
        } else if (table === actual.callsTable) {
          result = callsStore.filter((c) => vals.includes(c.id));
        } else if (table === actual.workflowJobsTable) {
          result = workflowJobsStore.filter((j) => vals.includes(j.id));
        } else if (table === actual.providerEventsTable) {
          result = providerEventsStore.filter(
            (e) => vals.includes(e.id) || (vals.includes(e.provider) && vals.includes(e.externalEventId)),
          );
        }

        const promise = Promise.resolve(result);
        (promise as any).limit = (_n: number) => Promise.resolve(result.slice(0, _n));
        (promise as any).orderBy = () => {
          const ordered = [...result].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
          const p = Promise.resolve(ordered);
          (p as any).limit = (_n: number) => Promise.resolve(ordered.slice(0, _n));
          return p;
        };
        return promise;
      },
    }),
  });
}

function makeInsertChain(actual: any) {
  return (table: any) => ({
    values: (vals: any) => {
      const doInsert = () => {
        if (table === actual.leadsTable && simulateTxFailure) {
          throw new Error("Simulated database failure during lead insert");
        }

        if (table === actual.contactsTable) {
          contactsStore.push({ ...vals });
        } else if (table === actual.leadsTable) {
          leadsStore.push({ ...vals, createdAt: new Date(), updatedAt: new Date() });
        } else if (table === actual.activitiesTable) {
          activitiesStore.push({ ...vals, createdAt: new Date() });
        } else if (table === actual.callsTable) {
          callsStore.push({ ...vals });
        } else if (table === actual.workflowJobsTable) {
          workflowJobsStore.push({ ...vals });
        } else if (table === actual.consentEventsTable) {
          consentEventsStore.push({ ...vals });
        } else if (table === actual.providerEventsTable) {
          const exists = providerEventsStore.some(
            (e) => e.provider === vals.provider && e.externalEventId === vals.externalEventId,
          );
          if (!exists) {
            providerEventsStore.push({ ...vals, processedAt: new Date() });
            return [{ id: vals.id ?? `event_${Date.now()}` }];
          }
          return [];
        }
        return [{ id: vals.id ?? `ins_${Date.now()}` }];
      };

      const res = doInsert();
      const promise = Promise.resolve(res);

      (promise as any).onConflictDoNothing = () => ({
        returning: () => Promise.resolve(res),
      });
      (promise as any).returning = () => Promise.resolve(res);

      return promise;
    },
  });
}

function makeUpdateChain(actual: any) {
  return (table: any) => ({
    set: (setVals: any) => ({
      where: (condition: any) => {
        const vals = extractValues(condition);
        if (table === actual.contactsTable) {
          const contact = contactsStore.find((c) => vals.includes(c.id));
          if (contact) Object.assign(contact, setVals);
        } else if (table === actual.leadsTable) {
          const lead = leadsStore.find((l) => vals.includes(l.id));
          if (lead) Object.assign(lead, setVals);
        }
        return Promise.resolve([{ id: "updated" }]);
      },
    }),
  });
}

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<any>("@workspace/db");

  const mockDb = {
    select: makeSelectChain(actual),
    insert: makeInsertChain(actual),
    update: makeUpdateChain(actual),
    transaction: async (callback: (tx: any) => Promise<any>) => {
      const contactsSnap = JSON.stringify(contactsStore);
      const leadsSnap = JSON.stringify(leadsStore);
      const activitiesSnap = JSON.stringify(activitiesStore);
      const callsSnap = JSON.stringify(callsStore);
      const jobsSnap = JSON.stringify(workflowJobsStore);
      const eventsSnap = JSON.stringify(providerEventsStore);
      const consentSnap = JSON.stringify(consentEventsStore);

      const tx = {
        select: makeSelectChain(actual),
        insert: makeInsertChain(actual),
        update: makeUpdateChain(actual),
      };

      try {
        const res = await callback(tx);
        return res;
      } catch (err) {
        contactsStore = JSON.parse(contactsSnap);
        leadsStore = JSON.parse(leadsSnap);
        activitiesStore = JSON.parse(activitiesSnap);
        callsStore = JSON.parse(callsSnap);
        workflowJobsStore = JSON.parse(jobsSnap);
        providerEventsStore = JSON.parse(eventsSnap);
        consentEventsStore = JSON.parse(consentSnap);
        throw err;
      }
    },
  };

  return {
    ...actual,
    db: mockDb,
  };
});

import webhooksRouter from "./routes/webhooks";

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

describe("Phase 3 Milestone 5: Subsequent Inbound Enquiry Re-engagement & Source-Event Deduplication", () => {
  const app = createWebhookApp();

  beforeEach(() => {
    process.env.LEAD_INTAKE_WEBHOOK_SECRET = TEST_INTAKE_SECRET;
    simulateTxFailure = false;

    businessesStore = [
      { id: "biz_1", name: "Acme Real Estate" },
      { id: "biz_2", name: "Beta Realty" },
    ];
    contactsStore = [];
    leadsStore = [];
    activitiesStore = [];
    callsStore = [];
    workflowJobsStore = [];
    providerEventsStore = [];
    consentEventsStore = [];
  });

  it("Scenario A: Existing contact + active lead (new/contacted/qualified) -> re-engagement updates lead", async () => {
    // 1. Initial intake
    const payload1 = {
      event_id: "evt_1001",
      business_id: "biz_1",
      name: "John Doe",
      phone: "+12024561111",
      campaign: "Spring Campaign",
      property_type: "Condo",
      timestamp: new Date().toISOString(),
    };
    const sig1 = computeHmac(JSON.stringify(payload1), TEST_INTAKE_SECRET);

    const res1 = await supertest(app)
      .post("/api/webhooks/intake")
      .set("Content-Type", "application/json")
      .set("x-leadsprint-signature", sig1)
      .send(payload1);

    expect(res1.status).toBe(201);
    expect(res1.body.accepted).toBe(true);
    expect(res1.body.re_engaged).toBe(false);
    const initialLeadId = res1.body.lead_id;

    // Manually transition lead status to 'contacted'
    const lead = leadsStore.find((l) => l.id === initialLeadId);
    if (lead) lead.status = "contacted";

    // 2. Re-engagement intake from same contact
    const payload2 = {
      event_id: "evt_1002",
      business_id: "biz_1",
      name: "John Doe Updated",
      phone: "+12024561111",
      campaign: "Summer Upgrade",
      property_type: "Penthouse",
      timestamp: new Date().toISOString(),
    };
    const sig2 = computeHmac(JSON.stringify(payload2), TEST_INTAKE_SECRET);

    const res2 = await supertest(app)
      .post("/api/webhooks/intake")
      .set("Content-Type", "application/json")
      .set("x-leadsprint-signature", sig2)
      .send(payload2);

    expect(res2.status).toBe(201);
    expect(res2.body.accepted).toBe(true);
    expect(res2.body.re_engaged).toBe(true);
    expect(res2.body.lead_id).toBe(initialLeadId);

    // Verify existing active lead was updated to 'new' with updated property details
    const updatedLead = leadsStore.find((l) => l.id === initialLeadId);
    expect(updatedLead?.status).toBe("new");
    expect(updatedLead?.campaign).toBe("Summer Upgrade");
    expect(updatedLead?.propertyType).toBe("Penthouse");

    // Verify activity logged
    const reEngagedActivity = activitiesStore.find((a) => a.title.includes("Re-engaged lead"));
    expect(reEngagedActivity).toBeDefined();

    // Verify call and workflow job enqueued
    expect(callsStore.length).toBe(2);
    expect(workflowJobsStore.length).toBe(2);
  });

  it("Scenario B: Existing contact + terminal lead (booked/closed/suppressed) -> creates new lead", async () => {
    // 1. Initial intake
    const payload1 = {
      event_id: "evt_2001",
      business_id: "biz_1",
      name: "Alice Smith",
      phone: "+12024562222",
      timestamp: new Date().toISOString(),
    };
    const sig1 = computeHmac(JSON.stringify(payload1), TEST_INTAKE_SECRET);
    const res1 = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig1).send(payload1);
    const firstLeadId = res1.body.lead_id;

    // Set existing lead to terminal status 'booked'
    const lead = leadsStore.find((l) => l.id === firstLeadId);
    if (lead) lead.status = "booked";

    // 2. Re-engagement intake from same contact
    const payload2 = {
      event_id: "evt_2002",
      business_id: "biz_1",
      name: "Alice Smith",
      phone: "+12024562222",
      campaign: "Second Inquiry",
      timestamp: new Date().toISOString(),
    };
    const sig2 = computeHmac(JSON.stringify(payload2), TEST_INTAKE_SECRET);
    const res2 = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig2).send(payload2);

    expect(res2.status).toBe(201);
    expect(res2.body.accepted).toBe(true);
    expect(res2.body.re_engaged).toBe(true);
    expect(res2.body.lead_id).not.toBe(firstLeadId); // Created new lead ID!

    expect(leadsStore.length).toBe(2);
    expect(leadsStore.find((l) => l.id === firstLeadId)?.status).toBe("booked");
    expect(leadsStore.find((l) => l.id === res2.body.lead_id)?.status).toBe("new");
  });

  it("Scenario C: Exact intake source-event replay -> returns 200 duplicate with no extra mutations", async () => {
    const payload = {
      event_id: "evt_replay_999",
      business_id: "biz_1",
      name: "Bob Replay",
      phone: "+12024563333",
      timestamp: new Date().toISOString(),
    };
    const sig = computeHmac(JSON.stringify(payload), TEST_INTAKE_SECRET);

    // First delivery
    const res1 = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig).send(payload);
    expect(res1.status).toBe(201);

    // Exact replay delivery
    const res2 = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig).send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.accepted).toBe(true);
    expect(res2.body.duplicate).toBe(true);

    // Verify NO duplicate state created
    expect(contactsStore.length).toBe(1);
    expect(leadsStore.length).toBe(1);
    expect(activitiesStore.length).toBe(1);
    expect(callsStore.length).toBe(1);
    expect(workflowJobsStore.length).toBe(1);
  });

  it("Scenario D: New source event from same contact -> legitimate new re-engagement", async () => {
    const payload1 = {
      event_id: "evt_distinct_1",
      business_id: "biz_1",
      name: "Charlie Brown",
      phone: "+12024564444",
      timestamp: new Date().toISOString(),
    };
    const sig1 = computeHmac(JSON.stringify(payload1), TEST_INTAKE_SECRET);
    await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig1).send(payload1);

    const payload2 = {
      event_id: "evt_distinct_2", // Distinct event ID
      business_id: "biz_1",
      name: "Charlie Brown",
      phone: "+12024564444",
      timestamp: new Date().toISOString(),
    };
    const sig2 = computeHmac(JSON.stringify(payload2), TEST_INTAKE_SECRET);
    const res2 = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig2).send(payload2);

    expect(res2.status).toBe(201);
    expect(res2.body.re_engaged).toBe(true);
  });

  it("Scenario E: Intent score handling — preserves existing intentScore unless explicitly provided", async () => {
    // 1. Initial intake with explicit intent_score
    const payload1 = {
      event_id: "evt_score_1",
      business_id: "biz_1",
      name: "Dave Score",
      phone: "+12024565555",
      intent_score: 85,
      timestamp: new Date().toISOString(),
    };
    const sig1 = computeHmac(JSON.stringify(payload1), TEST_INTAKE_SECRET);
    const res1 = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig1).send(payload1);
    const leadId = res1.body.lead_id;

    expect(leadsStore.find((l) => l.id === leadId)?.intentScore).toBe(85);

    // 2. Re-engagement WITHOUT intent_score -> must PRESERVE existing 85
    const payload2 = {
      event_id: "evt_score_2",
      business_id: "biz_1",
      name: "Dave Score",
      phone: "+12024565555",
      timestamp: new Date().toISOString(),
    };
    const sig2 = computeHmac(JSON.stringify(payload2), TEST_INTAKE_SECRET);
    await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig2).send(payload2);

    expect(leadsStore.find((l) => l.id === leadId)?.intentScore).toBe(85);
  });

  it("Scenario F: Consent & Timezone — non-affirmative payload does not create opt_in consent event", async () => {
    const payload = {
      event_id: "evt_consent_1",
      business_id: "biz_1",
      name: "Eve Consent",
      phone: "+12024566666",
      recipient_timezone: "America/Chicago",
      timestamp: new Date().toISOString(),
    };
    const sig = computeHmac(JSON.stringify(payload), TEST_INTAKE_SECRET);
    await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig).send(payload);

    expect(consentEventsStore.length).toBe(0); // No opt_in created without affirmative consent
    expect(contactsStore[0].recipientTimezone).toBe("America/Chicago");
    expect(contactsStore[0].timezoneProvenance).toBe("explicit_intake");
  });

  it("Scenario G: Explicit affirmative consent refresh creates opt_in record", async () => {
    const payload = {
      event_id: "evt_consent_2",
      business_id: "biz_1",
      name: "Frank Consent",
      phone: "+12024567777",
      consent_given: true,
      consent_source: "api_intake",
      timestamp: new Date().toISOString(),
    };
    const sig = computeHmac(JSON.stringify(payload), TEST_INTAKE_SECRET);
    await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig).send(payload);

    expect(consentEventsStore.length).toBe(1);
    expect(consentEventsStore[0].eventType).toBe("opt_in");
  });

  it("Scenario H: Multi-tenant tenant-scoped deduplication test — identical event IDs from different businesses do NOT suppress each other", async () => {
    const sharedPayloadBiz1 = {
      event_id: "evt_shared_100",
      business_id: "biz_1",
      name: "Tenant A Lead",
      phone: "+12024568888",
      timestamp: new Date().toISOString(),
    };
    const sig1 = computeHmac(JSON.stringify(sharedPayloadBiz1), TEST_INTAKE_SECRET);
    const res1 = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig1).send(sharedPayloadBiz1);
    expect(res1.status).toBe(201);

    const sharedPayloadBiz2 = {
      event_id: "evt_shared_100", // Same external event ID!
      business_id: "biz_2",
      name: "Tenant B Lead",
      phone: "+12024569999",
      timestamp: new Date().toISOString(),
    };
    const sig2 = computeHmac(JSON.stringify(sharedPayloadBiz2), TEST_INTAKE_SECRET);
    const res2 = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig2).send(sharedPayloadBiz2);

    expect(res2.status).toBe(201); // Tenant B is NOT suppressed by Tenant A's event!
    expect(res2.body.accepted).toBe(true);
    expect(res2.body.duplicate).toBeUndefined();
  });

  it("Scenario J: Worker policy authority — call job remains queued and Retell API is NOT called directly during intake", async () => {
    const payload = {
      event_id: "evt_policy_1",
      business_id: "biz_1",
      name: "Grace Policy",
      phone: "+12024560000",
      timestamp: new Date().toISOString(),
    };
    const sig = computeHmac(JSON.stringify(payload), TEST_INTAKE_SECRET);
    const res = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig).send(payload);

    expect(res.status).toBe(201);
    expect(callsStore.length).toBe(1);
    expect(callsStore[0].status).toBe("queued");
    expect(workflowJobsStore.length).toBe(1);
    expect(workflowJobsStore[0].status).toBe("queued");
    expect(workflowJobsStore[0].type).toBe("initiate_call");
  });

  it("Scenario K: Atomic transaction rollback — failure during transaction rolls back provider event registration", async () => {
    simulateTxFailure = true;

    const payload = {
      event_id: "evt_fail_100",
      business_id: "biz_1",
      name: "Hank Fail",
      phone: "+12024561234",
      timestamp: new Date().toISOString(),
    };
    const sig = computeHmac(JSON.stringify(payload), TEST_INTAKE_SECRET);

    const res = await supertest(app).post("/api/webhooks/intake").set("x-leadsprint-signature", sig).send(payload);

    expect(res.status).toBe(500);
    // Verify provider event registration was rolled back!
    expect(providerEventsStore.length).toBe(0);
    expect(contactsStore.length).toBe(0);
    expect(leadsStore.length).toBe(0);
  });
});
