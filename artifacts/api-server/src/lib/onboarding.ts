/**
 * Pilot onboarding checklist.
 *
 * LeadSprint is sold as a managed pilot: one configured workspace per
 * customer, onboarded by us. This module is the single definition of
 * "is this workspace actually ready to place live calls?", used by:
 *   - GET /onboarding/checklist (operator console setup screen)
 *   - the live-calling gate in POST /calls/start and the intake path
 *
 * The rule the whole pilot depends on: the app refuses to start live
 * outbound calls until every required item is complete. An unfinished
 * setup must fail loudly at configuration time, never silently at 2am on
 * a real prospect's phone.
 */

import type { businessesTable } from "@workspace/db";
import { hasCalConfig } from "./appointments";
import { hasRetellConfigForMarket } from "./providers";

export type ChecklistSeverity = "required" | "recommended";

export interface ChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  severity: ChecklistSeverity;
  detail: string;
}

export interface OnboardingChecklist {
  ready_for_live_calls: boolean;
  items: ChecklistItem[];
  missing_required: string[];
}

type BusinessRow = typeof businessesTable.$inferSelect;

function nonEmpty(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

export function buildOnboardingChecklist(
  business: BusinessRow | undefined,
): OnboardingChecklist {
  const market = business?.market === "IN" ? "IN" : "US";

  const items: ChecklistItem[] = [
    {
      key: "business_name",
      label: "Business name",
      complete: nonEmpty(business?.name) && business?.name !== "New LeadSprint workspace",
      severity: "required",
      detail: "The name the AI receptionist uses to identify itself on every call.",
    },
    {
      key: "timezone",
      label: "Business timezone",
      complete: nonEmpty(business?.timezone),
      severity: "required",
      detail: "Used for reporting and for interpreting the configured calling hours.",
    },
    {
      key: "business_phone",
      label: "Business phone number",
      complete: nonEmpty(business?.phoneNumber),
      severity: "required",
      detail: "The number leads recognise; shown to the operator and used for callbacks.",
    },
    {
      key: "transfer_number",
      label: "Human transfer number",
      complete: nonEmpty(business?.transferNumber),
      severity: "required",
      detail: "Where a caller who asks for a human is transferred. Without it, every transfer becomes a message capture.",
    },
    {
      key: "calling_hours",
      label: "Calling hours / quiet hours",
      complete: nonEmpty(business?.quietHours),
      severity: "required",
      detail: "Quiet-hours window in recipient local time, e.g. 21:00–08:00.",
    },
    {
      key: "approved_faq",
      label: "Approved FAQ",
      complete: nonEmpty(business?.approvedFaq),
      severity: "required",
      detail: "The only business information the agent is allowed to state. Everything else escalates.",
    },
    {
      key: "qualification_questions",
      label: "Qualification questions",
      complete: (business?.qualificationQuestions?.length ?? 0) > 0,
      severity: "required",
      detail: "The approved script questions asked on every qualification call.",
    },
    {
      key: "escalation_rules",
      label: "Escalation rules",
      complete: nonEmpty(business?.escalationRules),
      severity: "required",
      detail: "What the agent must refuse to answer and hand to a human instead.",
    },
    {
      key: "calendar_event_type",
      label: "Cal.com event type",
      complete: nonEmpty(business?.calEventTypeId),
      severity: "required",
      detail: "The event type booked when a lead accepts a slot.",
    },
    {
      key: "provider_retell",
      label: "Retell voice provider configured",
      complete: hasRetellConfigForMarket(market),
      severity: "required",
      detail: "RETELL_API_KEY, RETELL_AGENT_ID and a from-number for this market must be set on the deployment.",
    },
    {
      key: "provider_calcom",
      label: "Cal.com calendar provider configured",
      complete: hasCalConfig(),
      severity: "required",
      detail: "CALCOM_API_KEY and CALCOM_EVENT_TYPE_ID must be set; booking is never simulated in a live pilot.",
    },
    {
      key: "retell_agent",
      label: "Production Retell agent linked",
      complete: nonEmpty(business?.retellAgentId),
      severity: "recommended",
      detail: "Pin the workspace to the reviewed production agent rather than the number's default agent.",
    },
    {
      key: "disclosures",
      label: "AI and recording disclosure enabled",
      complete: Boolean(business?.aiDisclosure && business?.recordingDisclosure),
      severity: "recommended",
      detail: "The pilot customer must confirm the disclosure requirements for their jurisdiction.",
    },
  ];

  const missingRequired = items
    .filter((item) => item.severity === "required" && !item.complete)
    .map((item) => item.key);

  return {
    ready_for_live_calls: missingRequired.length === 0,
    items,
    missing_required: missingRequired,
  };
}

/**
 * Human-readable reason a workspace may not place live calls yet, or
 * `null` when it is fully configured.
 */
export function liveCallingBlockedReason(
  business: BusinessRow | undefined,
): string | null {
  const checklist = buildOnboardingChecklist(business);
  if (checklist.ready_for_live_calls) return null;
  const labels = checklist.items
    .filter((item) => checklist.missing_required.includes(item.key))
    .map((item) => item.label);
  return `Setup incomplete — live calling is disabled until these are configured: ${labels.join(", ")}.`;
}
