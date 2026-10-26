export type VerticalId = "real_estate" | "home_services";

export interface FieldOption {
  value: string;
  label: string;
}

export interface ProfileField {
  key: string;
  label: string;
  type: "text" | "enum";
  /** Required when `type` is "enum". */
  options?: FieldOption[];
  /** Shown in the lead list's summary column. */
  inList: boolean;
  /**
   * Where the value lives: a real column on `leads` (real estate's four legacy
   * fields, and `urgency`), or a key in the flexible `leads.details` object.
   */
  storage: "column" | "details";
}

export interface UrgencyLevel {
  value: string;
  label: string;
}

/**
 * Everything that differs between industries, as plain data. The engine
 * (intake, consent, queue, safety gate, booking) never branches on a vertical
 * id: it reads a profile.
 */
export interface VerticalProfile {
  id: VerticalId;
  label: string;
  /** What a booked appointment is called ("Viewing", "Service visit"). */
  appointmentLabel: string;
  fields: ProfileField[];
  /** Empty when the vertical has no urgency concept. */
  urgencyLevels: UrgencyLevel[];
  /** Lower-case phrases that make a lead an emergency. */
  emergencyKeywords: string[];
  defaultQualificationQuestions: string[];
  defaultApprovedFaq: string;
}
