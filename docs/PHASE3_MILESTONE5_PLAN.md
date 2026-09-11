# Phase 3 Milestone 5 Implementation Plan: Subsequent Inbound Enquiry Re-engagement & Source-Event Deduplication

> **Document Type:** Milestone Implementation Plan  
> **Milestone:** Phase 3 Milestone 4 Follow-up (Milestone 5)  
> **Priority:** P2 (Highest-Value Remaining Commercial & Sellability Feature)  
> **Migration Required:** NO  
> **Database Schema Changes:** NONE  
> **Status:** PENDING REVIEW & APPROVAL  
> **Date:** September 2026  

---

## 1. Executive Summary & Priority Classification

All P0 (critical multi-tenant blockers) and P1 (compliance, security, automated enqueueing, freshness enforcement) items identified in the Phase 3 Production Readiness Audit and Current Implementation Audit have been completed and committed across Milestones 1 through 4:
- **Milestone 1:** Multi-Tenant Provider Binding & Usage Entitlement Enforcement (P0)
- **Milestone 2:** Recipient Timezone Provenance & TCPA Consent Evidence (P1)
- **Milestone 3:** Automatic Outbound Dispatch Enqueueing (P1)
- **Milestone 4:** Webhook Freshness Enforcement (P1)

**Explicit Priority Statement:**  
All remaining open audit items in the repository belong to the **P2** tier. Among all deferred P2 items, **Subsequent Inbound Enquiry Re-engagement** represents the single highest-value sellability, operational, and customer experience gap for LeadSprint.

---

## 2. Problem Statement & Commercial Rationale

### Current Behavior:
In `POST /api/webhooks/intake` ([`artifacts/api-server/src/routes/webhooks.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/webhooks.ts)), when an inbound intake payload is received for a phone number that already exists in `contactsTable` for the tenant (`(businessId, phone)`), the route immediately short-circuits:
```ts
if (existing) {
  result = { accepted: false, reason: "duplicate" };
  return;
}
```
This returns HTTP 200 `{ accepted: false, reason: "duplicate" }` and **completely drops the payload**.

### Commercial & Operational Impact:
In real estate and local service operations, prospects and existing clients frequently re-engage by submitting new web forms for different properties or campaigns. Dropping these subsequent enquiries causes real commercial leads to be ignored, missing the critical < 5-minute lead response window.

---

## 3. Correctness Requirements & Technical Mechanics

### 3.1 `acceptProviderEvent` Transaction Atomicity (CRITICAL)

Currently, `acceptProviderEvent()` in `webhooks.ts` uses the global `db` client directly. To ensure true transaction atomicity (where a failure during lead/activity/call creation rolls back provider event registration as well):

1. **Transaction Client Parameter**:
   - Update `acceptProviderEvent` to accept an optional transaction client `tx` parameter (`dbOrTx = db`).
2. **Transaction Sequence**:
   ```ts
   await db.transaction(async (tx) => {
     const accepted = await acceptProviderEvent({
       businessId,
       provider: "LeadIntake",
       externalEventId: eventId(req, body),
       eventType: "lead_intake",
       payload: body,
     }, tx);

     if (!accepted) {
       result = { accepted: true, duplicate: true };
       return;
     }

     // Perform contact update, lead update/creation, activity log, call/job enqueueing using tx
   });
   ```
3. **Atomic Rollback Guarantee**:
   - If any step inside `tx` fails (e.g. database error), the entire transaction rolls back—**including the provider event registration**. This guarantees zero half-written state or orphaned event locks.

### 3.2 Event ID & Payload Hash Semantics

`eventId(req, body)` extracts event identifiers in order:
1. `body.event_id`
2. `body.id`
3. `x-event-id` header
4. **Fallback**: SHA-256 hash of the exact raw request body bytes.

#### Event Classification & Limitations:
- **Exact Replay**: Same raw body bytes or same explicit event ID → identical hash/ID → `acceptProviderEvent` returns `accepted: false` → HTTP 200 `{ accepted: true, duplicate: true }` with zero state mutations.
- **Legitimate New Event**: Distinct payload (different timestamp, property, campaign, or event ID) → distinct hash/ID → processed as new re-engagement.
- **Identical Payload Without Explicit Event ID (Explicit Limitation)**: If a caller submits two separate intake requests with **100% byte-for-byte identical JSON body** (same timestamp string, phone, property) without an explicit `event_id` or `x-event-id`, the raw body SHA-256 hash will be identical and the second request will be identified as a replay. Callers wishing to submit identical payloads for the same contact must supply a unique `event_id` or `x-event-id` header.

### 3.3 Verified Lead Status Semantics

The `leadsTable` schema supports the following enum statuses:
- **Active / Re-engageable States**: `new`, `contacted`, `qualified`.
- **Terminal / Closed States**: `booked`, `closed`, `suppressed`.

#### Re-engagement Behavior:
- **Existing Active Lead (`new`, `contacted`, `qualified`)**:
  - Update the existing lead record: set `status: "new"`, update `campaign`, `project`, `propertyType`, `budgetLabel`, `location`, `timeline`, set `nextAction: "Call lead"`, and `updatedAt: new Date()`.
- **Existing Terminal Lead (`booked`, `closed`, `suppressed`)**:
  - Create a **NEW** lead record (`lead_${UUID}`) with `status: "new"`, `nextAction: "Call lead"`, and the new enquiry details.

### 3.4 Intent Score Rules (No Synthetic Score / No Default 50)

- **Do NOT** calculate, invent, recalculate, or default an intent score to 50 for re-engagement.
- **Existing Lead Update**:
  - If `body.intent_score` or `body.intentScore` is explicitly provided as a valid number (0–100), update `intentScore`.
  - Otherwise, **preserve `existingLead.intentScore`**.
- **New Lead Creation**:
  - If `body.intent_score` or `body.intentScore` is explicitly provided as a valid number (0–100), use that score.
  - Otherwise, omit `intentScore` from explicit insert values to let the database schema default handle creation without synthetic application calculation.
- **Do NOT** introduce any scoring algorithm or synthetic score calculation.

### 3.5 Consent & Timezone Anti-Fabrication Rules

- Preserve Milestone 2 rules: An `opt_in` consent event is created **ONLY IF** affirmative consent is explicitly signaled (`body.consent_given === true || body.consentGiven === true || body.consent_given === "true"`).
- Contact updates, repeated form submissions, email updates, or timezone updates do **NOT** create consent events by themselves.
- If invalid `consent_captured_at` or invalid `consent_source` is supplied alongside affirmative consent, return HTTP 400.
- Timezone updates follow strict `isValidIanaTimezone()` validation; invalid values fall back to area-code inference (`inferTimezoneFromPhone`).

### 3.6 Call Policy & Worker Authority

- `/api/webhooks/intake` enqueues a `queued` call row in `callsTable` and a `queued` job in `workflowJobsTable` (`type: "initiate_call"`).
- Intake **MUST NOT** directly invoke Retell API or bypass call policy gates.
- The background `worker.ts` remains 100% authoritative for evaluating consent status, suppression/DNC, quiet hours, usage entitlements, tenant provider credentials, and global kill switches before dispatching.

---

## 4. Scope Control

### Strict IN-SCOPE Items:
1. Transactional `acceptProviderEvent` deduplication in `POST /api/webhooks/intake`.
2. Contact detail refresh on re-engagement.
3. Lead status updates for active leads vs. new lead creation for terminal leads.
4. Activity audit logging (`type: "intake"`, `title: "Re-engaged lead received for [Name]"`).
5. Atomic creation of `callsTable` and `workflowJobsTable` records inside `db.transaction(async (tx) => { ... })`.
6. Unit and integration test suite in `artifacts/api-server/src/phase3-m5.test.ts`.
7. Post-implementation verification report in `docs/PHASE3_MILESTONE5_REPORT.md`.

### Explicit OUT-OF-SCOPE Items:
- **Uncertain-call reconciliation** (P2): Deferred.
- **Concurrent same-phone dispatch guard** (P2): Deferred.
- **Global operator calling pause UI** (P2): Deferred.
- **Failed-transfer audio UI** (P2): Deferred.
- **Database Schema Migrations**: NO schema changes (`lib/db/src/schema/leadsprint.ts` remains untouched).
- **Architecture Rewrites**: NO external job queues, Redis, n8n, or microservices.

---

## 5. Architectural Boundaries & Constraints

- **NO Schema Changes**: Existing schema in `lib/db/src/schema/leadsprint.ts` is fully sufficient.
- **NO Migrations**: Zero migration files created or executed in `lib/db/drizzle/*`.
- **Transactional Integrity**: All updates execute inside a single `db.transaction(async (tx) => { ... })`.

---

## 6. Expected Files to Change

| File | Change Type | Purpose |
|------|-------------|---------|
| `artifacts/api-server/src/routes/webhooks.ts` | Modify | Update `acceptProviderEvent` helper to accept `tx` and update `/webhooks/intake` to support re-engagement and replay defense. |
| `artifacts/api-server/src/phase3-m5.test.ts` | Create | Comprehensive unit and integration test suite. |
| `docs/PHASE3_MILESTONE5_PLAN.md` | Document | Milestone 5 planning document (this document). |
| `docs/PHASE3_MILESTONE5_REPORT.md` | Document | Post-implementation verification report. |

---

## 7. Comprehensive Test Matrix

The test suite in `artifacts/api-server/src/phase3-m5.test.ts` will cover the following test scenarios:

| Test # | Test Scenario | Expected Outcome |
|---|---|---|
| **A** | Existing contact + active lead (`new`/`contacted`/`qualified`) → re-engagement | Updates lead to `status: "new"`, updates campaign/property, logs activity, enqueues call/workflow job (HTTP 201 `{ accepted: true, re_engaged: true }`). |
| **B** | Existing contact + terminal lead (`booked`/`closed`/`suppressed`) → new lead | Creates new lead record (`lead_${UUID}`), logs activity, enqueues call/workflow job (HTTP 201 `{ accepted: true, re_engaged: true }`). |
| **C** | Existing contact + identical source event replay | `acceptProviderEvent` detects duplicate external event ID → HTTP 200 `{ accepted: true, duplicate: true }` with NO duplicate lead/call/job/activity. |
| **D** | Two concurrent identical source events | First transaction succeeds; second hits unique constraint on `providerEventsTable` and returns duplicate with zero duplicate state writes. |
| **E** | New source event from same contact | Different event ID/payload hash → processed as legitimate new re-engagement. |
| **F** | Contact field refresh | Updates `email`, `name`, `intakeIp`, `recipientTimezone` on existing contact without altering consent events. |
| **G** | Explicit affirmative consent refresh | Inbound re-engagement with `consent_given: true` creates an `opt_in` record in `consentEventsTable`. |
| **H** | Non-affirmative payload | Inbound re-engagement without explicit consent signal does NOT create a consent event. |
| **I** | Timezone/provenance validation | Valid IANA string updates timezone as `explicit_intake`; invalid string falls back to area-code inference. |
| **J** | Worker policy authority | Re-engaged lead call job remains `queued` and is only dispatched after worker evaluates consent, DNC, quiet hours, and usage limits. |
| **K** | Atomic transaction rollback | Failure during lead/call creation rolls back entire transaction (including provider event registration). |
| **L** | Full regression suite | All 166+ existing repository tests continue passing cleanly. |

---

## 8. Acceptance Criteria

- [ ] `POST /api/webhooks/intake` accepts re-engagement webhooks from existing contacts, returning HTTP 201 `{ accepted: true, re_engaged: true, lead_id: ... }`.
- [ ] `acceptProviderEvent` operates on the transaction client (`tx`) ensuring atomic rollback on failure.
- [ ] Source event replay defense returns HTTP 200 `{ accepted: true, duplicate: true }` without duplicate DB mutations.
- [ ] Active leads (`new`, `contacted`, `qualified`) are updated to `status: "new"`; terminal leads (`booked`, `closed`, `suppressed`) trigger a new lead creation.
- [ ] `intentScore` is preserved on active lead updates unless an explicit valid score is supplied; default synthetic score calculation is removed.
- [ ] Affirmative consent rules and timezone validation follow Milestone 2 anti-fabrication semantics.
- [ ] `callsTable` and `workflowJobsTable` jobs are enqueued automatically inside the same database transaction.
- [ ] Zero schema migrations or Drizzle schema file changes.
- [ ] `pnpm --filter api-server test`, `typecheck`, and `build` pass with zero errors.

---

## 9. Implementation Confirmation

- Implementation has **NOT** started.
- No application files modified.
- No test files created yet.
- No commit, push, or deployment performed.
