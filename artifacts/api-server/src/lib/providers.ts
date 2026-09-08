import crypto from "node:crypto";

export class ProviderNotConfiguredError extends Error {
  readonly code = "PROVIDER_NOT_CONFIGURED";

  constructor(provider: string, missing: string[]) {
    super(`${provider} is not configured. Missing: ${missing.join(", ")}`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderRequestError extends Error {
  readonly code = "PROVIDER_REQUEST_FAILED";
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
  }
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function providerConfig() {
  const retell = {
    apiKey: env("RETELL_API_KEY"),
    agentId: env("RETELL_AGENT_ID"),
    fromNumber: env("RETELL_FROM_NUMBER"),
    fromNumberUS: env("RETELL_FROM_NUMBER_US"),
    fromNumberIN: env("RETELL_FROM_NUMBER_IN"),
    webhookSecret: env("RETELL_WEBHOOK_SECRET"),
  };
  const twilio = {
    accountSid: env("TWILIO_ACCOUNT_SID"),
    authToken: env("TWILIO_AUTH_TOKEN"),
    usFromNumber: env("TWILIO_FROM_NUMBER_US"),
    indiaFromNumber: env("TWILIO_FROM_NUMBER_IN"),
    webhookSecret: env("TWILIO_WEBHOOK_SECRET"),
  };
  const calcom = {
    apiKey: env("CALCOM_API_KEY"),
    eventTypeId: env("CALCOM_EVENT_TYPE_ID"),
    apiUrl: env("CALCOM_API_URL") ?? "https://api.cal.com/v2",
    webhookSecret: env("CALCOM_WEBHOOK_SECRET"),
  };
  return {
    retell,
    twilio,
    calcom,
    intakeWebhookSecret: env("LEAD_INTAKE_WEBHOOK_SECRET"),
  };
}

function requireValues(
  provider: string,
  values: Record<string, string | undefined>,
): Record<string, string> {
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw new ProviderNotConfiguredError(provider, missing);
  return values as Record<string, string>;
}

async function parseProviderResponse<T>(
  response: Response,
  provider: string,
): Promise<T> {
  const raw = await response.text();
  let parsed: unknown = raw;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // Keep the raw body in the structured error below.
  }
  if (!response.ok) {
    const detail =
      typeof parsed === "object" && parsed !== null
        ? JSON.stringify(parsed)
        : String(parsed);
    throw new ProviderRequestError(
      `${provider} returned ${response.status}: ${detail.slice(0, 500)}`,
      response.status,
    );
  }
  return parsed as T;
}

export async function startRetellCall(input: {
  toNumber: string;
  market: "US" | "IN";
  metadata: Record<string, string>;
}): Promise<{ callId: string }> {
  const config = providerConfig().retell;
  const fromNumber =
    input.market === "IN"
      ? config.fromNumberIN ?? config.fromNumber
      : config.fromNumberUS ?? config.fromNumber;
  const values = requireValues("Retell", {
    apiKey: config.apiKey,
    agentId: config.agentId,
    fromNumber,
  });
  const response = await fetch("https://api.retellai.com/v2/create-phone-call", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${values.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from_number: values.fromNumber,
      to_number: input.toNumber,
      // Retell's documented per-call override field is `override_agent_id`,
      // not `agent_id` (that field only exists on the response object).
      // Sending `agent_id` here is silently ignored by Retell's API, which
      // means every call actually ran on the number's bound agent instead
      // of the tenant-specific one this call requested.
      override_agent_id: values.agentId,
      metadata: { ...input.metadata, market: input.market },
    }),
  });
  const body = await parseProviderResponse<{ call_id?: string }>(
    response,
    "Retell",
  );
  if (!body?.call_id) throw new ProviderRequestError("Retell did not return call_id");
  return { callId: body.call_id };
}

export function hasRetellConfigForMarket(market?: "US" | "IN"): boolean {
  const config = providerConfig().retell;
  const fromNumber =
    market === "IN"
      ? config.fromNumberIN ?? config.fromNumber
      : market === "US"
        ? config.fromNumberUS ?? config.fromNumber
        : config.fromNumberUS ?? config.fromNumberIN ?? config.fromNumber;
  return Boolean(config.apiKey && config.agentId && fromNumber);
}

/**
 * Verifies Retell's `X-Retell-Signature` header, format `v={unix_ms},d={hex}`.
 * Per Retell's documented contract, the digest is HMAC-SHA256 over the raw
 * request body concatenated with the timestamp string, keyed by the Retell
 * API key that has the "webhook" badge in the dashboard — NOT a separate
 * shared-secret env var, and NOT a plain HMAC of the body alone. This same
 * header/scheme is used for both call webhooks and agent custom-function
 * tool calls, so this one function covers both.
 *
 * A ~5 minute freshness window is enforced by default to reject replayed
 * requests, matching Retell's own guidance.
 */
export function verifyRetellSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  apiKey: string | undefined,
  toleranceMs = 5 * 60 * 1000,
): boolean {
  if (!signatureHeader || !apiKey) return false;
  const match = /^v=(\d+),d=([0-9a-f]+)$/i.exec(signatureHeader.trim());
  if (!match) return false;
  const [, timestampStr, providedHex] = match;
  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() - timestamp) > toleranceMs) return false;
  const expected = crypto
    .createHmac("sha256", apiKey)
    .update(rawBody.toString("utf8") + timestampStr)
    .digest("hex");
  const providedBuffer = Buffer.from(providedHex.toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

/**
 * Retell's real webhook/custom-function envelope is `{ event, call }` (or,
 * for custom functions, `{ name, call, args }`) — not a flat object with
 * call fields at the top level. This normalizes both shapes defensively:
 * if `call` is a nested object, use it; otherwise fall back to the
 * top-level body so hand-built test fixtures without the wrapper still work.
 */
export function extractRetellCall(body: Record<string, unknown>): Record<string, unknown> {
  return body.call && typeof body.call === "object"
    ? (body.call as Record<string, unknown>)
    : body;
}

export function hasTwilioRoute(market: "US" | "IN"): boolean {
  const config = providerConfig().twilio;
  const fromNumber =
    market === "IN" ? config.indiaFromNumber : config.usFromNumber;
  return Boolean(config.accountSid && config.authToken && fromNumber);
}

export function providerReadiness(market: "US" | "IN") {
  const config = providerConfig();
  const retellFrom =
    market === "IN"
      ? config.retell.fromNumberIN ?? config.retell.fromNumber
      : config.retell.fromNumberUS ?? config.retell.fromNumber;
  return {
    retell: Boolean(config.retell.apiKey && config.retell.agentId && retellFrom),
    twilio: hasTwilioRoute(market),
    calcom: Boolean(config.calcom.apiKey && config.calcom.eventTypeId),
    intake: Boolean(config.intakeWebhookSecret),
  };
}

export function verifyTwilioSignature(
  url: string,
  params: Record<string, unknown>,
  signature: string | undefined,
  authToken: string | undefined,
): boolean {
  if (!signature || !authToken) return false;
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}${String(params[key] ?? "")}`)
    .join("");
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(url + sorted)
    .digest("base64");
  const provided = Buffer.from(signature, "utf8");
  const calculated = Buffer.from(expected, "utf8");
  return (
    provided.length === calculated.length &&
    crypto.timingSafeEqual(provided, calculated)
  );
}

// Cal.com v2 silently falls back to an older, differently-shaped endpoint
// version if this header is omitted — pin it explicitly everywhere.
const CAL_API_VERSION = "2024-08-13";

export async function getCalAvailability(input: {
  start: string;
  end: string;
  timeZone: string;
}): Promise<unknown> {
  const config = providerConfig().calcom;
  const values = requireValues("Cal.com", {
    apiKey: config.apiKey,
    eventTypeId: config.eventTypeId,
  });
  const url = new URL(`${config.apiUrl}/slots`);
  url.searchParams.set("eventTypeId", values.eventTypeId);
  url.searchParams.set("start", input.start);
  url.searchParams.set("end", input.end);
  url.searchParams.set("timeZone", input.timeZone);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${values.apiKey}`,
      "cal-api-version": CAL_API_VERSION,
    },
  });
  return parseProviderResponse(response, "Cal.com");
}

export async function createCalBooking(input: {
  start: string;
  timeZone: string;
  attendee: { name: string; email: string; phoneNumber?: string };
  metadata: Record<string, string>;
}): Promise<{ bookingId: string }> {
  const config = providerConfig().calcom;
  const values = requireValues("Cal.com", {
    apiKey: config.apiKey,
    eventTypeId: config.eventTypeId,
  });
  const response = await fetch(`${config.apiUrl}/bookings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${values.apiKey}`,
      "Content-Type": "application/json",
      "cal-api-version": CAL_API_VERSION,
    },
    body: JSON.stringify({
      eventTypeId: Number(values.eventTypeId),
      start: input.start,
      // Cal.com v2 requires timezone inside the attendee object, not as a
      // top-level field — a top-level `timeZone` is silently ignored.
      attendee: { ...input.attendee, timeZone: input.timeZone },
      metadata: input.metadata,
    }),
  });
  const body = await parseProviderResponse<{
    data?: { id?: string | number; uid?: string; booking?: { id?: string | number } };
    id?: string | number;
    uid?: string;
    booking?: { id?: string | number };
  }>(response, "Cal.com");
  // Cal.com v2 wraps successful responses as { status: "success", data: {...} }.
  // The previous version of this adapter only checked body.id / body.booking.id,
  // so it rejected every real successful booking as an error. `uid` is the
  // stable identifier needed for later reschedule/cancel operations — prefer
  // it over the numeric `id` where both are present.
  const bookingId =
    body?.data?.uid ??
    body?.data?.id ??
    body?.data?.booking?.id ??
    body?.uid ??
    body?.id ??
    body?.booking?.id;
  if (bookingId == null) throw new ProviderRequestError("Cal.com did not return a booking id");
  return { bookingId: String(bookingId) };
}

/**
 * Verifies Cal.com's `x-cal-signature-256` header: a raw hex HMAC-SHA256
 * of the request body (optionally prefixed `sha256=`), keyed by the
 * webhook's configured secret.
 */
export function verifyCalSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string | undefined,
): boolean {
  if (!signatureHeader || !secret) return false;
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const providedBuffer = Buffer.from(provided.toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

// Used only for LeadSprint's own intake webhook, which is our contract, not
// an external provider's — keep this generic verifier for that one route.
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!signature || !secret) return false;
  const provided = signature.replace(/^sha256=/, "").trim();
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}