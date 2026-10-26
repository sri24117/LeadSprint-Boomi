/**
 * The per-call variables sent to Retell as `retell_llm_dynamic_variables`
 * (spec §5.6). Until now the app sent none, so placeholders such as
 * {{lead_name}} in the agent prompt were never filled on a real call.
 */

import { describe, expect, it } from "vitest";
import { buildCallVariables } from "./callVariables";

type Business = Parameters<typeof buildCallVariables>[0]["business"];

const baseBusiness = {
  name: "Northstar Realty",
  vertical: "real_estate",
  projectName: "Northstar Realty — Spring buyer campaign",
  recordingDisclosure: true,
  approvedFaq: "We help buyers in Manhattan and Brooklyn.",
  qualificationQuestions: ["What area?", "What budget?"],
  escalationRules: "Transfer anything outside approved info.",
  serviceAreaZips: [] as string[],
  pricingPolicy: null as string | null,
} as unknown as Business;

const homeBusiness = {
  ...baseBusiness,
  name: "Frostline HVAC",
  vertical: "home_services",
  projectName: "Frostline spring tune-up",
  approvedFaq: "We repair and install AC and plumbing.",
  qualificationQuestions: ["What is wrong?", "What is your ZIP?"],
  serviceAreaZips: ["787", "78660"],
  pricingPolicy: "Our diagnostic visit is $89, applied to the repair.",
} as unknown as Business;

describe("buildCallVariables, real estate (fills the placeholders the existing prompt already uses)", () => {
  const vars = buildCallVariables({
    business: baseBusiness,
    contact: { name: "Dana Reyes" },
    lead: { project: "Spring buyer campaign", details: {}, urgency: null },
  });

  it("provides every placeholder in docs/retell-agent.md", () => {
    expect(vars).toMatchObject({
      business_name: "Northstar Realty",
      lead_name: "Dana Reyes",
      project_name: "Spring buyer campaign",
      approved_faq: "We help buyers in Manhattan and Brooklyn.",
      escalation_rules: "Transfer anything outside approved info.",
      recording_clause: ", and this call may be recorded",
      appointment_label: "Viewing",
    });
    expect(vars.qualification_questions).toBe("1. What area?\n2. What budget?");
  });

  it("leaves the recording clause empty when recording disclosure is off", () => {
    const off = buildCallVariables({
      business: { ...baseBusiness, recordingDisclosure: false } as Business,
      contact: { name: "Dana" },
      lead: { project: "p", details: {}, urgency: null },
    });
    expect(off.recording_clause).toBe("");
  });

  it("falls back to the business project when the lead only has the placeholder project", () => {
    const v = buildCallVariables({
      business: baseBusiness,
      contact: { name: "Dana" },
      lead: { project: "Configured project", details: {}, urgency: null },
    });
    expect(v.project_name).toBe("Northstar Realty — Spring buyer campaign");
  });

  it("falls back to the profile's default questions and FAQ when the workspace has none", () => {
    const v = buildCallVariables({
      business: { ...baseBusiness, qualificationQuestions: [], approvedFaq: "" } as Business,
      contact: { name: "Dana" },
      lead: { project: "p", details: {}, urgency: null },
    });
    expect(v.qualification_questions).toContain("1. What area are you looking in?");
    expect(v.approved_faq.length).toBeGreaterThan(0);
  });

  it("does not add home-services variables to a real-estate call", () => {
    expect(vars).not.toHaveProperty("problem");
    expect(vars).not.toHaveProperty("pricing_policy");
    expect(vars).not.toHaveProperty("service_area");
  });
});

describe("buildCallVariables, home services", () => {
  const vars = buildCallVariables({
    business: homeBusiness,
    contact: { name: "Sam Rivera" },
    lead: {
      project: "Configured project",
      urgency: "emergency",
      details: {
        service_type: "plumbing_repair",
        problem: "Burst pipe in the kitchen",
        zip: "78701",
        address: "12 Oak St",
        property_type: "home",
        preferred_time: "this morning",
      },
    },
  });

  it("describes the job in words the agent can speak", () => {
    expect(vars).toMatchObject({
      business_name: "Frostline HVAC",
      lead_name: "Sam Rivera",
      service_type: "Plumbing repair",
      problem: "Burst pipe in the kitchen",
      urgency: "Emergency",
      zip: "78701",
      address: "12 Oak St",
      property_type: "Home",
      preferred_time: "this morning",
      appointment_label: "Service visit",
    });
  });

  it("states the service area and the exact pricing wording", () => {
    expect(vars.service_area).toBe("We serve ZIP codes starting with 787, 78660.");
    expect(vars.pricing_policy).toBe("Our diagnostic visit is $89, applied to the repair.");
  });

  it("falls back to a sentence the agent can say aloud when the business set no pricing policy", () => {
    // The prompt has the agent speak this variable verbatim when asked about cost,
    // so it must be a sentence, not an instruction. "Never quote a price" lives
    // in the prompt itself.
    for (const unset of [null, "", "   "]) {
      const v = buildCallVariables({
        business: { ...homeBusiness, pricingPolicy: unset } as Business,
        contact: { name: "Sam" },
        lead: { project: "p", details: {}, urgency: null },
      });
      expect(v.pricing_policy).toBe("A technician will confirm the cost on site.");
    }
  });

  it("asks for the ZIP when the business has no service area configured", () => {
    const v = buildCallVariables({
      business: { ...homeBusiness, serviceAreaZips: [] } as Business,
      contact: { name: "Sam" },
      lead: { project: "p", details: {}, urgency: null },
    });
    expect(v.service_area).toMatch(/ask for the zip/i);
  });

  it("uses a clear placeholder for anything the lead did not provide, never 'undefined'", () => {
    const v = buildCallVariables({
      business: homeBusiness,
      contact: { name: "Sam" },
      lead: { project: "p", details: {}, urgency: null },
    });
    for (const key of ["service_type", "problem", "urgency", "zip", "address", "preferred_time"]) {
      expect(v[key], key).toBe("not provided");
    }
  });

  it("passes an unrecognised service type through as written instead of dropping it", () => {
    const v = buildCallVariables({
      business: homeBusiness,
      contact: { name: "Sam" },
      lead: { project: "p", details: { service_type: "chimney sweep" }, urgency: null },
    });
    expect(v.service_type).toBe("chimney sweep");
  });
});

describe("buildCallVariables, safety of the output", () => {
  it("only ever produces string values", () => {
    const v = buildCallVariables({
      business: homeBusiness,
      contact: { name: "Sam" },
      lead: { project: "p", details: { problem: 12345, zip: true } as never, urgency: null },
    });
    for (const [key, value] of Object.entries(v)) {
      expect(typeof value, key).toBe("string");
    }
  });

  it("caps each value so a huge customer message cannot bloat the call request", () => {
    const v = buildCallVariables({
      business: homeBusiness,
      contact: { name: "Sam" },
      lead: { project: "p", details: { problem: "x".repeat(5000) }, urgency: null },
    });
    expect(v.problem.length).toBeLessThanOrEqual(1000);
  });

  it("never includes the customer's phone number or email", () => {
    const v = buildCallVariables({
      business: homeBusiness,
      contact: { name: "Sam", phone: "+15125550142", email: "sam@example.com" } as never,
      lead: { project: "p", details: {}, urgency: null },
    });
    expect(Object.keys(v)).not.toContain("phone");
    expect(Object.keys(v)).not.toContain("email");
    expect(JSON.stringify(v)).not.toContain("5125550142");
    expect(JSON.stringify(v)).not.toContain("sam@example.com");
  });
});
