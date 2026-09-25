import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { db as defaultDb } from "@workspace/db";
import {
  activitiesTable,
  appointmentsTable,
  businessesTable,
  callsTable,
  contactsTable,
  leadsTable,
  providerEventsTable,
  suppressionsTable,
  usageTable,
  usersTable,
  workflowJobsTable,
} from "@workspace/db";
import {
  GetActivityQueryParams,
  GetActivityResponse,
  GetAppointmentsResponse,
  GetAuthMeResponse,
  GetAvailabilityBody,
  GetAvailabilityResponse,
  GetBusinessSettingsResponse,
  GetCallParams,
  GetCallResponse,
  GetCallsQueryParams,
  GetCallsResponse,
  GetLeadParams,
  GetLeadResponse,
  GetLeadsQueryParams,
  GetLeadsResponse,
  GetTodayResponse,
  GetUsageResponse,
  GetWeeklyReportResponse,
  ImportLeadsBody,
  ImportLeadsResponse,
  StartCallBody,
  StartCallResponse,
  SuppressLeadBody,
  SuppressLeadParams,
  SuppressLeadResponse,
  UpdateBusinessSettingsBody,
  UpdateBusinessSettingsResponse,
  UpdateLeadBody,
  UpdateLeadParams,
  UpdateLeadResponse,
  BookAppointmentBody,
  BookAppointmentResponse,
} from "@workspace/api-zod";
import {
  hasRetellConfigForMarket,
  hasTwilioRoute,
  providerConfig,
  startRetellCall,
} from "../lib/providers";
import { evaluateCallPolicy } from "../lib/policy";
import { timezoneForUSPhoneNumber } from "../lib/areaCodeTimezones";
import {
  ConsentEvidenceError,
  describeConsent,
  normalizeConsentEvidence,
} from "../lib/consent";
import {
  buildOnboardingChecklist,
  liveCallingBlockedReason,
} from "../lib/onboarding";
import { dispatchQueuedCall, enqueueCallForLead } from "../lib/callQueue";
import { getCurrentUsageRow, periodLabel, VOICE_COST_PER_MINUTE } from "../lib/usage";
import {
  AvailabilityError,
  BookingError,
  bookAppointmentForLead,
  getAvailabilityForBusiness,
  hasCalConfig,
} from "../lib/appointments";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Overridable database handle — see lib/callQueue.ts for why the
// acceptance tests run against a real embedded PostgreSQL rather than a
// mock.
let db: typeof defaultDb = defaultDb;

export function __setLeadsprintDb(next: typeof defaultDb): void {
  db = next;
}

export function __resetLeadsprintDb(): void {
  db = defaultDb;
}

const BUSINESS_ID = "business_demo";
const USER_ID = "user_demo";

// Exported so the demo-auth shortcut in routes/index.ts scopes requests to
// exactly the same seeded workspace the console falls back to.
export const DEMO_BUSINESS_ID = BUSINESS_ID;
export const DEMO_USER_ID = USER_ID;

/**
 * Demo seeding is now opt-in. Previously `ensureSeedData()` ran at import
 * time against ANY database — including production — writing a fake
 * "Northstar Realty" workspace with four fake leads and two fake calls.
 * A pilot customer must never see invented leads in their console, and a
 * production database must never contain a workspace nobody created.
 *
 * Requires an explicit flag AND a non-production NODE_ENV.
 */
export function demoSeedEnabled(): boolean {
  const requested = process.env["LEADSPRINT_DEMO_SEED"]?.trim().toLowerCase() === "true";
  return requested && process.env["NODE_ENV"] !== "production";
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/**
 * A request with no resolved workspace is a bug or an auth failure — it is
 * never "the demo business". The old silent fallback to `business_demo`
 * meant a misconfigured production deployment served (and mutated) the
 * seeded demo workspace's leads, calls and appointments. Fail closed.
 */
export class WorkspaceScopeError extends Error {
  readonly statusCode = 401;
  constructor() {
    super(
      "No workspace is associated with this request. Sign in again; LeadSprint no longer falls back to the demo workspace.",
    );
  }
}

function scopedBusinessId(req: { leadSprintBusinessId?: string }): string {
  const businessId = req.leadSprintBusinessId;
  if (businessId) return businessId;
  if (demoSeedEnabled()) return BUSINESS_ID;
  throw new WorkspaceScopeError();
}

async function ensureSeedData(): Promise<void> {
  let [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, BUSINESS_ID));
  if (!business) {
    await db.insert(businessesTable).values({
      id: BUSINESS_ID,
      name: "Northstar Realty",
      market: "US",
      timezone: "America/New_York",
      phoneNumber: "+1 (212) 555-0148",
      transferNumber: "+1 (212) 555-0199",
      projectName: "Northstar Realty — Spring buyer campaign",
      servicesOrPropertyTypes: ["Condos", "Townhomes", "Single-family homes"],
      approvedFaq: "Northstar Realty helps buyers and renters find homes in Manhattan and Brooklyn. Share only configured project information, then offer a human handoff.",
      qualificationQuestions: ["What area are you looking in?", "What is your target budget?", "When are you hoping to move?", "Would you like to schedule a showing?"],
      escalationRules: "Do not answer legal, lending, appraisal, fair-housing, or availability questions outside approved information. Transfer or take a message.",
      calEventTypeId: "cal_demo_showing",
      retellAgentId: "retell_demo_agent",
    }).onConflictDoNothing();
  }

  let [user] = await db.select().from(usersTable).where(eq(usersTable.id, USER_ID));
  if (!user) {
    await db.insert(usersTable).values({ id: USER_ID, businessId: BUSINESS_ID, name: "Maya Patel", email: "maya@northstarrealty.example", role: "owner" }).onConflictDoNothing();
  }

  const existingLeads = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.businessId, BUSINESS_ID)).limit(1);
  if (existingLeads.length > 0) return;

  const seed = [
    { id: "contact_ava", name: "Ava Williams", phone: "+1 917 555 0184", email: "ava.williams@example.com", preferredLanguage: "en", propertyType: "Condo", budgetLabel: "$850k – $1.1M", location: "Williamsburg", timeline: "0–3 months", score: "hot", intentScore: 92, status: "new", nextAction: "Call within 15 minutes", source: "Zillow", campaign: "Spring buyer campaign" },
    { id: "contact_rohan", name: "Rohan Mehta", phone: "+1 646 555 0130", email: "rohan.mehta@example.com", preferredLanguage: "en", propertyType: "Townhome", budgetLabel: "$1.2M – $1.5M", location: "Park Slope", timeline: "3–6 months", score: "warm", intentScore: 74, status: "contacted", nextAction: "Confirm showing interest", source: "Website", campaign: "Spring buyer campaign" },
    { id: "contact_priya", name: "Priya Shah", phone: "+1 347 555 0162", email: "priya.shah@example.com", preferredLanguage: "en", propertyType: "Single-family home", budgetLabel: "Under $900k", location: "Queens", timeline: "6–12 months", score: "warm", intentScore: 61, status: "qualified", nextAction: "Send curated options", source: "Referral", campaign: "Spring buyer campaign" },
    { id: "contact_marcus", name: "Marcus Green", phone: "+1 718 555 0177", email: "marcus.green@example.com", preferredLanguage: "en", propertyType: "Condo", budgetLabel: "$650k – $800k", location: "Crown Heights", timeline: "Just browsing", score: "cold", intentScore: 38, status: "new", nextAction: "Follow up next week", source: "Instagram", campaign: "Spring buyer campaign" },
  ];

  for (const item of seed) {
    await db.insert(contactsTable).values({
      id: item.id,
      businessId: BUSINESS_ID,
      name: item.name,
      phone: item.phone,
      email: item.email,
      preferredLanguage: item.preferredLanguage,
      timezone: timezoneForUSPhoneNumber(item.phone),
      consentStatus: "valid",
      consentSource: `demo_seed:${item.source.toLowerCase()} enquiry form`,
      consentAt: new Date(),
    }).onConflictDoNothing();
    await db.insert(leadsTable).values({
      id: id("lead"),
      businessId: BUSINESS_ID,
      contactId: item.id,
      source: item.source,
      campaign: item.campaign,
      project: "Northstar Realty",
      propertyType: item.propertyType,
      budgetLabel: item.budgetLabel,
      location: item.location,
      timeline: item.timeline,
      qualificationStatus: item.status === "qualified" ? "Qualified" : item.status === "contacted" ? "Contacted" : "New enquiry",
      intentScore: item.intentScore,
      score: item.score,
      status: item.status,
      nextAction: item.nextAction,
    }).onConflictDoNothing();
  }

  const seededLeads = await db.select().from(leadsTable).where(eq(leadsTable.businessId, BUSINESS_ID)).orderBy(leadsTable.createdAt);
  const now = new Date();
  const ava = seededLeads[0];
  const rohan = seededLeads[1];
  if (ava && rohan) {
    await db.insert(callsTable).values({
      id: "call_ava_latest",
      businessId: BUSINESS_ID,
      contactId: ava.contactId,
      leadId: ava.id,
      provider: "Retell",
      idempotencyKey: "seed_call_ava",
      status: "completed",
      startedAt: new Date(now.getTime() - 36 * 60 * 1000),
      endedAt: new Date(now.getTime() - 31 * 60 * 1000),
      durationSeconds: 296,
      summary: "Buyer is looking for a 2-bed condo in Williamsburg and is ready to view this weekend.",
      outcome: "Qualified — showing requested",
      transferred: true,
      booked: false,
    }).onConflictDoNothing();
    await db.insert(callsTable).values({
      id: "call_rohan_active",
      businessId: BUSINESS_ID,
      contactId: rohan.contactId,
      leadId: rohan.id,
      provider: "Retell",
      idempotencyKey: "seed_call_rohan",
      status: "in_progress",
      startedAt: new Date(now.getTime() - 2 * 60 * 1000),
      summary: "Live qualification call in progress.",
      outcome: "In progress",
    }).onConflictDoNothing();
    await db.insert(appointmentsTable).values({
      id: "appointment_priya",
      businessId: BUSINESS_ID,
      contactId: seededLeads[2]?.contactId ?? rohan.contactId,
      leadId: seededLeads[2]?.id ?? rohan.id,
      serviceOrProperty: "Northstar Realty buyer consultation",
      startTime: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      endTime: new Date(now.getTime() + 2.5 * 60 * 60 * 1000),
      timezone: "America/New_York",
      externalId: "cal_booking_priya",
    }).onConflictDoNothing();
  }
  await db.insert(activitiesTable).values([
    { id: "activity_import", businessId: BUSINESS_ID, type: "import", title: "4 leads imported", detail: "Spring buyer campaign · Zillow + website", createdAt: new Date(now.getTime() - 45 * 60 * 1000) },
    { id: "activity_call", businessId: BUSINESS_ID, type: "call", title: "Ava Williams qualified", detail: "Showing interest captured by Retell", createdAt: new Date(now.getTime() - 32 * 60 * 1000) },
    { id: "activity_booking", businessId: BUSINESS_ID, type: "booking", title: "Buyer consultation booked", detail: "Today at 4:00 PM · Cal.com verified", createdAt: new Date(now.getTime() - 20 * 60 * 1000) },
  ]).onConflictDoNothing();
  await db.insert(usageTable).values({
    id: "usage_demo",
    businessId: BUSINESS_ID,
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
    voiceMinutes: "18.4",
    smsCount: 0,
    bookingCount: 1,
    estimatedCost: "4.76",
  }).onConflictDoNothing();
}

// Fire-and-forget at boot so the demo workspace exists before the first
// request — but ONLY when demo seeding was explicitly requested on a
// non-production deployment (see demoSeedEnabled). A rejected promise
// here (database not reachable yet) must not become an unhandled
// rejection that takes the whole process down — the health endpoints and
// webhooks are supposed to stay up.
if (demoSeedEnabled()) {
  logger.warn(
    "LEADSPRINT_DEMO_SEED is enabled: writing the seeded demo workspace (fake leads, calls and appointments) into this database. Never enable this on a customer deployment.",
  );
  void ensureSeedData().catch((err) => {
    logger.error({ err }, "Demo seed data could not be created");
  });
}

async function getBusiness(businessId = BUSINESS_ID) {
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId));
  return business;
}

async function getLeadDto(leadId: string, businessId = BUSINESS_ID) {
  const [row] = await db.select({ lead: leadsTable, contact: contactsTable }).from(leadsTable).innerJoin(contactsTable, eq(leadsTable.contactId, contactsTable.id)).where(and(eq(leadsTable.id, leadId), eq(leadsTable.businessId, businessId)));
  if (!row) return undefined;
  const [lastCall] = await db.select({ endedAt: callsTable.endedAt, startedAt: callsTable.startedAt }).from(callsTable).where(eq(callsTable.leadId, leadId)).orderBy(desc(callsTable.createdAt)).limit(1);
  return {
    id: row.lead.id, name: row.contact.name, phone: row.contact.phone, email: row.contact.email,
    preferred_language: row.contact.preferredLanguage, source: row.lead.source, campaign: row.lead.campaign,
    project: row.lead.project, property_type: row.lead.propertyType, budget_min: row.lead.budgetMin ? Number(row.lead.budgetMin) : null,
    budget_max: row.lead.budgetMax ? Number(row.lead.budgetMax) : null, budget_label: row.lead.budgetLabel,
    location: row.lead.location, timeline: row.lead.timeline, qualification_status: row.lead.qualificationStatus,
    intent_score: row.lead.intentScore, score: row.lead.score, next_action: row.lead.nextAction, status: row.lead.status,
    suppressed: Boolean(row.contact.suppressedAt), last_call: iso(lastCall?.endedAt ?? lastCall?.startedAt ?? null), created_at: row.lead.createdAt.toISOString(),
    // Consent state is operator-visible on every lead: a lead that cannot
    // lawfully be called must look different in the console, not just fail
    // silently at call time.
    consent_status: row.contact.consentStatus,
    consent_source: row.contact.consentSource ?? null,
    consent_at: iso(row.contact.consentAt ?? null),
    consent_detail: describeConsent({
      consentStatus: row.contact.consentStatus,
      consentSource: row.contact.consentSource,
      consentAt: row.contact.consentAt,
    }),
    callable: row.contact.consentStatus === "valid" && !row.contact.suppressedAt,
  };
}

async function getAppointmentDto(row: typeof appointmentsTable.$inferSelect, businessId = BUSINESS_ID) {
  const [lead] = await db.select({ lead: leadsTable, contact: contactsTable }).from(leadsTable).innerJoin(contactsTable, eq(leadsTable.contactId, contactsTable.id)).where(and(eq(leadsTable.id, row.leadId), eq(leadsTable.businessId, businessId)));
  return {
    id: row.id, lead_id: row.leadId, lead_name: lead?.contact.name ?? "Unknown lead",
    service_or_property: row.serviceOrProperty, start_time: row.startTime.toISOString(), end_time: row.endTime.toISOString(),
    timezone: row.timezone, calendar_provider: row.calendarProvider, external_id: row.externalId, status: row.status,
  };
}

async function getCallDto(row: typeof callsTable.$inferSelect) {
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, row.contactId));
  return {
    id: row.id, lead_id: row.leadId, lead_name: contact?.name ?? "Unknown lead", phone: contact?.phone ?? "",
    provider: row.provider, status: row.status, started_at: iso(row.startedAt), ended_at: iso(row.endedAt),
    duration_seconds: row.durationSeconds, summary: row.summary, outcome: row.outcome,
    transferred: row.transferred, booked: row.booked, error_state: row.errorState,
  };
}

router.get("/auth/me", async (_req, res): Promise<void> => {
  const req = _req;
  const businessId = scopedBusinessId(req);
  if (demoSeedEnabled() || businessId === BUSINESS_ID) {
    try {
      await ensureSeedData();
    } catch (err) {
      logger.error({ err }, "Failed to ensure seed data in /auth/me");
    }
  }
  let [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.leadSprintUserId ?? USER_ID));
  let business = await getBusiness(businessId);
  if ((!user || !business) && businessId === BUSINESS_ID) {
    try {
      await ensureSeedData();
      [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.leadSprintUserId ?? USER_ID));
      business = await getBusiness(businessId);
    } catch (err) {
      logger.error({ err }, "Retry ensure seed data in /auth/me failed");
    }
  }
  if (!user || !business) { res.status(503).json({ error: "Operator setup is not ready" }); return; }
  res.json(GetAuthMeResponse.parse({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    business: { id: business.id, name: business.name, market: business.market, timezone: business.timezone, phone_number: business.phoneNumber, transfer_number: business.transferNumber, recording_disclosure: business.recordingDisclosure, ai_disclosure: business.aiDisclosure, quiet_hours: business.quietHours, max_call_attempts: business.maxCallAttempts, suppression_enabled: business.suppressionEnabled },
  }));
});

router.post("/auth/logout", async (_req, res): Promise<void> => { res.sendStatus(204); });

router.get("/leads", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const query = GetLeadsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const filters = [eq(leadsTable.businessId, BUSINESS_ID)];
  if (query.data.status) filters.push(eq(leadsTable.status, query.data.status));
  if (query.data.score) filters.push(eq(leadsTable.score, query.data.score));
  if (query.data.search) {
    filters.push(or(ilike(contactsTable.name, `%${query.data.search}%`), ilike(contactsTable.phone, `%${query.data.search}%`), ilike(leadsTable.location, `%${query.data.search}%`))!);
  }
  const rows = await db.select({ id: leadsTable.id }).from(leadsTable).innerJoin(contactsTable, eq(leadsTable.contactId, contactsTable.id)).where(and(...filters)).orderBy(desc(leadsTable.createdAt));
  const result = await Promise.all(rows.map((row) => getLeadDto(row.id, BUSINESS_ID)));
  res.json(GetLeadsResponse.parse(result.filter(Boolean)));
});

router.get("/leads/:id", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const params = GetLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const lead = await getLeadDto(params.data.id, BUSINESS_ID);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json(GetLeadResponse.parse(lead));
});

router.patch("/leads/:id", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const params = UpdateLeadParams.safeParse(req.params);
  const body = UpdateLeadBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [updated] = await db.update(leadsTable).set({
    status: body.data.status, nextAction: body.data.next_action, qualificationStatus: body.data.qualification_status,
    updatedAt: new Date(),
  }).where(and(eq(leadsTable.id, params.data.id), eq(leadsTable.businessId, BUSINESS_ID))).returning({ id: leadsTable.id });
  if (!updated) { res.status(404).json({ error: "Lead not found" }); return; }
  const lead = await getLeadDto(updated.id, BUSINESS_ID);
  res.json(UpdateLeadResponse.parse(lead));
});

router.post("/leads/:id/suppress", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const params = SuppressLeadParams.safeParse(req.params);
  const body = SuppressLeadBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid suppression request" }); return; }
  const [row] = await db.select({ contact: contactsTable }).from(leadsTable).innerJoin(contactsTable, eq(leadsTable.contactId, contactsTable.id)).where(and(eq(leadsTable.id, params.data.id), eq(leadsTable.businessId, BUSINESS_ID)));
  if (!row) { res.status(404).json({ error: "Lead not found" }); return; }
  await db.update(contactsTable).set({ suppressedAt: new Date(), consentStatus: "suppressed" }).where(eq(contactsTable.id, row.contact.id));
  await db.update(leadsTable).set({ status: "suppressed", nextAction: "No further calls", updatedAt: new Date() }).where(eq(leadsTable.id, params.data.id));
  await db.insert(suppressionsTable).values({ id: id("suppression"), businessId: BUSINESS_ID, phone: row.contact.phone, reason: body.data.reason ?? "Suppressed by operator" });
  const lead = await getLeadDto(params.data.id, BUSINESS_ID);
  res.json(SuppressLeadResponse.parse(lead));
});

router.post("/leads/import", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const body = ImportLeadsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  // Launch gate: an import must say where consent for this batch came
  // from. Without it every imported contact lands as "unknown" and is
  // never callable — which is safe, but silently useless. Make the
  // operator state it up front instead.
  let batchConsent;
  try {
    batchConsent = normalizeConsentEvidence({
      status: body.data.consent_status ?? "unknown",
      source: body.data.consent_source,
      at: body.data.consent_at,
    });
  } catch (error) {
    if (error instanceof ConsentEvidenceError) { res.status(error.statusCode).json({ error: error.message }); return; }
    throw error;
  }

  let imported = 0;
  let skipped = 0;
  for (const row of body.data.rows) {
    const existing = await db.select({ id: contactsTable.id }).from(contactsTable).where(and(eq(contactsTable.businessId, BUSINESS_ID), eq(contactsTable.phone, row.phone))).limit(1);
    if (existing[0]) { skipped += 1; continue; }
    const contactId = id("contact");
    const leadId = id("lead");
    await db.insert(contactsTable).values({ id: contactId, businessId: BUSINESS_ID, name: row.name, phone: row.phone, email: row.email ?? null, timezone: timezoneForUSPhoneNumber(row.phone), consentStatus: batchConsent.consentStatus, consentSource: batchConsent.consentSource, consentAt: batchConsent.consentAt });
    await db.insert(leadsTable).values({ id: leadId, businessId: BUSINESS_ID, contactId, source: row.source ?? "CSV import", campaign: row.campaign ?? "Pilot campaign", project: row.project ?? (await getBusiness(BUSINESS_ID))?.projectName ?? "Configured project", propertyType: row.property_type ?? "Not specified", budgetLabel: row.budget_label ?? "Not specified", location: row.location ?? "Not specified", timeline: row.timeline ?? "Not specified", intentScore: 50, score: "warm", status: "new", nextAction: "Call lead" });
    imported += 1;
  }
  await db.insert(activitiesTable).values({ id: id("activity"), businessId: BUSINESS_ID, type: "import", title: `${imported} leads imported`, detail: `CSV import completed with duplicate checks · consent: ${describeConsent(batchConsent)}` });
  const leads = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.businessId, BUSINESS_ID)).orderBy(desc(leadsTable.createdAt));
  const result = await Promise.all(leads.slice(0, imported).map((lead) => getLeadDto(lead.id, BUSINESS_ID)));
  res.json(ImportLeadsResponse.parse({ imported, skipped, leads: result.filter(Boolean) }));
});

router.get("/calls", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const query = GetCallsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const rows = await db.select().from(callsTable).where(and(eq(callsTable.businessId, BUSINESS_ID), query.data.status ? eq(callsTable.status, query.data.status) : undefined)).orderBy(desc(callsTable.createdAt));
  res.json(GetCallsResponse.parse(await Promise.all(rows.map(getCallDto))));
});

router.get("/calls/:id", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const params = GetCallParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(callsTable).where(and(eq(callsTable.id, params.data.id), eq(callsTable.businessId, BUSINESS_ID)));
  if (!row) { res.status(404).json({ error: "Call not found" }); return; }
  res.json(GetCallResponse.parse(await getCallDto(row)));
});

router.post("/calls/start", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const body = StartCallBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const lead = await getLeadDto(body.data.lead_id, BUSINESS_ID);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  // Already talking to this person — don't start a second call.
  const [existing] = await db.select().from(callsTable).where(and(eq(callsTable.leadId, body.data.lead_id), eq(callsTable.businessId, BUSINESS_ID), eq(callsTable.status, "in_progress"))).limit(1);
  if (existing) { res.json(StartCallResponse.parse(await getCallDto(existing))); return; }

  const business = await getBusiness(BUSINESS_ID);

  // Setup gate: refuse to place live calls from a half-configured
  // workspace, before any row is written, so an unfinished onboarding is
  // an obvious error in the console rather than a mystery failure on a
  // real prospect's phone.
  const setupBlocked = liveCallingBlockedReason(business);
  if (setupBlocked) {
    res.status(409).json({ error: setupBlocked, code: "SETUP_INCOMPLETE" });
    return;
  }

  // One shared implementation with the intake path and the cron worker
  // (lib/callQueue.ts): enqueue idempotently, then dispatch — with the
  // safety policy gate re-evaluated immediately before the provider
  // request.
  const queued = await enqueueCallForLead({
    businessId: BUSINESS_ID,
    leadId: body.data.lead_id,
    idempotencyKey: `console_${body.data.lead_id}`,
    source: "console",
  });
  if (!queued) { res.status(404).json({ error: "Lead not found" }); return; }

  const dispatch = await dispatchQueuedCall({ businessId: BUSINESS_ID, callId: queued.call.id });
  const current = dispatch.call ?? queued.call;

  if (dispatch.outcome === "policy_blocked") {
    res.status(409).json(StartCallResponse.parse(await getCallDto(current)));
    return;
  }
  if (dispatch.outcome === "setup_incomplete") {
    res.status(409).json({ error: dispatch.message, code: "SETUP_INCOMPLETE" });
    return;
  }
  res.status(201).json(StartCallResponse.parse(await getCallDto(current)));
});

/**
 * POST /calls/:id/retry — operator recovery for a call whose provider
 * state is uncertain or which failed. Re-queues the SAME call row under a
 * fresh attempt rather than leaving the operator with a dead end. The
 * policy gate runs again on dispatch, so a retry can still be blocked.
 */
router.post("/calls/:id/retry", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const callId = typeof req.params.id === "string" ? req.params.id : "";
  const [row] = await db.select().from(callsTable).where(and(eq(callsTable.id, callId), eq(callsTable.businessId, BUSINESS_ID)));
  if (!row) { res.status(404).json({ error: "Call not found" }); return; }
  if (!["uncertain", "failed", "policy_blocked"].includes(row.status)) {
    res.status(409).json({ error: `Only uncertain, failed or policy-blocked calls can be retried; this one is ${row.status}.` });
    return;
  }

  const queued = await enqueueCallForLead({
    businessId: BUSINESS_ID,
    leadId: row.leadId,
    idempotencyKey: `retry_${row.id}`,
    source: "console",
  });
  if (!queued) { res.status(404).json({ error: "Lead not found" }); return; }
  const dispatch = await dispatchQueuedCall({ businessId: BUSINESS_ID, callId: queued.call.id });
  const current = dispatch.call ?? queued.call;
  res.status(dispatch.outcome === "started" ? 201 : 409).json(StartCallResponse.parse(await getCallDto(current)));
});

router.get("/appointments", async (_req, res): Promise<void> => {
  const req = _req;
  const BUSINESS_ID = scopedBusinessId(req);
  const rows = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.businessId, BUSINESS_ID), eq(appointmentsTable.status, "confirmed"))).orderBy(appointmentsTable.startTime);
  res.json(GetAppointmentsResponse.parse(await Promise.all(rows.map((row) => getAppointmentDto(row, BUSINESS_ID)))));
});

router.post("/appointments/availability", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const body = GetAvailabilityBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const slots = await getAvailabilityForBusiness(BUSINESS_ID, body.data.date.toISOString().slice(0, 10));
    res.json(GetAvailabilityResponse.parse(slots));
  } catch (error) {
    if (error instanceof AvailabilityError) {
      req.log.error({ err: error.message }, "Cal.com availability failed");
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/appointments/book", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const body = BookAppointmentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  try {
    const created = await bookAppointmentForLead({
      businessId: BUSINESS_ID,
      leadId: body.data.lead_id,
      slotStart: new Date(body.data.slot_start),
      slotEnd: new Date(body.data.slot_end),
      source: "console",
    });
    res.status(201).json(BookAppointmentResponse.parse(await getAppointmentDto(created, BUSINESS_ID)));
  } catch (error) {
    if (error instanceof BookingError) {
      req.log.error({ err: error.message, leadId: body.data.lead_id }, "Cal.com booking failed");
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }
});

/**
 * Pilot setup checklist. The console shows this on the Today screen and a
 * dedicated setup panel; `ready_for_live_calls: false` means POST
 * /calls/start and the automatic intake path both refuse to dial.
 */
router.get("/onboarding/checklist", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const business = await getBusiness(BUSINESS_ID);
  res.json(buildOnboardingChecklist(business));
});

router.get("/business-settings", async (_req, res): Promise<void> => {
  const req = _req;
  const BUSINESS_ID = scopedBusinessId(req);
  const business = await getBusiness(BUSINESS_ID);
  if (!business) { res.status(503).json({ error: "Business setup is not ready" }); return; }
  res.json(GetBusinessSettingsResponse.parse({
    id: business.id, name: business.name, market: business.market, timezone: business.timezone, phone_number: business.phoneNumber, transfer_number: business.transferNumber,
    recording_disclosure: business.recordingDisclosure, ai_disclosure: business.aiDisclosure, quiet_hours: business.quietHours, max_call_attempts: business.maxCallAttempts, suppression_enabled: business.suppressionEnabled,
    project_name: business.projectName, services_or_property_types: business.servicesOrPropertyTypes, approved_faq: business.approvedFaq, qualification_questions: business.qualificationQuestions, escalation_rules: business.escalationRules, cal_event_type_id: business.calEventTypeId, retell_agent_id: business.retellAgentId,
  }));
});

router.patch("/business-settings", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const body = UpdateBusinessSettingsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [updated] = await db.update(businessesTable).set({
    market: body.data.market, timezone: body.data.timezone, transferNumber: body.data.transfer_number, projectName: body.data.project_name,
    approvedFaq: body.data.approved_faq, qualificationQuestions: body.data.qualification_questions, recordingDisclosure: body.data.recording_disclosure,
    aiDisclosure: body.data.ai_disclosure, quietHours: body.data.quiet_hours, maxCallAttempts: body.data.max_call_attempts, updatedAt: new Date(),
  }).where(eq(businessesTable.id, BUSINESS_ID)).returning();
  if (!updated) { res.status(404).json({ error: "Business not found" }); return; }
  res.json(UpdateBusinessSettingsResponse.parse({
    id: updated.id, name: updated.name, market: updated.market, timezone: updated.timezone, phone_number: updated.phoneNumber, transfer_number: updated.transferNumber,
    recording_disclosure: updated.recordingDisclosure, ai_disclosure: updated.aiDisclosure, quiet_hours: updated.quietHours, max_call_attempts: updated.maxCallAttempts, suppression_enabled: updated.suppressionEnabled,
    project_name: updated.projectName, services_or_property_types: updated.servicesOrPropertyTypes, approved_faq: updated.approvedFaq, qualification_questions: updated.qualificationQuestions, escalation_rules: updated.escalationRules, cal_event_type_id: updated.calEventTypeId, retell_agent_id: updated.retellAgentId,
  }));
});

router.get("/activity", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const query = GetActivityQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const rows = await db.select().from(activitiesTable).where(eq(activitiesTable.businessId, BUSINESS_ID)).orderBy(desc(activitiesTable.createdAt)).limit(query.data.limit ?? 8);
  res.json(GetActivityResponse.parse(rows.map((row) => ({ id: row.id, type: row.type, title: row.title, detail: row.detail, created_at: row.createdAt.toISOString() }))));
});

router.get("/today", async (_req, res): Promise<void> => {
  const req = _req;
  const BUSINESS_ID = scopedBusinessId(req);
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, BUSINESS_ID));

  const [leadMetrics] = await db
    .select({
      newLeads: sql<number>`count(*) filter (where ${leadsTable.status} = 'new')::int`,
      hotLeads: sql<number>`count(*) filter (where ${leadsTable.score} = 'hot')::int`,
    })
    .from(leadsTable)
    .where(eq(leadsTable.businessId, BUSINESS_ID));

  const [callMetrics] = await db
    .select({
      callsInProgress: sql<number>`count(*) filter (where ${callsTable.status} = 'in_progress')::int`,
      failedCalls: sql<number>`count(*) filter (where ${callsTable.status} in ('failed', 'uncertain'))::int`,
    })
    .from(callsTable)
    .where(eq(callsTable.businessId, BUSINESS_ID));

  const appointments = await db
    .select()
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.businessId, BUSINESS_ID), eq(appointmentsTable.status, "confirmed")))
    .orderBy(appointmentsTable.startTime);

  const activities = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.businessId, BUSINESS_ID))
    .orderBy(desc(activitiesTable.createdAt))
    .limit(8);

  const upcoming = await Promise.all(appointments.map((row) => getAppointmentDto(row, BUSINESS_ID)));

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [recentMessages] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.businessId, BUSINESS_ID),
        eq(activitiesTable.type, "message"),
        gte(activitiesTable.createdAt, weekAgo),
      ),
    );

  const warnings = [
    ...(hasRetellConfigForMarket() ? [] : ["Retell live calling is not configured; calls stay in safe demo mode"]),
    ...(hasCalConfig() ? [] : ["Cal.com live booking is not configured; availability stays simulated"]),
    ...(business?.market === "IN" && !hasTwilioRoute("IN") ? ["India telephony route is not configured"] : []),
    ...(business?.market !== "IN" && !hasTwilioRoute("US") ? ["US telephony route is not configured"] : []),
  ];

  res.json(GetTodayResponse.parse({
    date_label: new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: business?.timezone ?? "UTC" }).format(new Date()),
    metrics: {
      new_leads: leadMetrics?.newLeads ?? 0,
      calls_in_progress: callMetrics?.callsInProgress ?? 0,
      hot_leads: leadMetrics?.hotLeads ?? 0,
      appointments_today: appointments.length,
      failed_calls: callMetrics?.failedCalls ?? 0,
      unresolved_messages: recentMessages?.count ?? 0,
    },
    setup_warnings: warnings,
    upcoming,
    recent_activity: activities.map((row) => ({ id: row.id, type: row.type, title: row.title, detail: row.detail, created_at: row.createdAt.toISOString() })),
  }));
});

router.get("/reports/weekly", async (_req, res): Promise<void> => {
  const req = _req;
  const BUSINESS_ID = scopedBusinessId(req);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, BUSINESS_ID));

  const [callStats] = await db
    .select({
      callsAttempted: sql<number>`count(*)::int`,
      callsConnected: sql<number>`count(*) filter (where ${callsTable.status} in ('completed', 'in_progress'))::int`,
      transferredCount: sql<number>`count(*) filter (where ${callsTable.transferred} = true)::int`,
      failedActions: sql<number>`count(*) filter (where ${callsTable.status} in ('failed', 'uncertain'))::int`,
      totalDurationSeconds: sql<number>`coalesce(sum(${callsTable.durationSeconds}), 0)::int`,
    })
    .from(callsTable)
    .where(and(eq(callsTable.businessId, BUSINESS_ID), gte(callsTable.createdAt, weekAgo)));

  const [leadStats] = await db
    .select({
      leadsReceived: sql<number>`count(*)::int`,
      qualifiedLeads: sql<number>`count(*) filter (where ${leadsTable.status} in ('qualified', 'booked'))::int`,
    })
    .from(leadsTable)
    .where(and(eq(leadsTable.businessId, BUSINESS_ID), gte(leadsTable.createdAt, weekAgo)));

  const [apptStats] = await db
    .select({
      appointmentsBooked: sql<number>`count(*)::int`,
    })
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.businessId, BUSINESS_ID), gte(appointmentsTable.startTime, weekAgo)));

  const callsAttempted = callStats?.callsAttempted ?? 0;
  const transferredCount = callStats?.transferredCount ?? 0;
  const durationSeconds = callStats?.totalDurationSeconds ?? 0;
  const voiceMinutes = Number((durationSeconds / 60).toFixed(2));
  const transferRate = callsAttempted > 0 ? transferredCount / callsAttempted : 0;

  const windowFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: business?.timezone ?? "UTC" });

  res.json(GetWeeklyReportResponse.parse({
    period_label: `${windowFmt.format(weekAgo)} – ${windowFmt.format(new Date())} · pilot report`,
    leads_received: leadStats?.leadsReceived ?? 0,
    calls_attempted: callsAttempted,
    calls_connected: callStats?.callsConnected ?? 0,
    qualified_leads: leadStats?.qualifiedLeads ?? 0,
    appointments_booked: apptStats?.appointmentsBooked ?? 0,
    transfer_rate: transferRate,
    failed_actions: callStats?.failedActions ?? 0,
    voice_minutes: voiceMinutes,
    estimated_provider_cost: Number((voiceMinutes * VOICE_COST_PER_MINUTE).toFixed(2)),
  }));
});

router.get("/usage", async (_req, res): Promise<void> => {
  const req = _req;
  const BUSINESS_ID = scopedBusinessId(req);
  // Monthly period row, created at zero on first use — the label comes
  // from the row's own periodStart, so it can never drift from the
  // numbers the way the old hard-coded "September 2026" did.
  const usage = await getCurrentUsageRow(db, BUSINESS_ID);
  res.json(GetUsageResponse.parse({ period_label: periodLabel(usage.periodStart), voice_minutes: Number(usage?.voiceMinutes ?? 0), included_minutes: 300, sms_count: usage?.smsCount ?? 0, booking_count: usage?.bookingCount ?? 0, estimated_cost: Number(usage?.estimatedCost ?? 0) }));
});

export default router;