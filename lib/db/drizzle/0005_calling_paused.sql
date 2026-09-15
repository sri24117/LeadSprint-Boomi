ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "calling_paused" boolean DEFAULT false NOT NULL;
