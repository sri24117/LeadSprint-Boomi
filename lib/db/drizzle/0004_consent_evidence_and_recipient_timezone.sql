CREATE TABLE IF NOT EXISTS "consent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"disclosure_version" text,
	"disclosure_text" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_source" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "consent_disclosure_version" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "intake_ip" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "recipient_timezone" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "timezone_provenance" text DEFAULT 'business_fallback' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_events_business_contact_idx" ON "consent_events" USING btree ("business_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_events_captured_at_idx" ON "consent_events" USING btree ("captured_at");
