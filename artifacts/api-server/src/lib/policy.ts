/**
 * Call policy gate — implements the non-negotiable safety rules from the
 * LeadSprint product plan (section 11 "Safety policy" / section 8 "n8n
 * workflows: 04 Error and safety"):
 *
 *   consent valid?
 *     -> not suppressed?
 *       -> recipient quiet hours? (if resolvable)
 *         -> business quiet hours?
 *           -> attempt limit available?
 *             -> provider kill switch off?
 *               -> usage minutes available?
 *                 -> enqueue call
 *
 * This runs before any outbound provider request (Retell/Twilio) is made,
 * so a business misconfiguration or a bad lead state fails closed instead
 * of placing a call it shouldn't.
 */

export type PolicyBlockReason =
  | "consent_invalid"
  | "suppressed"
  | "quiet_hours"
  | "attempt_limit"
  | "kill_switch"
  | "usage_limit";

export interface PolicyDecision {
  allowed: boolean;
  reason?: PolicyBlockReason;
  message?: string;
}

export interface PolicyBusinessInput {
  timezone: string;
  quietHours: string | null | undefined;
  maxCallAttempts: number;
  includedVoiceMinutes?: number;
  currentVoiceMinutes?: number;
  callingPaused?: boolean | null;
}

export interface PolicyContactInput {
  consentStatus: string;
  suppressedAt: Date | null;
  recipientTimezone?: string | null;
  timezoneProvenance?: "explicit_intake" | "area_code_inferred" | "business_fallback" | string | null;
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

  if (business.callingPaused === true) {
    return {
      allowed: false,
      reason: "kill_switch",
      message: "Outbound calling is paused for this workspace.",
    };
  }

  if (isKillSwitchEngaged()) {
    return {
      allowed: false,
      reason: "kill_switch",
      message: "LEADSPRINT_KILL_SWITCH is engaged; all outbound calling is paused.",
    };
  }

  // Dual-gate quiet hours:
  // Gate 1: Recipient timezone (when resolvable and not falling back to business timezone)
  if (
    contact.recipientTimezone &&
    contact.timezoneProvenance &&
    contact.timezoneProvenance !== "business_fallback"
  ) {
    if (isWithinQuietHours(business.quietHours, contact.recipientTimezone, now)) {
      return {
        allowed: false,
        reason: "quiet_hours",
        message: `Outside allowed calling hours for recipient timezone (${business.quietHours} ${contact.recipientTimezone}).`,
      };
    }
  }

  // Gate 2: Business timezone
  if (isWithinQuietHours(business.quietHours, business.timezone, now)) {
    return {
      allowed: false,
      reason: "quiet_hours",
      message: `Outside allowed calling hours for business timezone (${business.quietHours} ${business.timezone}).`,
    };
  }

  if (
    business.includedVoiceMinutes !== undefined &&
    business.currentVoiceMinutes !== undefined &&
    business.currentVoiceMinutes >= business.includedVoiceMinutes
  ) {
    return {
      allowed: false,
      reason: "usage_limit",
      message: `Voice minutes entitlement (${business.includedVoiceMinutes}m) exhausted for this billing period (used: ${business.currentVoiceMinutes.toFixed(1)}m).`,
    };
  }

  return { allowed: true };
}
