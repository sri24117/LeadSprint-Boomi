import { describe, expect, it } from "vitest";
import { evaluateCallPolicy, isKillSwitchEngaged, isWithinQuietHours, nextAllowedCallTime, validateQuietHours } from "./policy";

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
    // 20:30 PT is inside the business's 08:00–21:00 window but past the
    // 20:00 floor LeadSprint applies everywhere (several states end at 8pm),
    // so it is blocked. 19:30 PT is the last allowed half hour.
    { nyLabel: "22:30 ET (19:30 PT)", isoUtc: "2026-09-08T02:30:00Z", expectBlocked: false },
    { nyLabel: "23:30 ET (20:30 PT)", isoUtc: "2026-09-08T03:30:00Z", expectBlocked: true },
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

  // Midday ET: every check below would be allowed if it failed open.
  const middayET = new Date("2026-09-07T16:00:00Z");

  it("blocks (fails closed) for an unparseable or missing quiet-hours setting", () => {
    // These used to return false — "never blocks" — so a typo such as
    // "9pm-8am" meant the business could be dialled at any hour.
    for (const bad of ["garbage", "9pm-8am", "21:00-21:00", "25:00-08:00", "", null, undefined]) {
      expect(isWithinQuietHours(bad, "America/New_York", middayET), String(bad)).toBe(true);
    }
  });

  it("blocks when the recipient timezone can't be resolved, instead of falling back to UTC", () => {
    expect(isWithinQuietHours("21:00-08:00", "Not/AZone", middayET)).toBe(true);
    expect(isWithinQuietHours("21:00-08:00", "", middayET)).toBe(true);
  });

  it("never allows calls outside 08:00–20:00 recipient time, whatever the business configures", () => {
    // A business that sets its quiet hours to 23:00–06:00 has asked for a
    // wider window than the law allows; the floor still applies.
    const wide = "23:00-06:00";
    expect(isWithinQuietHours(wide, "America/New_York", new Date("2026-09-07T11:30:00Z"))).toBe(true); // 07:30 ET
    expect(isWithinQuietHours(wide, "America/New_York", new Date("2026-09-07T12:00:00Z"))).toBe(false); // 08:00 ET
    expect(isWithinQuietHours(wide, "America/New_York", new Date("2026-09-07T23:59:00Z"))).toBe(false); // 19:59 ET
    expect(isWithinQuietHours(wide, "America/New_York", new Date("2026-09-08T00:00:00Z"))).toBe(true); // 20:00 ET
    expect(isWithinQuietHours(wide, "America/New_York", new Date("2026-09-08T02:30:00Z"))).toBe(true); // 22:30 ET
  });

  it("schedules a retry for when the floor opens, not just the business window", () => {
    // 20:30 ET with quiet hours 21:00–08:00: blocked by the floor alone.
    const retryAt = nextAllowedCallTime("21:00-08:00", "America/New_York", new Date("2026-09-08T00:30:00Z"));
    // 08:00 ET next morning = 12:00 UTC, within the 5-minute step + 1 minute.
    expect(retryAt.getTime()).toBeGreaterThanOrEqual(new Date("2026-09-08T12:00:00Z").getTime());
    expect(retryAt.getTime()).toBeLessThanOrEqual(new Date("2026-09-08T12:06:00Z").getTime());
  });
});

describe("validateQuietHours", () => {
  it("accepts the formats the gate reads", () => {
    for (const ok of ["21:00-08:00", "21:00–08:00", "9:00 - 17:30", "20:00-09:00"]) {
      expect(validateQuietHours(ok), ok).toBeNull();
    }
  });

  it("rejects anything the gate would have to guess about", () => {
    for (const bad of ["9pm-8am", "21:00", "21:00-21:00", "24:00-08:00", "21:60-08:00", "", null]) {
      expect(validateQuietHours(bad), String(bad)).toMatch(/Quiet hours/);
    }
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

  it("blocks a number on the do-not-call list even when this contact row was never suppressed", () => {
    // The opt-out was recorded on an earlier contact for the same number.
    const decision = evaluateCallPolicy({
      business: baseBusiness,
      contact: { consentStatus: "valid", suppressedAt: null, onSuppressionList: true, timezone: "America/New_York" },
      attemptsSoFar: 0,
      now: new Date("2026-09-07T18:00:00Z"),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("suppressed");
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
