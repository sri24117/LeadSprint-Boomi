/**
 * Voice-workflow scenario tests — the system half of the agent test
 * matrix in docs/retell-agent.md.
 *
 * These prove the agent can never tell a caller something the system has
 * not verified: no invented slots, no fabricated bookings, no silent
 * transfer failures. Conversation quality itself is verified manually in
 * Retell's test console (scenarios 1–5); everything here is the part that
 * must hold regardless of what the model decides to say.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  appointmentsTable,
  businessesTable,
  contactsTable,
  leadsTable,
} from "@workspace/db/schema";
import { createTestDb, pilotBusiness, type TestDb } from "../test/testDb";
import {
  AvailabilityError,
  BookingError,
  __resetAppointmentsDb,
  __setAppointmentsDb,
  bookAppointmentForLead,
  getAvailabilityForBusiness,
  normalizedCalSlots,
} from "./appointments";
import * as providers from "./providers";

let db: TestDb;
const getCalAvailability = vi.spyOn(providers, "getCalAvailability");
const createCalBooking = vi.spyOn(providers, "createCalBooking");

const ENV = {
  CALCOM_API_KEY: "cal_key",
  CALCOM_EVENT_TYPE_ID: "12345",
};

const BUSINESS_ID = "business_pilot";
const LEAD_ID = "lead_pilot";

beforeEach(async () => {
  db = await createTestDb();
  __setAppointmentsDb(db as never);
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  delete process.env.LEADSPRINT_DEMO_SEED;
  getCalAvailability.mockReset();
  createCalBooking.mockReset();

  await db.insert(businessesTable).values(pilotBusiness() as never);
  await db.insert(contactsTable).values({
    id: "contact_pilot",
    businessId: BUSINESS_ID,
    name: "Ava Williams",
    phone: "+19175550184",
    email: "ava@example.com",
    consentStatus: "valid",
    consentSource: "web_form",
    consentAt: new Date(),
    timezone: "America/New_York",
  });
  await db.insert(leadsTable).values({
    id: LEAD_ID,
    businessId: BUSINESS_ID,
    contactId: "contact_pilot",
    project: "Spring buyer campaign",
    propertyType: "Condo",
    budgetLabel: "$850k – $1.1M",
    location: "Williamsburg",
    timeline: "0–3 months",
  });
});

afterEach(() => {
  __resetAppointmentsDb();
  for (const key of Object.keys(ENV)) delete process.env[key];
});

describe("scenario: offering times", () => {
  it("offers only the slots the calendar actually returned", async () => {
    getCalAvailability.mockResolvedValue({
      data: {
        slots: [
          { start: "2026-09-17T14:00:00Z", end: "2026-09-17T14:30:00Z" },
          { start: "2026-09-17T15:00:00Z", end: "2026-09-17T15:30:00Z" },
        ],
      },
    });

    const slots = await getAvailabilityForBusiness(BUSINESS_ID, "2026-09-17");
    expect(slots).toHaveLength(2);
    expect(slots[0]?.start_time).toBe("2026-09-17T14:00:00.000Z");
  });

  it("never invents a slot when the calendar has no availability", async () => {
    getCalAvailability.mockResolvedValue({ data: { slots: [] } });

    await expect(getAvailabilityForBusiness(BUSINESS_ID, "2026-09-17")).rejects.toBeInstanceOf(
      AvailabilityError,
    );
  });

  it("surfaces a calendar outage instead of falling back to made-up times", async () => {
    getCalAvailability.mockRejectedValue(new providers.ProviderRequestError("Cal.com returned 500", 500));

    await expect(getAvailabilityForBusiness(BUSINESS_ID, "2026-09-17")).rejects.toBeInstanceOf(
      AvailabilityError,
    );
  });

  it("refuses to simulate availability when no calendar is configured", async () => {
    delete process.env.CALCOM_API_KEY;

    await expect(getAvailabilityForBusiness(BUSINESS_ID, "2026-09-17")).rejects.toThrow(
      /not configured/i,
    );
  });

  it("ignores malformed slot entries rather than offering a broken time", () => {
    const slots = normalizedCalSlots(
      { data: { slots: [{ start: "2026-09-17T14:00:00Z" }, { start: "2026-09-17T15:00:00Z", end: "2026-09-17T15:30:00Z" }] } },
      "America/New_York",
    );
    expect(slots).toHaveLength(1);
  });
});

describe("scenario: booking", () => {
  const slotStart = new Date("2026-09-17T14:00:00Z");
  const slotEnd = new Date("2026-09-17T14:30:00Z");

  it("records the appointment only after the calendar confirms it", async () => {
    createCalBooking.mockResolvedValue({ bookingId: "cal_uid_123" });

    const created = await bookAppointmentForLead({
      businessId: BUSINESS_ID,
      leadId: LEAD_ID,
      slotStart,
      slotEnd,
      source: "agent",
    });

    expect(created.externalId).toBe("cal_uid_123");
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, LEAD_ID));
    expect(lead?.status).toBe("booked");
  });

  it("does not create an appointment when the calendar rejects the booking", async () => {
    createCalBooking.mockRejectedValue(new providers.ProviderRequestError("Cal.com returned 409", 409));

    await expect(
      bookAppointmentForLead({ businessId: BUSINESS_ID, leadId: LEAD_ID, slotStart, slotEnd, source: "agent" }),
    ).rejects.toBeInstanceOf(BookingError);

    expect(await db.select().from(appointmentsTable)).toHaveLength(0);
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, LEAD_ID));
    expect(lead?.status).not.toBe("booked");
  });

  it("refuses to book at all when no calendar is configured", async () => {
    delete process.env.CALCOM_API_KEY;

    await expect(
      bookAppointmentForLead({ businessId: BUSINESS_ID, leadId: LEAD_ID, slotStart, slotEnd, source: "agent" }),
    ).rejects.toBeInstanceOf(BookingError);
    expect(await db.select().from(appointmentsTable)).toHaveLength(0);
  });

  it("cannot book a lead belonging to another workspace", async () => {
    createCalBooking.mockResolvedValue({ bookingId: "cal_uid_123" });
    await db.insert(businessesTable).values(pilotBusiness({ id: "business_other" }) as never);

    await expect(
      bookAppointmentForLead({ businessId: "business_other", leadId: LEAD_ID, slotStart, slotEnd, source: "agent" }),
    ).rejects.toBeInstanceOf(BookingError);
    expect(createCalBooking).not.toHaveBeenCalled();
  });
});
