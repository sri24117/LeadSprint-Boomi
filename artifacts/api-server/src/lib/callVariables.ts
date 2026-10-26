import type { businessesTable } from "@workspace/db";
import { getProfile, type VerticalProfile } from "./verticals";

type Business = typeof businessesTable.$inferSelect;

const MAX_VALUE_LENGTH = 1000;
const NOT_PROVIDED = "not provided";
const PLACEHOLDER_PROJECT = "Configured project";

function clip(value: string): string {
  return value.slice(0, MAX_VALUE_LENGTH);
}

/** A detail value as speakable text; empty when there is nothing usable. */
function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function numberedList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

/** The human label for an enum value; an unrecognised value is passed through as written. */
function labelFor(profile: VerticalProfile, key: string, value: string): string {
  const field = profile.fields.find((f) => f.key === key);
  return field?.options?.find((option) => option.value === value)?.label ?? value;
}

function serviceAreaSentence(zips: string[]): string {
  return zips.length > 0
    ? `We serve ZIP codes starting with ${zips.join(", ")}.`
    : "No service area is configured. Ask for the ZIP code; the office will confirm coverage.";
}

/**
 * The per-call variables sent to Retell as `retell_llm_dynamic_variables`.
 * They fill the {{placeholders}} in the agent prompt for THIS call. The
 * customer's phone number and email are deliberately never included: the agent
 * does not need them and they would only widen what a prompt can leak.
 *
 * Every value is a string (Retell requires it) and is capped in length.
 */
export function buildCallVariables(input: {
  business: Business;
  contact: { name: string };
  lead: { project: string; details: Record<string, unknown>; urgency: string | null };
}): Record<string, string> {
  const { business, contact, lead } = input;
  const profile = getProfile(business.vertical);
  const project =
    lead.project && lead.project !== PLACEHOLDER_PROJECT ? lead.project : business.projectName;

  const variables: Record<string, string> = {
    business_name: business.name,
    lead_name: contact.name,
    project_name: project,
    qualification_questions: numberedList(
      business.qualificationQuestions.length > 0
        ? business.qualificationQuestions
        : profile.defaultQualificationQuestions,
    ),
    approved_faq: business.approvedFaq || profile.defaultApprovedFaq,
    escalation_rules: business.escalationRules,
    recording_clause: business.recordingDisclosure ? ", and this call may be recorded" : "",
    appointment_label: profile.appointmentLabel,
  };

  // Industries that keep their answers in `details` also describe the job.
  if (profile.id !== "real_estate") {
    for (const field of profile.fields) {
      const raw = field.key === "urgency" ? asText(lead.urgency) : asText(lead.details[field.key]);
      variables[field.key] = raw ? (field.type === "enum" ? labelFor(profile, field.key, raw) : raw) : NOT_PROVIDED;
    }
    variables.service_area = serviceAreaSentence(business.serviceAreaZips ?? []);
    // Spoken verbatim by the agent when asked about cost, so it is a sentence.
    variables.pricing_policy = business.pricingPolicy?.trim() || "A technician will confirm the cost on site.";
  }

  return Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, clip(value)]));
}
