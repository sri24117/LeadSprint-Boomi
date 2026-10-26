/**
 * Vertical profiles and the pure rules built on them (spec §5.1, §5.4).
 */

import { describe, expect, it } from "vitest";
import {
  classifyUrgency,
  getProfile,
  isOutOfArea,
  toApiProfile,
  validateDetails,
  VERTICAL_IDS,
} from "./index";

describe("profile registry", () => {
  it("knows both verticals", () => {
    expect(VERTICAL_IDS).toEqual(["real_estate", "home_services"]);
    expect(getProfile("home_services").id).toBe("home_services");
    expect(getProfile("real_estate").id).toBe("real_estate");
  });

  it("falls back to real estate for an unknown or missing vertical", () => {
    for (const bad of ["plumber", "", undefined, null]) {
      expect(getProfile(bad as never).id, String(bad)).toBe("real_estate");
    }
  });

  it("gives every profile the members the rest of the system relies on", () => {
    for (const id of VERTICAL_IDS) {
      const profile = getProfile(id);
      expect(profile.label.length, id).toBeGreaterThan(0);
      expect(profile.appointmentLabel.length, id).toBeGreaterThan(0);
      expect(profile.fields.length, id).toBeGreaterThan(0);
      expect(profile.defaultQualificationQuestions.length, id).toBeGreaterThan(0);
      const keys = profile.fields.map((f) => f.key);
      expect(new Set(keys).size, `${id} field keys are unique`).toBe(keys.length);
      for (const field of profile.fields) {
        if (field.type === "enum") expect(field.options?.length, `${id}.${field.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps real estate exactly as it was: legacy columns, no urgency", () => {
    const re = getProfile("real_estate");
    expect(re.fields.map((f) => f.key)).toEqual(["property_type", "budget_label", "location", "timeline"]);
    expect(re.fields.every((f) => f.storage === "column")).toBe(true);
    expect(re.urgencyLevels).toEqual([]);
    expect(re.appointmentLabel).toBe("Viewing");
  });

  it("describes home services: details fields, an urgency column, a service visit", () => {
    const hs = getProfile("home_services");
    expect(hs.appointmentLabel).toBe("Service visit");
    expect(hs.urgencyLevels.map((u) => u.value)).toEqual(["emergency", "same_day", "this_week", "quote"]);
    const byKey = Object.fromEntries(hs.fields.map((f) => [f.key, f]));
    expect(byKey.urgency?.storage).toBe("column");
    for (const key of ["service_type", "problem", "zip", "address", "property_type", "preferred_time"]) {
      expect(byKey[key]?.storage, key).toBe("details");
    }
    expect(byKey.service_type?.options?.map((o) => o.value)).toEqual([
      "ac_repair", "ac_install", "plumbing_repair", "plumbing_install", "water_heater", "drain", "other",
    ]);
  });

  it("serialises a profile for the API without leaking code-only members", () => {
    const api = toApiProfile(getProfile("home_services"));
    expect(api.id).toBe("home_services");
    expect(api.appointment_label).toBe("Service visit");
    expect(api.urgency_levels[0]).toEqual({ value: "emergency", label: "Emergency" });
    expect(api.fields.find((f) => f.key === "service_type")).toMatchObject({ in_list: true, storage: "details", type: "enum" });
    expect(JSON.stringify(api)).not.toContain("emergencyKeywords");
  });
});

describe("classifyUrgency", () => {
  const hs = getProfile("home_services");

  it("uses a supplied valid urgency", () => {
    expect(classifyUrgency(hs, { urgency: "same_day", problem: "burst pipe" })).toBe("same_day");
  });

  it("ignores a supplied urgency that is not one of the profile's levels", () => {
    expect(classifyUrgency(hs, { urgency: "whenever", problem: "dripping tap" })).toBe("this_week");
  });

  it.each([
    "I can smell gas in the kitchen",
    "the whole basement smells like gas",
    "there's a smell of gas near the water heater",
    "Gas leak near the meter",
    "a pipe burst upstairs",
    "carbon monoxide alarm going off",
    "BURST PIPE in the basement",
    "flooding in the garage",
    "sewage coming up the drain",
    "we have no water at all",
    "sparks from the outlet",
    "there is a burning smell from the unit",
  ])("flags %j as an emergency", (problem) => {
    expect(classifyUrgency(hs, { problem })).toBe("emergency");
  });

  it("defaults to this_week when nothing says otherwise", () => {
    expect(classifyUrgency(hs, { problem: "AC not cooling as well as last year" })).toBe("this_week");
    expect(classifyUrgency(hs, {})).toBe("this_week");
  });

  it("errs toward safety: a keyword phrase anywhere in the text triggers an emergency, but unrelated text does not", () => {
    // A false emergency costs an extra email; a missed one can cost a home.
    expect(classifyUrgency(hs, { problem: "not sure if this counts, but there was some flooding last week" })).toBe("emergency");
    expect(classifyUrgency(hs, { problem: "water bill question" })).toBe("this_week");
  });

  it("returns null for a vertical with no urgency levels (real estate)", () => {
    expect(classifyUrgency(getProfile("real_estate"), { problem: "burst pipe", urgency: "emergency" })).toBeNull();
  });
});

describe("validateDetails", () => {
  it("accepts missing details as empty", () => {
    expect(validateDetails(undefined)).toEqual({ ok: true, details: {} });
  });

  it("accepts strings, finite numbers and booleans", () => {
    expect(validateDetails({ zip: "78701", rooms: 3, has_unit: true })).toEqual({
      ok: true,
      details: { zip: "78701", rooms: 3, has_unit: true },
    });
  });

  it("rejects anything that is not a plain object", () => {
    for (const bad of [null, "text", 5, [], [{ a: 1 }]]) {
      expect(validateDetails(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects nested values, null values, and non-finite numbers", () => {
    for (const bad of [{ a: { b: 1 } }, { a: [1] }, { a: null }, { a: Number.POSITIVE_INFINITY }, { a: Number.NaN }]) {
      expect(validateDetails(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("enforces the size limits", () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect(validateDetails(many).ok).toBe(false);
    expect(validateDetails(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, "v"]))).ok).toBe(true);
    expect(validateDetails({ ["k".repeat(41)]: "v" }).ok).toBe(false);
    expect(validateDetails({ ["k".repeat(40)]: "v" }).ok).toBe(true);
    expect(validateDetails({ a: "x".repeat(501) }).ok).toBe(false);
    expect(validateDetails({ a: "x".repeat(500) }).ok).toBe(true);
    expect(validateDetails({ "": "v" }).ok).toBe(false);
  });

  it("explains what was wrong", () => {
    const result = validateDetails({ a: { b: 1 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/details/i);
  });
});

describe("isOutOfArea", () => {
  const zips = ["787", "78660", "73301"];

  it("is never out of area when the business set no service area", () => {
    expect(isOutOfArea([], { zip: "99999" })).toBe(false);
  });

  it("is in area for an exact ZIP and for a ZIP under a prefix entry", () => {
    expect(isOutOfArea(zips, { zip: "78660" })).toBe(false);
    expect(isOutOfArea(zips, { zip: "78704" })).toBe(false);
    expect(isOutOfArea(zips, { zip: "73301" })).toBe(false);
  });

  it("is out of area for a ZIP that matches nothing", () => {
    expect(isOutOfArea(zips, { zip: "10001" })).toBe(true);
    expect(isOutOfArea(zips, { zip: "78659" })).toBe(true); // shares only "786", not an entry
  });

  it("reads ZIP+4 and takes the first five digits", () => {
    expect(isOutOfArea(zips, { zip: "78701-1234" })).toBe(false);
    expect(isOutOfArea(zips, { zip: "10001-0001" })).toBe(true);
  });

  it("falls back to a 5-digit sequence in the address", () => {
    expect(isOutOfArea(zips, { address: "12 Main St, Austin TX 78704" })).toBe(false);
    expect(isOutOfArea(zips, { address: "9 Broadway, New York, NY 10004" })).toBe(true);
  });

  it("does not treat a longer digit run (like a phone number) as a ZIP", () => {
    expect(isOutOfArea(zips, { address: "call 5125550100 for gate" })).toBe(false);
  });

  it("is not out of area when no ZIP is supplied: the agent will ask", () => {
    expect(isOutOfArea(zips, {})).toBe(false);
    expect(isOutOfArea(zips, { zip: "unknown" })).toBe(false);
  });
});
