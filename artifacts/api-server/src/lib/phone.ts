import { parsePhoneNumberWithError, CountryCode } from "libphonenumber-js";

export interface PhoneNormalizationResult {
  raw: string;
  e164: string;
  valid: boolean;
  error?: string;
}

export type TimezoneProvenance = "explicit_intake" | "area_code_inferred" | "business_fallback";

export interface TimezoneResolutionResult {
  timezone: string | null;
  provenance: TimezoneProvenance;
  areaCode?: string;
}

/**
 * Normalizes an arbitrary phone string into an official E.164 formatted string (e.g., +15551234567).
 *
 * @param phone Raw input phone string from body, CSV, or webhook.
 * @param defaultCountry Default 2-letter ISO country code if no country code prefix (+X) is provided. Defaults to "US".
 */
export function normalizeToE164(
  phone: string | null | undefined,
  defaultCountry: CountryCode = "US",
): PhoneNormalizationResult {
  const raw = (phone ?? "").trim();
  if (!raw) {
    return {
      raw,
      e164: "",
      valid: false,
      error: "Phone number is required",
    };
  }

  try {
    const phoneNumber = parsePhoneNumberWithError(raw, defaultCountry);
    if (!phoneNumber.isValid()) {
      return {
        raw,
        e164: "",
        valid: false,
        error: `Invalid phone number format for country ${defaultCountry}`,
      };
    }

    return {
      raw,
      e164: phoneNumber.number, // Formatted as E.164 (+1...)
      valid: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid phone number";
    return {
      raw,
      e164: "",
      valid: false,
      error: message,
    };
  }
}

// Toll-free NPA area codes
const TOLL_FREE_AREA_CODES = new Set(["800", "888", "877", "866", "855", "844", "833"]);

// US NANP 3-digit Area Code Mapping to Primary IANA Timezones (Heuristic)
const EASTERN_AREA_CODES = new Set([
  "201", "202", "203", "207", "212", "215", "216", "239", "240", "248", "252", "267",
  "301", "302", "304", "305", "315", "330", "336", "339", "347", "351", "352", "386",
  "401", "404", "407", "410", "412", "413", "434", "440", "443", "470", "475", "478", "484",
  "508", "516", "518", "540", "561", "570", "585",
  "603", "607", "609", "610", "617", "631", "646", "678", "681",
  "703", "704", "706", "716", "717", "718", "724", "727", "732", "754", "757", "770", "772", "774", "781", "786",
  "802", "803", "804", "813", "814", "828", "843", "845", "848", "856", "860", "862", "864", "865",
  "904", "908", "910", "912", "914", "917", "919", "929", "937", "941", "954", "959", "973", "978", "980", "984", "989",
]);

const CENTRAL_AREA_CODES = new Set([
  "205", "210", "214", "217", "218", "219", "224", "225", "228", "251", "254", "256", "260", "262", "269", "270", "281",
  "308", "309", "312", "314", "316", "318", "319", "320", "331", "334", "337", "346", "361",
  "402", "405", "409", "414", "417", "430", "432", "469", "479",
  "501", "502", "504", "507", "512", "515", "531", "534", "539", "563", "573", "580",
  "601", "605", "608", "612", "615", "618", "620", "630", "636", "641", "651", "660", "662", "682",
  "701", "708", "712", "713", "715", "731", "737", "763", "765", "769", "773", "779",
  "812", "815", "816", "830", "832", "847", "850", "859", "870",
  "901", "903", "913", "918", "920", "931", "936", "940", "952", "956", "972", "979", "985",
]);

const MOUNTAIN_AREA_CODES = new Set([
  "303", "307", "385", "406", "435", "505", "575", "719", "720", "801", "970",
]);

const ARIZONA_AREA_CODES = new Set([
  "480", "520", "602", "623", "928",
]);

const PACIFIC_AREA_CODES = new Set([
  "206", "209", "213", "253", "310", "323", "360", "408", "415", "424", "425", "442",
  "503", "509", "510", "530", "541", "559", "562", "564",
  "619", "626", "628", "650", "657", "661", "669",
  "702", "707", "714", "725", "747", "760", "775",
  "805", "818", "820", "831", "858",
  "909", "916", "925", "949", "951", "971",
]);

const ALASKA_AREA_CODES = new Set(["907"]);
const HAWAII_AREA_CODES = new Set(["808"]);

/**
 * Infers recipient IANA timezone from US NANP phone number area code.
 *
 * NOTE: Area-code inference is a HEURISTIC based on historical North American
 * Numbering Plan assignment. It is NOT authoritative geographic location proof.
 *
 * @param phone E.164 or raw phone number string
 * @returns TimezoneResolutionResult containing inferred IANA timezone and provenance
 */
export function inferTimezoneFromPhone(phone: string | null | undefined): TimezoneResolutionResult {
  const norm = normalizeToE164(phone, "US");
  if (!norm.valid || !norm.e164.startsWith("+1") || norm.e164.length < 12) {
    return { timezone: null, provenance: "business_fallback" };
  }

  // Extract 3-digit area code from +1NXX...
  const areaCode = norm.e164.slice(2, 5);

  if (TOLL_FREE_AREA_CODES.has(areaCode)) {
    return { timezone: null, provenance: "business_fallback", areaCode };
  }
  if (EASTERN_AREA_CODES.has(areaCode)) {
    return { timezone: "America/New_York", provenance: "area_code_inferred", areaCode };
  }
  if (CENTRAL_AREA_CODES.has(areaCode)) {
    return { timezone: "America/Chicago", provenance: "area_code_inferred", areaCode };
  }
  if (MOUNTAIN_AREA_CODES.has(areaCode)) {
    return { timezone: "America/Denver", provenance: "area_code_inferred", areaCode };
  }
  if (ARIZONA_AREA_CODES.has(areaCode)) {
    return { timezone: "America/Phoenix", provenance: "area_code_inferred", areaCode };
  }
  if (PACIFIC_AREA_CODES.has(areaCode)) {
    return { timezone: "America/Los_Angeles", provenance: "area_code_inferred", areaCode };
  }
  if (ALASKA_AREA_CODES.has(areaCode)) {
    return { timezone: "America/Anchorage", provenance: "area_code_inferred", areaCode };
  }
  if (HAWAII_AREA_CODES.has(areaCode)) {
    return { timezone: "Pacific/Honolulu", provenance: "area_code_inferred", areaCode };
  }

  // Unmapped NANP or international
  return { timezone: null, provenance: "business_fallback", areaCode };
}

/**
 * Validates an IANA timezone identifier using Intl.DateTimeFormat.
 * Returns true only if the identifier is recognised by the JS runtime.
 */
export function isValidIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Canonical consent source vocabulary.
 * These are the ONLY values permitted to be persisted.
 */
export const CANONICAL_CONSENT_SOURCES = new Set([
  "web_form",
  "csv_import",
  "api_intake",
  "operator_verbal",
  "historical_import",
  "operator_console",
] as const);

export type CanonicalConsentSource = typeof CANONICAL_CONSENT_SOURCES extends Set<infer T> ? T : never;

/**
 * Validates a raw consent source string against the canonical vocabulary.
 *
 * Rules:
 *  - If rawSource is a canonical value → return it
 *  - If rawSource is absent/null/undefined → return the provided defaultSource
 *  - If rawSource is present but not canonical → return null (caller must reject)
 *
 * Never returns "unknown" or arbitrary strings.
 * NULL return value means: invalid source supplied — caller must reject/skip.
 */
export function validateConsentSource(
  rawSource: string | null | undefined,
  defaultSource: CanonicalConsentSource,
): CanonicalConsentSource | null {
  if (rawSource === null || rawSource === undefined || rawSource === "") {
    return defaultSource;
  }
  const trimmed = rawSource.trim();
  if (trimmed === "") {
    return defaultSource;
  }
  if (CANONICAL_CONSENT_SOURCES.has(trimmed as CanonicalConsentSource)) {
    return trimmed as CanonicalConsentSource;
  }
  // Non-empty, non-canonical → invalid
  return null;
}

/**
 * Parses a consent timestamp candidate.
 *
 * Rules:
 *  - If candidate is absent/null/undefined → return { date: now, wasSupplied: false }
 *  - If candidate is present and parses to a valid Date → return { date: parsed, wasSupplied: true }
 *  - If candidate is present but invalid → return { date: null, wasSupplied: true, invalid: true }
 *
 * The caller MUST check `invalid` and reject the row / reject the request accordingly.
 * new Date() (current time) is NEVER substituted for a supplied-but-invalid timestamp.
 */
export interface ConsentTimestampResult {
  date: Date | null;
  wasSupplied: boolean;
  invalid?: true;
}

export function parseConsentTimestamp(
  candidate: unknown,
): ConsentTimestampResult {
  if (candidate === null || candidate === undefined || candidate === "") {
    return { date: new Date(), wasSupplied: false };
  }
  if (typeof candidate === "string" || typeof candidate === "number") {
    const parsed = new Date(candidate as string | number);
    if (isNaN(parsed.getTime())) {
      return { date: null, wasSupplied: true, invalid: true };
    }
    return { date: parsed, wasSupplied: true };
  }
  // Unexpected type
  return { date: null, wasSupplied: true, invalid: true };
}
