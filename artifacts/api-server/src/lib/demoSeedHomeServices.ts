import { eq } from "drizzle-orm";
import {
  activitiesTable,
  appointmentsTable,
  businessesTable,
  callsTable,
  contactsTable,
  type db as defaultDb,
  leadsTable,
  usageTable,
  usersTable,
} from "@workspace/db";
import { timezoneForUSPhoneNumber } from "./areaCodeTimezones";
import { getProfile } from "./verticals";

type Database = typeof defaultDb;

/** True only for the exact value; anything else leaves the real-estate demo. */
export function demoVerticalIsHomeServices(): boolean {
  return process.env["LEADSPRINT_DEMO_VERTICAL"]?.trim() === "home_services";
}

const CONSENT_WORDING =
  "I agree to be contacted by an automated assistant by phone about my request.";

/**
 * Seeds the fictional "Frostline HVAC & Plumbing" workspace: five leads that
 * show the home-services flow (a same-day AC job that gets booked, a live
 * emergency, a quote request, an out-of-area lead, and a lead that still needs
 * consent), one booked service visit, and a live call. Idempotent. Demo only:
 * the caller is gated by the same non-production check as the real-estate seed.
 */
export async function seedHomeServicesDemo(db: Database, ids: { businessId: string; userId: string }): Promise<void> {
  const { businessId, userId } = ids;
  const profile = getProfile("home_services");

  await db
    .insert(businessesTable)
    .values({
      id: businessId,
      name: "Frostline HVAC & Plumbing",
      market: "US",
      timezone: "America/Chicago",
      phoneNumber: "+1 (512) 555-0148",
      transferNumber: "+1 (512) 555-0199",
      projectName: "Frostline — spring tune-ups & repairs",
      servicesOrPropertyTypes: ["AC repair", "AC installation", "Plumbing repair", "Water heaters", "Drains"],
      approvedFaq:
        "Frostline repairs and installs air conditioning and plumbing in the Austin area, with same-day visits when possible. A technician confirms any cost on site. Share only this information, then offer a human handoff.",
      qualificationQuestions: profile.defaultQualificationQuestions,
      escalationRules:
        "Never give repair, safety or pricing advice beyond approved information. For gas, flooding, sparks or carbon monoxide, stop and transfer, or take an urgent message.",
      calEventTypeId: "cal_demo_service_visit",
      retellAgentId: "retell_demo_agent",
      vertical: "home_services",
      notifyEmail: "dispatch@frostline.example",
      serviceAreaZips: ["787", "78660", "78664"],
      pricingPolicy: "Our diagnostic visit is $89, applied to the repair if you go ahead.",
    })
    .onConflictDoNothing();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    await db
      .insert(usersTable)
      .values({ id: userId, businessId, name: "Dana Ortiz", email: "dana@frostline.example", role: "owner" })
      .onConflictDoNothing();
  }

  const existing = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.businessId, businessId)).limit(1);
  if (existing.length > 0) return;

  type Seed = {
    contactId: string;
    leadId: string;
    name: string;
    phone: string;
    email: string;
    source: string;
    campaign: string;
    urgency: "emergency" | "same_day" | "this_week" | "quote";
    details: Record<string, string>;
    status: "new" | "contacted" | "qualified" | "booked";
    score: "hot" | "warm" | "cold";
    intentScore: number;
    nextAction: string;
    consent: "valid" | "unknown";
    qualification: string;
  };

  const seeds: Seed[] = [
    {
      contactId: "contact_marisol", leadId: "lead_marisol", name: "Marisol Vega", phone: "+1 512 555 0141", email: "marisol.vega@example.com",
      source: "Facebook lead ad", campaign: "AC tune-up spring", urgency: "same_day",
      details: { service_type: "ac_repair", problem: "AC not cooling since this morning", zip: "78704", address: "412 Barton Springs Rd", property_type: "home", preferred_time: "tomorrow morning" },
      status: "booked", score: "hot", intentScore: 91, nextAction: "Service visit booked", consent: "valid", qualification: "Qualified",
    },
    {
      contactId: "contact_jordan", leadId: "lead_jordan", name: "Jordan Blake", phone: "+1 737 555 0172", email: "jordan.blake@example.com",
      source: "Facebook lead ad", campaign: "Emergency plumbing", urgency: "emergency",
      details: { service_type: "plumbing_repair", problem: "Burst pipe in the kitchen, water on the floor", zip: "78745", address: "88 Oak Hollow Dr", property_type: "home", preferred_time: "as soon as possible" },
      status: "contacted", score: "hot", intentScore: 95, nextAction: "Emergency call in progress", consent: "valid", qualification: "Contacted",
    },
    {
      contactId: "contact_chen", leadId: "lead_chen", name: "Chen Wei", phone: "+1 512 555 0119", email: "chen.wei@example.com",
      source: "Website form", campaign: "Water heater quotes", urgency: "quote",
      details: { service_type: "water_heater", problem: "Wants a quote to replace a 12-year-old water heater", zip: "78660", property_type: "home", preferred_time: "next week" },
      status: "new", score: "cold", intentScore: 42, nextAction: "Call lead", consent: "valid", qualification: "New enquiry",
    },
    {
      contactId: "contact_tom", leadId: "lead_tom", name: "Tom Becker", phone: "+1 212 555 0155", email: "tom.becker@example.com",
      source: "Facebook lead ad", campaign: "AC tune-up spring", urgency: "this_week",
      details: { service_type: "ac_install", problem: "Looking to install a new AC unit", zip: "10001", property_type: "apartment" },
      status: "new", score: "warm", intentScore: 30, nextAction: "Out of service area — review", consent: "valid", qualification: "New enquiry",
    },
    {
      contactId: "contact_lena", leadId: "lead_lena", name: "Lena Ortiz", phone: "+1 214 555 0183", email: "lena.ortiz@example.com",
      source: "Facebook lead ad", campaign: "AC tune-up spring", urgency: "same_day",
      details: { service_type: "ac_repair", problem: "Unit is blowing warm air", zip: "78701", property_type: "home" },
      status: "new", score: "warm", intentScore: 55, nextAction: "Needs consent — contact manually", consent: "unknown", qualification: "New enquiry",
    },
  ];

  const now = new Date();
  for (const item of seeds) {
    const metaConsent = item.source === "Facebook lead ad";
    await db
      .insert(contactsTable)
      .values({
        id: item.contactId,
        businessId,
        name: item.name,
        phone: item.phone,
        email: item.email,
        timezone: timezoneForUSPhoneNumber(item.phone),
        consentStatus: item.consent,
        consentSource: item.consent === "valid" ? (metaConsent ? "meta_lead_form:form_demo_1" : "demo_seed:website enquiry form") : "meta_lead_form:form_demo_2",
        consentAt: item.consent === "valid" ? now : null,
        consentEvidence: item.consent === "valid" && metaConsent ? CONSENT_WORDING : null,
      })
      .onConflictDoNothing();
    await db
      .insert(leadsTable)
      .values({
        id: item.leadId,
        businessId,
        contactId: item.contactId,
        source: item.source,
        campaign: item.campaign,
        project: "Frostline HVAC & Plumbing",
        propertyType: "Not specified",
        budgetLabel: "Not specified",
        location: "Not specified",
        timeline: "Not specified",
        qualificationStatus: item.qualification,
        intentScore: item.intentScore,
        score: item.score,
        status: item.status,
        nextAction: item.nextAction,
        details: item.details,
        urgency: item.urgency,
      })
      .onConflictDoNothing();
  }

  await db
    .insert(callsTable)
    .values([
      {
        id: "call_marisol_latest",
        businessId,
        contactId: "contact_marisol",
        leadId: "lead_marisol",
        provider: "Retell",
        idempotencyKey: "seed_call_marisol",
        status: "completed",
        startedAt: new Date(now.getTime() - 40 * 60 * 1000),
        endedAt: new Date(now.getTime() - 36 * 60 * 1000),
        durationSeconds: 233,
        summary: "AC stopped cooling this morning. Confirmed ZIP 78704 is in the service area. Service visit booked for tomorrow morning.",
        outcome: "Qualified — service visit booked",
        transferred: false,
        booked: true,
      },
      {
        id: "call_jordan_active",
        businessId,
        contactId: "contact_jordan",
        leadId: "lead_jordan",
        provider: "Retell",
        idempotencyKey: "seed_call_jordan",
        status: "in_progress",
        startedAt: new Date(now.getTime() - 90 * 1000),
        summary: "Emergency lead: burst pipe. Assistant is offering an immediate transfer to the on-call technician.",
        outcome: "In progress",
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(appointmentsTable)
    .values({
      id: "appointment_marisol",
      businessId,
      contactId: "contact_marisol",
      leadId: "lead_marisol",
      serviceOrProperty: "Service visit — AC repair",
      startTime: new Date(now.getTime() + 20 * 60 * 60 * 1000),
      endTime: new Date(now.getTime() + 23 * 60 * 60 * 1000),
      timezone: "America/Chicago",
      externalId: "cal_booking_marisol",
    })
    .onConflictDoNothing();

  await db
    .insert(activitiesTable)
    .values([
      { id: "activity_import", businessId, type: "import", title: "5 leads received", detail: "Spring AC tune-up · Facebook lead ads + website", createdAt: new Date(now.getTime() - 60 * 60 * 1000) },
      { id: "activity_emergency", businessId, type: "alert", title: "Emergency lead: Jordan Blake", detail: "Burst pipe · owner emailed · assistant calling now", createdAt: new Date(now.getTime() - 2 * 60 * 1000) },
      { id: "activity_call", businessId, type: "call", title: "Marisol Vega qualified", detail: "AC not cooling · in service area · booked", createdAt: new Date(now.getTime() - 36 * 60 * 1000) },
      { id: "activity_booking", businessId, type: "booking", title: "Service visit booked", detail: "Tomorrow 9:00 AM–12:00 PM · Cal.com verified", createdAt: new Date(now.getTime() - 35 * 60 * 1000) },
      { id: "activity_area", businessId, type: "intake", title: "Tom Becker is outside the service area", detail: "ZIP 10001 is not in this business's service area, so no call was placed.", createdAt: new Date(now.getTime() - 50 * 60 * 1000) },
    ])
    .onConflictDoNothing();

  await db
    .insert(usageTable)
    .values({
      id: "usage_demo",
      businessId,
      periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
      periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
      voiceMinutes: "9.2",
      smsCount: 0,
      bookingCount: 1,
      estimatedCost: "1.10",
    })
    .onConflictDoNothing();
}
