ALTER TABLE "businesses" ADD COLUMN "vertical" text DEFAULT 'real_estate' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "notify_email" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "service_area_zips" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "pricing_policy" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "consent_evidence" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "urgency" text;