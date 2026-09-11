# Phase 3 Milestone 3 Report: Automatic Outbound Dispatch Enqueueing

> **Document Type:** Milestone Completion Report  
> **Status:** COMPLETE (Uncommitted local changes, Migration NOT required)  
> **Date:** September 2026  
> **Base Commit:** `9dc3848` (*Phase 3: consent evidence and timezone provenance*)  
> **Branch:** `feature/leadsprint-mvp-hardening`

---

## Executive Summary

Phase 3 Milestone 3 resolves the single remaining production-critical outbound dispatch gap identified in the production readiness audit (`docs/PHASE3_PRODUCTION_READINESS_AUDIT.md`) and authoritative product specification (`LeadSprint_US_Sellable_MVP_Final (1).docx`).

Prior to Milestone 3, inbound intake webhooks (`POST /api/webhooks/intake`) and CSV lead imports (`POST /api/leads/import`) created `contactsTable` and `leadsTable` records in status `new` with `nextAction: "Call lead"`, but **omitted enqueueing a `workflow_jobsTable` record**. Consequently, the background worker (`processWorkflowJobs` in `artifacts/api-server/src/lib/worker.ts`) found zero jobs to process, and newly ingested leads sat indefinitely without being called automatically. Outbound outreach required manual operator button clicks in the owner console.

Milestone 3 fixes this disconnect by making lead creation, initial `callsTable` row creation, and `workflow_jobsTable` enqueueing (`type: "initiate_call"`, `status: "queued"`, `idempotencyKey`) atomic within the database transaction for both intake webhooks and CSV imports.

---

## Key Technical Changes

### 1. Inbound Webhook Intake (`artifacts/api-server/src/routes/webhooks.ts`)
Within `POST /api/webhooks/intake` `db.transaction(async (tx) => { ... })`:
- Added atomic insert of `callsTable` row (`status: "queued"`, `summary: "Call queued for the approved qualification script."`, `outcome: "Queued"`, `idempotencyKey: intake_call_${leadId}`).
- Added atomic insert of `workflow_jobsTable` row (`type: "initiate_call"`, `status: "queued"`, `availableAt: new Date()`, `idempotencyKey: intake_call_${leadId}`).
- If any step fails inside the transaction, the entire intake operation rolls back cleanly.

### 2. CSV Lead Import (`artifacts/api-server/src/routes/leadsprint.ts`)
Within `POST /api/leads/import` `db.transaction(async (tx) => { ... })` for each imported row:
- Added atomic insert of `callsTable` row (`idempotencyKey: import_call_${leadId}`).
- Added atomic insert of `workflow_jobsTable` row (`type: "initiate_call"`, `status: "queued"`, `availableAt: new Date()`, `idempotencyKey: import_call_${leadId}`).
- Skipped or invalid CSV rows do not execute the transaction or create job records.

### 3. Worker Pre-Dispatch Policy Integrity
- The workflow worker `processWorkflowJobs()` claims queued jobs via PostgreSQL `FOR UPDATE SKIP LOCKED` locks.
- Immediately before invoking Retell provider API, the worker evaluates `evaluateCallPolicy(input)`.
- If the contact consent status is invalid, the contact is suppressed, recipient timezone is inside quiet hours, or usage limit is reached, `evaluateCallPolicy` blocks dispatch and marks the job deferred/blocked without double-dialing.

---

## Verification & Test Results

### 1. Test Suite Coverage (`artifacts/api-server/src/phase3-m3.test.ts`)
Added 12 focused test cases covering:
1. **Intake Auto-Enqueue**: Webhook intake creates `workflow_jobs` (`initiate_call`, `queued`) and `calls` row.
2. **Transaction Atomicity**: All 6 DB entities (contact, consent event, lead, activity, call, workflow job) created in a single transaction.
3. **Transaction Rollback**: Job creation failure rolls back contact, lead, and activity inserts.
4. **Replay Idempotency**: Duplicate payload/event key rejected by unique constraint `(business_id, idempotency_key)`.
5. **CSV Import Auto-Enqueue**: Successfully imported leads generate `initiate_call` jobs.
6. **CSV Filter Integrity**: Skipped/invalid CSV rows do not generate jobs.
7. **Tenant Scoping**: Jobs are strictly tenant-isolated via `businessId`.
8. **Reference Integrity**: Job idempotency keys match corresponding call and lead IDs.
9. **Worker Job Claiming**: Worker successfully claims `queued` jobs and updates state to `dispatching`.
10. **Pre-Dispatch Policy Gate**: Midday valid call allowed by policy engine.
11. **Consent & Suppression Gate**: Suppressed contact blocked pre-dispatch.
12. **Overnight Quiet Hours Gate**: Nighttime call blocked pre-dispatch.

### 2. Full Test Suite Execution
`pnpm test` output:
```text
 Test Files  9 passed (9)
      Tests  144 passed (144)
   Start at  14:28:01
   Duration  4.32s
```

### 3. TypeScript Typecheck
`pnpm run typecheck` output:
```text
$ tsc --build
artifacts/api-server typecheck: Done
artifacts/leadsprint typecheck: Done
scripts typecheck: Done
```

### 4. Package Builds
`pnpm --filter @workspace/api-server run build` & `pnpm --filter @workspace/leadsprint run build`:
```text
dist/index.mjs          3.8mb (API Server)
dist/public/index.html   1.47 kB (Vite SPA Frontend)
```

### 5. Git Diff & Formatting Check
`git diff --check`: Exit code 0 (clean).

---

## Compliance & Security Matrix

| Requirement | Implementation | Status |
| :--- | :--- | :---: |
| **Atomic Job Enqueueing** | Enqueued inside `db.transaction()` along with lead record | ✅ PASS |
| **Worker Independence** | Worker claims via `FOR UPDATE SKIP LOCKED` on cron tick | ✅ PASS |
| **Idempotency** | Deterministic keys `intake_call_${leadId}` & `import_call_${leadId}` | ✅ PASS |
| **Pre-Dispatch Policy** | `evaluateCallPolicy` runs dynamically right before provider call | ✅ PASS |
| **Tenant Isolation** | All queries and inserts explicitly scoped to `businessId` | ✅ PASS |
| **Schema Stability** | Zero schema changes, zero migrations required | ✅ PASS |

---

## Conclusion & Readiness Status

Phase 3 Milestone 3 is **COMPLETE and READY FOR REVIEW**. LeadSprint now provides end-to-end automated outbound outreach upon lead intake and CSV import, with full transaction safety, replay idempotency, and pre-dispatch compliance gating.
