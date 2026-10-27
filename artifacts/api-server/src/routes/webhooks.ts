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
import { normalizePhone, samePhone, suppressContact } from "../lib/suppression";
import {
  extractRetellCall,
  hasTwilioSmsConfig,
  providerConfig,
  sendTwilioSms,
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
import { classifyUrgency, getProfile, isOutOfArea, validateDetails } from "../lib/verticals";
import { sendBusinessAlertEmail } from "../lib/mailer";

const router: IRouter = Router();

// Provider callbacks arrive without an operator session, so the limiter
// runs before any signature check — a flood must be shed cheaply.
// Scoped to /webhooks: this router is mounted at the /api root, so a bare
// router.use(limiter) would also throttle every operator-console request.
router.use("/webhooks", createWebhookLimiter());

/**
 * Validates timestamp freshness to prevent webhook replay attacks.
 * Accepts Date, ISO string, or numeric epoch timestamp (seconds or milliseconds).
 * Returns true if the timestamp is within maxAgeSeconds (default 300s = 5m) of now.
 */
export function isTimestampFresh(
  timestamp: Date | string | number | undefined | null,
  maxAgeSeconds = 300,
): boolean {
  if (timestamp === undefined || timestamp === null || timestamp === "") {
    return false;
  }
  let time: number;
  if (typeof timestamp === "number") {
    time = timestamp > 1e11 ? timestamp : timestamp * 1000;
  } else if (timestamp instanceof Date) {
    time = timestamp.getTime();
  } else if (typeof timestamp === "string") {
    if (/^\d+$/.test(timestamp.trim())) {
      const num = Number(timestamp.trim());
      time = num > 1e11 ? num : num * 1000;
    } else {
      time = new Date(timestamp).getTime();
    }
  } else {
    return false;
  }

  if (!Number.isFinite(time) || Number.isNaN(time)) {
    return false;
  }

  const skewMs = Math.abs(Date.now() - time);
  return skewMs <= maxAgeSeconds * 1000;
}

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

/**
 * Optional second way to authenticate intake, for no-code senders (Zapier,
 * Make, Meta's CRM link) that cannot compute an HMAC: send the intake secret
 * itself in `x-leadsprint-key`. OFF unless INTAKE_ALLOW_KEY_AUTH=true. It is
 * weaker than the signature (a captured request can be replayed), so TLS is
 * required and HMAC stays the recommended method. Compared in constant time.
 */
function intakeKeyAccepted(req: Request, secret: string | undefined): boolean {
  if (process.env["INTAKE_ALLOW_KEY_AUTH"] !== "true" || !secret) return false;
  const provided = req.get("x-leadsprint-key");
  if (!provided) return false;
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(provided), digest(secret));
}

type IntakeConsent = ReturnType<typeof normalizeConsentEvidence> & { evidenceText: string | null };

/**
 * Consent for an incoming lead. For Meta lead-ad leads a sender cannot simply
 * assert `consent_status: "valid"`: consent is valid only when the form's
 * explicit consent was given AND its wording and form id are present, and that
 * wording is kept as evidence. Anything less stays "unknown" and the safety
 * gate refuses to call. A source may still REVOKE. Every other source behaves
 * exactly as it always has.
 */
function resolveIntakeConsent(body: Record<string, unknown>, formId: string, consentText: string): IntakeConsent {
  if (body.source === "meta_lead_ads" && body.consent_status !== "revoked") {
    const source = formId ? `meta_lead_form:${formId}` : null;
    if (body.consent_given === true && consentText && formId) {
      return { consentStatus: "valid", consentSource: source, consentAt: new Date(), evidenceText: consentText };
    }
    return { consentStatus: "unknown", consentSource: source, consentAt: null, evidenceText: null };
  }
  return {
    ...normalizeConsentEvidence({ status: body.consent_status, source: body.consent_source, at: body.consent_at }),
    evidenceText: null,
  };
}

/**
 * Fire-and-forget: tells the client's owner about an emergency lead the moment
 * it arrives. Never awaited by intake and never allowed to fail it.
 */
function notifyEmergencyLead(
  req: Request,
  input: {
    to: string;
    businessName: string;
    name: string;
    phone: string;
    source: string;
    details: Record<string, string | number | boolean>;
    consentStatus: string;
    outOfArea: boolean;
  },
): void {
  const { details } = input;
  const place = [details.address, details.zip].filter((v) => v !== undefined && v !== "").join(" · ");
  const status = input.outOfArea
    ? "OUT OF SERVICE AREA: the AI will not call this lead. Please decide how to respond."
    : input.consentStatus === "valid"
      ? "The AI assistant is calling this lead now, or as soon as legal calling hours allow."
      : "No valid consent is recorded, so the AI will not call. Please contact the customer yourself.";
  const lines = [
    `EMERGENCY lead for ${input.businessName}`,
    `Name: ${input.name}`,
    `Phone: ${input.phone}`,
    `Problem: ${details.problem ?? "not provided"}`,
    `Service: ${details.service_type ?? "not provided"}`,
    `Where: ${place || "not provided"}`,
    `Source: ${input.source}`,
    status,
  ];
  Promise.resolve()
    .then(() => sendBusinessAlertEmail(input.to, `EMERGENCY lead: ${input.name}`, lines))
    .catch((err) => req.log?.warn?.({ err }, "Emergency lead email could not be sent"));
}

router.post("/webhooks/intake", async (req, res): Promise<void> => {
  const config = providerConfig();
  const signed = verifyWebhookSignature(rawBody(req), signatureFor(req), config.intakeWebhookSecret);
  if (!signed && !intakeKeyAccepted(req, config.intakeWebhookSecret)) {
    res.status(401).json({ error: "Invalid intake signature" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const rawTimestamp = req.get("x-webhook-timestamp") ?? body.timestamp;
  if (rawTimestamp !== undefined && rawTimestamp !== null && rawTimestamp !== "") {
    if (!isTimestampFresh(rawTimestamp as string | number | Date, 300)) {
      res.status(400).json({ error: "Webhook timestamp expired" });
      return;
    }
  }
  const businessId = typeof body.business_id === "string" ? body.business_id : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  // Stored and compared in one canonical form (E.164), so "(213) 555-0111"
  // and "+12135550111" are recognised as the same person.
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : "";
  if (!businessId || !name || !phone) {
    res.status(400).json({ error: "business_id, name, and phone are required" });
    return;
  }
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  if (!business) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  // Industry fields. Validated before anything is written, so a malformed
  // payload creates nothing.
  const detailsResult = validateDetails(body.details);
  if (!detailsResult.ok) {
    res.status(400).json({ error: detailsResult.error });
    return;
  }
  const details = detailsResult.details;
  if (body.consent_text !== undefined && (typeof body.consent_text !== "string" || body.consent_text.length > 1000)) {
    res.status(400).json({ error: "consent_text must be a string of at most 1000 characters." });
    return;
  }
  const consentText = typeof body.consent_text === "string" ? body.consent_text.trim() : "";
  const formId = typeof body.form_id === "string" ? body.form_id.trim().slice(0, 100) : "";
  const [existing] = await db.select({ id: contactsTable.id, phone: contactsTable.phone }).from(contactsTable).where(and(eq(contactsTable.businessId, businessId), samePhone(contactsTable.phone, body.phone as string))).limit(1);
  if (existing) {
    // A lead source revoking consent for someone we already hold must take
    // effect. Previously the duplicate check returned first, so a
    // "consent_status: revoked" update was silently dropped and the person
    // stayed callable.
    if (body.consent_status === "revoked") {
      await suppressContact(db, { businessId, contactId: existing.id, phone: existing.phone, reason: "Consent revoked by lead source", source: "intake_revoked" });
      res.status(200).json({ accepted: true, reason: "consent_revoked", contact_id: existing.id });
      return;
    }
    res.status(200).json({ accepted: false, reason: "duplicate" });
    return;
  }
  // Launch gate: the signed intake payload must carry explicit consent
  // evidence. A lead with no recorded reason it is lawful to call lands as
  // "unknown" and is never dialed — the policy gate blocks it and the
  // console shows why. `consent_status: "valid"` without a
  // `consent_source` is rejected outright rather than silently downgraded,
  // so a miswired lead source is visible to whoever integrated it.
  let consent: IntakeConsent;
  try {
    consent = resolveIntakeConsent(body, formId, consentText);
  } catch (error) {
    if (error instanceof ConsentEvidenceError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }

  const contactId = `contact_${crypto.randomUUID().slice(0, 12)}`;
  const leadId = `lead_${crypto.randomUUID().slice(0, 12)}`;
  await db.insert(contactsTable).values({ id: contactId, businessId, name, phone, email: typeof body.email === "string" ? body.email : null, timezone: timezoneForUSPhoneNumber(phone), consentStatus: consent.consentStatus, consentSource: consent.consentSource, consentAt: consent.consentAt, consentEvidence: consent.evidenceText });
  // Urgency and the service-area decision are made here, once, from the
  // workspace's profile; the engine itself never branches on an industry.
  const urgency = classifyUrgency(getProfile(business.vertical), { urgency: body.urgency, problem: details.problem });
  const outOfArea = isOutOfArea(business.serviceAreaZips ?? [], details);
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
    nextAction: outOfArea ? "Out of service area — review" : "Call lead",
    details,
    urgency,
  });
  await db.insert(activitiesTable).values({ id: `activity_${crypto.randomUUID().slice(0, 12)}`, businessId, type: "intake", title: `New lead received for ${name}`, detail: `Authenticated intake webhook accepted · ${describeConsent(consent)}` });
  if (outOfArea) {
    await db.insert(activitiesTable).values({
      id: `activity_${crypto.randomUUID().slice(0, 12)}`,
      businessId,
      type: "intake",
      title: `${name} is outside the service area`,
      detail: `ZIP ${String(details.zip ?? "from address")} is not in this business's service area, so no call was placed.`,
    });
  }
  if (urgency === "emergency" && business.notifyEmail) {
    notifyEmergencyLead(req, {
      to: business.notifyEmail,
      businessName: business.name,
      name,
      phone,
      source: typeof body.source === "string" ? body.source : "webhook",
      details,
      consentStatus: consent.consentStatus,
      outOfArea,
    });
  }

  // THE speed-to-lead step. Previously this webhook stopped at "lead
  // created" and a human had to open the console and press Call, which
  // makes the product an operator-assisted response desk, not LeadSprint.
  // Intake now creates one idempotent call job and dispatches it
  // immediately; the safety policy gate still runs inside
  // dispatchQueuedCall, so consent/suppression/quiet hours/attempt limits
  // and the kill switch are all enforced before any provider request.
  // A lead outside the business's service area is kept for review but never
  // queued: calling someone the company cannot serve wastes provider minutes.
  const queued = outOfArea
    ? null
    : await enqueueCallForLead({
        businessId,
        leadId,
        idempotencyKey: intakeIdempotencyKey(leadId),
        source: "intake",
      });

  let callState: { call_id?: string; status: string; detail?: string } = {
    status: "not_queued",
    ...(outOfArea ? { detail: "Outside the service area" } : {}),
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
      req.log?.warn?.(
        { businessId, leadId, callId: queued.call.id, outcome: dispatch.outcome },
        "Intake call was not started immediately",
      );
    }
  }

  res.status(201).json({
    accepted: true,
    lead_id: leadId,
    consent_status: consent.consentStatus,
    urgency,
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
  // Read the call row BEFORE archiving the event, so the usage accrual
  // below can tell "this is the first terminal report for this call" from
  // "this is a duplicate report of the same call".
  const [callBefore] = await db
    .select()
    .from(callsTable)
    .where(and(eq(callsTable.businessId, businessId), eq(callsTable.providerCallId, callId)));
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

    // A duration is billed exactly once per call. Retell reports the same
    // talk time on `call_ended` AND again on `call_analyzed`, and those two
    // payloads differ, so provider-event dedupe (keyed on the event hash)
    // cannot collapse them — accruing on every event that carried a
    // duration billed every call twice. Only the first terminal report for
    // a call we actually placed may write usage.
    const firstReportedDuration =
      terminal && duration != null && callBefore != null && callBefore.durationSeconds == null;

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

    if (firstReportedDuration) {
      // Attributed to the current month's usage row (created on demand),
      // never spread across periods by a bare business-wide update.
      await recordVoiceUsage(db, businessId, duration / 60, VOICE_COST_PER_MINUTE);
    }

    if (transferFailed && callBefore) {
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
      }).where(and(eq(leadsTable.id, callBefore.leadId), eq(leadsTable.businessId, businessId)));
    }

    // Speed-to-lead SMS: when the lead didn't answer (voicemail or no-answer),
    // send a follow-up SMS 2 minutes later so we stay in their attention window
    // without hammering them immediately. The SMS is fire-and-forget — a failure
    // is logged as a warning so the webhook still returns 202 and the call
    // record is already written. Only fires if Twilio is configured for the
    // business's market; silently skips otherwise.
    const missedCallReasons = ["voicemail_reached", "dial_no_answer", "machine_detected"];
    const wasMissedCall =
      terminal &&
      disconnectionReason != null &&
      missedCallReasons.includes(disconnectionReason) &&
      callRow != null;

    if (wasMissedCall) {
      // Fetch the contact's phone and the business project name so the SMS
      // is personalised — avoids a cold "we tried to call you" message.
      const [contactRow] = await db
        .select({ phone: contactsTable.phone, name: contactsTable.name })
        .from(contactsTable)
        .where(and(eq(contactsTable.id, callRow!.contactId), eq(contactsTable.businessId, businessId)))
        .limit(1);
      const [businessRow] = await db
        .select({ projectName: businessesTable.projectName, market: businessesTable.market })
        .from(businessesTable)
        .where(eq(businessesTable.id, businessId))
        .limit(1);

      if (contactRow && businessRow) {
        const market = (businessRow.market === "IN" ? "IN" : "US") as "US" | "IN";
        const firstName = contactRow.name.split(" ")[0] ?? contactRow.name;
        const smsBody =
          `Hi ${firstName}, we just tried calling about your enquiry for ${businessRow.projectName}. ` +
          `Reply to this message or just call back when you're free — we'd love to help.`;

        // Capture DB handle and businessId in closure so the setTimeout
        // callback can still write the activity row after the request is done.
        const dbHandle = db;
        const capturedBusinessId = businessId;
        const capturedCallId = callId;

        // 2-minute delay: enough time that the lead has put the phone down
        // and will actually read the SMS, but short enough to still feel instant.
        setTimeout(async () => {
          try {
            if (!hasTwilioSmsConfig(market)) {
              req.log?.info?.(
                { businessId: capturedBusinessId, callId: capturedCallId },
                "Skipping missed-call SMS — Twilio not configured for market",
              );
              return;
            }
            const { messageSid } = await sendTwilioSms({
              to: contactRow.phone,
              body: smsBody,
              market,
            });
            await dbHandle.insert(activitiesTable).values({
              id: `activity_${crypto.randomUUID().slice(0, 12)}`,
              businessId: capturedBusinessId,
              type: "message",
              title: `SMS follow-up sent to ${contactRow.name}`,
              detail: `Missed-call SMS dispatched (sid: ${messageSid}). Message: "${smsBody.slice(0, 100)}…"`,
            });
          } catch (err) {
            // Non-fatal: the call record and usage are already written.
            // Log so the operator can see it in monitoring.
            req.log?.warn?.(
              { businessId: capturedBusinessId, callId: capturedCallId, err },
              "Missed-call SMS failed to send",
            );
          }
        }, 2 * 60 * 1000);
      }
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
  if (body.createdAt !== undefined && body.createdAt !== null && !isTimestampFresh(body.createdAt as string, 300)) {
    res.status(401).json({ error: "Stale Cal.com webhook timestamp" });
    return;
  }
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