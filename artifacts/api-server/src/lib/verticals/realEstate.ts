import type { VerticalProfile } from "./types";

/**
 * The original LeadSprint behaviour, described as data. These four fields are
 * the legacy `leads` columns the console and the voice agent's qualify tool
 * have always used, so nothing about real estate changes.
 */
export const realEstateProfile: VerticalProfile = {
  id: "real_estate",
  label: "Real estate",
  appointmentLabel: "Viewing",
  fields: [
    { key: "property_type", label: "Property type", type: "text", inList: true, storage: "column" },
    { key: "budget_label", label: "Budget", type: "text", inList: true, storage: "column" },
    { key: "location", label: "Location", type: "text", inList: true, storage: "column" },
    { key: "timeline", label: "Timeline", type: "text", inList: true, storage: "column" },
  ],
  urgencyLevels: [],
  emergencyKeywords: [],
  defaultQualificationQuestions: [
    "What area are you looking in?",
    "What is your target budget?",
    "When are you hoping to move?",
    "Would you like to schedule a showing?",
  ],
  defaultApprovedFaq:
    "Share only configured project information, then offer a human handoff.",
};
