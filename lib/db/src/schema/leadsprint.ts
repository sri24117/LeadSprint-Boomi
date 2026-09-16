import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const businessesTable = pgTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  market: text("market").notNull().default("US"),
  timezone: text("timezone").notNull().default("America/New_York"),
  phoneNumber: text("phone_number").notNull(),
  transferNumber: text("transfer_number").notNull(),
  recordingDisclosure: boolean("recording_disclosure").notNull().default(true),
  aiDisclosure: boolean("ai_disclosure").notNull().default(true),
  quietHours: text("quiet_hours").notNull().default("21:00–08:00"),
  maxCallAttempts: integer("max_call_attempts").notNull().default(2),
  suppressionEnabled: boolean("suppression_enabled").notNull().default(true),
  projectName: text("project_name").notNull(),
  servicesOrPropertyTypes: text("services_or_property_types").array().notNull().default([]),
  approvedFaq: text("approved_faq").notNull().default(""),
  qualificationQuestions: text("qualification_questions").array().notNull().default([]),
  escalationRules: text("escalation_rules").notNull().default("Transfer questions outside approved business information to a human."),
  calEventTypeId: text("cal_event_type_id"),
  retellAgentId: text("retell_agent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("owner"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const contactsTable = pgTable("contacts", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  preferredLanguage: text("preferred_language").notNull().default("en"),
  // Launch gate: a contact is NOT callable until someone records why it is
  // lawful to call them. The old default ("valid") meant any row created by
  // intake or CSV import became callable with no evidence at all, so the
  // default is now "unknown" and the policy gate blocks it. Valid values:
  // unknown | valid | revoked.
  consentStatus: text("consent_status").notNull().default("unknown"),
  // Evidence for the consent decision: where it came from (e.g.
  // "web_form:listing-enquiry", "csv:2026-09-16 seller list", "verbal") and
  // when it was captured. Both are required before consent may be "valid".
  consentSource: text("consent_source"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
  // Called-party IANA timezone, derived from the phone number's area code
  // at intake (see lib/areaCodeTimezones.ts). NULL means "we couldn't
  // determine it" — the policy gate blocks rather than guessing, since
  // quiet-hours law is defined by the recipient's local time, not the
  // business's.
  timezone: text("timezone"),
});

export const leadsTable = pgTable("leads", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  contactId: text("contact_id").notNull().references(() => contactsTable.id),
  source: text("source").notNull().default("manual"),
  campaign: text("campaign").notNull().default("Pilot campaign"),
  project: text("project").notNull(),
  propertyType: text("property_type").notNull(),
  budgetMin: numeric("budget_min"),
  budgetMax: numeric("budget_max"),
  budgetLabel: text("budget_label").notNull(),
  location: text("location").notNull(),
  timeline: text("timeline").notNull(),
  qualificationStatus: text("qualification_status").notNull().default("New enquiry"),
  intentScore: integer("intent_score").notNull().default(50),
  score: text("score").notNull().default("warm"),
  nextAction: text("next_action").notNull().default("Call lead"),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const callsTable = pgTable("calls", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  contactId: text("contact_id").notNull().references(() => contactsTable.id),
  leadId: text("lead_id").notNull().references(() => leadsTable.id),
  provider: text("provider").notNull().default("Retell"),
  providerCallId: text("provider_call_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("queued"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  summary: text("summary").notNull().default("Call queued for the approved qualification script."),
  outcome: text("outcome").notNull().default("Queued"),
  transferred: boolean("transferred").notNull().default(false),
  booked: boolean("booked").notNull().default(false),
  errorState: text("error_state"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Provider call ids are only unique within a tenant: two workspaces may
  // legitimately hold the same provider id (separate Twilio subaccounts,
  // stub/dev ids), and a global constraint would make the second business's
  // insert fail — while a global index is exactly what a cross-tenant
  // webhook lookup would scan. Always scope by business_id.
  providerCallUnique: uniqueIndex("calls_provider_call_unique").on(table.businessId, table.provider, table.providerCallId),
  idempotencyUnique: uniqueIndex("calls_business_idempotency_unique").on(table.businessId, table.idempotencyKey),
}));

export const appointmentsTable = pgTable("appointments", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  contactId: text("contact_id").notNull().references(() => contactsTable.id),
  leadId: text("lead_id").notNull().references(() => leadsTable.id),
  serviceOrProperty: text("service_or_property").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  timezone: text("timezone").notNull(),
  calendarProvider: text("calendar_provider").notNull().default("Cal.com"),
  externalId: text("external_id").notNull(),
  status: text("status").notNull().default("confirmed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  calendarExternalUnique: uniqueIndex("appointments_calendar_external_unique").on(table.calendarProvider, table.externalId),
}));

export const activitiesTable = pgTable("activities", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageTable = pgTable("usage", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  voiceMinutes: numeric("voice_minutes").notNull().default("0"),
  smsCount: integer("sms_count").notNull().default(0),
  bookingCount: integer("booking_count").notNull().default(0),
  estimatedCost: numeric("estimated_cost").notNull().default("0"),
});

export const suppressionsTable = pgTable("suppressions", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  phone: text("phone").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull().default("operator"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowJobsTable = pgTable("workflow_jobs", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  type: text("type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lastError: text("last_error"),
}, (table) => ({
  jobIdempotencyUnique: uniqueIndex("workflow_jobs_business_idempotency_unique").on(table.businessId, table.idempotencyKey),
}));

export const providerEventsTable = pgTable("provider_events", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  provider: text("provider").notNull(),
  externalEventId: text("external_event_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => ({
  providerEventUnique: uniqueIndex("provider_events_provider_external_unique").on(table.provider, table.externalEventId),
}));

export const insertBusinessSchema = createInsertSchema(businessesTable);
export const insertUserSchema = createInsertSchema(usersTable);
export const insertContactSchema = createInsertSchema(contactsTable);
export const insertLeadSchema = createInsertSchema(leadsTable);
export const insertCallSchema = createInsertSchema(callsTable);
export const insertAppointmentSchema = createInsertSchema(appointmentsTable);
export const insertActivitySchema = createInsertSchema(activitiesTable);
export const insertUsageSchema = createInsertSchema(usageTable);
export const insertSuppressionSchema = createInsertSchema(suppressionsTable);
export const insertWorkflowJobSchema = createInsertSchema(workflowJobsTable);
export const insertProviderEventSchema = createInsertSchema(providerEventsTable);

export type Business = z.infer<typeof insertBusinessSchema>;
export type User = z.infer<typeof insertUserSchema>;
export type Contact = z.infer<typeof insertContactSchema>;
export type Lead = z.infer<typeof insertLeadSchema>;
export type Call = z.infer<typeof insertCallSchema>;
export type Appointment = z.infer<typeof insertAppointmentSchema>;