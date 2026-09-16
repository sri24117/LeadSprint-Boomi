import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, eq } from "drizzle-orm";
import {
  activitiesTable,
  businessesTable,
  callsTable,
  db,
  leadsTable,
} from "@workspace/db";
import { AgentAuthError, parseAgentToolRequest } from "../lib/agentAuth";
import {
  AvailabilityError,
  BookingError,
  bookAppointmentForLead,
  getAvailabilityForBusiness,
} from "../lib/appointments";

const router: IRouter = Router();

function rawBody(req: Request): Buffer {
  return (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 12)}`;
}

/**
 * Every route in this file is what turns LeadSprint from a demo into a
 * product: these are the ONLY endpoints Retell can call mid-conversation
 * to actually do something (check availability, book, request a
 * transfer, capture a message, or record qualification answers). Before
 * this file existed, everything past "the AI can talk" required a human
 * to act afterward in the console — Retell had no session and no way to
 * reach the authenticated /appointments/* routes.
 *
 * Auth model: NOT behind Clerk (Retell has no Clerk session). Instead,
 * every request must carry a valid X-Retell-Signature (same scheme as
 * the call webhooks — see lib/providers.ts). business_id/lead_id are
 * derived only from the signed call's own metadata, never from
 * LLM-supplied arguments — see lib/agentAuth.ts for why.
 */
router.use((req, res, next) => {
  try {
    (req as Request & { agentTool?: ReturnType<typeof parseAgentToolRequest> }).agentTool = parseAgentToolRequest(req, rawBody(req));
    next();
  } catch (error) {
    if (error instanceof AgentAuthError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});

function toolContext(req: Request) {
  return (req as Request & { agentTool: ReturnType<typeof parseAgentToolRequest> }).agentTool;
}

router.post("/agent/availability", async (req, res): Promise<void> => {
  const { businessId, args } = toolContext(req);
  const date = typeof args.date === "string" ? args.date : new Date().toISOString().slice(0, 10);
  try {
    const slots = await getAvailabilityForBusiness(businessId, date);
    res.json({ slots });
  } catch (error) {
    if (error instanceof AvailabilityError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/agent/book", async (req, res): Promise<void> => {
  const { businessId, leadId, callId, args } = toolContext(req);
  const slotStart = typeof args.slot_start === "string" ? new Date(args.slot_start) : null;
  const slotEnd = typeof args.slot_end === "string" ? new Date(args.slot_end) : null;
  if (!slotStart || !slotEnd || Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime())) {
    res.status(400).json({ error: "slot_start and slot_end (ISO timestamps) are required" });
    return;
  }
  try {
    const created = await bookAppointmentForLead({ businessId, leadId, slotStart, slotEnd, source: "agent" });
    if (callId) {
      await db.update(callsTable).set({ booked: true }).where(and(eq(callsTable.businessId, businessId), eq(callsTable.providerCallId, callId)));
    }
    res.status(201).json({ booked: true, appointment_id: created.id, external_id: created.externalId, start_time: created.startTime.toISOString() });
  } catch (error) {
    if (error instanceof BookingError) {
      // Never let the agent tell the caller "you're booked" on an
      // ambiguous or failed provider response — surface the real status
      // so the agent's own script can fall back to a human transfer or a
      // message instead of fabricating a confirmation.
      res.status(error.statusCode).json({ booked: false, error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/agent/transfer", async (req, res): Promise<void> => {
  const { businessId, leadId, callId, args } = toolContext(req);
  const [business] = await db.select({ transferNumber: businessesTable.transferNumber }).from(businessesTable).where(eq(businessesTable.id, businessId));
  const reason = typeof args.reason === "string" ? args.reason : "Caller requested a human";
  if (!business?.transferNumber) {
    // Nothing to transfer to. Tell the agent plainly so its script can
    // fall back to a message instead of attempting a transfer that can't
    // possibly work.
    res.status(200).json({ transfer_available: false, reason: "No transfer number configured for this business" });
    return;
  }
  await db.insert(activitiesTable).values({
    id: id("activity"),
    businessId,
    type: "call",
    title: "Transfer requested mid-call",
    detail: `Lead ${leadId}, call ${callId || "unknown"}: ${reason}`,
  });
  // The actual transfer mechanics (dialing business.transferNumber) are
  // executed by Retell's own native transfer-call function using the
  // number returned here — LeadSprint's job is authorization + logging,
  // not placing the transfer itself. Success/failure is confirmed later
  // by the call-ended webhook (see routes/webhooks.ts's transferFailed
  // handling), which is the only source of truth for whether it actually
  // connected.
  res.status(200).json({ transfer_available: true, transfer_number: business.transferNumber });
});

router.post("/agent/message", async (req, res): Promise<void> => {
  const { businessId, leadId, callId, args } = toolContext(req);
  const messageBody = typeof args.message === "string" ? args.message.trim() : "";
  if (!messageBody) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  await db.insert(activitiesTable).values({
    id: id("activity"),
    businessId,
    type: "message",
    title: "Message captured mid-call",
    detail: `Call ${callId || "unknown"}: "${messageBody}"`,
  });
  await db.update(leadsTable).set({ nextAction: "Call back — caller left a message", updatedAt: new Date() }).where(and(eq(leadsTable.id, leadId), eq(leadsTable.businessId, businessId)));
  res.status(200).json({ captured: true });
});

router.post("/agent/qualify", async (req, res): Promise<void> => {
  const { businessId, leadId, args } = toolContext(req);
  const updates: Partial<typeof leadsTable.$inferInsert> = { updatedAt: new Date() };
  if (typeof args.location === "string") updates.location = args.location;
  if (typeof args.property_type === "string") updates.propertyType = args.property_type;
  if (typeof args.budget_label === "string") updates.budgetLabel = args.budget_label;
  if (typeof args.timeline === "string") updates.timeline = args.timeline;
  if (typeof args.qualification_status === "string") updates.qualificationStatus = args.qualification_status;
  if (typeof args.intent_score === "number") updates.intentScore = Math.max(0, Math.min(100, Math.round(args.intent_score)));
  // Qualifying a lead is a meaningful business-state transition, not just
  // metadata — reflect it in .status too so it shows up correctly in the
  // console's lead list/filters, not only in the qualification fields.
  if (typeof args.qualification_status === "string" && args.qualification_status.toLowerCase() !== "disqualified") {
    updates.status = "qualified";
  }
  const [updated] = await db.update(leadsTable).set(updates).where(and(eq(leadsTable.id, leadId), eq(leadsTable.businessId, businessId))).returning({ id: leadsTable.id });
  if (!updated) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.status(200).json({ updated: true });
});

export default router;
