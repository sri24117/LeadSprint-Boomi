import { describe, expect, it } from "vitest";
import {
  ConsentEvidenceError,
  describeConsent,
  normalizeConsentEvidence,
} from "./consent";

describe("normalizeConsentEvidence", () => {
  it("defaults to unknown when no status is supplied", () => {
    const result = normalizeConsentEvidence({});
    expect(result.consentStatus).toBe("unknown");
    expect(result.consentAt).toBeNull();
  });

  it("never upgrades an unrecognized status to valid", () => {
    expect(normalizeConsentEvidence({ status: "yes" }).consentStatus).toBe("unknown");
    expect(normalizeConsentEvidence({ status: true }).consentStatus).toBe("unknown");
    expect(normalizeConsentEvidence({ status: "VALID" }).consentStatus).toBe("unknown");
  });

  it("rejects valid consent that has no recorded source", () => {
    expect(() => normalizeConsentEvidence({ status: "valid" })).toThrow(ConsentEvidenceError);
    expect(() => normalizeConsentEvidence({ status: "valid", source: "   " })).toThrow(
      ConsentEvidenceError,
    );
  });

  it("accepts valid consent with a source and stamps the capture time", () => {
    const now = new Date("2026-09-16T10:00:00Z");
    const result = normalizeConsentEvidence({
      status: "valid",
      source: "web_form:listing-enquiry",
      now,
    });
    expect(result).toEqual({
      consentStatus: "valid",
      consentSource: "web_form:listing-enquiry",
      consentAt: now,
    });
  });

  it("uses an explicitly supplied capture timestamp", () => {
    const result = normalizeConsentEvidence({
      status: "valid",
      source: "web_form",
      at: "2026-09-01T08:30:00Z",
    });
    expect(result.consentAt?.toISOString()).toBe("2026-09-01T08:30:00.000Z");
  });

  it("rejects an unparseable capture timestamp", () => {
    expect(() =>
      normalizeConsentEvidence({ status: "valid", source: "web_form", at: "last tuesday" }),
    ).toThrow(ConsentEvidenceError);
  });

  it("records revocation with a timestamp", () => {
    const now = new Date("2026-09-16T10:00:00Z");
    const result = normalizeConsentEvidence({ status: "revoked", now });
    expect(result.consentStatus).toBe("revoked");
    expect(result.consentAt).toEqual(now);
  });

  it("truncates an over-long source rather than storing it whole", () => {
    const result = normalizeConsentEvidence({
      status: "valid",
      source: "x".repeat(500),
    });
    expect(result.consentSource).toHaveLength(200);
  });
});

describe("describeConsent", () => {
  it("explains why an unknown contact cannot be called", () => {
    expect(describeConsent({ consentStatus: "unknown" })).toContain("blocked");
  });

  it("names the source and date for a valid contact", () => {
    const text = describeConsent({
      consentStatus: "valid",
      consentSource: "web_form:listing-enquiry",
      consentAt: new Date("2026-09-01T08:30:00Z"),
    });
    expect(text).toContain("web_form:listing-enquiry");
    expect(text).toContain("2026-09-01");
  });

  it("is unambiguous about revoked consent", () => {
    expect(describeConsent({ consentStatus: "revoked" })).toContain("must not be called");
  });
});
