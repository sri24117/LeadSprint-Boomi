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
      agent_id: values.agentId,
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
    headers: { Authorization: `Bearer ${values.apiKey}` },
  });
  return parseProviderResponse(response, "Cal.com");
}

export async function createCalBooking(input: {
  start: string;
  end: string;
  timeZone: string;
  attendee: { name: string; email: string; phone?: string };
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
    },
    body: JSON.stringify({
      eventTypeId: Number(values.eventTypeId),
      start: input.start,
      end: input.end,
      timeZone: input.timeZone,
      attendee: input.attendee,
      metadata: input.metadata,
    }),
  });
  const body = await parseProviderResponse<{
    id?: string | number;
    booking?: { id?: string | number };
  }>(response, "Cal.com");
  const bookingId = body?.id ?? body?.booking?.id;
  if (bookingId == null) throw new ProviderRequestError("Cal.com did not return a booking id");
  return { bookingId: String(bookingId) };
}

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