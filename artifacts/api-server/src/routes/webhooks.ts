import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  activitiesTable,
  appointmentsTable,
  businessesTable,
  callsTable,
  consentEventsTable,
  contactsTable,
  db,
  leadsTable,
  providerEventsTable,
  usageTable,
  workflowJobsTable,
} from "@workspace/db";
import {
  providerConfig,
  verifyTwilioSignature,
  verifyWebhookSignature,
} from "../lib/providers";
import { normalizeToE164, inferTimezoneFromPhone, isValidIanaTimezone, validateConsentSource, parseConsentTimestamp } from "../lib/phone";
import { getActiveUsageRow } from "../lib/usage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000; // 5 minutes

export function verifyTimestampFreshness(
  timestampValue: string | number | undefined | null,
  maxAgeMs = MAX_WEBHOOK_AGE_MS,
): { valid: boolean; reason?: string } {
  if (timestampValue === undefined || timestampValue === null) {
    return { valid: false, reason: "Missing timestamp" };
  }

  if (typeof timestampValue === "string" && timestampValue.trim() === "") {
    return { valid: false, reason: "Missing timestamp" };
  }

  let tsMs: number;
  if (typeof timestampValue === "number") {
    if (isNaN(timestampValue) || !isFinite(timestampValue)) {
      return { valid: false, reason: "Unparseable timestamp number" };
    }
    tsMs = timestampValue < 10000000000 ? timestampValue * 1000 : timestampValue;
  } else if (typeof timestampValue === "string") {
    const trimmed = timestampValue.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      if (isNaN(num) || !isFinite(num)) {
        return { valid: false, reason: "Unparseable timestamp string" };
      }
      tsMs = num < 10000000000 ? num * 1000 : num;
    } else {
      const parsed = Date.parse(trimmed);
      if (isNaN(parsed)) {
        return { valid: false, reason: "Unparseable timestamp string" };
      }
      tsMs = parsed;
    }
  } else {
    return { valid: false, reason: "Invalid timestamp type" };
  }

  const ageMs = Math.abs(Date.now() - tsMs);
  if (ageMs > maxAgeMs) {
    return { valid: false, reason: `Timestamp outside freshness window (${Math.round(ageMs / 1000)}s old)` };
  }
  return { valid: true };
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
        providerEventsTable.provider,
        providerEventsTable.externalEventId,
      ],
    })
    .returning({ id: providerEventsTable.id });
  return Boolean(created);
}

function signatureFor(req: Request): string | undefined {
  return (
    req.get("x-cal-signature-256") ??
    req.get("x-calcom-signature") ??
    req.get("x-retell-signature") ??
    req.get("x-leadsprint-signature")
  );
}

router.post("/webhooks/intake", async (req, res): Promise<void> => {
  const config = providerConfig();
  if (!verifyWebhookSignature(rawBody(req), signatureFor(req), config.intakeWebhookSecret)) {
    res.status(401).json({ error: "Invalid intake signature" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const tsCandidate = body.timestamp ?? body.created_at ?? req.get("x-timestamp");
  const freshness = verifyTimestampFreshness(tsCandidate as string | number | undefined);
  if (!freshness.valid) {
    res.status(400).json({ error: `Stale webhook: ${freshness.reason}` });
    return;
  }

  const businessId = typeof body.business_id === "string" ? body.business_id : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!businessId || !name || !rawPhone) {
    res.status(400).json({ error: "business_id, name, and phone are required" });
    return;
  }

  const normalizedPhone = normalizeToE164(rawPhone);
  if (!normalizedPhone.valid) {
    res.status(400).json({ error: `Invalid phone number: ${normalizedPhone.error}` });
    return;
  }
  const phone = normalizedPhone.e164;

  const [business] = await db.select({ id: businessesTable.id }).from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  if (!business) {
    res.status(404).json({ error: "Business not found" });
    return;
  }

  let result: { accepted: boolean; reason?: string; lead_id?: string } = { accepted: false };

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: contactsTable.id }).from(contactsTable).where(and(eq(contactsTable.businessId, businessId), eq(contactsTable.phone, phone))).limit(1);
    if (existing) {
      result = { accepted: false, reason: "duplicate" };
      return;
    }

    const intakeIp = ((req.ip || (req.get("x-forwarded-for")?.split(",")[0]?.trim()) || null) ?? null) as string | null;

    let recipientTimezone: string | null = null;
    let timezoneProvenance: "explicit_intake" | "area_code_inferred" | "business_fallback" = "business_fallback";

    // Issue 3 fix: validate supplied timezone as genuine IANA identifier before accepting as explicit_intake
    const rawTzField = typeof body.recipient_timezone === "string" ? body.recipient_timezone.trim()
      : (typeof body.timezone === "string" ? body.timezone.trim() : "");

    if (rawTzField) {
      if (isValidIanaTimezone(rawTzField)) {
        recipientTimezone = rawTzField;
        timezoneProvenance = "explicit_intake";
      } else {
        // Supplied timezone is invalid — fall back to area-code inference; do NOT persist invalid value
        const inferred = inferTimezoneFromPhone(phone);
        recipientTimezone = inferred.timezone;
        timezoneProvenance = inferred.provenance;
      }
    } else {
      const inferred = inferTimezoneFromPhone(phone);
      recipientTimezone = inferred.timezone;
      timezoneProvenance = inferred.provenance;
    }

    // Affirmative consent check: only create opt_in consent event if affirmative consent is explicitly signaled
    const hasAffirmativeConsent =
      body.consent_given === true ||
      body.consentGiven === true ||
      body.consent_given === "true";

    let consentCapturedAt: Date | null = null;
    let consentSource: string | null = null;
    let consentDisclosureVersion: string | null = null;
    let disclosureText: string | null = null;

    if (hasAffirmativeConsent) {
      // Issue 1 fix: never substitute new Date() for a supplied-but-invalid consent timestamp
      const tsResult = parseConsentTimestamp(body.consent_captured_at ?? null);
      if (tsResult.invalid) {
        // Supplied timestamp is invalid — reject request; do not fabricate a timestamp
        res.status(400).json({ error: "consent_captured_at is invalid; supply a valid ISO 8601 timestamp or omit the field" });
        return;
      }
      consentCapturedAt = tsResult.date;

      // Issue 2 fix: validate consent source against canonical vocabulary
      const rawSource = typeof body.consent_source === "string" ? body.consent_source : null;
      const validatedSource = validateConsentSource(rawSource, "api_intake");
      if (validatedSource === null) {
        res.status(400).json({ error: `consent_source '${rawSource}' is not a recognised canonical value` });
        return;
      }
      consentSource = validatedSource;

      consentDisclosureVersion = (typeof body.consent_disclosure_version === "string" && body.consent_disclosure_version.trim()) ? body.consent_disclosure_version.trim() : null;
      disclosureText = (typeof body.disclosure_text === "string" && body.disclosure_text.trim()) ? body.disclosure_text.trim() : null;
    }

    const contactId = `contact_${crypto.randomUUID().slice(0, 12)}`;
    const leadId = `lead_${crypto.randomUUID().slice(0, 12)}`;
    await tx.insert(contactsTable).values({
      id: contactId,
      businessId,
      name,
      phone,
      email: typeof body.email === "string" ? body.email : null,
      consentStatus: "valid",
      consentCapturedAt,
      consentSource,
      consentDisclosureVersion,
      intakeIp,
      recipientTimezone,
      timezoneProvenance,
    });

    if (hasAffirmativeConsent) {
      await tx.insert(consentEventsTable).values({
        id: `consent_${crypto.randomUUID().slice(0, 12)}`,
        businessId,
        contactId,
        eventType: "opt_in",
        source: consentSource ?? "api_intake",
        disclosureVersion: consentDisclosureVersion,
        disclosureText,
        ipAddress: intakeIp,
        userAgent: req.get("user-agent") || null,
        metadata: {},
        capturedAt: consentCapturedAt ?? new Date(),
      });
    }

    await tx.insert(leadsTable).values({
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
    await tx.insert(activitiesTable).values({ id: `activity_${crypto.randomUUID().slice(0, 12)}`, businessId, type: "intake", title: `New lead received for ${name}`, detail: "Authenticated intake webhook accepted" });

    const callId = `call_${crypto.randomUUID().slice(0, 12)}`;
    const jobId = `job_${crypto.randomUUID().slice(0, 12)}`;
    const idempotencyKey = `intake_call_${leadId}`;

    await tx.insert(callsTable).values({
      id: callId,
      businessId,
      contactId,
      leadId,
      provider: "Retell",
      idempotencyKey,
      status: "queued",
      summary: "Call queued for the approved qualification script.",
      outcome: "Queued",
    });

    await tx.insert(workflowJobsTable).values({
      id: jobId,
      businessId,
      type: "initiate_call",
      idempotencyKey,
      status: "queued",
      availableAt: new Date(),
    });

    result = { accepted: true, lead_id: leadId };
  });

  if (!result.accepted && result.reason === "duplicate") {
    res.status(200).json(result);
    return;
  }

  res.status(201).json(result);
});

router.post("/webhooks/retell", async (req, res): Promise<void> => {
  const config = providerConfig();
  if (!verifyWebhookSignature(rawBody(req), signatureFor(req), config.retell.webhookSecret)) {
    res.status(401).json({ error: "Invalid Retell signature" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const tsCandidate = body.event_timestamp ?? body.timestamp ?? req.get("x-timestamp");
  const freshness = verifyTimestampFreshness(tsCandidate as string | number | undefined);
  if (!freshness.valid) {
    res.status(400).json({ error: `Stale webhook: ${freshness.reason}` });
    return;
  }

  const callId = typeof body.call_id === "string" ? body.call_id : typeof body.callId === "string" ? body.callId : "";
  const metadata = (body.metadata && typeof body.metadata === "object" ? body.metadata : {}) as Record<string, unknown>;
  const businessId = typeof metadata.business_id === "string" ? metadata.business_id : "";
  const metadataCallId = typeof metadata.call_id === "string" ? metadata.call_id : "";
  if (!callId || !businessId) {
    res.status(400).json({ error: "call_id and metadata.business_id are required" });
    return;
  }
  const accepted = await acceptProviderEvent({ businessId, provider: "Retell", externalEventId: eventId(req, body), eventType: typeof body.event === "string" ? body.event : "call_update", payload: body });
  if (accepted) {
    const status = typeof body.call_status === "string" ? body.call_status : typeof body.status === "string" ? body.status : "completed";
    const terminal = ["ended", "call_ended", "completed", "call_analyzed"].includes(status);
    const duration = typeof body.duration_ms === "number" ? Math.round(body.duration_ms / 1000) : null;
    const disconnectionReason = typeof body.disconnection_reason === "string" ? body.disconnection_reason : undefined;

    const transferAttempted = body.transfer_attempted === true || typeof body.transfer_to_number === "string";
    const transferSucceeded = body.transferred === true || body.transfer_successful === true;
    const failedTransferReasons = ["dial_failed", "dial_no_answer", "dial_busy", "voicemail_reached", "transfer_failed"];
    const transferFailed = transferAttempted && !transferSucceeded && (disconnectionReason ? failedTransferReasons.includes(disconnectionReason) : true);

    let [callRow] = await db.select().from(callsTable).where(and(eq(callsTable.businessId, businessId), eq(callsTable.providerCallId, callId)));
    if (!callRow && metadataCallId) {
      const [orphanCall] = await db.select().from(callsTable).where(and(eq(callsTable.businessId, businessId), eq(callsTable.id, metadataCallId)));
      if (orphanCall) {
        callRow = orphanCall;
      }
    }

    if (callRow) {
      await db.update(callsTable).set({
        status: terminal ? "completed" : status === "failed" ? "failed" : "in_progress",
        endedAt: terminal || status === "failed" ? new Date() : undefined,
        durationSeconds: duration ?? undefined,
        providerCallId: callId,
        transferred: transferAttempted ? transferSucceeded : undefined,
        summary: typeof body.call_analysis === "string" ? body.call_analysis : undefined,
        outcome: transferFailed
          ? "Transfer failed — message captured for manual follow-up"
          : disconnectionReason,
        errorState: status === "failed" ? "Retell reported a failed call" : transferFailed ? "transfer_failed" : undefined,
      }).where(and(eq(callsTable.businessId, businessId), eq(callsTable.id, callRow.id)));

      if (terminal) {
        await db
          .update(workflowJobsTable)
          .set({
            status: "completed",
            lockedAt: null,
            lockedBy: null,
            leaseExpiresAt: null,
            lastError: null,
          })
          .where(
            and(
              eq(workflowJobsTable.businessId, businessId),
              eq(workflowJobsTable.idempotencyKey, callRow.id),
            ),
          );
      }
    }

    if (duration != null) {
      const activeUsage = await getActiveUsageRow(businessId, new Date(), db);
      await db.update(usageTable).set({
        voiceMinutes: sql`${usageTable.voiceMinutes} + ${duration / 60}`,
        estimatedCost: sql`${usageTable.estimatedCost} + ${(duration / 60) * 0.12}`,
      }).where(eq(usageTable.id, activeUsage.id));
    }

    if (transferFailed && callRow) {
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
  const tsCandidate = body.Timestamp ?? req.get("x-twilio-timestamp");
  const freshness = verifyTimestampFreshness(tsCandidate as string | number | undefined);
  if (!freshness.valid) {
    res.status(400).json({ error: `Stale webhook: ${freshness.reason}` });
    return;
  }

  const callId = typeof body.CallSid === "string" ? body.CallSid : "";
  const [callRow] = callId
    ? await db.select({ businessId: callsTable.businessId }).from(callsTable).where(eq(callsTable.providerCallId, callId)).limit(1)
    : [];
  const businessId = typeof body.BusinessId === "string" ? body.BusinessId : callRow?.businessId;
  if (!callId || !businessId) {
    res.status(400).json({ error: "CallSid must match a known LeadSprint call" });
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
  if (!verifyWebhookSignature(rawBody(req), signatureFor(req), config.calcom.webhookSecret)) {
    res.status(401).json({ error: "Invalid Cal.com signature" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const payload = (body.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>;
  const tsCandidate = body.createdAt ?? payload.createdAt ?? req.get("x-timestamp");
  const freshness = verifyTimestampFreshness(tsCandidate as string | number | undefined);
  if (!freshness.valid) {
    res.status(400).json({ error: `Stale webhook: ${freshness.reason}` });
    return;
  }

  const metadata = (body.metadata && typeof body.metadata === "object" ? body.metadata : {}) as Record<string, unknown>;
  const payloadMetadata = (payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}) as Record<string, unknown>;
  const businessId =
    (typeof metadata.business_id === "string" && metadata.business_id) ||
    (typeof payloadMetadata.business_id === "string" && payloadMetadata.business_id) ||
    "";
  if (!businessId) {
    res.status(400).json({ error: "metadata.business_id is required" });
    return;
  }

  const triggerEvent = typeof body.triggerEvent === "string" ? body.triggerEvent : "";
  const externalEventId = eventId(req, body);

  const accepted = await acceptProviderEvent({
    businessId,
    provider: "Cal.com",
    externalEventId,
    eventType: triggerEvent || "booking",
    payload: body,
  });

  if (!accepted) {
    res.status(202).json({ accepted: true, duplicate: true });
    return;
  }

  const uidCandidate = payload.uid ?? payload.bookingId ?? payload.id ?? body.uid;
  const uid = uidCandidate != null ? String(uidCandidate).trim() : "";

  switch (triggerEvent) {
    case "BOOKING_CONFIRMED":
    case "BOOKING_CREATED": {
      if (!uid) {
        logger.warn({ triggerEvent, businessId }, "Cal.com webhook missing booking uid");
        break;
      }
      try {
        await db.transaction(async (tx) => {
          const [appointment] = await tx
            .select()
            .from(appointmentsTable)
            .where(
              and(
                eq(appointmentsTable.businessId, businessId),
                eq(appointmentsTable.externalId, uid),
              ),
            )
            .limit(1);

          if (!appointment) {
            logger.warn(
              { businessId, uid, triggerEvent },
              "Cal.com webhook appointment not found for tenant",
            );
            return;
          }

          await tx
            .update(appointmentsTable)
            .set({ status: "confirmed" })
            .where(eq(appointmentsTable.id, appointment.id));
        });
      } catch (err) {
        logger.error(
          { err, triggerEvent, businessId, uid },
          "Failed to process Cal.com webhook lifecycle reconciliation",
        );
        await db
          .delete(providerEventsTable)
          .where(
            and(
              eq(providerEventsTable.provider, "Cal.com"),
              eq(providerEventsTable.externalEventId, externalEventId),
            ),
          );
        res.status(500).json({ error: "Failed to process Cal.com event" });
        return;
      }
      break;
    }

    case "BOOKING_RESCHEDULED": {
      if (!uid) {
        logger.warn({ triggerEvent, businessId }, "Cal.com webhook missing booking uid");
        break;
      }
      try {
        await db.transaction(async (tx) => {
          const [appointment] = await tx
            .select()
            .from(appointmentsTable)
            .where(
              and(
                eq(appointmentsTable.businessId, businessId),
                eq(appointmentsTable.externalId, uid),
              ),
            )
            .limit(1);

          if (!appointment) {
            logger.warn(
              { businessId, uid, triggerEvent },
              "Cal.com webhook appointment not found for tenant",
            );
            return;
          }

          let newStart: Date | undefined;
          let newEnd: Date | undefined;

          if (payload.startTime && typeof payload.startTime === "string") {
            const parsed = new Date(payload.startTime);
            if (!isNaN(parsed.getTime())) {
              newStart = parsed;
            }
          }
          if (payload.endTime && typeof payload.endTime === "string") {
            const parsed = new Date(payload.endTime);
            if (!isNaN(parsed.getTime())) {
              newEnd = parsed;
            }
          }

          if (!newStart || !newEnd) {
            logger.warn(
              { uid, payloadStartTime: payload.startTime, payloadEndTime: payload.endTime },
              "BOOKING_RESCHEDULED missing valid startTime or endTime; preserving existing times",
            );
          }

          const finalStart = newStart ?? appointment.startTime;
          const finalEnd = newEnd ?? appointment.endTime;

          await tx
            .update(appointmentsTable)
            .set({
              startTime: finalStart,
              endTime: finalEnd,
              status: "confirmed",
            })
            .where(eq(appointmentsTable.id, appointment.id));

          await tx
            .update(leadsTable)
            .set({
              nextAction: "Appointment rescheduled",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(leadsTable.id, appointment.leadId),
                eq(leadsTable.businessId, businessId),
              ),
            );

          await tx.insert(activitiesTable).values({
            id: `activity_${crypto.randomUUID().slice(0, 12)}`,
            businessId,
            type: "booking",
            title: "Appointment rescheduled",
            detail: `Showing rescheduled for ${finalStart.toISOString()}.`,
          });
        });
      } catch (err) {
        logger.error(
          { err, triggerEvent, businessId, uid },
          "Failed to process Cal.com webhook lifecycle reconciliation",
        );
        await db
          .delete(providerEventsTable)
          .where(
            and(
              eq(providerEventsTable.provider, "Cal.com"),
              eq(providerEventsTable.externalEventId, externalEventId),
            ),
          );
        res.status(500).json({ error: "Failed to process Cal.com event" });
        return;
      }
      break;
    }

    case "BOOKING_CANCELLED": {
      if (!uid) {
        logger.warn({ triggerEvent, businessId }, "Cal.com webhook missing booking uid");
        break;
      }
      try {
        await db.transaction(async (tx) => {
          const [appointment] = await tx
            .select()
            .from(appointmentsTable)
            .where(
              and(
                eq(appointmentsTable.businessId, businessId),
                eq(appointmentsTable.externalId, uid),
              ),
            )
            .limit(1);

          if (!appointment) {
            logger.warn(
              { businessId, uid, triggerEvent },
              "Cal.com webhook appointment not found for tenant",
            );
            return;
          }

          await tx
            .update(appointmentsTable)
            .set({ status: "cancelled" })
            .where(eq(appointmentsTable.id, appointment.id));

          await tx
            .update(leadsTable)
            .set({
              nextAction: "Reschedule showing",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(leadsTable.id, appointment.leadId),
                eq(leadsTable.businessId, businessId),
              ),
            );

          await tx.insert(activitiesTable).values({
            id: `activity_${crypto.randomUUID().slice(0, 12)}`,
            businessId,
            type: "booking",
            title: "Appointment cancelled",
            detail: `Cal.com booking ${uid} was cancelled.`,
          });
        });
      } catch (err) {
        logger.error(
          { err, triggerEvent, businessId, uid },
          "Failed to process Cal.com webhook lifecycle reconciliation",
        );
        await db
          .delete(providerEventsTable)
          .where(
            and(
              eq(providerEventsTable.provider, "Cal.com"),
              eq(providerEventsTable.externalEventId, externalEventId),
            ),
          );
        res.status(500).json({ error: "Failed to process Cal.com event" });
        return;
      }
      break;
    }

    default: {
      logger.info({ triggerEvent, businessId }, "Unhandled Cal.com event type received");
      break;
    }
  }

  res.status(202).json({ accepted: true, duplicate: false });
});

export default router;