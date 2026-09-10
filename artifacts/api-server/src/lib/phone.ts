import { parsePhoneNumberWithError, CountryCode } from "libphonenumber-js";

export interface PhoneNormalizationResult {
  raw: string;
  e164: string;
  valid: boolean;
  error?: string;
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
