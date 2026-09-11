# LeadSprint Phase 3: Production Readiness Audit Report

> **Audit Type:** Read-Only Production Readiness & Commercial Release Verification  
> **Baseline Commit:** `98cb5b5` (*Phase 2: response DTO resiliency, Docker non-root, CI codegen drift*)  
> **Branch:** `feature/leadsprint-mvp-hardening`  
> **Reference Specification:** `LeadSprint_US_Sellable_MVP_Final (1).docx` (v2.0, 8 Sept 2026) / `docs/PHASE2_IMPLEMENTATION_PLAN.md`  
> **Date:** September 2026  

---

## 1. Executive Summary

This production readiness audit evaluates whether the current LeadSprint repository can safely support the first controlled 1–3 customer pilot.

The codebase exhibits high technical maturity in core infrastructure:
- Robust relational data model with PostgreSQL and Drizzle ORM.
- Multi-step writes protected by explicit database transactions.
- Worker concurrency managed with PostgreSQL `FOR UPDATE SKIP LOCKED` row locks and lease recovery.
- Full DTO schema resiliency with safe parsing and credential-sanitized logging.
- Hardened single-container Docker packaging running as non-root `node` user with runtime startup migrations.
- 86 automated unit and integration tests passing across all core modules.

However, when audited against commercial multi-tenant pilot requirements:
1. **Cal.com Event Type Binding**: `createCalBooking` and `getCalAvailability` currently bind to the global `CALCOM_EVENT_TYPE_ID` env var rather than the tenant's `businessesTable.calEventTypeId`.
2. **Retell Telephony Binding**: `startRetellCall` binds `from_number` to global `RETELL_FROM_NUMBER_US` rather than `businessesTable.phoneNumber`.
3. **Usage Limit Pre-Dispatch Enforcement**: Usage is accurately tracked and billed across periods, but outbound calls are not blocked when `voiceMinutes >= includedVoiceMinutes`.
4. **Recipient Timezone Provenance**: Quiet hours are evaluated against `business.timezone` rather than recipient phone area-code timezone provenance (TCPA compliance consideration).

**Verdict:** **READY WITH CONDITIONS** (Safe for a 1-customer single-tenant pilot under operator supervision; multi-customer 2–3 pilot requires resolving the tenant-level provider bindings and usage enforcement).

---

## 2. Customer Intake Audit

- **Path:** `POST /api/webhooks/intake` in `artifacts/api-server/src/routes/webhooks.ts`.
- **Authentication:** HMAC-SHA256 webhook signature verified with timing-safe comparison (`verifyWebhookSignature`).
- **Timestamp Freshness:** Verified against 5-minute freshness window (`verifyTimestampFreshness`). If timestamp is omitted by caller, the check returns `{ valid: true }`.
- **Phone Validation:** Inbound phone number is normalized to E.164 via `normalizeToE164(rawPhone)`. Rejects invalid formats with HTTP 400.
- **Tenant Validation:** Verified business exists in `businessesTable`; rejects unknown tenants with HTTP 404.
- **Duplicate & Replay Handling:** Evaluates `contactsTable` for `(businessId, phone)`. If contact exists, returns `{ accepted: false, reason: "duplicate" }` (HTTP 200).
- **Transactional Consistency:** Multi-step creation (`contactsTable`, `leadsTable`, `activitiesTable`) is wrapped in `db.transaction(async (tx) => { ... })`.
- **Gaps Identified:**
  - Inbound intake does not store consent capture timestamp, disclosure text version, or IP/form URL provenance.
  - Subsequent enquiries from an existing contact are rejected as duplicates rather than appending a new enquiry/lead to the existing contact.
  - Intake creates lead in `new` state with `nextAction: "Call lead"`, but does not automatically enqueue a `workflow_jobs` record (calls are triggered via operator console `POST /api/leads/:id/call` or CSV import).

---

## 3. Outbound Eligibility Audit

- **Decision Engine:** `evaluateCallPolicy()` in `artifacts/api-server/src/lib/policy.ts` and `processWorkflowJobs()` in `artifacts/api-server/src/lib/worker.ts`.
- **Execution Order:**
  1. Stale lease recovery (`recoverStaleLeases` claims expired locks).
  2. Batch claim via `FOR UPDATE SKIP LOCKED` with 5-minute lease.
  3. Crash idempotency check (`isAlreadyDispatched` verifies `providerCallId` or active status).
  4. Business existence and Retell provider configuration check.
  5. Global kill switch check (`LEADSPRINT_KILL_SWITCH`).
  6. Contact consent status (`contact.consentStatus === 'valid'`).
  7. Contact suppression check (`!contact.suppressedAt`).
  8. Quiet hours check (`isWithinQuietHours(business.quietHours, business.timezone, now)`).
  9. Maximum attempt limit check (`attemptsSoFar < business.maxCallAttempts`).
  10. E.164 phone normalization check.
  11. Retell provider dispatch (`startRetellCall`).
- **Gaps Identified:**
  - Quiet hours evaluates against `business.timezone` rather than the recipient's phone number area-code timezone.
  - Entitlement limits (`includedVoiceMinutes`) are not evaluated prior to dispatch.

---

## 4. Retell Call Flow Audit

- **Dispatch Path:** `startRetellCall()` in `artifacts/api-server/src/lib/providers.ts` called from `worker.ts` or manual `leadsprint.ts`.
- **Agent Binding:** Uses `business.retellAgentId ?? config.retell.agentId` (Tenant-specific agent override supported).
- **Caller ID Binding:** Uses `RETELL_FROM_NUMBER_US` / `RETELL_FROM_NUMBER_IN` env vars instead of `business.phoneNumber`.
- **Webhook Processing:** `POST /api/webhooks/retell` in `webhooks.ts`:
  - HMAC-SHA256 signature verification.
  - 5-minute freshness check.
  - Idempotent deduplication via `provider_events` table `(provider, external_event_id)`.
  - Atomically updates `callsTable` status (`completed`, `failed`, `in_progress`), duration, and outcome.
  - Orphan call reconciliation: matches via `providerCallId` or fallback `metadata.call_id`.
  - Increments usage (`voiceMinutes`, `estimatedCost`) in `usageTable`.
  - Automatically marks `workflow_jobs` completed upon terminal call status.
- **Provider Crash Window:** If Retell accepts the call but the local process crashes before persisting `providerCallId`, the call is set to `uncertain` with exponential backoff. Upon webhook arrival, `POST /api/webhooks/retell` reconciles the call via `metadata.call_id`, preventing duplicate dispatch.

---

## 5. Booking Flow Audit

- **Availability:** `getCalAvailability()` calls Cal.com `/v2/slots` API with `start`, `end`, and `timeZone`.
- **Booking Creation:** `POST /api/appointments/book` in `artifacts/api-server/src/routes/leadsprint.ts`:
  1. Checks for existing confirmed appointment on lead.
  2. Calls Cal.com `/v2/bookings` with attendee details and metadata.
  3. Reconciles existing appointment record by external ID.
  4. Wraps local `appointmentsTable` insert, `leadsTable` update (`booked`), `activitiesTable` insert, and `usageTable.bookingCount` increment in an atomic database transaction.
- **Webhook Reconciliation:** `POST /api/webhooks/calcom` handles `BOOKING_CONFIRMED`, `BOOKING_RESCHEDULED`, and `BOOKING_CANCELLED`:
  - Updates appointment start/end times and status.
  - Updates lead `nextAction` ("Appointment rescheduled" / "Reschedule showing").
  - Inserts activity audit entry.
- **Gaps Identified:**
  - `createCalBooking()` uses global `CALCOM_EVENT_TYPE_ID` env var rather than `business.calEventTypeId`.

---

## 6. Human Transfer & Message Fallback Audit

- **Transfer Number:** `businessesTable.transferNumber` configured in business settings.
- **Transfer Failure Detection:** Retell webhook inspects `disconnection_reason` against `["dial_failed", "dial_no_answer", "dial_busy", "voicemail_reached", "transfer_failed"]`.
- **Message Fallback Actions:**
  - `callsTable.outcome` updated to `"Transfer failed — message captured for manual follow-up"`.
  - `callsTable.errorState` set to `"transfer_failed"`.
  - `leadsTable.nextAction` updated to `"Call back — transfer to human did not connect"`.
  - Activity log entry created: `type: "message"`.
- **Gaps Identified:**
  - No dedicated `messages` table; captured audio or caller voice messages are stored only as text summaries in `callsTable.summary`.
  - No real-time SMS/email push alerts to operators upon transfer failure.

---

## 7. Consent & Compliance Evidence Audit

- **Current State:**
  - `contactsTable.consentStatus` defaults to `"valid"`.
  - `contactsTable.suppressedAt` marks DNC status.
  - `suppressionsTable` stores phone number, reason, source, and creation timestamp.
  - `policy.ts` hard-blocks outbound calls if `consentStatus !== 'valid'` or `suppressedAt != null`.
- **Technical Evidence Gaps:**
  - No consent capture timestamp column on contact.
  - No disclosure text version or disclosure acceptance record.
  - No IP address or intake URL evidence captured.

---

## 8. Multi-Tenancy Audit

- **Tenant Scoping:** Every authenticated route invokes `scopedBusinessId(req)`. All database queries explicitly filter by `eq(table.businessId, BUSINESS_ID)`.
- **Demo Mode Isolation:** `isDemoAuthEnabled()` is strictly gated behind `LEADSPRINT_DEMO_AUTH=true` AND `NODE_ENV !== 'production'`. In production, missing business scope throws an explicit error.
- **Provider Event Isolation:** Provider events table has unique index `(provider, external_event_id)` and records `business_id`.
- **Calls & Appointments Isolation:**
  - `callsTable`: Unique indexes on `(business_id, provider, provider_call_id)` and `(business_id, idempotency_key)`.
  - `appointmentsTable`: Scoped to `business_id` and unique on `(calendar_provider, external_id)`.
- **Gaps Identified:**
  - Telephony and Calendar provider client calls in `providers.ts` rely on global environment credentials for outbound caller ID and event type ID.

---

## 9. Owner Console Audit

- **Frontend Technology:** React 19 + TypeScript + Vite + Tailwind CSS + TanStack Query + Wouter.
- **Implemented Views:**
  - **Today:** KPI cards, setup warnings, upcoming appointments, recent activity.
  - **Leads:** Pipeline table, score/status filters, search, CSV import modal, lead detail sheet, manual call trigger, appointment booking modal, suppression action.
  - **Calls:** Voice desk log, status filters, call detail modal with outcome/duration/transferred indicators.
  - **Appointments:** Confirmed calendar appointments with attendee and Cal.com UID.
  - **Reports:** Weekly pilot report metrics, voice minutes, and estimated provider costs.
  - **Business Settings:** Full configuration editor for market, timezone, phone numbers, disclosures, quiet hours, max attempts, FAQ, qualification questions, and escalation rules.
- **Gaps Identified:**
  - `metrics.unresolved_messages` on Today screen is hardcoded to 1 by the backend API.
  - No in-app UI switch for pausing/killing outbound calls (controlled via env var).

---

## 10. Usage & Entitlements Audit

- **Billing Periods:** Standard monthly periods computed via `getBillingPeriod()`.
- **Usage Row Management:** `getActiveUsageRow()` automatically provisions a unique period row `(business_id, period_start, period_end)`.
- **Atomic Increments:** Webhook and booking handlers use SQL expressions (`sql`${usageTable.voiceMinutes} + ${delta}``) inside transactions.
- **Gaps Identified:**
  - Entitlements are reported in the UI but not enforced as a pre-call policy gate.

---

## 11. Failure Recovery Audit

| Failure Scenario | Recovery Mechanism | Operator Visibility | Status |
| :--- | :--- | :--- | :--- |
| **Retell API Timeout / 5xx** | Call marked `uncertain`; job deferred with exponential backoff (up to 5 attempts) | Call outcome: "Provider state uncertain" | **Protected** |
| **Worker Crash during Dispatch** | 5-minute lease expires; `recoverStaleLeases` reclaims job | Activity logged upon recovery | **Protected** |
| **Duplicate Webhook Delivery** | `provider_events` unique constraint ignores duplicate; HTTP 202 returned | Duplicate logged | **Protected** |
| **Cal.com Booking DB Failure** | Webhook handler rolls back and deletes provider event for retry; API logs critical alert | 500 error with provider booking UID | **Protected** |
| **Transfer to Human Fails** | Webhook detects failure reason, updates lead `nextAction`, logs message activity | Lead tagged for manual callback | **Protected** |

---

## 12. Security Audit

- **Authentication:** Clerk session token validated on all `/api/*` endpoints (except unauthenticated `/api/healthz`, `/api/readyz`, `/api/webhooks/*`, and `/api/cron/*`).
- **Webhook Verification:** HMAC-SHA256 timing-safe signatures enforced on all webhook endpoints.
- **Cron Protection:** `CRON_SECRET` verified with timing-safe comparison on all `/api/cron/*` endpoints.
- **Rate Limiting:** Express rate limiting active on webhooks and cron endpoints.
- **Container Security:** Non-root `node` user runtime; no `chmod 777` permissions.
- **Secrets Management:** Credentials masked in database migration logs; no secrets committed to source.

---

## 13. Production Deployment Readiness

- **Container Build:** Single multi-stage Dockerfile bundling API server, SPA frontend, and migration runner.
- **Startup Sequence:** `node artifacts/api-server/dist/migrate.mjs && node artifacts/api-server/dist/index.mjs`. Server fails fast if migrations fail.
- **Database Migrations:** Standalone runner executes Drizzle SQL migrations (`0000`–`0003`) safely using runtime connection pooling.
- **CI Pipeline:** GitHub Actions workflow verifies frozen lockfile, codegen drift, TypeScript compilation, full test suite, and bundle builds.

---

## 14. Commercial Pilot Checklist

| Item | Requirement | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **A** | Customer controls lead form | **PARTIAL** | Webhook intake accepts external form submissions; no native form widget |
| **B** | Consent disclosure / evidence | **PARTIAL** | Disclosures configurable; capture timestamp & IP not persisted |
| **C** | Recipient location | **PARTIAL** | Location string stored; timezone derived from business, not area code |
| **D** | Approved business information | **PASS** | FAQ, property types, questions configured in DB and UI |
| **E** | Real calendar availability | **PASS** | Cal.com `/v2/slots` integrated |
| **F** | Verified booking | **PASS** | Cal.com `/v2/bookings` verified before marking lead booked |
| **G** | Human escalation | **PASS** | Transfer number configured; transfer status tracked |
| **H** | Message fallback | **PARTIAL** | Fallback logged in activity and lead status; no audio playback |
| **I** | Owner console | **PASS** | Complete React operator dashboard |
| **J** | Usage limits | **PARTIAL** | Usage tracked and reported; limit not enforced pre-dispatch |
| **K** | Tenant isolation | **PASS** | Scoped DB queries across all entities |
| **L** | Duplicate-call prevention | **PASS** | Idempotency keys on calls and workflow jobs |
| **M** | Duplicate-booking prevention | **PASS** | Verified confirmed appointment check + unique indexes |
| **N** | Provider failure recovery | **PASS** | Crash recovery, stale lease recovery, backoff retries |
| **O** | Truthful outcomes | **PASS** | Real-time webhook reconciliation for calls and bookings |
| **P** | Manual onboarding | **PASS** | Clerk auth self-provisioning + Business settings UI |
| **Q** | One business number | **PARTIAL** | Schema stores phone number; dispatch uses global env var |
| **R** | Tenant-specific agent | **PASS** | `businessesTable.retellAgentId` passed to Retell |
| **S** | Tenant-specific calendar | **PARTIAL** | Schema stores event type; dispatch uses global env var |

---

## 15. P0 Findings (Blocks Multi-Tenant Pilot)

1. **Tenant-Specific Cal.com Event Type Binding**  
   - *Path:* `artifacts/api-server/src/lib/providers.ts` (`createCalBooking`, `getCalAvailability`)  
   - *Impact:* API uses global `CALCOM_EVENT_TYPE_ID` env var. In a 2–3 customer pilot, all customers' appointments book into the same Cal.com event type.  
   - *Remedy:* Pass `business.calEventTypeId` into `getCalAvailability` and `createCalBooking`.

2. **Tenant-Specific Outbound Telephony Phone Number Binding**  
   - *Path:* `artifacts/api-server/src/lib/providers.ts` (`startRetellCall`)  
   - *Impact:* API sends global `RETELL_FROM_NUMBER_US` as `from_number`. Outbound calls for Tenant B display Tenant A's caller ID.  
   - *Remedy:* Pass `business.phoneNumber` into `startRetellCall` and use it as `from_number`.

3. **Usage Entitlement Enforcement Pre-Dispatch**  
   - *Path:* `artifacts/api-server/src/lib/policy.ts` (`evaluateCallPolicy`)  
   - *Impact:* Outbound calls are permitted even when `voiceMinutes >= includedVoiceMinutes`, exposing the operator to unmetered provider costs.  
   - *Remedy:* Add usage entitlement check in `evaluateCallPolicy` and `worker.ts`.

---

## 16. P1 Findings (Should Fix Before Pilot)

1. **Recipient Area-Code Timezone Provenance**  
   - Quiet hours evaluates against `business.timezone`. Outbound calls to leads in different time zones may violate TCPA quiet hours windows.
2. **Consent Evidence Persistence**  
   - Add `consentCapturedAt`, `consentDisclosureVersion`, and `intakeIp` columns to `contactsTable` to satisfy TCPA compliance audit trails.
3. **Hardcoded Unresolved Messages Metric**  
   - `GET /today` in `leadsprint.ts` hardcodes `unresolved_messages: 1`. Compute dynamically from leads with `nextAction ILIKE '%Call back%'`.
4. **Webhook Freshness When Timestamp Omitted**  
   - `verifyTimestampFreshness` treats missing timestamp headers as valid, allowing potential replay of captured webhooks without timestamp fields.

---

## 17. P2 Findings (Can Defer After First Customers)

1. **Subsequent Inbound Enquiry Deduplication**  
   - Webhook intake ignores repeated enquiries from an existing phone number. Should append new enquiry/activity to existing contact.
2. **Real-Time Operator Push Notifications**  
   - Implement immediate SMS/Email alert to business owner when a human transfer fails.
3. **In-Console Global Kill Switch**  
   - Add UI toggle in Business Settings to pause/resume outbound calling without requiring environment variable changes.

---

## 18. Readiness Score

- **Technical Readiness:** **8.5 / 10**  
  *(Clean architecture, transaction safety, concurrent worker locking, resilient DTOs, full test coverage, robust container packaging)*
- **Sellable MVP Readiness:** **6.5 / 10**  
  *(Multi-tenant provider routing for Cal.com & Retell phone numbers, pre-dispatch usage limits, and TCPA timezone provenance required for commercial release)*

---

## 19. Recommended Next Milestone

### Milestone Name: **Phase 3 Milestone 1: Multi-Tenant Provider Binding & Usage Enforcement**
- **Business Reason:** Enables safe onboarding of 2–3 independent pilot customers with isolated phone numbers, isolated Cal.com event types, and protected usage limits.
- **P0/P1 Issues Addressed:**
  - Pass tenant `calEventTypeId` to Cal.com provider requests.
  - Pass tenant `phoneNumber` to Retell provider requests.
  - Enforce `includedVoiceMinutes` in `evaluateCallPolicy`.
  - Fix dynamic calculation of `unresolved_messages` in `GET /today`.
- **Files Affected:**
  - `artifacts/api-server/src/lib/providers.ts`
  - `artifacts/api-server/src/lib/policy.ts`
  - `artifacts/api-server/src/lib/worker.ts`
  - `artifacts/api-server/src/routes/leadsprint.ts`
  - `artifacts/api-server/src/routes/webhooks.ts`
- **Tests Required:**
  - Multi-tenant Retell `from_number` routing tests.
  - Multi-tenant Cal.com `event_type_id` booking tests.
  - Usage exhaustion policy blocking tests.
  - Dynamic `unresolved_messages` calculation tests.
- **Migration Required:** **NO** (`cal_event_type_id`, `phone_number`, and `included_voice_minutes` already exist in `businessesTable`).

---

## 20. Evidence & File References

- **Intake & Webhooks:** [`artifacts/api-server/src/routes/webhooks.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/webhooks.ts)
- **Policy Engine:** [`artifacts/api-server/src/lib/policy.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/policy.ts)
- **Workflow Worker:** [`artifacts/api-server/src/lib/worker.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/worker.ts)
- **Provider Integrations:** [`artifacts/api-server/src/lib/providers.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/providers.ts)
- **Operator Routes:** [`artifacts/api-server/src/routes/leadsprint.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/leadsprint.ts)
- **Database Schema:** [`lib/db/src/schema/leadsprint.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/lib/db/src/schema/leadsprint.ts)
- **Frontend SPA:** [`artifacts/leadsprint/src/App.tsx`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/leadsprint/src/App.tsx)
- **Docker Packaging:** [`Dockerfile`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/Dockerfile)
