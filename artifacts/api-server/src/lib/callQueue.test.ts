/**
 * Acceptance tests for the speed-to-lead path, against a real embedded
 * PostgreSQL. These cover the scenarios in the pilot definition of done
 * that idempotency and gate ordering depend on:
 *
 *   - one intake ⇒ exactly one call job
 *   - a duplicate/replayed intake ⇒ still exactly one call
 *   - the policy gate runs immediately before the provider request
 *   - suppressed / invalid-consent leads never reach the provider
 *   - the kill switch prevents all new outbound calls
 *   - a failed provider call is visible and recoverable
 *   - a second workspace cannot see the first workspace's calls
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  callsTable,
  contactsTable,
  leadsTable,
  workflowJobsTable,
  businessesTable,
} from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import {
  __resetCallQueueDb,
  __setCallQueueDb,
  dispatchQueuedCall,
  enqueueCallForLead,
  intakeIdempotencyKey,
} from "./callQueue";
import * as providers from "./providers";

let db: TestDb;
const startRetellCall = vi.spyOn(providers, "startRetellCall");

const ENV = {
  RETELL_API_KEY: "key",
  RETELL_AGENT_ID: "agent_live",
  RETELL_FROM_NUMBER_US: "+12125550100",
  CALCOM_API_KEY: "cal_key",
  CALCOM_EVENT_TYPE_ID: "12345",
};

async function seedLead(options: {
  businessId?: string;
  leadId?: string;
  consentStatus?: string;
  suppressedAt?: Date | null;
  timezone?: string | null;
  business?: Record<string, unknown>;
} = {}) {
  const businessId = options.businessId ?? "business_pilot";
  const leadId = options.leadId ?? `lead_${businessId}`;
  const contactId = `contact_${leadId}`;

  const [existing] = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.id, businessId));
  if (!existing) {
    await db
      .insert(businessesTable)
      .values(pilotBusiness({ id: businessId, ...(options.business ?? {}) }) as never);
  }

  await db.insert(contactsTable).values({
    id: contactId,
    businessId,
    name: "Ava Williams",
    phone: "+19175550184",
    consentStatus: options.consentStatus ?? "valid",
    consentSource: "web_form:listing-enquiry",
    consentAt: new Date(),
    suppressedAt: options.suppressedAt ?? null,
    timezone: options.timezone === undefined ? "America/New_York" : options.timezone,
  });
  await db.insert(leadsTable).values({
    id: leadId,
    businessId,
    contactId,
    project: "Spring buyer campaign",
    propertyType: "Condo",
    budgetLabel: "$850k – $1.1M",
    location: "Williamsburg",
    timeline: "0–3 months",
  });
  return { businessId, leadId, contactId };
}

beforeEach(async () => {
  // Freeze the clock inside the pilot's allowed calling window
  // (13:00 America/New_York). Otherwise the whole suite passes or fails
  // depending on what time of day CI happens to run — quiet hours are
  // 21:00–08:00 recipient-local, and every one of these calls would be
  // blocked overnight.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T17:00:00Z"));
  db = await createTestDb();
  __setCallQueueDb(db as never);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  delete process.env.LEADSPRINT_KILL_SWITCH;
  startRetellCall.mockReset();
  startRetellCall.mockResolvedValue({ callId: "retell_call_1" });
});

afterEach(() => {
  vi.useRealTimers();
  __resetCallQueueDb();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

describe("enqueueCallForLead", () => {
  it("creates exactly one call and one workflow job for a new lead", async () => {
    const { businessId, leadId } = await seedLead();
    const result = await enqueueCallForLead({
      businessId,
      leadId,
      idempotencyKey: intakeIdempotencyKey(leadId),
      source: "intake",
    });

    expect(result?.created).toBe(true);
    expect(result?.call.status).toBe("queued");
    const jobs = await db.select().from(workflowJobsTable);
    expect(jobs).toHaveLength(1);
    // The workflow job shares the call's *stable* idempotency key (not the
    // call row's PK) so the cron worker can find the call it belongs to and
    // a replay cannot create a second job. See lib/callQueue.ts and the
    // 2026-09-17 audit, issue #4.
    expect(jobs[0]?.idempotencyKey).toBe(intakeIdempotencyKey(leadId));
  });

  it("is idempotent: a replayed intake never creates a second call", async () => {
    const { businessId, leadId } = await seedLead();
    const key = intakeIdempotencyKey(leadId);

    const first = await enqueueCallForLead({ businessId, leadId, idempotencyKey: key, source: "intake" });
    const second = await enqueueCallForLead({ businessId, leadId, idempotencyKey: key, source: "intake" });

    expect(second?.created).toBe(false);
    expect(second?.call.id).toBe(first?.call.id);
    expect(await db.select().from(callsTable)).toHaveLength(1);
    expect(await db.select().from(workflowJobsTable)).toHaveLength(1);
  });

  it("returns null for a lead that belongs to another workspace", async () => {
    const { leadId } = await seedLead({ businessId: "business_a", leadId: "lead_a" });
    await seedLead({ businessId: "business_b", leadId: "lead_b" });

    const crossTenant = await enqueueCallForLead({
      businessId: "business_b",
      leadId,
      idempotencyKey: "x",
      source: "console",
    });
    expect(crossTenant).toBeNull();
  });
});

describe("dispatchQueuedCall", () => {
  async function queue(seed: Parameters<typeof seedLead>[0] = {}) {
    const { businessId, leadId } = await seedLead(seed);
    const queued = await enqueueCallForLead({
      businessId,
      leadId,
      idempotencyKey: intakeIdempotencyKey(leadId),
      source: "intake",
    });
    return { businessId, leadId, callId: queued!.call.id };
  }

  it("places the call and records the provider id", async () => {
    const { businessId, callId } = await queue();
    const result = await dispatchQueuedCall({ businessId, callId });

    expect(result.outcome).toBe("started");
    expect(startRetellCall).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(callsTable).where(eq(callsTable.id, callId));
    expect(row?.status).toBe("in_progress");
    expect(row?.providerCallId).toBe("retell_call_1");
  });

  it("passes business_id, lead_id and call_id to the provider", async () => {
    const { businessId, leadId, callId } = await queue();
    await dispatchQueuedCall({ businessId, callId });

    expect(startRetellCall).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { business_id: businessId, lead_id: leadId, call_id: callId },
      }),
    );
  });

  it("never dials a lead with unknown consent", async () => {
    const { businessId, callId } = await queue({ consentStatus: "unknown" });
    const result = await dispatchQueuedCall({ businessId, callId });

    expect(result.outcome).toBe("policy_blocked");
    expect(result.policyReason).toBe("consent_invalid");
    expect(startRetellCall).not.toHaveBeenCalled();
    const [row] = await db.select().from(callsTable).where(eq(callsTable.id, callId));
    expect(row?.status).toBe("policy_blocked");
  });

  it("never dials a suppressed lead", async () => {
    const { businessId, callId } = await queue({ suppressedAt: new Date() });
    const result = await dispatchQueuedCall({ businessId, callId });

    expect(result.policyReason).toBe("suppressed");
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("blocks rather than guessing when the recipient timezone is unknown", async () => {
    const { businessId, callId } = await queue({ timezone: null });
    const result = await dispatchQueuedCall({ businessId, callId });

    expect(result.policyReason).toBe("location_unknown");
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("re-evaluates the policy at dispatch time, not at enqueue time", async () => {
    const { businessId, callId } = await queue();
    // Consent is revoked after the call was already queued.
    await db.update(contactsTable).set({ consentStatus: "revoked" });

    const result = await dispatchQueuedCall({ businessId, callId });
    expect(result.outcome).toBe("policy_blocked");
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("blocks a call attempted during quiet hours", async () => {
    vi.setSystemTime(new Date("2026-09-17T05:00:00Z")); // 01:00 America/New_York
    const { businessId, callId } = await queue();
    const result = await dispatchQueuedCall({ businessId, callId });

    expect(result.policyReason).toBe("quiet_hours");
    expect(result.retryable).toBe(true);
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("stops every new outbound call while the kill switch is engaged", async () => {
    process.env.LEADSPRINT_KILL_SWITCH = "true";
    const { businessId, callId } = await queue();
    const result = await dispatchQueuedCall({ businessId, callId });

    expect(result.policyReason).toBe("kill_switch");
    expect(startRetellCall).not.toHaveBeenCalled();
    delete process.env.LEADSPRINT_KILL_SWITCH;
  });

  it("refuses to dial from a half-configured workspace", async () => {
    const { businessId, callId } = await queue({ business: { transferNumber: "" } });
    const result = await dispatchQueuedCall({ businessId, callId });

    expect(result.outcome).toBe("setup_incomplete");
    expect(result.retryable).toBe(true);
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("defers rather than failing when the provider is not configured yet", async () => {
    delete process.env.RETELL_API_KEY;
    const { businessId, callId } = await queue();
    const result = await dispatchQueuedCall({ businessId, callId });

    // Reported as a setup problem, and the call stays queued so the
    // backlog drains once credentials arrive.
    expect(["setup_incomplete", "provider_not_configured"]).toContain(result.outcome);
    const [row] = await db.select().from(callsTable).where(eq(callsTable.id, callId));
    expect(row?.status).toBe("queued");
  });

  it("marks a failed provider request as uncertain and recoverable, never as sent", async () => {
    startRetellCall.mockRejectedValueOnce(new Error("Retell returned 502"));
    const { businessId, callId } = await queue();
    const result = await dispatchQueuedCall({ businessId, callId });

    expect(result.outcome).toBe("provider_uncertain");
    expect(result.retryable).toBe(true);
    const [row] = await db.select().from(callsTable).where(eq(callsTable.id, callId));
    expect(row?.status).toBe("uncertain");
    expect(row?.errorState).toContain("502");
  });

  it("does not dial twice when the same call is dispatched again", async () => {
    const { businessId, callId } = await queue();
    await dispatchQueuedCall({ businessId, callId });
    const second = await dispatchQueuedCall({ businessId, callId });

    expect(second.outcome).toBe("already_handled");
    expect(startRetellCall).toHaveBeenCalledTimes(1);
  });

  it("enforces the per-lead attempt limit", async () => {
    const { businessId, leadId } = await seedLead();
    // maxCallAttempts is 2 for the pilot business.
    for (const key of ["a", "b"]) {
      const queued = await enqueueCallForLead({ businessId, leadId, idempotencyKey: key, source: "console" });
      await dispatchQueuedCall({ businessId, callId: queued!.call.id });
    }
    const third = await enqueueCallForLead({ businessId, leadId, idempotencyKey: "c", source: "console" });
    const result = await dispatchQueuedCall({ businessId, callId: third!.call.id });

    expect(result.policyReason).toBe("attempt_limit");
    expect(startRetellCall).toHaveBeenCalledTimes(2);
  });

  it("does not let a policy-blocked call consume the attempt budget", async () => {
    const { businessId, leadId } = await seedLead({ consentStatus: "unknown" });
    const blocked = await enqueueCallForLead({ businessId, leadId, idempotencyKey: "a", source: "console" });
    await dispatchQueuedCall({ businessId, callId: blocked!.call.id });

    // Consent is now properly captured; the lead should still be callable.
    await db.update(contactsTable).set({ consentStatus: "valid" });
    const retry = await enqueueCallForLead({ businessId, leadId, idempotencyKey: "b", source: "console" });
    const result = await dispatchQueuedCall({ businessId, callId: retry!.call.id });

    expect(result.outcome).toBe("started");
  });

  it("cannot dispatch another workspace's call", async () => {
    const { callId } = await queue();
    await seedLead({ businessId: "business_other", leadId: "lead_other" });

    const result = await dispatchQueuedCall({ businessId: "business_other", callId });
    expect(result.outcome).toBe("already_handled");
    expect(startRetellCall).not.toHaveBeenCalled();
    const [row] = await db
      .select()
      .from(callsTable)
      .where(and(eq(callsTable.id, callId), eq(callsTable.businessId, "business_pilot")));
    expect(row?.status).toBe("queued");
  });
});
