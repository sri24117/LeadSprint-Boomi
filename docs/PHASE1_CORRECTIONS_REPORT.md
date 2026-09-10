# Phase 1 Corrections Report

> **Branch:** `feature/leadsprint-mvp-hardening`  
> **Status:** All 3 corrections implemented and verified  
> **Scope:** Strictly the 3 items identified in `docs/PHASE1_POST_IMPLEMENTATION_REVIEW.md`  

---

## 1. Cal.com Duplicate Booking Protection

### File Changed
[`artifacts/api-server/src/routes/leadsprint.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/leadsprint.ts)  
[`artifacts/api-server/src/lib/providers.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/providers.ts)

### Changes Implemented
1. **Pre-Check for Existing Confirmed Booking:**  
   Before calling `createCalBooking()`, `POST /appointments/book` queries `appointmentsTable` for `(businessId, leadId, status: "confirmed")`. If a confirmed appointment already exists, it immediately returns the existing appointment DTO without invoking the external Cal.com API.
2. **Stable Operation Key:**  
   Constructs a deterministic operation key (`book_${BUSINESS_ID}_${lead_id}_${slot_start.getTime()}`) passed in the booking request metadata to Cal.com.
3. **Cal.com Stable Booking UID Preservation:**  
   Updated `createCalBooking()` in `providers.ts` to inspect and return `body?.uid ?? body?.booking?.uid` (Cal.com's stable UUID identifier) before falling back to numeric `id`.
4. **Retry Safety & Idempotent Persistence:**  
   Checks if an appointment row already exists for `(calendarProvider: "Cal.com", externalId)`. On insert, applies `.onConflictDoNothing({ target: [appointmentsTable.calendarProvider, appointmentsTable.externalId] })` to guarantee local idempotency.
5. **Cal.com Success vs. PostgreSQL Failure Handling:**  
   Wrapped the local PostgreSQL mutations in a `try/catch`. If Cal.com creation succeeds but PostgreSQL transaction fails, it logs an explicit CRITICAL error with `{ leadId, externalId, businessId }` and returns HTTP 500 with the external booking ID so operators can reconcile without data loss.

---

## 2. Cron Phone Normalization

### File Changed
[`artifacts/api-server/src/routes/cron.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/cron.ts)

### Changes Implemented
1. **Central Normalization Integration:**  
   Imported and applied `normalizeToE164(contact.phone)` from `../lib/phone` before invoking `startRetellCall` for queued workflow jobs (`type = "initiate_call"`).
2. **Failure Handling Without Provider Dispatch:**  
   If normalization fails:
   - Call status set to `"policy_blocked"` with `errorState: "invalid_phone"`.
   - Workflow job marked as `"failed"` with `lastError: Invalid contact phone number: ...`.
   - Records an operator-visible activity log (`type: "policy"`).
   - Retell API is **never called** with the malformed number.
3. **Clean E.164 Dispatch:**  
   When valid, `phoneNorm.e164` and `business.retellAgentId` are passed directly to `startRetellCall()`.

---

## 3. Incremental Database Migration

### Files Created / Updated
- [`lib/db/drizzle/0001_scope_calls_provider_call_unique.sql`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/lib/db/drizzle/0001_scope_calls_provider_call_unique.sql) *(NEW)*
- [`lib/db/drizzle/meta/_journal.json`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/lib/db/drizzle/meta/_journal.json) *(UPDATED)*

### Changes Implemented
1. **Preserved Baseline Migration:**  
   Left `lib/db/drizzle/0000_first_demogoblin.sql` untouched without executing it against any active database.
2. **Created Targeted Delta Migration:**  
   Created `0001_scope_calls_provider_call_unique.sql` containing only:
   ```sql
   DROP INDEX IF EXISTS "calls_provider_call_unique";--> statement-breakpoint
   CREATE UNIQUE INDEX IF NOT EXISTS "calls_provider_call_unique" ON "calls" USING btree ("business_id","provider","provider_call_id");
   ```
3. **Safe & Non-Destructive:**  
   - Does not drop tables.
   - Does not touch existing rows.
   - Updates the unique index constraint from `(provider, provider_call_id)` to `(business_id, provider, provider_call_id)`.
   - Updated Drizzle journal metadata to register entry `idx: 1`.

---

## 4. Verification Commands and Results

| Check | Command | Status |
| :--- | :--- | :---: |
| **Workspace Typecheck** | `pnpm run typecheck` | **PASSED (Exit Code 0)** |
| **API Server Build** | `pnpm --filter @workspace/api-server run build` | **PASSED (Exit Code 0)** |
| **Frontend SPA Build** | `pnpm --filter @workspace/leadsprint run build` | **PASSED (Exit Code 0)** |
| **Automated Tests** | `pnpm test` (if configured) | No test script configured in project |

---

## 5. Remaining Limitations

1. **Distributed Boundary Between External Cal.com API and PostgreSQL:**  
   PostgreSQL transactions cannot roll back HTTP requests made to external third-party APIs. If Cal.com succeeds and PostgreSQL persistence fails catastrophically (e.g. database disk full or network severance), the Cal.com booking exists externally. The system logs the provider booking UID and returns it in the 500 error body for manual/webhook reconciliation, which is the safest possible strategy without a two-phase commit protocol.
2. **Automated Test Harness:**  
   The project currently has no Vitest/Jest suite configured in `package.json`. Creating automated unit tests for policy evaluations, phone parsing, and webhook signatures remains recommended for Phase 2/3.
