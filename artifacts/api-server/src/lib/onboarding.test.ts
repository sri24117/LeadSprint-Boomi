import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { businessesTable } from "@workspace/db";
import { buildOnboardingChecklist, liveCallingBlockedReason } from "./onboarding";

type BusinessRow = typeof businessesTable.$inferSelect;

function business(overrides: Partial<BusinessRow> = {}): BusinessRow {
  return {
    id: "business_pilot",
    name: "Northstar Realty",
    market: "US",
    timezone: "America/New_York",
    phoneNumber: "+12125550148",
    transferNumber: "+12125550199",
    recordingDisclosure: true,
    aiDisclosure: true,
    quietHours: "21:00–08:00",
    maxCallAttempts: 2,
    suppressionEnabled: true,
    projectName: "Spring buyer campaign",
    servicesOrPropertyTypes: ["Condos"],
    approvedFaq: "We help buyers in Manhattan and Brooklyn.",
    qualificationQuestions: ["What area?", "What budget?"],
    escalationRules: "Transfer anything outside approved info.",
    calEventTypeId: "12345",
    retellAgentId: "agent_live",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BusinessRow;
}

const providerEnv = {
  RETELL_API_KEY: "key",
  RETELL_AGENT_ID: "agent_live",
  RETELL_FROM_NUMBER_US: "+12125550100",
  CALCOM_API_KEY: "cal_key",
  CALCOM_EVENT_TYPE_ID: "12345",
};

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const [key, value] of Object.entries(providerEnv)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("buildOnboardingChecklist", () => {
  it("is ready for live calls when everything is configured", () => {
    const checklist = buildOnboardingChecklist(business());
    expect(checklist.missing_required).toEqual([]);
    expect(checklist.ready_for_live_calls).toBe(true);
  });

  it("is never ready for a workspace that does not exist", () => {
    const checklist = buildOnboardingChecklist(undefined);
    expect(checklist.ready_for_live_calls).toBe(false);
    expect(checklist.missing_required.length).toBeGreaterThan(0);
  });

  it("blocks on a missing transfer number", () => {
    const checklist = buildOnboardingChecklist(business({ transferNumber: "" }));
    expect(checklist.ready_for_live_calls).toBe(false);
    expect(checklist.missing_required).toContain("transfer_number");
  });

  it("blocks on an unconfigured qualification script", () => {
    const checklist = buildOnboardingChecklist(
      business({ qualificationQuestions: [], approvedFaq: "" }),
    );
    expect(checklist.missing_required).toEqual(
      expect.arrayContaining(["approved_faq", "qualification_questions"]),
    );
  });

  it("treats the auto-created placeholder workspace name as incomplete", () => {
    const checklist = buildOnboardingChecklist(business({ name: "New LeadSprint workspace" }));
    expect(checklist.missing_required).toContain("business_name");
  });

  it("blocks when the voice provider is not configured for the market", () => {
    delete process.env.RETELL_API_KEY;
    const checklist = buildOnboardingChecklist(business());
    expect(checklist.missing_required).toContain("provider_retell");
  });

  it("blocks when the calendar provider is not configured", () => {
    delete process.env.CALCOM_API_KEY;
    const checklist = buildOnboardingChecklist(business());
    expect(checklist.missing_required).toContain("provider_calcom");
  });

  it("does not block on recommended-only items", () => {
    const checklist = buildOnboardingChecklist(
      business({ retellAgentId: null, aiDisclosure: false }),
    );
    expect(checklist.ready_for_live_calls).toBe(true);
  });
});

describe("liveCallingBlockedReason", () => {
  it("returns null for a fully configured workspace", () => {
    expect(liveCallingBlockedReason(business())).toBeNull();
  });

  it("names the exact missing configuration", () => {
    const reason = liveCallingBlockedReason(business({ transferNumber: "", calEventTypeId: null }));
    expect(reason).toContain("Human transfer number");
    expect(reason).toContain("Cal.com event type");
  });
});
