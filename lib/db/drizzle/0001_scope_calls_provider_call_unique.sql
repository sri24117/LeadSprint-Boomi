DROP INDEX IF EXISTS "calls_provider_call_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calls_provider_call_unique" ON "calls" USING btree ("business_id","provider","provider_call_id");
