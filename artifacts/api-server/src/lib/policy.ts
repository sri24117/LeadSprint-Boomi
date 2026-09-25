/**
 * Call policy gate — implements the non-negotiable safety rules from the
 * LeadSprint product plan (section 11 "Safety policy" / section 8 "n8n
 * workflows: 04 Error and safety"):
 *
 *   consent valid?
 *     -> not suppressed?
 *       -> within quiet hours?
 *         -> attempt limit available?
 *           -> provider kill switch off?
 *             -> enqueue call
 *
 * This runs before any outbound provider request (Retell/Twilio) is made,
 * so a business misconfiguration or a bad lead state fails closed instead
 * of placing a call it shouldn't.
 */

export type PolicyBlockReason =
  | "consent_invalid"
  | "suppressed"
  | "location_unknown"
  | "quiet_hours"
  | "attempt_limit"
  | "kill_switch";

export interface PolicyDecision {
  allowed: boolean;
  reason?: PolicyBlockReason;
  message?: string;
}

export interface PolicyBusinessInput {
  timezone: string;
  quietHours: string | null | undefined;
  maxCallAttempts: number;
}

export interface PolicyContactInput {
  consentStatus: string;
  suppressedAt: Date | null;
  // The CALLED PARTY's IANA timezone (see lib/areaCodeTimezones.ts) — not
  // the business's. TCPA quiet hours (8am–9pm) are defined by the
  // recipient's local time. `null`/`undefined` means we couldn't
  // determine it, which blocks the call rather than falling back to the
  // business's timezone — an unverified location is treated the same as
  // an unsafe one, per the product spec's "block ambiguous or invalid
  // location data" requirement.
  timezone: string | null | undefined;
}

/**
 * Parses a "HH:MM–HH:MM" / "HH:MM-HH:MM" quiet-hours window (24h clock,
 * business-local time) and reports whether `now` falls inside it. Handles
 * overnight windows such as 21:00–08:00.
 */
export function isWithinQuietHours(
  quietHours: string | null | undefined,
  timezone: string,
  now: Date = new Date(),
): boolean {
  if (!quietHours) return false;
  const match = quietHours
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const [, startH, startM, endH, endM] = match;

  let localHour: number;
  let localMinute: number;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    localHour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    localMinute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  } catch {
    localHour = now.getUTCHours();
    localMinute = now.getUTCMinutes();
  }

  const nowMinutes = localHour * 60 + localMinute;
  const startMinutes = Number(startH) * 60 + Number(startM);
  const endMinutes = Number(endH) * 60 + Number(endM);

  if (startMinutes === endMinutes) return false; // degenerate window, never blocks
  if (startMinutes < endMinutes) {
    // Same-day window, e.g. 09:00–17:00
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Overnight window, e.g. 21:00–08:00
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/**
 * The instant the current quiet-hours block ends — i.e. when it becomes
 * lawful to call this recipient again — or `now` when the window is already
 * open.
 *
 * This exists because a retry that fires on a fixed timer cannot cross a
 * night: a lead that arrives at 22:00 is blocked until 08:00, which is ten
 * 30-minute worker ticks away, so a fixed-interval retry gives up long
 * before the window opens and that enquiry is never called. Deferring to
 * the opening of the window is what makes "retry a call blocked by quiet
 * hours" mean something.
 *
 * Stepped rather than solved analytically so it stays correct across DST
 * transitions and half-hour offsets: `isWithinQuietHours` is the single
 * definition of "blocked", and this walks forward until it stops being
 * true. Resolves to within `stepMs` of the real opening.
 */
export function nextAllowedCallTime(
  quietHours: string | null | undefined,
  timezone: string,
  now: Date = new Date(),
  stepMs = 5 * 60 * 1000,
): Date {
  if (!isWithinQuietHours(quietHours, timezone, now)) return now;
  const limit = now.getTime() + 24 * 60 * 60 * 1000;
  for (let t = now.getTime() + stepMs; t <= limit; t += stepMs) {
    if (!isWithinQuietHours(quietHours, timezone, new Date(t))) {
      // One minute past the boundary, so the retry cannot land a second
      // before the window opens and read as still-blocked.
      return new Date(t + 60 * 1000);
    }
  }
  // A window that is 24h wide is a misconfiguration; block, don't guess.
  return new Date(limit);
}

export function isKillSwitchEngaged(): boolean {
  const value = process.env["LEADSPRINT_KILL_SWITCH"]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "on";
}

export function evaluateCallPolicy(input: {
  business: PolicyBusinessInput;
  contact: PolicyContactInput;
  attemptsSoFar: number;
  now?: Date;
}): PolicyDecision {
  const { business, contact, attemptsSoFar } = input;
  const now = input.now ?? new Date();

  if (contact.consentStatus !== "valid") {
    return {
      allowed: false,
      reason: "consent_invalid",
      message: "Contact consent is not valid for outbound contact.",
    };
  }

  if (contact.suppressedAt) {
    return {
      allowed: false,
      reason: "suppressed",
      message: "This contact is suppressed and cannot be called.",
    };
  }

  if (!contact.timezone) {
    return {
      allowed: false,
      reason: "location_unknown",
      message: "Could not determine the recipient's timezone; blocking rather than guessing.",
    };
  }

  if (isWithinQuietHours(business.quietHours, contact.timezone, now)) {
    return {
      allowed: false,
      reason: "quiet_hours",
      message: `Outside allowed calling hours (${business.quietHours} ${contact.timezone}, recipient local time).`,
    };
  }

  if (attemptsSoFar >= business.maxCallAttempts) {
    return {
      allowed: false,
      reason: "attempt_limit",
      message: `Maximum call attempts (${business.maxCallAttempts}) already reached for this lead.`,
    };
  }

  if (isKillSwitchEngaged()) {
    return {
      allowed: false,
      reason: "kill_switch",
      message: "LEADSPRINT_KILL_SWITCH is engaged; all outbound calling is paused.",
    };
  }

  return { allowed: true };
}
