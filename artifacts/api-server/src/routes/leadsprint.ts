import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
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
  createCalBooking,
  getCalAvailability,
  hasRetellConfigForMarket,
  hasTwilioRoute,
  providerConfig,
  ProviderRequestError,
  startRetellCall,
} from "../lib/providers";
import { evaluateCallPolicy } from "../lib/policy";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const BUSINESS_ID = "business_demo";
const USER_ID = "user_demo";

// Exported so the demo-auth shortcut in routes/index.ts scopes requests to
// exactly the same seeded workspace the console falls back to.
export const DEMO_BUSINESS_ID = BUSINESS_ID;
export const DEMO_USER_ID = USER_ID;

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function scopedBusinessId(req: { leadSprintBusinessId?: string }): string {
  return req.leadSprintBusinessId ?? BUSINESS_ID;
}

async function ensureSeedData(): Promise<void> {
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, BUSINESS_ID));
  if (business) return;

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
  });
  await db.insert(usersTable).values({ id: USER_ID, businessId: BUSINESS_ID, name: "Maya Patel", email: "maya@northstarrealty.example", role: "owner" });

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
    });
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
    });
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
    });
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
    });
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
    });
  }
  await db.insert(activitiesTable).values([
    { id: "activity_import", businessId: BUSINESS_ID, type: "import", title: "4 leads imported", detail: "Spring buyer campaign · Zillow + website", createdAt: new Date(now.getTime() - 45 * 60 * 1000) },
    { id: "activity_call", businessId: BUSINESS_ID, type: "call", title: "Ava Williams qualified", detail: "Showing interest captured by Retell", createdAt: new Date(now.getTime() - 32 * 60 * 1000) },
    { id: "activity_booking", businessId: BUSINESS_ID, type: "booking", title: "Buyer consultation booked", detail: "Today at 4:00 PM · Cal.com verified", createdAt: new Date(now.getTime() - 20 * 60 * 1000) },
  ]);
  await db.insert(usageTable).values({
    id: "usage_demo",
    businessId: BUSINESS_ID,
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
    voiceMinutes: "18.4",
    smsCount: 0,
    bookingCount: 1,
    estimatedCost: "4.76",
  });
}

// Fire-and-forget at boot so the demo workspace exists before the first
// request. A rejected promise here (database not reachable yet) must not
// become an unhandled rejection that takes the whole process down — the
// health endpoints and webhooks are supposed to stay up, and the seed is
// retried by the first /auth/me request anyway.
void ensureSeedData().catch((err) => {
  logger.error({ err }, "Demo seed data could not be created");
});

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

function hasCalConfig(): boolean {
  const config = providerConfig().calcom;
  return Boolean(config.apiKey && config.eventTypeId);
}

function normalizedCalSlots(
  value: unknown,
  timezone: string,
): Array<{ start_time: string; end_time: string; label: string }> {
  const source =
    value && typeof value === "object" && "data" in value
      ? (value as { data?: unknown }).data
      : value;
  const candidates = Array.isArray(source)
    ? source
    : source && typeof source === "object" && "slots" in source
      ? (source as { slots?: unknown }).slots
      : [];
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((slot) => {
    if (!slot || typeof slot !== "object") return [];
    const item = slot as Record<string, unknown>;
    const start = typeof item.start === "string" ? item.start : typeof item.start_time === "string" ? item.start_time : "";
    const end = typeof item.end === "string" ? item.end : typeof item.end_time === "string" ? item.end_time : "";
    if (!start || !end) return [];
    return [{ start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), label: new Date(start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }) }];
  });
}

router.get("/auth/me", async (_req, res): Promise<void> => {
  await ensureSeedData();
  const req = _req;
  const businessId = scopedBusinessId(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.leadSprintUserId ?? USER_ID));
  const business = await getBusiness(businessId);
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
  let imported = 0;
  let skipped = 0;
  for (const row of body.data.rows) {
    const existing = await db.select({ id: contactsTable.id }).from(contactsTable).where(and(eq(contactsTable.businessId, BUSINESS_ID), eq(contactsTable.phone, row.phone))).limit(1);
    if (existing[0]) { skipped += 1; continue; }
    const contactId = id("contact");
    const leadId = id("lead");
    await db.insert(contactsTable).values({ id: contactId, businessId: BUSINESS_ID, name: row.name, phone: row.phone, email: row.email ?? null });
    await db.insert(leadsTable).values({ id: leadId, businessId: BUSINESS_ID, contactId, source: row.source ?? "CSV import", campaign: row.campaign ?? "Pilot campaign", project: row.project ?? (await getBusiness(BUSINESS_ID))?.projectName ?? "Configured project", propertyType: row.property_type ?? "Not specified", budgetLabel: row.budget_label ?? "Not specified", location: row.location ?? "Not specified", timeline: row.timeline ?? "Not specified", intentScore: 50, score: "warm", status: "new", nextAction: "Call lead" });
    imported += 1;
  }
  await db.insert(activitiesTable).values({ id: id("activity"), businessId: BUSINESS_ID, type: "import", title: `${imported} leads imported`, detail: "CSV import completed with duplicate checks" });
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
  const [existing] = await db.select().from(callsTable).where(and(eq(callsTable.leadId, body.data.lead_id), eq(callsTable.businessId, BUSINESS_ID), eq(callsTable.status, "in_progress"))).limit(1);
  if (existing) { res.json(StartCallResponse.parse(await getCallDto(existing))); return; }

  const business = await getBusiness(BUSINESS_ID);
  const [leadRow] = await db.select({ contactId: leadsTable.contactId }).from(leadsTable).where(and(eq(leadsTable.id, body.data.lead_id), eq(leadsTable.businessId, BUSINESS_ID)));
  const contactId = leadRow?.contactId ?? "";
  const [contact] = contactId ? await db.select().from(contactsTable).where(eq(contactsTable.id, contactId)) : [];
  const priorAttempts = (await db.select({ id: callsTable.id }).from(callsTable).where(and(eq(callsTable.leadId, body.data.lead_id), eq(callsTable.businessId, BUSINESS_ID), sql`${callsTable.status} != 'policy_blocked'`))).length;

  const callId = id("call");

  // Non-negotiable safety gate: consent -> not suppressed -> quiet hours -> attempt limit -> kill switch.
  const decision = evaluateCallPolicy({
    business: { timezone: business?.timezone ?? "UTC", quietHours: business?.quietHours, maxCallAttempts: business?.maxCallAttempts ?? 2 },
    contact: { consentStatus: contact?.consentStatus ?? "valid", suppressedAt: contact?.suppressedAt ?? null },
    attemptsSoFar: priorAttempts,
  });

  if (!decision.allowed) {
    const [blocked] = await db.insert(callsTable).values({
      id: callId, businessId: BUSINESS_ID, contactId, leadId: body.data.lead_id, provider: "Retell",
      idempotencyKey: `manual_${callId}`, status: "policy_blocked",
      outcome: `Blocked — ${decision.reason}`, summary: decision.message ?? "Blocked by call policy.", errorState: decision.reason,
    }).returning();
    await db.insert(activitiesTable).values({ id: id("activity"), businessId: BUSINESS_ID, type: "policy", title: `Call blocked for ${lead.name}`, detail: decision.message ?? "Blocked by call policy." });
    res.status(409).json(StartCallResponse.parse(await getCallDto(blocked)));
    return;
  }

  const [created] = await db.insert(callsTable).values({ id: callId, businessId: BUSINESS_ID, contactId, leadId: body.data.lead_id, provider: "Retell", idempotencyKey: `manual_${callId}`, status: "queued", outcome: "Queued for provider", summary: "Call queued for the approved qualification script." }).returning();
  let current = created;
  const liveRetell = hasRetellConfigForMarket(business?.market === "IN" ? "IN" : "US");
  if (liveRetell) {
    try {
      const live = await startRetellCall({
        toNumber: lead.phone,
        market: business?.market === "IN" ? "IN" : "US",
        metadata: { business_id: BUSINESS_ID, lead_id: body.data.lead_id, call_id: callId },
      });
      [current] = await db.update(callsTable).set({ providerCallId: live.callId, status: "in_progress", startedAt: new Date(), outcome: "Live call started with Retell", summary: "Retell accepted the call and will report the final outcome by webhook." }).where(and(eq(callsTable.id, callId), eq(callsTable.businessId, BUSINESS_ID))).returning();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Retell request failed";
      [current] = await db.update(callsTable).set({ status: "uncertain", errorState: message, outcome: "Provider state uncertain", summary: "The call request could not be confirmed. Reconcile from the provider callback before retrying." }).where(and(eq(callsTable.id, callId), eq(callsTable.businessId, BUSINESS_ID))).returning();
      req.log.error({ callId, err: message }, "Retell call start failed");
    }
  } else {
    await db.insert(workflowJobsTable).values({ id: id("job"), businessId: BUSINESS_ID, type: "initiate_call", idempotencyKey: callId });
  }
  await db.insert(activitiesTable).values({ id: id("activity"), businessId: BUSINESS_ID, type: "call", title: `Call ${liveRetell ? "started" : "queued"} for ${lead.name}`, detail: liveRetell ? "Retell accepted the call · awaiting signed callback" : "Demo mode · Retell credentials are not configured", });
  res.status(201).json(StartCallResponse.parse(await getCallDto(current)));
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
  const business = await getBusiness(BUSINESS_ID);
  if (hasCalConfig()) {
    try {
      const start = new Date(`${body.data.date}T00:00:00Z`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const providerSlots = normalizedCalSlots(await getCalAvailability({ start: start.toISOString(), end: end.toISOString(), timeZone: business?.timezone ?? "UTC" }), business?.timezone ?? "UTC");
      if (!providerSlots.length) {
        res.status(502).json({ error: "Cal.com returned no usable availability" });
        return;
      }
      res.json(GetAvailabilityResponse.parse(providerSlots));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cal.com availability failed";
      req.log.error({ err: message }, "Cal.com availability failed");
      res.status(error instanceof ProviderRequestError ? 502 : 503).json({ error: message });
      return;
    }
  }
  const base = new Date(`${body.data.date}T13:00:00Z`);
  const slots = [0, 1, 2, 3].map((offset) => {
    const start = new Date(base.getTime() + offset * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return { start_time: start.toISOString(), end_time: end.toISOString(), label: start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: business?.timezone ?? "UTC" }) };
  });
  res.json(GetAvailabilityResponse.parse(slots));
});

router.post("/appointments/book", async (req, res): Promise<void> => {
  const BUSINESS_ID = scopedBusinessId(req);
  const body = BookAppointmentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [lead] = await db.select({ lead: leadsTable, contact: contactsTable }).from(leadsTable).innerJoin(contactsTable, eq(leadsTable.contactId, contactsTable.id)).where(and(eq(leadsTable.id, body.data.lead_id), eq(leadsTable.businessId, BUSINESS_ID)));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  const business = await getBusiness(BUSINESS_ID);
  const appointmentId = id("appointment");
  let externalId = `cal_${appointmentId}`;
  if (hasCalConfig()) {
    try {
      const booking = await createCalBooking({
        start: body.data.slot_start.toISOString(),
        end: body.data.slot_end.toISOString(),
        timeZone: business?.timezone ?? "UTC",
        attendee: { name: lead.contact.name, email: lead.contact.email ?? `${lead.contact.id}@lead.local`, phone: lead.contact.phone },
        metadata: { business_id: BUSINESS_ID, lead_id: body.data.lead_id },
      });
      externalId = booking.bookingId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cal.com booking failed";
      req.log.error({ err: message, leadId: body.data.lead_id }, "Cal.com booking failed");
      res.status(error instanceof ProviderRequestError ? 502 : 503).json({ error: message });
      return;
    }
  }
  const [created] = await db.insert(appointmentsTable).values({ id: appointmentId, businessId: BUSINESS_ID, contactId: lead.contact.id, leadId: body.data.lead_id, serviceOrProperty: business?.projectName ?? "Configured appointment", startTime: new Date(body.data.slot_start), endTime: new Date(body.data.slot_end), timezone: business?.timezone ?? "UTC", externalId }).returning();
  await db.update(leadsTable).set({ status: "booked", nextAction: "Appointment confirmed", updatedAt: new Date() }).where(eq(leadsTable.id, body.data.lead_id));
  await db.insert(activitiesTable).values({ id: id("activity"), businessId: BUSINESS_ID, type: "booking", title: `Appointment booked for ${lead.contact.name}`, detail: "Cal.com verification complete" });
  const usage = await db.select().from(usageTable).where(eq(usageTable.businessId, BUSINESS_ID)).limit(1);
  if (usage[0]) await db.update(usageTable).set({ bookingCount: sql`${usageTable.bookingCount} + 1` }).where(and(eq(usageTable.id, usage[0].id), eq(usageTable.businessId, BUSINESS_ID)));
  res.status(201).json(BookAppointmentResponse.parse(await getAppointmentDto(created, BUSINESS_ID)));
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
  const leads = await db.select().from(leadsTable).where(eq(leadsTable.businessId, BUSINESS_ID));
  const calls = await db.select().from(callsTable).where(eq(callsTable.businessId, BUSINESS_ID));
  const appointments = await db.select().from(appointmentsTable).where(and(eq(appointmentsTable.businessId, BUSINESS_ID), eq(appointmentsTable.status, "confirmed")));
  const activities = await db.select().from(activitiesTable).where(eq(activitiesTable.businessId, BUSINESS_ID)).orderBy(desc(activitiesTable.createdAt)).limit(8);
  const upcoming = await Promise.all(appointments.map((row) => getAppointmentDto(row, BUSINESS_ID)));
  const warnings = [
    ...(hasRetellConfigForMarket() ? [] : ["Retell live calling is not configured; calls stay in safe demo mode"]),
    ...(hasCalConfig() ? [] : ["Cal.com live booking is not configured; availability stays simulated"]),
    ...(business?.market === "IN" && !hasTwilioRoute("IN") ? ["India telephony route is not configured"] : []),
    ...(business?.market !== "IN" && !hasTwilioRoute("US") ? ["US telephony route is not configured"] : []),
  ];
  res.json(GetTodayResponse.parse({
    date_label: new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: business?.timezone ?? "UTC" }).format(new Date()),
    metrics: { new_leads: leads.filter((lead) => lead.status === "new").length, calls_in_progress: calls.filter((call) => call.status === "in_progress").length, hot_leads: leads.filter((lead) => lead.score === "hot").length, appointments_today: appointments.length, failed_calls: calls.filter((call) => call.status === "failed" || call.status === "uncertain").length, unresolved_messages: 1 },
    setup_warnings: warnings,
    upcoming,
    recent_activity: activities.map((row) => ({ id: row.id, type: row.type, title: row.title, detail: row.detail, created_at: row.createdAt.toISOString() })),
  }));
});

router.get("/reports/weekly", async (_req, res): Promise<void> => {
  const req = _req;
  const BUSINESS_ID = scopedBusinessId(req);
  const leads = await db.select().from(leadsTable).where(eq(leadsTable.businessId, BUSINESS_ID));
  const calls = await db.select().from(callsTable).where(eq(callsTable.businessId, BUSINESS_ID));
  const appointments = await db.select().from(appointmentsTable).where(eq(appointmentsTable.businessId, BUSINESS_ID));
  const usage = (await db.select().from(usageTable).where(eq(usageTable.businessId, BUSINESS_ID)))[0];
  res.json(GetWeeklyReportResponse.parse({ period_label: "This week · pilot report", leads_received: leads.length, calls_attempted: calls.length, calls_connected: calls.filter((call) => call.status === "completed" || call.status === "in_progress").length, qualified_leads: leads.filter((lead) => lead.status === "qualified" || lead.status === "booked").length, appointments_booked: appointments.length, transfer_rate: calls.length ? calls.filter((call) => call.transferred).length / calls.length : 0, failed_actions: calls.filter((call) => call.status === "failed" || call.status === "uncertain").length, voice_minutes: Number(usage?.voiceMinutes ?? 0), estimated_provider_cost: Number(usage?.estimatedCost ?? 0) }));
});

router.get("/usage", async (_req, res): Promise<void> => {
  const req = _req;
  const BUSINESS_ID = scopedBusinessId(req);
  const usage = (await db.select().from(usageTable).where(eq(usageTable.businessId, BUSINESS_ID)))[0];
  res.json(GetUsageResponse.parse({ period_label: "September 2026", voice_minutes: Number(usage?.voiceMinutes ?? 0), included_minutes: 300, sms_count: usage?.smsCount ?? 0, booking_count: usage?.bookingCount ?? 0, estimated_cost: Number(usage?.estimatedCost ?? 0) }));
});

export default router;