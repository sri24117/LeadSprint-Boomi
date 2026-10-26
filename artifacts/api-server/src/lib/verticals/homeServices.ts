import type { VerticalProfile } from "./types";

/**
 * AC repair and plumbing. Everything except `urgency` lives in the flexible
 * `leads.details` object; `urgency` is a real column so it can be filtered and
 * sorted.
 */
export const homeServicesProfile: VerticalProfile = {
  id: "home_services",
  label: "Home services (AC & plumbing)",
  appointmentLabel: "Service visit",
  fields: [
    {
      key: "service_type",
      label: "Service",
      type: "enum",
      options: [
        { value: "ac_repair", label: "AC repair" },
        { value: "ac_install", label: "AC installation" },
        { value: "plumbing_repair", label: "Plumbing repair" },
        { value: "plumbing_install", label: "Plumbing installation" },
        { value: "water_heater", label: "Water heater" },
        { value: "drain", label: "Drain / sewer" },
        { value: "other", label: "Other" },
      ],
      inList: true,
      storage: "details",
    },
    {
      key: "urgency",
      label: "Urgency",
      type: "enum",
      options: [
        { value: "emergency", label: "Emergency" },
        { value: "same_day", label: "Same day" },
        { value: "this_week", label: "This week" },
        { value: "quote", label: "Just a quote" },
      ],
      inList: true,
      storage: "column",
    },
    { key: "problem", label: "Problem", type: "text", inList: false, storage: "details" },
    { key: "zip", label: "ZIP code", type: "text", inList: true, storage: "details" },
    { key: "address", label: "Address", type: "text", inList: false, storage: "details" },
    {
      key: "property_type",
      label: "Property type",
      type: "enum",
      options: [
        { value: "home", label: "Home" },
        { value: "apartment", label: "Apartment" },
        { value: "commercial", label: "Commercial" },
      ],
      inList: false,
      storage: "details",
    },
    { key: "preferred_time", label: "Preferred time", type: "text", inList: true, storage: "details" },
  ],
  urgencyLevels: [
    { value: "emergency", label: "Emergency" },
    { value: "same_day", label: "Same day" },
    { value: "this_week", label: "This week" },
    { value: "quote", label: "Just a quote" },
  ],
  emergencyKeywords: [
    "gas smell",
    "gas leak",
    "smell gas",
    "smells like gas",
    "smell of gas",
    "carbon monoxide",
    "burst pipe",
    "pipe burst",
    "flooding",
    "sewage",
    "no water",
    "sparks",
    "burning smell",
  ],
  defaultQualificationQuestions: [
    "What service do you need: AC, plumbing, or something else?",
    "What is happening, and when did it start?",
    "What is the ZIP code for the visit?",
    "When would you like a technician to come out?",
  ],
  defaultApprovedFaq:
    "We repair and install air conditioning and plumbing. A technician confirms any cost on site. Share only configured company information, then offer a human handoff.",
};
