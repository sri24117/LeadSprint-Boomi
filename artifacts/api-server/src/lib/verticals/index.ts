import { homeServicesProfile } from "./homeServices";
import { realEstateProfile } from "./realEstate";
import type { VerticalId, VerticalProfile } from "./types";

export type { ProfileField, VerticalId, VerticalProfile } from "./types";

export const VERTICAL_IDS: VerticalId[] = ["real_estate", "home_services"];

const PROFILES: Record<VerticalId, VerticalProfile> = {
  real_estate: realEstateProfile,
  home_services: homeServicesProfile,
};

/** Unknown, empty or missing ids fall back to real estate (the original behaviour). */
export function getProfile(verticalId: string | null | undefined): VerticalProfile {
  return PROFILES[verticalId as VerticalId] ?? realEstateProfile;
}

export function isVerticalId(value: unknown): value is VerticalId {
  return typeof value === "string" && (VERTICAL_IDS as string[]).includes(value);
}

/** The profile as the API exposes it: no code-only members such as emergency keywords. */
export function toApiProfile(profile: VerticalProfile) {
  return {
    id: profile.id,
    label: profile.label,
    appointment_label: profile.appointmentLabel,
    urgency_levels: profile.urgencyLevels.map((u) => ({ value: u.value, label: u.label })),
    fields: profile.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options?.map((o) => ({ value: o.value, label: o.label })) ?? [],
      in_list: f.inList,
      storage: f.storage,
    })),
  };
}

/**
 * Urgency for a lead: a supplied valid level wins; otherwise an emergency
 * keyword in the problem text makes it an emergency; otherwise "this_week".
 * Returns null for a vertical with no urgency levels.
 *
 * Errs toward safety on purpose: a false emergency costs an extra email, a
 * missed one can cost a home.
 */
export function classifyUrgency(
  profile: VerticalProfile,
  input: { urgency?: unknown; problem?: unknown },
): string | null {
  if (profile.urgencyLevels.length === 0) return null;
  const levels = profile.urgencyLevels.map((u) => u.value);
  if (typeof input.urgency === "string" && levels.includes(input.urgency)) return input.urgency;
  const problem = typeof input.problem === "string" ? input.problem.toLowerCase() : "";
  if (problem && profile.emergencyKeywords.some((keyword) => problem.includes(keyword))) {
    return "emergency";
  }
  return "this_week";
}

export type DetailsValue = string | number | boolean;
export type DetailsResult =
  | { ok: true; details: Record<string, DetailsValue> }
  | { ok: false; error: string };

const MAX_DETAIL_KEYS = 20;
const MAX_KEY_LENGTH = 40;
const MAX_VALUE_LENGTH = 500;

/**
 * Validates the flexible `details` object an intake sender supplies: a flat
 * object, at most 20 keys, keys of 1-40 characters, and values that are
 * strings of at most 500 characters, finite numbers, or booleans.
 */
export function validateDetails(input: unknown): DetailsResult {
  if (input === undefined) return { ok: true, details: {} };
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "details must be an object of simple values." };
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_DETAIL_KEYS) {
    return { ok: false, error: `details may have at most ${MAX_DETAIL_KEYS} keys.` };
  }
  const details: Record<string, DetailsValue> = {};
  for (const [key, value] of entries) {
    if (key.length < 1 || key.length > MAX_KEY_LENGTH) {
      return { ok: false, error: `details keys must be 1 to ${MAX_KEY_LENGTH} characters.` };
    }
    if (typeof value === "string") {
      if (value.length > MAX_VALUE_LENGTH) {
        return { ok: false, error: `details values may be at most ${MAX_VALUE_LENGTH} characters ("${key}").` };
      }
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) return { ok: false, error: `details value "${key}" must be a finite number.` };
    } else if (typeof value !== "boolean") {
      return { ok: false, error: `details value "${key}" must be a string, number or boolean.` };
    }
    details[key] = value as DetailsValue;
  }
  return { ok: true, details };
}

/**
 * True only when the business has a service area, the lead supplied a ZIP, and
 * that ZIP matches none of the entries (an entry matches when the ZIP starts
 * with it, so 3-digit prefixes and exact 5-digit ZIPs both work). A missing
 * ZIP is never "out of area": the voice agent asks.
 */
export function isOutOfArea(
  serviceAreaZips: string[],
  details: { zip?: unknown; address?: unknown },
): boolean {
  if (serviceAreaZips.length === 0) return false;
  const zip = leadZip(details);
  if (!zip) return false;
  return !serviceAreaZips.some((entry) => zip.startsWith(entry));
}

function leadZip(details: { zip?: unknown; address?: unknown }): string | null {
  if (typeof details.zip === "string") {
    const fromZip = details.zip.match(/\d{5}/);
    if (fromZip) return fromZip[0];
  }
  if (typeof details.address === "string") {
    // A standalone 5-digit run only: a phone number or longer id is not a ZIP.
    const fromAddress = details.address.match(/(?<!\d)\d{5}(?!\d)/);
    if (fromAddress) return fromAddress[0];
  }
  return null;
}
