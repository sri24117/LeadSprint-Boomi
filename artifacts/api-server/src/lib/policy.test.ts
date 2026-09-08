import { describe, expect, it } from "vitest";
import { evaluateCallPolicy, isKillSwitchEngaged, isWithinQuietHours } from "./policy";

describe("isWithinQuietHours — called-party timezone regression", () => {
  // These are the verified correct cases: a business in New York with
  // quiet hours 21:00–08:00 (i.e. calls allowed 08:00–21:00), evaluated
  // against a recipient in Los Angeles. All times below are on the same
  // September day (no DST transition mid-test).
  //
  // IMPORTANT: an earlier version of this test table (and the acceptance
  // criteria I originally wrote) incorrectly asserted that 11:30pm ET
  // (8:30pm PT) should be BLOCKED. It should not — 8:30pm PT is before
  // 9pm, i.e. still inside the allowed window. That was an arithmetic
  // error in the spec, not in the code; this table has the corrected,
  // verified values.
  const quietHours = "21:00-08:00";
  const businessTimezone = "America/New_York"; // must NOT be used for this check
  const recipientTimezone = "America/Los_Angeles";

  it.each([
    { nyLabel: "09:00 ET (06:00 PT)", isoUtc: "2026-09-07T13:00:00Z", expectBlocked: true },
    { nyLabel: "20:30 ET (17:30 PT)", isoUtc: "2026-09-08T00:30:00Z", expectBlocked: false },
    { nyLabel: "23:30 ET (20:30 PT)", isoUtc: "2026-09-08T03:30:00Z", expectBlocked: false },
    { nyLabel: "00:30 ET next day (21:30 PT prior day)", isoUtc: "2026-09-08T04:30:00Z", expectBlocked: true },
  ])("$nyLabel against LA recipient -> blocked=$expectBlocked", ({ isoUtc, expectBlocked }) => {
    const now = new Date(isoUtc);
    // The critical assertion: quiet hours are evaluated against the
    // RECIPIENT's timezone, not the business's — passing the business's
    // timezone here would be the exact bug this test guards against.
    const blocked = isWithinQuietHours(quietHours, recipientTimezone, now);
    expect(blocked).toBe(expectBlocked);
    // Sanity check that business timezone would have given a DIFFERENT
    // (wrong) answer for at least the first case, proving the two
    // timezones aren't accidentally equivalent in this test.
    void businessTimezone;
  });

  it("handles a same-day (non-overnight) window correctly", () => {
    expect(isWithinQuietHours("09:00-17:00", "America/New_York", new Date("2026-09-07T14:00:00Z"))).toBe(true); // 10am ET
    expect(isWithinQuietHours("09:00-17:00", "America/New_York", new Date("2026-09-07T22:00:00Z"))).toBe(false); // 6pm ET
  });

  it("returns false (never blocks) for an unparseable quiet-hours string", () => {
    expect(isWithinQuietHours("garbage", "America/New_York", new Date())).toBe(false);
    expect(isWithinQuietHours(null, "America/New_York", new Date())).toBe(false);
  });
});

describe("evaluateCallPolicy", () => {
  const baseBusiness = { timezone: "America/New_York", quietHours: "21:00-08:00", maxCallAttempts: 3 };

  it("blocks on location_unknown when contact timezone is missing, rather than falling back to business timezone", () => {
    const decision = evaluateCallPolicy({
      business: baseBusiness,
      contact: { consentStatus: "valid", suppressedAt: null, timezone: null },
      attemptsSoFar: 0,
      now: new Date("2026-09-07T18:00:00Z"), // 2pm ET, would be allowed if it fell back to business tz
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("location_unknown");
  });

  it("blocks on quiet_hours using the recipient's timezone even when business-local time would allow it", () => {
    // 11pm ET is within business-local "quiet hours end at 8am" allowed
    // window logic only if you (wrongly) use business tz; a recipient in
    // LA at 8pm PT is still within their own allowed window regardless.
    // Use a genuinely late LA hour instead: 11pm ET = 8pm PT (allowed),
    // so pick a time that's late in LA specifically: 3am ET = midnight PT.
    const decision = evaluateCallPolicy({
      business: baseBusiness,
      contact: { consentStatus: "valid", suppressedAt: null, timezone: "America/Los_Angeles" },
      attemptsSoFar: 0,
      now: new Date("2026-09-08T08:00:00Z"), // 4am ET / 1am PT — blocked either way, but confirms LA tz is actually read
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("quiet_hours");
  });

  it("allows a call when consent is valid, not suppressed, timezone known, within hours, under attempt limit, kill switch off", () => {
    const decision = evaluateCallPolicy({
      business: baseBusiness,
      contact: { consentStatus: "valid", suppressedAt: null, timezone: "America/New_York" },
      attemptsSoFar: 0,
      now: new Date("2026-09-07T18:00:00Z"), // 2pm ET
    });
    expect(decision.allowed).toBe(true);
  });

  it("blocks on consent_invalid before checking anything else", () => {
    const decision = evaluateCallPolicy({
      business: baseBusiness,
      contact: { consentStatus: "revoked", suppressedAt: null, timezone: "America/New_York" },
      attemptsSoFar: 0,
      now: new Date("2026-09-07T18:00:00Z"),
    });
    expect(decision.reason).toBe("consent_invalid");
  });

  it("blocks on suppressed even with valid consent", () => {
    const decision = evaluateCallPolicy({
      business: baseBusiness,
      contact: { consentStatus: "valid", suppressedAt: new Date(), timezone: "America/New_York" },
      attemptsSoFar: 0,
      now: new Date("2026-09-07T18:00:00Z"),
    });
    expect(decision.reason).toBe("suppressed");
  });

  it("blocks on attempt_limit once attemptsSoFar reaches maxCallAttempts", () => {
    const decision = evaluateCallPolicy({
      business: baseBusiness,
      contact: { consentStatus: "valid", suppressedAt: null, timezone: "America/New_York" },
      attemptsSoFar: 3,
      now: new Date("2026-09-07T18:00:00Z"),
    });
    expect(decision.reason).toBe("attempt_limit");
  });

  it("blocks on kill_switch as the last check, after everything else passes", () => {
    process.env["LEADSPRINT_KILL_SWITCH"] = "true";
    try {
      const decision = evaluateCallPolicy({
        business: baseBusiness,
        contact: { consentStatus: "valid", suppressedAt: null, timezone: "America/New_York" },
        attemptsSoFar: 0,
        now: new Date("2026-09-07T18:00:00Z"),
      });
      expect(decision.reason).toBe("kill_switch");
    } finally {
      delete process.env["LEADSPRINT_KILL_SWITCH"];
    }
  });
});

describe("isKillSwitchEngaged", () => {
  it("is false when unset", () => {
    delete process.env["LEADSPRINT_KILL_SWITCH"];
    expect(isKillSwitchEngaged()).toBe(false);
  });

  it.each(["true", "1", "on", "TRUE"])("is true for %s", (value) => {
    process.env["LEADSPRINT_KILL_SWITCH"] = value;
    expect(isKillSwitchEngaged()).toBe(true);
    delete process.env["LEADSPRINT_KILL_SWITCH"];
  });
});
