import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, eq } from "drizzle-orm";
import {
  activitiesTable,
  appointmentsTable,
  businessesTable,
  callsTable,
  contactsTable,
  db as defaultDb,
  leadsTable,
  providerEventsTable,
} from "@workspace/db";
import {
  extractRetellCall,
  providerConfig,
  verifyCalSignature,
  verifyRetellSignature,
  verifyTwilioSignature,
  verifyWebhookSignature,
} from "../lib/providers";
import { timezoneForUSPhoneNumber } from "../lib/areaCodeTimezones";
import {
  ConsentEvidenceError,
  describeConsent,
  normalizeConsentEvidence,
} from "../lib/consent";
import {
  dispatchQueuedCall,
  enqueueCallForLead,
  intakeIdempotencyKey,
} from "../lib/callQueue";
import { recordVoiceUsage, VOICE_COST_PER_MINUTE } from "../lib/usage";
import { createWebhookLimiter } from "../middlewares/rateLimit";

const router: IRouter = Router();

// Provider callbacks arrive without an operator session, so the limiter
// runs before any signature check — a flood must be shed cheaply.
router.use(createWebhookLimiter());

// Overridable database handle — see lib/callQueue.ts for why the
// acceptance tests run against a real embedded PostgreSQL rather than a mock.
let db: typeof defaultDb = defaultDb;

export function __setWebhooksDb(next: typeof defaultDb): void {
  db = next;
}

export function __resetWebhooksDb(): void {
  db = defaultDb;
}

function rawBody(req: Request): Buffer {
  return (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
}

function eventId(req: Request, body: Record<string, unknown>): string {
  const candidate =
    (typeof body.event_id === "string" && body.event_id) ||
    (typeof body.id === "string" && body.id) ||
    req.get("x-event-id") ||
    undefined;
  return candidate ?? crypto.createHash("sha256").update(rawBody(req)).digest("hex");
}

async function acceptProviderEvent(input: {
  businessId: string;
  provider: string;
  externalEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(input.payload))
    .digest("hex");
  const [created] = await db
    .insert(providerEventsTable)
    .values({
      id: `event_${crypto.randomUUID().slice(0, 12)}`,
      businessId: input.businessId,
      provider: input.provider,
      externalEventId: input.externalEventId,
      payloadHash,
      eventType: input.eventType,
      payload: input.payload,
      processedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [
        providerEventsTable.businessId,
        providerEventsTable.provider,
        providerEventsTable.externalEventId,
      ],
    })
    .returning({ id: providerEventsTable.id });
  return Boolean(created);
}

function signatureFor(req: Request): string | undefined {
  return req.get("x-retell-signature") ?? req.get("x-leadsprint-signature");
}

router.post("/webhooks/intake", async (req, res): Promise<void> => {
  const config = providerConfig();
  if (!verifyWebhookSignature(rawBody(req), signatureFor(req), config.intakeWebhookSecret)) {
    res.status(401).json({ error: "Invalid intake signature" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const businessId = typeof body.business_id === "string" ? body.business_id : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!businessId || !name || !phone) {
    res.status(400).json({ error: "business_id, name, and phone are required" });
    return;
  }
  const [business] = await db.select({ id: businessesTable.id }).from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  if (!business) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  const [existing] = await db.select({ id: contactsTable.id }).from(contactsTable).where(and(eq(contactsTable.businessId, businessId), eq(contactsTable.phone, phone))).limit(1);
  if (existing) {
    res.status(200).json({ accepted: false, reason: "duplicate" });
    return;
  }
  // Launch gate: the signed intake payload must carry explicit consent
  // evidence. A lead with no recorded reason it is lawful to call lands as
  // "unknown" and is never dialed — the policy gate blocks it and the
  // console shows why. `consent_status: "valid"` without a
  // `consent_source` is rejected outright rather than silently downgraded,
  // so a miswired lead source is visible to whoever integrated it.
  let consent;
  try {
    consent = normalizeConsentEvidence({
      status: body.consent_status,
      source: body.consent_source,
      at: body.consent_at,
    });
  } catch (error) {
    if (error instanceof ConsentEvidenceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }

  const contactId = `contact_${crypto.randomUUID().slice(0, 12)}`;
  const leadId = `lead_${crypto.randomUUID().slice(0, 12)}`;
  await db.insert(contactsTable).values({ id: contactId, businessId, name, phone, email: typeof body.email === "string" ? body.email : null, timezone: timezoneForUSPhoneNumber(phone), consentStatus: consent.consentStatus, consentSource: consent.consentSource, consentAt: consent.consentAt });
  await db.insert(leadsTable).values({
    id: leadId,
    businessId,
    contactId,
    source: typeof body.source === "string" ? body.source : "webhook",
    campaign: typeof body.campaign === "string" ? body.campaign : "Inbound enquiry",
    project: typeof body.project === "string" ? body.project : "Configured project",
    propertyType: typeof body.property_type === "string" ? body.property_type : "Not specified",
    budgetLabel: typeof body.budget_label === "string" ? body.budget_label : "Not specified",
    location: typeof body.location === "string" ? body.location : "Not specified",
    timeline: typeof body.timeline === "string" ? body.timeline : "Not specified",
    intentScore: 50,
    score: "warm",
    status: "new",
    nextAction: "Call lead",
  });
  await db.insert(activitiesTable).values({ id: `activity_${crypto.randomUUID().slice(0, 12)}`, businessId, type: "intake", title: `New lead received for ${name}`, detail: `Authenticated intake webhook accepted · ${describeConsent(consent)}` });

  // THE speed-to-lead step. Previously this webhook stopped at "lead
  // created" and a human had to open the console and press Call, which
  // makes the product an operator-assisted response desk, not LeadSprint.
  // Intake now creates one idempotent call job and dispatches it
  // immediately; the safety policy gate still runs inside
  // dispatchQueuedCall, so consent/suppression/quiet hours/attempt limits
  // and the kill switch are all enforced before any provider request.
  const queued = await enqueueCallForLead({
    businessId,
    leadId,
    idempotencyKey: intakeIdempotencyKey(leadId),
    source: "intake",
  });

  let callState: { call_id?: string; status: string; detail?: string } = {
    status: "not_queued",
  };
  if (queued) {
    const dispatch = await dispatchQueuedCall({ businessId, callId: queued.call.id });
    callState = {
      call_id: queued.call.id,
      status: dispatch.outcome,
      detail: dispatch.message,
    };
    if (dispatch.outcome !== "started") {
      // A call that could not be placed right now is not lost: the
      // workflow job stays queued and POST /api/cron/process-jobs retries
      // it under the same idempotency key. Non-retryable outcomes (e.g.
      // revoked consent) are already recorded as policy_blocked and are
      // operator-visible.
      req.log.warn(
        { businessId, leadId, callId: queued.call.id, outcome: dispatch.outcome },
        "Intake call was not started immediately",
      );
    }
  }

  res.status(201).json({
    accepted: true,
    lead_id: leadId,
    consent_status: consent.consentStatus,
    call: callState,
  });
});

router.post("/webhooks/retell", async (req, res): Promise<void> => {
  const config = providerConfig();
  // Retell signs with the API key that has the "webhook" badge, using
  // v={timestamp},d={hex} over rawBody+timestamp — not the generic
  // sha256-of-body scheme used elsewhere. See verifyRetellSignature.
  const webhookKey = config.retell.webhookSecret ?? config.retell.apiKey;
  if (!verifyRetellSignature(rawBody(req), req.get("x-retell-signature"), webhookKey)) {
    res.status(401).json({ error: "Invalid Retell signature" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  // Retell's real envelope is { event, call: {...} } — pull call fields
  // from the nested object, not the top level.
  const call = extractRetellCall(body);
  const callId = typeof call.call_id === "string" ? call.call_id : "";
  const metadata = (call.metadata && typeof call.metadata === "object" ? call.metadata : {}) as Record<string, unknown>;
  const businessId = typeof metadata.business_id === "string" ? metadata.business_id : "";
  if (!callId || !businessId) {
    res.status(400).json({ error: "call.call_id and call.metadata.business_id are required" });
    return;
  }
  const [business] = await db.select({ id: businessesTable.id }).from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  if (!business) {
    // Without this check, an unknown business_id (malformed payload, stale
    // metadata, or a bad-faith request that got past signature verification
    // some other way) hits the providerEventsTable foreign-key constraint
    // and throws a raw 500 instead of a clean rejection.
    res.status(404).json({ error: "Unknown business_id" });
    return;
  }
  const eventType = typeof body.event === "string" ? body.event : "call_update";
  const accepted = await acceptProviderEvent({ businessId, provider: "Retell", externalEventId: eventId(req, body), eventType, payload: body });
  if (accepted) {
    // Real Retell call_status values: registered | ongoing | ended | error.
    // call_analyzed is a separate event (post-call analysis complete) that
    // arrives after call_ended and carries the transcript/summary.
    const status = typeof call.call_status === "string" ? call.call_status : "ended";
    const terminal = eventType === "call_ended" || eventType === "call_analyzed" || status === "ended" || status === "error";
    const duration = typeof call.duration_ms === "number" ? Math.round(call.duration_ms / 1000) : null;
    const disconnectionReason = typeof call.disconnection_reason === "string" ? call.disconnection_reason : undefined;

    // A transfer was attempted if the agent's tool call requested one; Retell
    // reports the outcome either as an explicit boolean or via disconnection
    // reason. Treat ambiguous/failed transfer outcomes as "transfer failed",
    // never as a silent success — per the safety rule that a failed transfer
    // must become a message capture rather than disappear.
    const transferAttempted = call.transfer_attempted === true || typeof call.transfer_to_number === "string";
    const transferSucceeded = call.transferred === true || call.transfer_successful === true;
    const failedTransferReasons = ["dial_failed", "dial_no_answer", "dial_busy", "voicemail_reached", "transfer_failed"];
    const transferFailed = transferAttempted && !transferSucceeded && (disconnectionReason ? failedTransferReasons.includes(disconnectionReason) : true);

    const [callRow] = await db.select().from(callsTable).where(and(eq(callsTable.businessId, businessId), eq(callsTable.providerCallId, callId)));

    await db.update(callsTable).set({
      status: terminal ? (status === "error" ? "failed" : "completed") : "in_progress",
      endedAt: terminal ? new Date() : undefined,
      durationSeconds: duration ?? undefined,
      providerCallId: callId,
      transferred: transferAttempted ? transferSucceeded : undefined,
      summary: typeof call.call_analysis === "string" ? call.call_analysis : undefined,
      outcome: transferFailed
        ? "Transfer failed — message captured for manual follow-up"
        : disconnectionReason,
      errorState: status === "error" ? "Retell reported a failed call" : transferFailed ? "transfer_failed" : undefined,
    }).where(and(eq(callsTable.businessId, businessId), eq(callsTable.providerCallId, callId)));

    if (duration != null) {
      // Attributed to the current month's usage row (created on demand),
      // never spread across periods by a bare business-wide update.
      await recordVoiceUsage(db, businessId, duration / 60, VOICE_COST_PER_MINUTE);
    }

    if (transferFailed && callRow) {
      // Never expose the failure to the caller or silently drop it: log an
      // operator-visible activity and flip the lead to a manual follow-up
      // state so someone calls the person back.
      await db.insert(activitiesTable).values({
        id: `activity_${crypto.randomUUID().slice(0, 12)}`,
        businessId,
        type: "message",
        title: "Transfer failed — message captured",
        detail: `Call ${callId}: human transfer did not connect (${disconnectionReason ?? "unknown reason"}). Caller's message/callback request needs manual follow-up.`,
      });
      await db.update(leadsTable).set({
        nextAction: "Call back — transfer to human did not connect",
        updatedAt: new Date(),
      }).where(and(eq(leadsTable.id, callRow.leadId), eq(leadsTable.businessId, businessId)));
    }
  }
  res.status(202).json({ accepted: true, duplicate: !accepted });
});

router.post("/webhooks/twilio/status", async (req, res): Promise<void> => {
  const config = providerConfig();
  const twilioSignatureValid = verifyTwilioSignature(
    `${req.protocol}://${req.get("host")}${req.originalUrl}`,
    req.body as Record<string, unknown>,
    req.get("x-twilio-signature"),
    config.twilio.authToken,
  );
  const signedBodyValid = verifyWebhookSignature(rawBody(req), signatureFor(req), config.twilio.webhookSecret);
  if (!twilioSignatureValid && !signedBodyValid) {
    res.status(401).json({ error: "Invalid Twilio signature" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const callId = typeof body.CallSid === "string" ? body.CallSid : "";
  // Tenant identity must travel WITH the webhook: a `businessId` query
  // parameter on the configured status-callback URL, or a `BusinessId` field
  // from an internal gateway. Looking the tenant up by `provider_call_id`
  // across all businesses would let one tenant's signed status webhook land
  // on another tenant's call, so it is deliberately not done — an unscoped
  // callback is rejected, never guessed.
  const businessId =
    (typeof body.BusinessId === "string" && body.BusinessId) ||
    (typeof req.query.businessId === "string" && req.query.businessId) ||
    "";
  if (!callId || !businessId) {
    res.status(400).json({ error: "CallSid and a business-scoped callback (businessId) are required" });
    return;
  }
  // Calls are persisted before any provider work, so the CallSid must
  // already exist for THIS business. Rejecting unknown pairs keeps a
  // misconfigured (or foreign) callback from writing provider events or
  // call state into the wrong tenant.
  const [callRow] = await db
    .select({ id: callsTable.id })
    .from(callsTable)
    .where(and(eq(callsTable.businessId, businessId), eq(callsTable.providerCallId, callId)))
    .limit(1);
  if (!callRow) {
    res.status(400).json({ error: "CallSid must match a known LeadSprint call for this business" });
    return;
  }
  const accepted = await acceptProviderEvent({ businessId, provider: "Twilio", externalEventId: eventId(req, body), eventType: typeof body.CallStatus === "string" ? body.CallStatus : "status", payload: body });
  if (accepted) {
    const status = typeof body.CallStatus === "string" ? body.CallStatus : "unknown";
    await db.update(callsTable).set({
      providerCallId: callId,
      status: status === "completed" ? "completed" : status === "failed" || status === "busy" || status === "no-answer" ? "failed" : "in_progress",
      endedAt: status === "completed" || status === "failed" || status === "busy" || status === "no-answer" ? new Date() : undefined,
      errorState: status === "failed" || status === "busy" || status === "no-answer" ? `Twilio reported ${status}` : undefined,
    }).where(and(eq(callsTable.businessId, businessId), eq(callsTable.providerCallId, callId)));
  }
  res.status(202).json({ accepted: true, duplicate: !accepted });
});

router.post("/webhooks/calcom", async (req, res): Promise<void> => {
  const config = providerConfig();
  if (!verifyCalSignature(rawBody(req), req.get("x-cal-signature-256"), config.calcom.webhookSecret)) {
    res.status(401).json({ error: "Invalid Cal.com signature" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  // Cal.com's real webhook envelope is { triggerEvent, createdAt, payload }.
  const payload = (body.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>;
  const metadata = (payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}) as Record<string, unknown>;
  const businessId = typeof metadata.business_id === "string" ? metadata.business_id : "";
  if (!businessId) {
    res.status(400).json({ error: "payload.metadata.business_id is required" });
    return;
  }
  const [business] = await db.select({ id: businessesTable.id }).from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  if (!business) {
    res.status(404).json({ error: "Unknown business_id" });
    return;
  }
  const triggerEvent = typeof body.triggerEvent === "string" ? body.triggerEvent : "booking";
  const accepted = await acceptProviderEvent({ businessId, provider: "Cal.com", externalEventId: eventId(req, body), eventType: triggerEvent, payload: body });
  if (accepted) {
    // A webhook that only archives the event never updates the console —
    // the appointment row itself has to reflect cancellation/reschedule,
    // or the operator keeps seeing a confirmed appointment that no longer
    // exists on the actual calendar.
    const externalId = typeof payload.uid === "string" ? payload.uid : typeof payload.bookingId !== "undefined" ? String(payload.bookingId) : "";
    if (externalId) {
      if (triggerEvent === "BOOKING_CANCELLED") {
        await db.update(appointmentsTable).set({ status: "cancelled" }).where(and(eq(appointmentsTable.businessId, businessId), eq(appointmentsTable.externalId, externalId)));
      } else if (triggerEvent === "BOOKING_RESCHEDULED") {
        const startTime = typeof payload.startTime === "string" ? new Date(payload.startTime) : undefined;
        const endTime = typeof payload.endTime === "string" ? new Date(payload.endTime) : undefined;
        await db.update(appointmentsTable).set({
          startTime,
          endTime,
          // If Cal.com didn't include the new times in this payload, don't
          // silently keep showing the old time as confirmed — force a look.
          status: startTime && endTime ? "confirmed" : "needs_review",
        }).where(and(eq(appointmentsTable.businessId, businessId), eq(appointmentsTable.externalId, externalId)));
      }
    }
  }
  res.status(202).json({ accepted: true, duplicate: !accepted });
});

export default router;