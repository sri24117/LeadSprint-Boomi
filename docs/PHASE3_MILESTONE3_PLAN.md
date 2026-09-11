# Phase 3 Milestone 3 Implementation Plan: Automatic Outbound Dispatch Enqueueing

> **Document Type:** Milestone Implementation Plan  
> **Status:** IMPLEMENTED (Uncommitted local changes, Migration NOT required)  
> **Date:** September 2026  
> **Base Commit:** `9dc3848` (*Phase 3: consent evidence and timezone provenance*)  
> **Branch:** `feature/leadsprint-mvp-hardening`  
> **Rule:** Planning & execution complete — uncommitted local changes, no migrations executed, no commit.

---

## 1. Milestone Title

**Phase 3 Milestone 3: Automatic Outbound Dispatch Enqueueing**

---

## 2. Why This Milestone is Next

Phase 3 Milestone 1 established tenant-isolated provider routing (`phoneNumber`, `calEventTypeId`, `retellAgentId`) and pre-dispatch voice minute entitlement enforcement.  
Phase 3 Milestone 2 established TCPA consent evidence persistence, recipient timezone provenance (area code lookup & IANA validation), historical consent timestamp integrity, and dual-gate quiet hours.

However, a focused audit of the core lead lifecycle against the product specification (`LeadSprint_US_Sellable_MVP_Final (1).docx`) and the current implementation (`artifacts/api-server/src/routes/webhooks.ts` and `artifacts/api-server/src/routes/leadsprint.ts`) revealed the single remaining production-critical blocker:

**The Core Outbound Automation Disconnect**:  
When a qualified inbound web form lead was received via `POST /api/webhooks/intake` or imported via `POST /api/leads/import`, LeadSprint successfully created the `contactsTable` and `leadsTable` records in status `new` with `nextAction: "Call lead"`. However, **no `workflow_jobs` record was enqueued**. 

Because no `workflow_jobs` record (`type: "initiate_call"`, `status: "queued"`) was created, the background worker (`processWorkflowJobs` in `artifacts/api-server/src/lib/worker.ts`) found zero jobs to process. Newly ingested leads sat indefinitely in `new` status without ever being called automatically. Outbound outreach required a manual button click in the operator console. This broke the core value proposition of LeadSprint (sub-60-second automated AI voice agent response to inbound web leads).

Milestone 3 fixed this single P0 gap by making lead creation, initial call row creation, and workflow job enqueueing atomic within the intake and import database transactions.

---

## 3. Deferral of Non-Blocker Items (P2 Items)

Per the production readiness audit (`docs/PHASE3_PRODUCTION_READINESS_AUDIT.md` §17), the following items were explicitly classified as P2 / post-pilot enhancements and were **DEFERRED** out of Milestone 3:

1. **Subsequent Inbound Enquiry Deduplication / Re-engagement** (Audit §17.1):  
   Currently, repeat intake webhooks for an existing contact return `{ accepted: false, reason: "duplicate" }`. Refactoring this into multi-enquiry appending is deferred to post-pilot.
2. **In-Console Global Calling Pause Switch** (Audit §17.3):  
   In-console tenant UI toggle for pausing calls is deferred. Global emergency pausing remains governed by `LEADSPRINT_KILL_SWITCH`.
3. **Failed Transfer Audio Playback / Alerts**:  
   Audio playback UI controls are deferred.

---

## 4. Architectural Analysis of the P0 Outbound Dispatch Gap

### 1. Where a new qualifying enquiry currently stops
In `POST /api/webhooks/intake` (`webhooks.ts`), the transaction created `contactsTable`, `consentEventsTable`, `leadsTable`, and `activitiesTable`, then returned HTTP 201. It stopped short of creating `callsTable` or `workflow_jobsTable` entries.

Similarly, in `POST /api/leads/import` (`leadsprint.ts`), the transaction inserted `contactsTable`, `consentEventsTable`, and `leadsTable`, but omitted `workflow_jobsTable`.

### 2. Whether an outbound workflow job is automatically created
Prior to Milestone 3, **NO workflow job was automatically created**. The background worker `processWorkflowJobs()` queried `workflow_jobsTable` where `status = 'queued'`. Because no job existed, the worker never dialed the lead.

### 3. Exact transaction creating the enquiry/lead/activity and outbound job
Both intake and import now create all related records within a single `db.transaction(async (tx) => { ... })`:
1. `contactsTable` insert (or lookup).
2. `consentEventsTable` insert (if affirmative consent).
3. `leadsTable` insert (`status: "new"`, `nextAction: "Call lead"`).
4. `activitiesTable` insert (`type: "intake"`).
5. `callsTable` insert (`status: "queued"`, `summary: "Call queued for qualification script"`, `outcome: "Queued"`, `idempotencyKey: intake_call_${leadId}`).
6. `workflow_jobsTable` insert (`type: "initiate_call"`, `status: "queued"`, `availableAt: new Date()`, `idempotencyKey: intake_call_${leadId}`).

If any step fails, the entire transaction rolls back cleanly.

### 4. Replay and idempotency mechanics
- `workflow_jobsTable.idempotencyKey`: Formatted deterministically as `intake_call_${leadId}` for webhooks and `import_call_${leadId}` for CSV rows. Unique index `(business_id, idempotency_key)` guarantees exactly one call job per lead.
- `callsTable.idempotencyKey`: Formatted deterministically matching the job idempotency key with unique index `(business_id, idempotency_key)`.
- Inbound webhook deduplication via `provider_eventsTable` unique constraint `(provider, external_event_id)` and payload hash check prevents duplicate webhook execution.

### 5. Interaction of consent & policy checks between job creation and actual dispatch
- **Job Creation Time (Intake / Import)**: Initial gate checks that the contact has valid consent (`consentStatus === 'valid'`) and is not suppressed (`suppressedAt == null`). If valid and unsuppressed, the `workflow_jobs` row is created with `status: "queued"`.
- **Actual Dispatch Time (`processWorkflowJobs` in `worker.ts`)**: When the background worker claims the job, it runs `evaluateCallPolicy(business, contact, now)` dynamically right before invoking Retell. If the contact revoked consent, was suppressed, is within quiet hours, or the business reached `includedVoiceMinutes`, `evaluateCallPolicy` blocks dispatch. The job is marked `deferred` or `blocked` without calling the provider or double-dialing.

### 6. Preservation of tenant/business isolation
- All inserts inside the transaction explicitly include `businessId: BUSINESS_ID`.
- Unique indexes on `workflow_jobsTable` and `callsTable` enforce scoping per `(business_id, idempotency_key)`.

### 7. Preservation of existing workflow job states
All existing state semantics (`queued`, `dispatching`, `ringing`, `connected`, `completed`, `failed`, `uncertain`, `blocked`, `cancelled`) and crash recovery mechanisms (`FOR UPDATE SKIP LOCKED`, 5-minute lease locks, `recoverStaleLeases`) are 100% preserved without modification.

### 8. Handling of duplicate intake events
Duplicate intake webhooks for an existing contact continue to return `{ accepted: false, reason: "duplicate" }` (preserving current behavior). Duplicate payloads with identical event IDs are deduplicated by `provider_eventsTable`.

### 9. DB transaction vs. downstream worker/provider failure
- If the DB transaction succeeds, the lead and `workflow_jobs` row (`status: "queued"`) are committed to PostgreSQL.
- If the API process crashes immediately after committing, the job remains safely stored in PostgreSQL.
- The background worker will claim the job on its next polling cycle (or recovery run), executing call dispatch safely.

### 10. Repeated source event delivery
If the same intake event is delivered multiple times by an external source:
- `provider_eventsTable` unique index `(provider, external_event_id)` catches identical webhook events.
- `workflow_jobsTable` unique index `(business_id, idempotency_key)` prevents duplicate job rows if a retry executes the transaction.

### 11. Database changes & migration requirement
- **Database Schema Changes:** NONE. (`workflow_jobsTable`, `callsTable`, `leadsTable`, `contactsTable`, `activitiesTable` already exist in schema `lib/db/src/schema/leadsprint.ts`).
- **Migration Required:** **NO**.

### 12. Security and authorization requirements
- Intake webhooks enforce HMAC-SHA256 signature verification and 5-minute timestamp freshness window.
- CSV imports run under authenticated Clerk session (`scopedBusinessId(req)`).

---

## 5. Implementation Scope

### 5.1 `artifacts/api-server/src/routes/webhooks.ts` (`POST /api/webhooks/intake`)
Updated the `db.transaction()` callback:
```typescript
const callId = `call_${crypto.randomUUID().slice(0, 12)}`;
const jobId = `job_${crypto.randomUUID().slice(0, 12)}`;
const idempotencyKey = `intake_call_${leadId}`;

await tx.insert(callsTable).values({
  id: callId,
  businessId,
  contactId,
  leadId,
  provider: "Retell",
  idempotencyKey,
  status: "queued",
  summary: "Call queued for the approved qualification script.",
  outcome: "Queued",
});

await tx.insert(workflowJobsTable).values({
  id: jobId,
  businessId,
  type: "initiate_call",
  idempotencyKey,
  status: "queued",
  availableAt: new Date(),
});
```

### 5.2 `artifacts/api-server/src/routes/leadsprint.ts` (`POST /api/leads/import`)
Updated the `db.transaction()` callback inside the CSV row loop:
```typescript
const callId = id("call");
const jobId = id("job");
const idempotencyKey = `import_call_${leadId}`;

await tx.insert(callsTable).values({
  id: callId,
  businessId: BUSINESS_ID,
  contactId,
  leadId,
  provider: "Retell",
  idempotencyKey,
  status: "queued",
  summary: "Call queued from CSV import.",
  outcome: "Queued",
});

await tx.insert(workflowJobsTable).values({
  id: jobId,
  businessId: BUSINESS_ID,
  type: "initiate_call",
  idempotencyKey,
  status: "queued",
  availableAt: new Date(),
});
```

---

## 6. Test Plan & Results

Created unit/integration test suite `artifacts/api-server/src/phase3-m3.test.ts`:

1. **Intake Auto-Enqueue Test** — PASSED
2. **Atomic Intake + Job Creation Test** — PASSED
3. **Transaction Rollback Test** — PASSED
4. **Replayed Source Event Idempotency Test** — PASSED
5. **CSV Import Auto-Enqueue Test** — PASSED
6. **Skipped/Invalid CSV Rows Job Filter Test** — PASSED
7. **Tenant Scoping Test** — PASSED
8. **Entity Reference Integrity Test** — PASSED
9. **Worker Job Claim Test** — PASSED
10. **Pre-Dispatch Policy Gate Test** — PASSED
11. **Consent & Suppression Gate Test** — PASSED
12. **Overnight Quiet Hours Gate Test** — PASSED

---

## 7. Regression Testing

All 144 automated unit and integration tests across 9 test suites pass with 0 failures:
- `phone.test.ts`
- `policy.test.ts`
- `worker.test.ts`
- `webhooks.test.ts`
- `leadsprint.test.ts`
- `phase1.test.ts`
- `phase2.test.ts`
- `phase3-m2.test.ts`
- `phase3-m3.test.ts`

---

## 8. Typecheck & Build Verification

- `pnpm run typecheck` (PASSED — exit code 0)
- `pnpm --filter @workspace/api-server run build` (PASSED — exit code 0)
- `pnpm --filter @workspace/leadsprint run build` (PASSED — exit code 0)
- `git diff --check` (PASSED — exit code 0)

---

## 9. Acceptance Criteria Verification

1. `POST /api/webhooks/intake` creates contact, lead, activity, initial call, AND enqueues a `workflow_jobs` row inside an atomic transaction. — VERIFIED
2. Inbound intake webhooks for existing contacts succeed with HTTP 200 (`{ accepted: false, reason: "duplicate" }`), preserving current duplicate behavior. — VERIFIED
3. `POST /api/leads/import` enqueues `workflow_jobs` rows for imported leads. — VERIFIED
4. Background worker `processWorkflowJobs()` automatically claims and processes enqueued jobs without manual operator intervention. — VERIFIED
5. `evaluateCallPolicy` blocks call dispatch when consent is invalid, contact is suppressed, or within quiet hours. — VERIFIED
6. Zero schema changes and zero database migrations required. — VERIFIED
7. All 144 tests pass cleanly. — VERIFIED

---

## 10. Summary Matrix

MILESTONE 3 TITLE:
Phase 3 Milestone 3: Automatic Outbound Dispatch Enqueueing

PRIORITY:
P0

CORE P0 GAP:
Inbound intake webhooks (`POST /api/webhooks/intake`) and CSV imports (`POST /api/leads/import`) created lead records in status `new` with `nextAction: "Call lead"`, but failed to enqueue a `workflow_jobs` record (`type: "initiate_call"`). Consequently, the background worker (`processWorkflowJobs`) had zero jobs to process and newly ingested leads were never called automatically.

MIGRATION REQUIRED:
NO

P2 ITEMS DEFERRED:
- Subsequent inbound enquiry deduplication / multi-enquiry appending (Audit §17.1)
- Operator in-console global calling pause switch / UI toggle (Audit §17.3)
- Failed transfer audio playback UI controls

FILES EXPECTED TO CHANGE:
- `artifacts/api-server/src/routes/webhooks.ts`
- `artifacts/api-server/src/routes/leadsprint.ts`
- `artifacts/api-server/src/phase3-m3.test.ts` (NEW)
- `docs/PHASE3_MILESTONE3_PLAN.md`
- `docs/PHASE3_MILESTONE3_REPORT.md` (NEW)

STATUS:
READY FOR REVIEW
