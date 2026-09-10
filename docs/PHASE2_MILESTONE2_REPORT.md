# LeadSprint Phase 2 — Milestone 2 Implementation Report

> **Branch:** `feature/leadsprint-mvp-hardening`  
> **Milestone:** Milestone 2 — Usage Accounting & Active Billing Period  
> **Execution Date:** 2026-09-10  
> **Status:** Fully Implemented and Verified  

---

## 1. Summary of Changes

Milestone 2 hardens usage accounting by making all voice minutes, SMS, and booking metrics tenant-scoped, calendar-month billing-period scoped, dynamically configured via `business.included_voice_minutes`, and protected against concurrency races and provider webhook replay double-counting.

### Files Changed

| File | Type | Description |
|---|---|---|
| [`lib/db/src/schema/leadsprint.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/lib/db/src/schema/leadsprint.ts) | Modified | Added `includedVoiceMinutes` to `businessesTable` and `usage_business_period_unique` unique index on `usageTable`. |
| [`lib/db/drizzle/0002_usage_and_billing_period.sql`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/lib/db/drizzle/0002_usage_and_billing_period.sql) | **NEW** | Incremental migration for `included_voice_minutes` column and `usage_business_period_unique` index. |
| [`lib/db/drizzle/meta/_journal.json`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/lib/db/drizzle/meta/_journal.json) | Modified | Registered migration `0002_usage_and_billing_period` at index 2. |
| [`artifacts/api-server/src/lib/usage.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/usage.ts) | **NEW** | Deterministic UTC calendar-month billing period calculation (`getBillingPeriod`) and race-proof active usage resolver (`getActiveUsageRow`). |
| [`artifacts/api-server/src/lib/usage.test.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/usage.test.ts) | **NEW** | 15 unit and integration tests covering entitlement, active period scoping, concurrency, idempotency, and API schema compliance. |
| [`artifacts/api-server/src/routes/leadsprint.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/leadsprint.ts) | Modified | `GET /usage` reads `business.includedVoiceMinutes` and active usage row with dynamic `period_label`; `GET /reports/weekly` and `POST /appointments/book` scoped to active period usage row. |
| [`artifacts/api-server/src/routes/webhooks.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/webhooks.ts) | Modified | Retell call webhook updates `voiceMinutes` and `estimatedCost` on the active period usage row by exact usage ID. |
| [`artifacts/api-server/src/routes/cron.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/cron.ts) | Modified | `send-weekly-reports` queries the active usage row per tenant. |
| [`artifacts/api-server/src/middlewares/auth.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/middlewares/auth.ts) | Modified | Operator workspace provisioning uses `getActiveUsageRow()` rather than a single static ID. |

---

## 2. Schema Changes & Migration

### Schema Adjustments
1. **`businessesTable`**:
   ```ts
   includedVoiceMinutes: integer("included_voice_minutes").notNull().default(300)
   ```
2. **`usageTable`**:
   ```ts
   (table) => ({
     businessPeriodUnique: uniqueIndex("usage_business_period_unique").on(
       table.businessId,
       table.periodStart,
       table.periodEnd,
     ),
   })
   ```

### Migration Name & SQL
- **Migration tag:** `0002_usage_and_billing_period.sql`
- **Path:** `lib/db/drizzle/0002_usage_and_billing_period.sql`
- **SQL Content:**
  ```sql
  ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "included_voice_minutes" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
  CREATE UNIQUE INDEX IF NOT EXISTS "usage_business_period_unique" ON "usage" USING btree ("business_id","period_start","period_end");
  ```
- **Safety:** Strictly additive. Existing migrations `0000` and `0001` remain untouched.
- **Production migration status:** **NOT EXECUTED** (zero connection to production database).

---

## 3. Active Billing Period & Concurrency Model

### Billing Period Calculation
- `getBillingPeriod(asOf: Date)` calculates UTC calendar-month boundaries deterministically:
  - `periodStart`: First millisecond of month (`YYYY-MM-01T00:00:00.000Z`).
  - `periodEnd`: Last millisecond of month (`YYYY-MM-LDT23:59:59.999Z`).
  - `periodLabel`: Formatted via `Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })` (e.g. "September 2026", "October 2026").

### Concurrency Protection
- When `getActiveUsageRow(businessId, asOf, executor)` runs:
  1. It performs a tenant- and period-filtered select (`business_id = ? AND period_start <= ? AND period_end >= ?`).
  2. If missing, it executes an `INSERT ... ON CONFLICT DO NOTHING` using a deterministic ID (`usage_${businessId}_${year}_${monthPad}`) guarded by the database unique index `(business_id, period_start, period_end)`.
  3. Re-queries the record to return the single canonical active usage row.
  4. Multiple concurrent requests for the same tenant and billing cycle resolve to the identical row without errors or duplicate rows.

---

## 4. Usage Idempotency & Tenant Isolation

### Idempotency Mechanism
- **Provider webhook deduplication:** `acceptProviderEvent` in `webhooks.ts` writes to `provider_events` with unique index on `(provider, external_event_id)`.
- If a Retell or calendar webhook is retransmitted or replayed:
  - `acceptProviderEvent` returns `false` (`duplicate: true`).
  - Webhook processing exits early with HTTP `202 Accepted`.
  - Usage increments (`voiceMinutes`, `estimatedCost`, `bookingCount`) are bypassed completely.
- **Appointment booking atomicity:** Appointment booking in `POST /appointments/book` updates `bookingCount` within the active Drizzle transaction (`tx`), ensuring atomic commits alongside appointment record creation.

---

## 5. Verification Results

| Verification Step | Command | Result |
|---|---|:---:|
| **Automated Tests** | `pnpm --filter @workspace/api-server run test` | ✅ **50 passed** (20 env + 15 security + 15 usage) |
| **Full Workspace Typecheck** | `pnpm run typecheck` | ✅ **Exit Code 0** |
| **API Server Build** | `pnpm --filter @workspace/api-server run build` | ✅ **Exit Code 0** (`dist/index.mjs` 3.7MB) |
| **Frontend SPA Build** | `pnpm --filter @workspace/leadsprint run build` | ✅ **Exit Code 0** (`dist/public/`) |
| **Git Diff Whitespace Check** | `git diff --check` | ✅ **Clean** (0 whitespace errors) |

---

## 6. Known Limitations & Next Steps

1. **Activity-level Resolution Model:** `unresolved_messages` in `GET /today` continues to use active callback requirements pending the dedicated messaging inbox model planned in future phases.
2. **Next Milestone:** Milestone 3 (Workflow Worker Concurrency & Crash Idempotency via `FOR UPDATE SKIP LOCKED`, stale lease recovery, and pre-dispatch call checks).
