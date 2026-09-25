/**
 * Concurrency guards on the call path.
 *
 * Placing a call is the one operation in LeadSprint that cannot be undone:
 * a duplicate reaches a real person's phone and cannot be recalled. The
 * safety policy gate protects *whether* a call happens; these tests cover
 * *how many times*.
 *
 * The failure they exist for: every check between "this call is queued"
 * and "dial it" used to be a read followed by a decision, so two
 * dispatching workers — the in-process scheduler and an external cron, or
 * two replicas during a rolling deploy — could both read `queued`, both
 * pass the gate, and both ask Retell to dial. Both guarantees below are
 * enforced by a conditional UPDATE in the database, which is why they are
 * tested against a real embedded PostgreSQL rather than a mocked handle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  businessesTable,
  callsTable,
  contactsTable,
  leadsTable,
  workflowJobsTable,
} from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import {
  __resetCallQueueDb,
  __setCallQueueDb,
  dispatchQueuedCall,
  enqueueCallForLead,
  intakeIdempotencyKey,
} from "./callQueue";
import { processQueuedJobs } from "./scheduler";
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

const BUSINESS_ID = "business_pilot";

async function seedLead(leadId = "lead_race") {
  await db.insert(businessesTable).values(pilotBusiness() as never);
  await db.insert(contactsTable).values({
    id: `contact_${leadId}`,
    businessId: BUSINESS_ID,
    name: "Ava Williams",
    phone: "+19175550184",
    consentStatus: "valid",
    consentSource: "web_form:listing-enquiry",
    consentAt: new Date(),
    timezone: "America/New_York",
  });
  await db.insert(leadsTable).values({
    id: leadId,
    businessId: BUSINESS_ID,
    contactId: `contact_${leadId}`,
    project: "Spring buyer campaign",
    propertyType: "Condo",
    budgetLabel: "$850k – $1.1M",
    location: "Williamsburg",
    timeline: "0–3 months",
  });
  return leadId;
}

async function callRows() {
  return db.select().from(callsTable).where(eq(callsTable.businessId, BUSINESS_ID));
}

beforeEach(async () => {
  // 13:00 America/New_York — inside the pilot's allowed calling window, so
  // these tests assert concurrency, not quiet hours.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T17:00:00Z"));
  db = await createTestDb();
  __setCallQueueDb(db as never);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  delete process.env.LEADSPRINT_KILL_SWITCH;
  startRetellCall.mockReset();
  startRetellCall.mockResolvedValue({ callId: "retell_call_race" });
});

afterEach(() => {
  vi.useRealTimers();
  __resetCallQueueDb();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

describe("duplicate dispatch", () => {
  it("dials once when the same call is dispatched concurrently", async () => {
    const leadId = await seedLead();
    const queued = await enqueueCallForLead({
      businessId: BUSINESS_ID,
      leadId,
      idempotencyKey: intakeIdempotencyKey(leadId),
      source: "intake",
    });
    const callId = queued!.call.id;

    // Hold the provider request open so the second dispatcher is forced to
    // interleave with the first *after* it has decided to dial. Without the
    // atomic claim, both read status "queued" before either writes, and
    // both reach the provider — two calls to one prospect.
    let releaseProvider: ((value: { callId: string }) => void) | undefined;
    startRetellCall.mockImplementation(
      () =>
        new Promise<{ callId: string }>((resolve) => {
          releaseProvider = resolve;
        }),
    );

    const first = dispatchQueuedCall({ businessId: BUSINESS_ID, callId });
    const second = dispatchQueuedCall({ businessId: BUSINESS_ID, callId });
    await vi.advanceTimersByTimeAsync(0);
    releaseProvider?.({ callId: "retell_call_race" });
    const results = await Promise.all([first, second]);

    expect(startRetellCall).toHaveBeenCalledTimes(1);
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes).toEqual(["already_handled", "started"]);
    // And the loser must not have written a competing state onto the row.
    const rows = await callRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("in_progress");
    expect(rows[0]?.providerCallId).toBe("retell_call_race");
  });

  it("dials once when two workers drain the queue at the same time", async () => {
    const leadId = await seedLead();
    await enqueueCallForLead({
      businessId: BUSINESS_ID,
      leadId,
      idempotencyKey: intakeIdempotencyKey(leadId),
      source: "intake",
    });

    // An internal scheduler tick and a POST /api/cron/process-jobs landing
    // in the same instant — the documented way to run both mechanisms at
    // once, and the reason the job queue needs an atomic claim of its own.
    const [first, second] = await Promise.all([
      processQueuedJobs(db as never),
      processQueuedJobs(db as never),
    ]);

    expect(startRetellCall).toHaveBeenCalledTimes(1);
    expect(first.started + second.started).toBe(1);

    const jobs = await db
      .select()
      .from(workflowJobsTable)
      .where(eq(workflowJobsTable.businessId, BUSINESS_ID));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("completed");
  });

  it("requeues a job abandoned mid-dispatch instead of wedging the queue", async () => {
    const leadId = await seedLead();
    const queued = await enqueueCallForLead({
      businessId: BUSINESS_ID,
      leadId,
      idempotencyKey: intakeIdempotencyKey(leadId),
      source: "intake",
    });
    expect(queued).toBeTruthy();

    // A worker that claimed the job and then died (deploy, OOM, SIGKILL)
    // leaves it in `dispatching`. Nothing would ever pick it up again if the
    // claim had no expiry, and that call would silently never happen.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    await db
      .update(workflowJobsTable)
      .set({ status: "dispatching", lockedAt: tenMinutesAgo })
      .where(eq(workflowJobsTable.businessId, BUSINESS_ID));

    const result = await processQueuedJobs(db as never);

    expect(result.started).toBe(1);
    expect(startRetellCall).toHaveBeenCalledTimes(1);
    const [job] = await db
      .select()
      .from(workflowJobsTable)
      .where(eq(workflowJobsTable.businessId, BUSINESS_ID));
    expect(job?.status).toBe("completed");
  });

  it("leaves a claim that is still fresh alone", async () => {
    const leadId = await seedLead();
    await enqueueCallForLead({
      businessId: BUSINESS_ID,
      leadId,
      idempotencyKey: intakeIdempotencyKey(leadId),
      source: "intake",
    });
    // A live worker is mid-dispatch. Re-claiming now would be the double
    // dial this whole mechanism exists to prevent.
    await db
      .update(workflowJobsTable)
      .set({ status: "dispatching", lockedAt: new Date() })
      .where(eq(workflowJobsTable.businessId, BUSINESS_ID));

    const result = await processQueuedJobs(db as never);

    expect(result.jobs_seen).toBe(0);
    expect(result.started).toBe(0);
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("calls a lead who enquired overnight once the window opens", async () => {
    const leadId = await seedLead();
    // 23:00 America/New_York: inside quiet hours. The enquiry is real, the
    // call is not lawful yet, and the queue has to remember it.
    vi.setSystemTime(new Date("2026-09-16T03:00:00Z"));
    const queued = await enqueueCallForLead({
      businessId: BUSINESS_ID,
      leadId,
      idempotencyKey: intakeIdempotencyKey(leadId),
      source: "intake",
    });
    expect(queued).toBeTruthy();

    const blocked = await dispatchQueuedCall({ businessId: BUSINESS_ID, callId: queued!.call.id });
    expect(blocked.outcome).toBe("policy_blocked");
    expect(blocked.policyReason).toBe("quiet_hours");
    // The retry is scheduled for the opening of the window, not 30 minutes
    // from now — otherwise the queue burns its attempts during the night and
    // this lead is never called at all.
    expect(blocked.retryAt).toBeInstanceOf(Date);
    expect(blocked.retryAt!.getTime()).toBeGreaterThan(new Date("2026-09-16T11:00:00Z").getTime());
    expect(blocked.retryAt!.getTime()).toBeLessThanOrEqual(new Date("2026-09-16T12:05:00Z").getTime());

    const [job] = await db
      .select()
      .from(workflowJobsTable)
      .where(eq(workflowJobsTable.businessId, BUSINESS_ID));
    expect(job?.status).toBe("queued");

    // 08:00 America/New_York the next morning — the window is open.
    vi.setSystemTime(new Date("2026-09-16T12:05:00Z"));
    const tick = await processQueuedJobs(db as never);

    expect(tick.started).toBe(1);
    expect(startRetellCall).toHaveBeenCalledTimes(1);
    const rows = await callRows();
    // The same call row carries the outcome: the block is history on it, not
    // a dead end that stops the call forever.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("in_progress");
  });

  it("does not re-dial a call blocked by a decision, only by the clock", async () => {
    const leadId = await seedLead();
    await db
      .update(contactsTable)
      .set({ consentStatus: "unknown", consentSource: null, consentAt: null })
      .where(eq(contactsTable.id, `contact_${leadId}`));
    const queued = await enqueueCallForLead({
      businessId: BUSINESS_ID,
      leadId,
      idempotencyKey: intakeIdempotencyKey(leadId),
      source: "intake",
    });
    const blocked = await dispatchQueuedCall({ businessId: BUSINESS_ID, callId: queued!.call.id });
    expect(blocked.outcome).toBe("policy_blocked");
    expect(blocked.retryable).toBe(false);
    expect(blocked.retryAt).toBeUndefined();

    // Dispatching again must not reopen it: consent is a decision, and a
    // retry cannot clear it.
    const again = await dispatchQueuedCall({ businessId: BUSINESS_ID, callId: queued!.call.id });
    expect(again.outcome).toBe("already_handled");
    expect(startRetellCall).not.toHaveBeenCalled();
  });

  it("records exactly one call row for a replayed intake", async () => {
    const leadId = await seedLead();
    const key = intakeIdempotencyKey(leadId);
    const [first, second] = await Promise.all([
      enqueueCallForLead({ businessId: BUSINESS_ID, leadId, idempotencyKey: key, source: "intake" }),
      enqueueCallForLead({ businessId: BUSINESS_ID, leadId, idempotencyKey: key, source: "intake" }),
    ]);
    expect(first?.call.id).toBe(second?.call.id);
    expect(await callRows()).toHaveLength(1);
    expect(
      (await db.select().from(workflowJobsTable).where(and(eq(workflowJobsTable.businessId, BUSINESS_ID)))).length,
    ).toBe(1);
  });
});
