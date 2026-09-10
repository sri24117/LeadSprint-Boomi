ALTER TABLE "workflow_jobs" ADD COLUMN IF NOT EXISTS "locked_by" text;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_jobs_poll_idx" ON "workflow_jobs" USING btree ("type","status","available_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_jobs_lease_idx" ON "workflow_jobs" USING btree ("status","locked_at");
