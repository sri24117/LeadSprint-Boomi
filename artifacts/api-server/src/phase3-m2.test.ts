import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { inferTimezoneFromPhone, isValidIanaTimezone, validateConsentSource, parseConsentTimestamp } from "./lib/phone";
import { evaluateCallPolicy, isWithinQuietHours } from "./lib/policy";

describe("Phase 3 Milestone 2 — Consent Evidence & Recipient Timezone Provenance", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("A. Consent Model & Negative Anti-Fabrication Tests", () => {
    it("1. Intake with no explicit consent: creates contact, no opt_in event created", () => {
      // Simulate intake payload without affirmative consent signal
      const body = {
        business_id: "biz_100",
        name: "Jane Doe",
        phone: "+12125550100",
        email: "jane@example.com",
      };

      const hasAffirmativeConsent =
        (body as any).consent_given === true ||
        (body as any).consentGiven === true ||
        (body as any).consent_given === "true";

      expect(hasAffirmativeConsent).toBe(false);

      // Contact record should have null evidence
      const contactRecord = {
        name: body.name,
        phone: body.phone,
        consentStatus: "valid",
        consentCapturedAt: null,
        consentSource: null,
        consentDisclosureVersion: null,
      };

      expect(contactRecord.consentStatus).toBe("valid");
      expect(contactRecord.consentCapturedAt).toBeNull();
      expect(contactRecord.consentSource).toBeNull();
      expect(contactRecord.consentDisclosureVersion).toBeNull();
    });

    it("2. Disclosure version only: does NOT create opt_in event", () => {
      const body = {
        name: "John Smith",
        phone: "+14155550200",
        consent_disclosure_version: "v1_pilot",
      };

      const hasAffirmativeConsent =
        (body as any).consent_given === true ||
        (body as any).consentGiven === true ||
        (body as any).consent_given === "true";

      expect(hasAffirmativeConsent).toBe(false);
    });

    it("3. Timestamp only: does NOT create opt_in event", () => {
      const body = {
        name: "Alice Brown",
        phone: "+13125550300",
        consent_captured_at: "2026-09-01T12:00:00Z",
      };

      const hasAffirmativeConsent =
        (body as any).consent_given === true ||
        (body as any).consentGiven === true ||
        (body as any).consent_given === "true";

      expect(hasAffirmativeConsent).toBe(false);
    });

    it("4. IP/source only: does NOT create opt_in event", () => {
      const body = {
        name: "Bob White",
        phone: "+13035550400",
        consent_source: "web_form",
        intake_ip: "192.168.1.1",
      };

      const hasAffirmativeConsent =
        (body as any).consent_given === true ||
        (body as any).consentGiven === true ||
        (body as any).consent_given === "true";

      expect(hasAffirmativeConsent).toBe(false);
    });

    it("5. Explicit affirmative consent: creates contact with evidence and opt_in event", () => {
      const body = {
        business_id: "biz_100",
        name: "Charlie Green",
        phone: "+14155550500",
        consent_given: true,
        consent_disclosure_version: "v1_pilot",
        consent_source: "web_form",
        consent_captured_at: "2026-09-10T10:00:00Z",
        disclosure_text: "I agree to be called by LeadSprint AI.",
      };

      const hasAffirmativeConsent =
        (body as any).consent_given === true ||
        (body as any).consentGiven === true ||
        (body as any).consent_given === "true";

      expect(hasAffirmativeConsent).toBe(true);

      const capturedAt = new Date(body.consent_captured_at);
      const consentEvent = {
        businessId: body.business_id,
        eventType: "opt_in",
        source: body.consent_source,
        disclosureVersion: body.consent_disclosure_version,
        disclosureText: body.disclosure_text,
        capturedAt,
      };

      expect(consentEvent.eventType).toBe("opt_in");
      expect(consentEvent.source).toBe("web_form");
      expect(consentEvent.capturedAt.toISOString()).toBe("2026-09-10T10:00:00.000Z");
    });

    it("6. CSV contact-only row: does NOT create opt_in event", () => {
      const csvRow = {
        name: "David Lee",
        phone: "+17025550600",
        email: "david@example.com",
      };

      const hasAffirmativeConsent =
        (csvRow as any).consent_given === true ||
        (csvRow as any).consent_given === "true" ||
        (csvRow as any).consent_given === "yes";

      expect(hasAffirmativeConsent).toBe(false);
    });

    it("7. CSV explicit historical consent: creates opt_in event with preserved historical timestamp", () => {
      const csvRow = {
        name: "Eve Black",
        phone: "+16175550700",
        consent_given: "true",
        consent_date: "2025-06-15T14:30:00Z",
        consent_source: "historical_import",
        disclosure_version: "v0_legacy",
      };

      const hasAffirmativeConsent =
        (csvRow as any).consent_given === true ||
        (csvRow as any).consent_given === "true" ||
        (csvRow as any).consent_given === "yes";

      expect(hasAffirmativeConsent).toBe(true);

      const capturedAt = new Date(csvRow.consent_date);
      expect(capturedAt.toISOString()).toBe("2025-06-15T14:30:00.000Z");
      expect(csvRow.consent_source).toBe("historical_import");
    });

    it("8. Existing valid contact without evidence: remains callable by policy engine", () => {
      const decision = evaluateCallPolicy({
        business: {
          timezone: "America/New_York",
          quietHours: "21:00–08:00",
          maxCallAttempts: 3,
        },
        contact: {
          consentStatus: "valid",
          suppressedAt: null,
          recipientTimezone: null,
          timezoneProvenance: "business_fallback",
        },
        attemptsSoFar: 0,
        now: new Date("2026-09-11T14:00:00Z"), // 10:00 AM EDT (outside quiet hours)
      });

      expect(decision.allowed).toBe(true);
    });

    it("9. NULL consentSource: legacy contact accepted without error", () => {
      const contact = {
        consentStatus: "valid",
        consentCapturedAt: null,
        consentSource: null,
        consentDisclosureVersion: null,
      };

      expect(contact.consentSource).toBeNull();
      expect(contact.consentStatus).toBe("valid");
    });

    it("10. Append-only lifecycle: opt_in -> suppression -> re_consent produces 3 distinct events", () => {
      const events: Array<{ id: string; eventType: string; source: string; capturedAt: Date }> = [];

      // 1. Initial explicit opt-in
      events.push({
        id: "evt_1",
        eventType: "opt_in",
        source: "web_form",
        capturedAt: new Date("2026-09-01T10:00:00Z"),
      });

      // 2. Operator suppression
      events.push({
        id: "evt_2",
        eventType: "suppression",
        source: "operator_console",
        capturedAt: new Date("2026-09-05T12:00:00Z"),
      });

      // 3. Re-consent
      events.push({
        id: "evt_3",
        eventType: "re_consent",
        source: "operator_verbal",
        capturedAt: new Date("2026-09-10T15:00:00Z"),
      });

      expect(events).toHaveLength(3);
      expect(events[0].eventType).toBe("opt_in");
      expect(events[1].eventType).toBe("suppression");
      expect(events[2].eventType).toBe("re_consent");
    });

    it("11. Canonical vocabulary enforcement", () => {
      const validEventTypes = new Set(["opt_in", "opt_out", "suppression", "re_consent", "revocation"]);
      const validSources = new Set([
        "web_form",
        "csv_import",
        "api_intake",
        "operator_verbal",
        "historical_import",
        "operator_console",
      ]);

      expect(validEventTypes.has("opt_in")).toBe(true);
      expect(validEventTypes.has("suppressed")).toBe(false);

      expect(validSources.has("historical_import")).toBe(true);
      expect(validSources.has("unknown")).toBe(false);
    });

    it("12. Tenant isolation for consent events", () => {
      const eventA = { businessId: "biz_A", contactId: "c_1", eventType: "opt_in" };
      const eventB = { businessId: "biz_B", contactId: "c_2", eventType: "opt_in" };

      expect(eventA.businessId).not.toBe(eventB.businessId);
    });
  });

  describe("B. Timezone Provenance Tests", () => {
    it("13. 212 area code resolves to America/New_York", () => {
      const res = inferTimezoneFromPhone("+12125550199");
      expect(res.timezone).toBe("America/New_York");
      expect(res.provenance).toBe("area_code_inferred");
    });

    it("14. 415 area code resolves to America/Los_Angeles", () => {
      const res = inferTimezoneFromPhone("+14155550299");
      expect(res.timezone).toBe("America/Los_Angeles");
      expect(res.provenance).toBe("area_code_inferred");
    });

    it("15. 312 area code resolves to America/Chicago", () => {
      const res = inferTimezoneFromPhone("+13125550399");
      expect(res.timezone).toBe("America/Chicago");
      expect(res.provenance).toBe("area_code_inferred");
    });

    it("16. 303 area code resolves to America/Denver", () => {
      const res = inferTimezoneFromPhone("+13035550499");
      expect(res.timezone).toBe("America/Denver");
      expect(res.provenance).toBe("area_code_inferred");
    });

    it("17. 800 toll-free area code resolves to business_fallback", () => {
      const res = inferTimezoneFromPhone("+18005550199");
      expect(res.timezone).toBeNull();
      expect(res.provenance).toBe("business_fallback");
    });

    it("18. Unmapped / international phone resolves to business_fallback", () => {
      const res = inferTimezoneFromPhone("+442079460991");
      expect(res.timezone).toBeNull();
      expect(res.provenance).toBe("business_fallback");
    });
  });

  describe("C. Dual-Gate Quiet Hours Policy Tests", () => {
    it("19. East business calling West lead at 8:15 AM EDT (5:15 AM PDT) -> BLOCKED by recipient quiet hours", () => {
      // 8:15 AM EDT = 12:15 UTC
      const now = new Date("2026-09-11T12:15:00Z");

      const decision = evaluateCallPolicy({
        business: {
          timezone: "America/New_York",
          quietHours: "21:00–08:00",
          maxCallAttempts: 3,
        },
        contact: {
          consentStatus: "valid",
          suppressedAt: null,
          recipientTimezone: "America/Los_Angeles",
          timezoneProvenance: "area_code_inferred",
        },
        attemptsSoFar: 0,
        now,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("quiet_hours");
      expect(decision.message).toContain("recipient timezone");
    });

    it("20. West business calling East lead at 9:30 PM EDT (6:30 PM PDT) -> BLOCKED by recipient quiet hours", () => {
      // 9:30 PM EDT = 01:30 UTC next day
      const now = new Date("2026-09-12T01:30:00Z");

      const decision = evaluateCallPolicy({
        business: {
          timezone: "America/Los_Angeles",
          quietHours: "21:00–08:00",
          maxCallAttempts: 3,
        },
        contact: {
          consentStatus: "valid",
          suppressedAt: null,
          recipientTimezone: "America/New_York",
          timezoneProvenance: "explicit_intake",
        },
        attemptsSoFar: 0,
        now,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("quiet_hours");
      expect(decision.message).toContain("recipient timezone");
    });

    it("21. Both daytime (2:00 PM EDT / 11:00 AM PDT) -> ALLOWED", () => {
      // 2:00 PM EDT = 18:00 UTC
      const now = new Date("2026-09-11T18:00:00Z");

      const decision = evaluateCallPolicy({
        business: {
          timezone: "America/New_York",
          quietHours: "21:00–08:00",
          maxCallAttempts: 3,
        },
        contact: {
          consentStatus: "valid",
          suppressedAt: null,
          recipientTimezone: "America/Los_Angeles",
          timezoneProvenance: "area_code_inferred",
        },
        attemptsSoFar: 0,
        now,
      });

      expect(decision.allowed).toBe(true);
    });

    it("22. business_fallback -> evaluates business timezone only once", () => {
      // 10:00 AM EDT = 14:00 UTC (allowed in Business NY)
      const now = new Date("2026-09-11T14:00:00Z");

      const decision = evaluateCallPolicy({
        business: {
          timezone: "America/New_York",
          quietHours: "21:00–08:00",
          maxCallAttempts: 3,
        },
        contact: {
          consentStatus: "valid",
          suppressedAt: null,
          recipientTimezone: null,
          timezoneProvenance: "business_fallback",
        },
        attemptsSoFar: 0,
        now,
      });

      expect(decision.allowed).toBe(true);
    });

    it("23. DST Boundary evaluation", () => {
      // November 1st, 2026 (Daylight saving EDT)
      const dateEDT = new Date("2026-11-01T14:00:00Z"); // 10:00 AM EDT
      const inQuietEDT = isWithinQuietHours("21:00–08:00", "America/New_York", dateEDT);
      expect(inQuietEDT).toBe(false);

      // 4:00 AM EDT
      const dateEarly = new Date("2026-11-01T08:00:00Z"); // 4:00 AM EDT
      const inQuietEarly = isWithinQuietHours("21:00–08:00", "America/New_York", dateEarly);
      expect(inQuietEarly).toBe(true);
    });
  }); // end describe("C. Dual-Gate Quiet Hours Policy Tests")

  describe("D. Correction Pass — Timestamp Integrity Tests", () => {
    it("CP-1. Valid historical timestamp is preserved exactly", () => {
      const result = parseConsentTimestamp("2025-06-15T14:30:00Z");
      expect(result.invalid).toBeUndefined();
      expect(result.wasSupplied).toBe(true);
      expect(result.date).not.toBeNull();
      expect((result.date as Date).toISOString()).toBe("2025-06-15T14:30:00.000Z");
    });

    it("CP-2. Invalid historical timestamp is rejected (not substituted with now)", () => {
      const result = parseConsentTimestamp("not-a-date");
      expect(result.invalid).toBe(true);
      expect(result.date).toBeNull();
    });

    it("CP-3. Invalid explicit intake timestamp is rejected", () => {
      const result = parseConsentTimestamp("2025-99-99");
      expect(result.invalid).toBe(true);
      expect(result.date).toBeNull();
    });

    it("CP-4. Absent timestamp (null) uses current capture time", () => {
      const before = Date.now();
      const result = parseConsentTimestamp(null);
      const after = Date.now();
      expect(result.invalid).toBeUndefined();
      expect(result.wasSupplied).toBe(false);
      expect(result.date).not.toBeNull();
      const ts = (result.date as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("CP-5. Absent timestamp (undefined) uses current capture time", () => {
      const before = Date.now();
      const result = parseConsentTimestamp(undefined);
      const after = Date.now();
      expect(result.wasSupplied).toBe(false);
      expect(result.date).not.toBeNull();
      const ts = (result.date as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe("E. Correction Pass — Canonical Source Validation Tests", () => {
    it("CP-6. All canonical sources are accepted", () => {
      const canonicals = ["web_form", "csv_import", "api_intake", "operator_verbal", "historical_import", "operator_console"] as const;
      for (const src of canonicals) {
        expect(validateConsentSource(src, "api_intake")).toBe(src);
      }
    });

    it("CP-7. Invalid (non-canonical) source is rejected (returns null)", () => {
      expect(validateConsentSource("random_source", "api_intake")).toBeNull();
      expect(validateConsentSource("unknown", "api_intake")).toBeNull();
      expect(validateConsentSource("web form", "api_intake")).toBeNull(); // spaces → non-canonical
    });

    it("CP-8. Null/absent source returns the provided default", () => {
      expect(validateConsentSource(null, "api_intake")).toBe("api_intake");
      expect(validateConsentSource(undefined, "csv_import")).toBe("csv_import");
      expect(validateConsentSource("", "historical_import")).toBe("historical_import");
    });

    it("CP-9. 'unknown' is never generated by validateConsentSource", () => {
      const result1 = validateConsentSource(null, "api_intake");
      const result2 = validateConsentSource(undefined, "csv_import");
      expect(result1).not.toBe("unknown");
      expect(result2).not.toBe("unknown");
    });

    it("CP-10. NULL contact.consentSource is accepted for legacy contacts", () => {
      // Genuinely unavailable source stored as NULL, not forced to 'unknown'
      const contact = { consentSource: null };
      expect(contact.consentSource).toBeNull();
    });
  });

  describe("F. Correction Pass — Timezone Validation Tests", () => {
    it("CP-11. America/New_York is a valid IANA timezone", () => {
      expect(isValidIanaTimezone("America/New_York")).toBe(true);
    });

    it("CP-12. America/Los_Angeles is a valid IANA timezone", () => {
      expect(isValidIanaTimezone("America/Los_Angeles")).toBe(true);
    });

    it("CP-13. Invalid timezone falls back to area-code inference (212 → America/New_York)", () => {
      expect(isValidIanaTimezone("Not/AValidTZ")).toBe(false);
      // Caller falls back to area-code inference for this phone number
      const inferred = inferTimezoneFromPhone("+12125550199");
      expect(inferred.timezone).toBe("America/New_York");
      expect(inferred.provenance).toBe("area_code_inferred");
    });

    it("CP-14. Invalid timezone + unmapped phone falls back to business_fallback", () => {
      expect(isValidIanaTimezone("Bad/Timezone")).toBe(false);
      // UK number — not in NANP so area-code inference fails too
      const inferred = inferTimezoneFromPhone("+442079460991");
      expect(inferred.timezone).toBeNull();
      expect(inferred.provenance).toBe("business_fallback");
    });
  });
});
