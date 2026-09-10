CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"service_or_property" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"calendar_provider" text DEFAULT 'Cal.com' NOT NULL,
	"external_id" text NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"market" text DEFAULT 'US' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"phone_number" text NOT NULL,
	"transfer_number" text NOT NULL,
	"recording_disclosure" boolean DEFAULT true NOT NULL,
	"ai_disclosure" boolean DEFAULT true NOT NULL,
	"quiet_hours" text DEFAULT '21:00–08:00' NOT NULL,
	"max_call_attempts" integer DEFAULT 2 NOT NULL,
	"suppression_enabled" boolean DEFAULT true NOT NULL,
	"project_name" text NOT NULL,
	"services_or_property_types" text[] DEFAULT '{}' NOT NULL,
	"approved_faq" text DEFAULT '' NOT NULL,
	"qualification_questions" text[] DEFAULT '{}' NOT NULL,
	"escalation_rules" text DEFAULT 'Transfer questions outside approved business information to a human.' NOT NULL,
	"cal_event_type_id" text,
	"retell_agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"provider" text DEFAULT 'Retell' NOT NULL,
	"provider_call_id" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"summary" text DEFAULT 'Call queued for the approved qualification script.' NOT NULL,
	"outcome" text DEFAULT 'Queued' NOT NULL,
	"transferred" boolean DEFAULT false NOT NULL,
	"booked" boolean DEFAULT false NOT NULL,
	"error_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"consent_status" text DEFAULT 'valid' NOT NULL,
	"suppressed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"campaign" text DEFAULT 'Pilot campaign' NOT NULL,
	"project" text NOT NULL,
	"property_type" text NOT NULL,
	"budget_min" numeric,
	"budget_max" numeric,
	"budget_label" text NOT NULL,
	"location" text NOT NULL,
	"timeline" text NOT NULL,
	"qualification_status" text DEFAULT 'New enquiry' NOT NULL,
	"intent_score" integer DEFAULT 50 NOT NULL,
	"score" text DEFAULT 'warm' NOT NULL,
	"next_action" text DEFAULT 'Call lead' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"phone" text NOT NULL,
	"reason" text NOT NULL,
	"source" text DEFAULT 'operator' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"voice_minutes" numeric DEFAULT '0' NOT NULL,
	"sms_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"estimated_cost" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_calendar_external_unique" ON "appointments" USING btree ("calendar_provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_provider_call_unique" ON "calls" USING btree ("business_id","provider","provider_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_business_idempotency_unique" ON "calls" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_events_provider_external_unique" ON "provider_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_jobs_business_idempotency_unique" ON "workflow_jobs" USING btree ("business_id","idempotency_key");