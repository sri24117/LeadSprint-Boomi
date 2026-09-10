# LeadSprint Phase 2 — Milestone 3 Implementation Report

> **Branch:** `feature/leadsprint-mvp-hardening`  
> **Milestone:** Milestone 3 — Workflow Worker Concurrency & Crash Idempotency  
> **Execution Date:** 2026-09-10  
> **Status:** Fully Implemented and Verified  

---

## 1. Summary of Changes

Milestone 3 hardens outbound workflow job execution by introducing atomic batch claiming with PostgreSQL row locks (`FOR UPDATE SKIP LOCKED`), durable worker leases with automatic stale lease recovery, crash idempotency with stable operation keys, pre-dispatch verification gates, exponential backoff retry scheduling, and tenant-scoped webhook orphan call reconciliation.

### Files Changed

| File | Type | Description |
|---|---|---|
| [`lib/db/src/schema/leadsprint.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/lib/db/src/schema/leadsprint.ts) | Modified | Added `lockedBy` and `leaseExpiresAt` fields along with `workflow_jobs_poll_idx` and `workflow_jobs_lease_idx` indexes on `workflowJobsTable`. |
| [`lib/db/drizzle/0003_workflow_worker_concurrency.sql`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/lib/db/drizzle/0003_workflow_worker_concurrency.sql) | **NEW** | Incremental additive migration adding `locked_by`, `lease_expires_at`, and indexing on `workflow_jobs`. |
| [`lib/db/drizzle/meta/_journal.json`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/lib/db/drizzle/meta/_journal.json) | Modified | Registered migration `0003_workflow_worker_concurrency` at index 3. |
| [`artifacts/api-server/src/lib/worker.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/worker.ts) | **NEW** | Centralized workflow worker engine implementing atomic claiming (`claimQueuedJobs`), stale recovery (`recoverStaleLeases`), and end-to-end dispatching (`processWorkflowJobs`). |
| [`artifacts/api-server/src/lib/worker.test.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/worker.test.ts) | **NEW** | 16 unit and integration tests covering worker concurrency, lease ownership, stable operation keys, existing-call detection, state transitions, backoff, pre-dispatch gates, and webhook orphan call reconciliation. |
| [`artifacts/api-server/src/routes/cron.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/cron.ts) | Modified | `POST /api/cron/process-jobs` delegates directly to the robust `processWorkflowJobs()` engine. |
| [`artifacts/api-server/src/routes/webhooks.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/webhooks.ts) | Modified | Added tenant-scoped `metadata.call_id` fallback lookup to reconcile orphan call records and complete associated workflow jobs after worker crashes. |

---

## 2. Worker Concurrency & Locking Strategy

### Atomic Batch Claiming (`FOR UPDATE SKIP LOCKED`)
- Jobs are selected and claimed in a single atomic SQL statement:
  ```sql
  UPDATE workflow_jobs
  SET
    status = 'dispatching',
    locked_at = NOW(),
    locked_by = ${workerId},
    lease_expires_at = NOW() + INTERVAL '5 minutes',
    attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM workflow_jobs
    WHERE type = 'initiate_call'
      AND status IN ('queued', 'deferred')
      AND available_at <= NOW()
    ORDER BY available_at ASC
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
  ```
- **Non-blocking parallel execution:** Multiple worker processes running simultaneously select disjoint batches without waiting on lock acquisition or double-claiming rows.
- **Zero long-lived DB transactions:** The database row lock is committed and released immediately after claiming. Outbound HTTP calls to Retell do not hold database connections open.

---

## 3. Leases & Stale Lease Recovery

### Durable Lease Model
- Each claimed job receives:
  - `locked_by`: Unique process/worker identifier (`worker_${pid}_${uuid}`).
  - `locked_at`: Timestamp of claim acquisition.
  - `lease_expires_at`: 5 minutes after acquisition (`NOW() + 5 minutes`).
  - `attempts`: Incremented attempt counter.

### Automatic Recovery
- Before claiming new jobs, `recoverStaleLeases()` reclaims jobs stranded in `dispatching` by crashed or killed workers:
  ```sql
  UPDATE workflow_jobs
  SET status = 'queued', locked_at = NULL, locked_by = NULL, lease_expires_at = NULL
  WHERE status = 'dispatching' 
    AND (
      (lease_expires_at IS NOT NULL AND lease_expires_at < NOW())
      OR (lease_expires_at IS NULL AND locked_at < NOW() - INTERVAL '5 minutes')
    );
  ```

---

## 4. Webhook Orphan Call Reconciliation & Tenant Isolation

### Fallback Mechanism in Retell Webhook
When a worker successfully calls Retell but crashes before writing `providerCallId` to `callsTable`, the local call record remains with `providerCallId = NULL`.

The Retell webhook handler in [`webhooks.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/webhooks.ts) now implements a two-tier tenant-scoped lookup:
1. **Primary Lookup:** Match by `(business_id, providerCallId = Retell call_id)`.
2. **Fallback Lookup:** If not found and `metadata.call_id` is present in the Retell payload, match by `(business_id, id = metadata.call_id)`.
3. **Reconciliation:** When matched via fallback:
   - Sets `callsTable.providerCallId = Retell call_id`.
   - Updates call status (`completed` or `failed`), `endedAt`, `durationSeconds`.
   - Reconciles the associated `workflow_jobs` record to `status: "completed"`.
   - Increments active billing period usage.

### Strict Tenant Isolation
- The fallback lookup strictly requires `eq(callsTable.businessId, businessId)`.
- A webhook payload claiming `business_id: "biz_B"` can never match or update a call belonging to `business_id: "biz_A"`, even if `metadata.call_id` matches.

---

## 5. Pre-Dispatch Verification & Policy Gates

Immediately before external dispatch, durable state is verified:
1. **Business Tenant Validation:** Business exists and market configuration is verified.
2. **Global Kill Switch:** Evaluates `isKillSwitchEngaged()` (`LEADSPRINT_KILL_SWITCH`).
3. **Contact Consent & Suppression:** Verifies `consentStatus === "valid"` and `!suppressedAt`.
4. **Attempt Limit Check:** Verifies prior lead attempts have not reached `business.maxCallAttempts`.
5. **Quiet Hours Evaluation:** Evaluates `isWithinQuietHours()`. If in quiet hours, the job transitions to `status: "deferred"`, scheduling the next check at `availableAt = NOW() + 30 minutes` without burning terminal attempts.
6. **Phone Normalization:** Validates recipient phone via E.164 normalization before external dispatch.

---

## 6. State Machine & Exponential Backoff

### State Transitions
- `queued` / `deferred` → `dispatching` (worker claim)
- `dispatching` → `completed` (Retell accepted call, `calls.status = "in_progress"`)
- `dispatching` → `deferred` (quiet hours or transient provider backoff, `available_at = NOW() + 2^attempts minutes`)
- `dispatching` → `blocked` (policy violation: consent, suppression, phone invalid, attempt limit)
- `dispatching` → `uncertain` / `failed` (timeout or max attempts exhausted)

### Exponential Backoff
- On transient network or provider failure:
  - `delayMinutes = Math.min(60, Math.pow(2, attempts))` (1m, 2m, 4m, 8m, 16m, 32m, 60m).
  - Terminal failure triggered when `attempts >= 5` (`MAX_JOB_ATTEMPTS`).

---

## 7. Residual Provider Crash Window & Exactly-Once Limitation

> [!WARNING]
> **Residual Provider Crash Window Analysis**
> 
> - **Durable Local Operation Key:** The worker uses a durable local operation key stored in `workflow_jobs.idempotency_key` and transmitted in `metadata.call_id`. This key prevents duplicate **local** workflow operations and links retried workflow jobs to the canonical local call row.
> - **Provider-Side Limitation:** Retell's `POST /v2/create-phone-call` endpoint does **not** support native provider-side idempotency keys or idempotency headers. Every valid HTTP request received by Retell initiates a distinct live call on the telephony network.
> - **Crash Window:** If the worker process crashes after Retell returns HTTP 201 (`call_id`) but **before** `providerCallId` is committed locally AND **before** an asynchronous Retell webhook arrives to reconcile the call, the database has no durable evidence of the remote dispatch.
> - **Mitigation:** The webhook fallback implemented in this milestone substantially mitigates this window by allowing incoming Retell webhooks (which echo `metadata.call_id`) to reconnect orphan calls and mark the workflow job `completed`.
> - **Exactly-Once Semantics:** If both the worker's local commit and webhook reconciliation are unavailable during the recovery window, the subsequent worker cannot determine whether the remote call was placed. Therefore, **provider-side exactly-once execution cannot be mathematically guaranteed** for this specific crash window under the current Retell API contract.

---

## 8. Migration 0003 Summary

- **File:** `lib/db/drizzle/0003_workflow_worker_concurrency.sql`
- **SQL:**
  ```sql
  ALTER TABLE "workflow_jobs" ADD COLUMN IF NOT EXISTS "locked_by" text;--> statement-breakpoint
  ALTER TABLE "workflow_jobs" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;--> statement-breakpoint
  CREATE INDEX IF NOT EXISTS "workflow_jobs_poll_idx" ON "workflow_jobs" USING btree ("type","status","available_at");--> statement-breakpoint
  CREATE INDEX IF NOT EXISTS "workflow_jobs_lease_idx" ON "workflow_jobs" USING btree ("status","locked_at");
  ```
- **Journal:** Registered in `lib/db/drizzle/meta/_journal.json` with `idx: 3`.
- **Safety:** Strictly additive. Prior migrations `0000`, `0001`, and `0002` remain untouched.
- **Production Execution:** **NOT EXECUTED** (0 migrations executed against production).

---

## 9. Verification Results

| Verification Step | Command | Result |
|---|---|:---:|
| **Automated Tests** | `pnpm --filter @workspace/api-server run test` | ✅ **66 passed** (20 env + 15 security + 15 usage + 16 worker) |
| **Full Workspace Typecheck** | `pnpm run typecheck` | ✅ **Exit Code 0** |
| **API Server Build** | `pnpm --filter @workspace/api-server run build` | ✅ **Exit Code 0** (`dist/index.mjs` 3.7MB) |
| **Frontend SPA Build** | `pnpm --filter @workspace/leadsprint run build` | ✅ **Exit Code 0** (`dist/public/`) |
| **Git Diff Whitespace Check** | `git diff --check` | ✅ **Clean** (0 whitespace errors) |

---

## 10. Known Limitations

- **Provider Idempotency:** Full provider-side crash idempotency requires Retell to support an `Idempotency-Key` header on `/v2/create-phone-call`. Until supported upstream, the local operation key + webhook fallback provide the highest durable protection possible.
