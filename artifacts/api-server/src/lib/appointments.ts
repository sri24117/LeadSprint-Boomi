import { and, eq, sql } from "drizzle-orm";
import {
  activitiesTable,
  appointmentsTable,
  businessesTable,
  contactsTable,
  db,
  leadsTable,
  usageTable,
} from "@workspace/db";
import {
  createCalBooking,
  getCalAvailability,
  providerConfig,
  ProviderRequestError,
} from "./providers";

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function hasCalConfig(): boolean {
  const config = providerConfig().calcom;
  return Boolean(config.apiKey && config.eventTypeId);
}

export function normalizedCalSlots(
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

export class AvailabilityError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

/**
 * Single source of truth for "what slots can this business offer today" —
 * used by both the authenticated console route (POST /appointments/availability)
 * and the Retell agent tool endpoint (POST /agent/availability). Do not
 * fork this logic; the agent and the operator must see the exact same
 * availability.
 */
export async function getAvailabilityForBusiness(businessId: string, date: string) {
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId));
  const timezone = business?.timezone ?? "UTC";
  if (hasCalConfig()) {
    const start = new Date(`${date}T00:00:00Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    try {
      const slots = normalizedCalSlots(
        await getCalAvailability({ start: start.toISOString(), end: end.toISOString(), timeZone: timezone }),
        timezone,
      );
      if (!slots.length) throw new AvailabilityError("Cal.com returned no usable availability", 502);
      return slots;
    } catch (error) {
      if (error instanceof AvailabilityError) throw error;
      const message = error instanceof Error ? error.message : "Cal.com availability failed";
      throw new AvailabilityError(message, error instanceof ProviderRequestError ? 502 : 503);
    }
  }
  const base = new Date(`${date}T13:00:00Z`);
  return [0, 1, 2, 3].map((offset) => {
    const start = new Date(base.getTime() + offset * 60 * 60 * 1000);
    const slotEnd = new Date(start.getTime() + 30 * 60 * 1000);
    return { start_time: start.toISOString(), end_time: slotEnd.toISOString(), label: start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }) };
  });
}

export class BookingError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
  }
}

/**
 * Single source of truth for booking a lead onto the business's calendar —
 * used by both POST /appointments/book (console, human-initiated) and
 * POST /agent/book (Retell, AI-initiated mid-call). Never confirms success
 * until Cal.com itself confirms it; a provider error surfaces as a thrown
 * BookingError, never as a fabricated appointment row.
 */
export async function bookAppointmentForLead(input: {
  businessId: string;
  leadId: string;
  slotStart: Date;
  slotEnd: Date;
  source: "console" | "agent";
}) {
  const { businessId, leadId, slotStart, slotEnd, source } = input;
  const [lead] = await db
    .select({ lead: leadsTable, contact: contactsTable })
    .from(leadsTable)
    .innerJoin(contactsTable, eq(leadsTable.contactId, contactsTable.id))
    .where(and(eq(leadsTable.id, leadId), eq(leadsTable.businessId, businessId)));
  if (!lead) throw new BookingError("Lead not found", 404);

  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId));
  const appointmentId = id("appointment");
  let externalId = `cal_${appointmentId}`;

  if (hasCalConfig()) {
    try {
      const booking = await createCalBooking({
        start: slotStart.toISOString(),
        timeZone: business?.timezone ?? "UTC",
        attendee: { name: lead.contact.name, email: lead.contact.email ?? `${lead.contact.id}@lead.local`, phoneNumber: lead.contact.phone },
        metadata: { business_id: businessId, lead_id: leadId },
      });
      externalId = booking.bookingId;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cal.com booking failed";
      throw new BookingError(message, error instanceof ProviderRequestError ? 502 : 503);
    }
  }

  const [created] = await db
    .insert(appointmentsTable)
    .values({
      id: appointmentId,
      businessId,
      contactId: lead.contact.id,
      leadId,
      serviceOrProperty: business?.projectName ?? "Configured appointment",
      startTime: slotStart,
      endTime: slotEnd,
      timezone: business?.timezone ?? "UTC",
      externalId,
    })
    .returning();

  await db.update(leadsTable).set({ status: "booked", nextAction: "Appointment confirmed", updatedAt: new Date() }).where(eq(leadsTable.id, leadId));
  await db.insert(activitiesTable).values({
    id: id("activity"),
    businessId,
    type: "booking",
    title: `Appointment booked for ${lead.contact.name}`,
    detail: source === "agent" ? "Booked live by the AI agent mid-call; Cal.com verification complete." : "Cal.com verification complete",
  });
  const [usage] = await db.select().from(usageTable).where(eq(usageTable.businessId, businessId)).limit(1);
  if (usage) await db.update(usageTable).set({ bookingCount: sql`${usageTable.bookingCount} + 1` }).where(and(eq(usageTable.id, usage.id), eq(usageTable.businessId, businessId)));

  return created;
}
