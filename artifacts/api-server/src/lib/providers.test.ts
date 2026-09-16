import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { extractRetellCall, verifyCalSignature, verifyRetellSignature } from "../lib/providers";

const API_KEY = "test_retell_api_key";

function signRetell(body: string, apiKey: string, timestampMs: number): string {
  const digest = crypto.createHmac("sha256", apiKey).update(body + String(timestampMs)).digest("hex");
  return `v=${timestampMs},d=${digest}`;
}

describe("verifyRetellSignature", () => {
  const body = JSON.stringify({ event: "call_ended", call: { call_id: "call_123" } });

  it("accepts a correctly signed, fresh request", () => {
    const now = Date.now();
    const header = signRetell(body, API_KEY, now);
    expect(verifyRetellSignature(Buffer.from(body), header, API_KEY)).toBe(true);
  });

  it("rejects a request signed with the wrong key", () => {
    const now = Date.now();
    const header = signRetell(body, "wrong_key", now);
    expect(verifyRetellSignature(Buffer.from(body), header, API_KEY)).toBe(false);
  });

  it("rejects a tampered body even with a valid-looking signature", () => {
    const now = Date.now();
    const header = signRetell(body, API_KEY, now);
    const tamperedBody = JSON.stringify({ event: "call_ended", call: { call_id: "call_999" } });
    expect(verifyRetellSignature(Buffer.from(tamperedBody), header, API_KEY)).toBe(false);
  });

  it("rejects a stale (replayed) signature outside the freshness window", () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    const header = signRetell(body, API_KEY, sixMinutesAgo);
    expect(verifyRetellSignature(Buffer.from(body), header, API_KEY)).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(verifyRetellSignature(Buffer.from(body), "not-the-right-format", API_KEY)).toBe(false);
    expect(verifyRetellSignature(Buffer.from(body), undefined, API_KEY)).toBe(false);
  });

  it("rejects when no api key is configured", () => {
    const header = signRetell(body, API_KEY, Date.now());
    expect(verifyRetellSignature(Buffer.from(body), header, undefined)).toBe(false);
  });

  // Regression: the previous verifier used a plain HMAC of the body alone,
  // with no timestamp and no v=/d= format, keyed by a separate webhook
  // secret. A correctly-signed real Retell webhook would have failed that
  // verifier every time. This test fails against that old implementation.
  it("rejects the old plain-HMAC scheme even with the right secret", () => {
    const oldStyleHeader = crypto.createHmac("sha256", API_KEY).update(body).digest("hex");
    expect(verifyRetellSignature(Buffer.from(body), oldStyleHeader, API_KEY)).toBe(false);
  });
});

describe("extractRetellCall", () => {
  it("pulls fields from the nested call object when present", () => {
    const envelope = { event: "call_ended", call: { call_id: "call_abc", call_status: "ended" } };
    expect(extractRetellCall(envelope)).toEqual({ call_id: "call_abc", call_status: "ended" });
  });

  it("falls back to the top-level body when call is absent (test fixtures without the wrapper)", () => {
    const flat = { call_id: "call_abc", call_status: "ended" };
    expect(extractRetellCall(flat)).toEqual(flat);
  });
});

describe("verifyCalSignature", () => {
  const secret = "cal_webhook_secret";
  const body = JSON.stringify({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "abc123" } });

  it("accepts a valid signature with the sha256= prefix", () => {
    const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyCalSignature(Buffer.from(body), `sha256=${digest}`, secret)).toBe(true);
  });

  it("accepts a valid signature without a prefix", () => {
    const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyCalSignature(Buffer.from(body), digest, secret)).toBe(true);
  });

  it("rejects a wrong secret", () => {
    const digest = crypto.createHmac("sha256", "other_secret").update(body).digest("hex");
    expect(verifyCalSignature(Buffer.from(body), digest, secret)).toBe(false);
  });

  // Regression: the old code never read x-cal-signature-256 at all — it only
  // checked x-retell-signature / x-leadsprint-signature — so Cal.com webhook
  // verification failed on every real request regardless of secret.
  it("is exactly what the x-cal-signature-256 header should be checked against", () => {
    const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyCalSignature(Buffer.from(body), digest, secret)).toBe(true);
  });
});
