ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "included_voice_minutes" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_business_period_unique" ON "usage" USING btree ("business_id","period_start","period_end");
