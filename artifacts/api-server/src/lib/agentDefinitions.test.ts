/**
 * The Retell agent definitions in docs/ are configuration that lives outside the
 * code, so nothing else stops them drifting from it. These checks tie them to
 * the code: every {{placeholder}} must be a variable the app really sends, every
 * tool must point at an endpoint that exists, and the safety rules must be
 * present in the home-services script.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCallVariables } from "./callVariables";
import { getProfile } from "./verticals";

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../docs");

type Tool = {
  type: string;
  name: string;
  description?: string;
  url?: string;
  parameters?: { properties?: Record<string, { enum?: string[] }>; required?: string[] };
};
type Agent = {
  webhook_url: string;
  general_prompt: string;
  begin_message: string;
  general_tools: Tool[];
  post_call_analysis_data: Array<{ name: string; choices?: string[] }>;
};

const load = (file: string): Agent => JSON.parse(fs.readFileSync(path.join(DOCS, file), "utf8"));
const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!);

function sampleVariables(vertical: string) {
  const business = {
    name: "Acme",
    vertical,
    projectName: "Project",
    recordingDisclosure: true,
    approvedFaq: "faq",
    qualificationQuestions: ["q"],
    escalationRules: "rules",
    serviceAreaZips: ["787"],
    pricingPolicy: null,
  } as never;
  return buildCallVariables({ business, contact: { name: "Sam" }, lead: { project: "p", details: {}, urgency: null } });
}

const AGENT_PATHS = ["availability", "book", "transfer", "message", "opt_out", "qualify"];

describe.each([
  ["retell-agent.json", "real_estate"],
  ["retell-agent-home-services.json", "home_services"],
])("%s", (file, vertical) => {
  const agent = load(file);

  it("uses only placeholders the app actually sends for this vertical", () => {
    const sent = Object.keys(sampleVariables(vertical));
    const used = new Set([...placeholders(agent.general_prompt), ...placeholders(agent.begin_message)]);
    for (const name of used) expect(sent, `{{${name}}} is used in the prompt but never sent`).toContain(name);
  });

  it("points every custom tool at an endpoint the API serves", () => {
    for (const tool of agent.general_tools.filter((t) => t.type === "custom")) {
      const match = tool.url?.match(/^https:\/\/leadsprint\.example\.com\/api\/agent\/([a-z_]+)$/);
      expect(match, `${tool.name} url ${tool.url}`).not.toBeNull();
      expect(AGENT_PATHS, tool.name).toContain(match![1]);
    }
  });

  it("includes the opt-out tool and keeps do-not-call out of capture_message", () => {
    expect(agent.general_tools.some((t) => t.name === "opt_out")).toBe(true);
    const capture = agent.general_tools.find((t) => t.name === "capture_message");
    expect(capture?.description).toMatch(/not for do-not-call/i);
  });

  it("reports call events to the app's Retell webhook", () => {
    expect(agent.webhook_url).toBe("https://leadsprint.example.com/api/webhooks/retell");
  });
});

describe("retell-agent-home-services.json", () => {
  const agent = load("retell-agent-home-services.json");
  const profile = getProfile("home_services");
  const prompt = agent.general_prompt;

  it("asks record_qualification for exactly the fields the profile stores, with the profile's enum values", () => {
    const tool = agent.general_tools.find((t) => t.name === "record_qualification");
    const properties = tool?.parameters?.properties ?? {};
    for (const field of profile.fields) {
      expect(properties, `record_qualification.${field.key}`).toHaveProperty(field.key);
      if (field.type === "enum") {
        expect(properties[field.key]?.enum, field.key).toEqual(field.options!.map((o) => o.value));
      }
    }
    for (const extra of ["qualification_status", "intent_score"]) expect(properties).toHaveProperty(extra);
    expect(tool?.parameters?.required).toEqual(["qualification_status"]);
    // Real-estate parameters must not leak into this agent.
    for (const legacy of ["location", "budget_label", "timeline"]) expect(properties).not.toHaveProperty(legacy);
  });

  it("carries the safety rules as hard requirements", () => {
    expect(prompt).toMatch(/automated assistant/i);
    expect(prompt).toMatch(/911/);
    expect(prompt).toMatch(/gas/i);
    expect(prompt).toMatch(/carbon monoxide/i);
    expect(prompt).toMatch(/never (give|offer) troubleshooting|do not (give|offer) troubleshooting/i);
    expect(prompt).toMatch(/never quote|do not quote/i);
    expect(prompt).toContain("{{pricing_policy}}");
    expect(prompt).toContain("in_service_area");
    for (const tool of ["opt_out", "request_transfer", "capture_message", "check_availability", "book_appointment", "record_qualification"]) {
      expect(prompt, tool).toContain(tool);
    }
    expect(prompt).toMatch(/booked:\s*true/i);
  });

  it("never lets a hazard be handled by the AI alone", () => {
    expect(prompt).toMatch(/person|human|colleague/i);
    expect(prompt).toMatch(/stop (asking|qualifying)|do not continue/i);
  });

  it("is written for trades, with no real-estate wording left over", () => {
    expect(prompt).not.toMatch(/\b(propert(y|ies)|showing|viewing|buyers?|listings?|real estate|mortgage|lending)\b/i);
  });

  it("can report emergencies and out-of-area outcomes after the call", () => {
    const outcome = agent.post_call_analysis_data.find((d) => d.name === "qualification_outcome");
    expect(outcome?.choices).toEqual(expect.arrayContaining(["emergency_escalated", "out_of_area", "qualified", "do_not_call"]));
  });
});
