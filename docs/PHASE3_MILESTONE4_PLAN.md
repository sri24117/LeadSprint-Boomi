# Phase 3 Milestone 4 Implementation Plan: Webhook Freshness Enforcement

> **Document Type:** Milestone Implementation Plan  
> **Milestone:** Phase 3 Milestone 4  
> **Priority:** P1  
> **Migration Required:** NO  
> **Database Schema Changes:** NONE  
> **Status:** PENDING REVIEW & APPROVAL  
> **Date:** September 2026  

---

## 1. Milestone Overview & Primary Objective

**Milestone Title:** Phase 3 Milestone 4: Webhook Freshness Enforcement

**Primary Objective:**  
Fix and harden `verifyTimestampFreshness()` within `artifacts/api-server/src/routes/webhooks.ts` so that missing, empty, malformed, stale, or future timestamps cannot bypass webhook replay protection.

Currently, `verifyTimestampFreshness()` returns `{ valid: true }` when a timestamp is `undefined`, `null`, or `""`. This allows an attacker who captures a signed request or strips an optional header/timestamp field to replay requests indefinitely if unique event ID tracking is not enforced on omitted IDs. Requiring a strict, valid, fresh timestamp ensures deterministic replay defense across all webhook entrypoints (`/api/webhooks/intake`, `/api/webhooks/retell`, `/api/webhooks/twilio/status`, `/api/webhooks/calcom`).

---

## 2. Why This is the Highest-Priority Remaining Item

Following the successful completion of Milestone 3 (Atomic Outbound Dispatch Enqueueing), the core transaction pipeline from intake to call dispatch is durable and verified.

The webhook freshness loophole is the **only remaining P1 security vulnerability** identified in the Phase 3 production audit:
- It affects public webhook endpoints that accept external partner/caller data.
- Bypassing freshness checks allows replay attacks, potentially triggering duplicate outbound calls, spurious appointment cancellations, or improper billing/analytics increments.
- Closing this vulnerability does not require schema changes or architecture redesign, but establishes zero-trust boundary validation on all external webhooks prior to production launch.

---

## 3. Required Behavior & Validation Semantics

1. **Fresh valid timestamp → accepted**: Timestamps (ISO-8601 strings, UNIX epoch in seconds or milliseconds) within the `MAX_WEBHOOK_AGE_MS` (5-minute) freshness window relative to `Date.now()` evaluate to `{ valid: true }`.
2. **Missing timestamp (`undefined`, `null`) → rejected**: Returns `{ valid: false, reason: "Missing timestamp" }` (HTTP 400 with descriptive error).
3. **Empty timestamp (`""`, whitespace-only string) → rejected**: Returns `{ valid: false, reason: "Missing timestamp" }` or `{ valid: false, reason: "Unparseable timestamp string" }`.
4. **Malformed timestamp (invalid string / NaN) → rejected**: Unparseable strings return `{ valid: false, reason: "Unparseable timestamp string" }`.
5. **Stale timestamp (older than freshness window) → rejected**: Timestamps older than `Date.now() - MAX_WEBHOOK_AGE_MS` return `{ valid: false, reason: "Timestamp outside freshness window (...s old)" }`.
6. **Future timestamp (too far in future) → rejected**: Timestamps greater than `Date.now() + MAX_WEBHOOK_AGE_MS` (or exceeding allowable future clock skew) return `{ valid: false, reason: "Timestamp outside freshness window (...s old)" }`.
7. **Preserve existing signature verification**: HMAC / Twilio / Retell / Cal.com signature checks remain strictly enforced before or alongside timestamp validation.
8. **Preserve existing Retell webhook behavior**: Retell payload timestamp extraction (`event_timestamp`, `timestamp`, `x-timestamp`) remains intact and functional for legitimate events.
9. **Preserve existing Cal.com webhook behavior**: Cal.com payload timestamp extraction (`createdAt`, `payload.createdAt`, `x-timestamp`) remains intact and functional for legitimate bookings/cancellations.
10. **Do not weaken any security or tenant checks**: Tenant resolution, business isolation, idempotency event logging (`provider_events`), and rate limiting remain 100% intact.

---

## 4. Explicitly Deferred Items (P2 Scope)

The following items are explicitly **DEFERRED** and will **NOT** be included in this milestone:
- **Uncertain-call reconciliation** (P2): Background cron/polling of stuck Retell calls.
- **Concurrent same-phone dispatch guard** (P2): Cross-lead phone number concurrency lock.
- **Subsequent inbound enquiry deduplication** (P2): Deduplication logic for repeat submissions within a short window.
- **Global operator calling pause** (P2): UI toggle and tenant-level master switch for outbound calling.
- **Failed-transfer audio UI** (P2): Audio player component for failed warm transfer recordings.

---

## 5. Architectural Boundaries & Constraints

- **NO Migrations**: No migration files will be created, modified, or executed (`lib/db/drizzle/*`).
- **NO Schema Changes**: `lib/db/src/schema/leadsprint.ts` will remain untouched.
- **NO Webhook Architecture Redesign**: The webhook routing, express middleware, raw body extraction, and signature verification architecture remain unchanged.
- **NO Unrelated Code Changes**: Changes are strictly scoped to timestamp validation and its direct unit/integration tests.

---

## 6. Exact Files Expected to Change

| File | Change Type | Purpose |
|------|-------------|---------|
| `artifacts/api-server/src/routes/webhooks.ts` | Modify | Update `verifyTimestampFreshness()` to reject missing/empty/malformed/stale/future timestamps. |
| `artifacts/api-server/src/phase3-m4.test.ts` *(or `artifacts/api-server/src/routes/webhooks.test.ts`)* | Create / Modify | Add comprehensive unit & integration tests covering all freshness permutations and provider regressions. |
| `docs/PHASE3_MILESTONE4_PLAN.md` | Document | Milestone 4 implementation plan (this document). |
| `docs/PHASE3_MILESTONE4_REPORT.md` | Document | Post-implementation verification report. |

---

## 7. Test Strategy & Test Cases

The test suite will validate both unit-level timestamp calculations and end-to-end HTTP webhook requests:

### 7.1 Unit & Freshness Semantics Test Cases
1. **Valid Fresh Timestamp (ISO String)**: e.g. `new Date().toISOString()` → Accepted (`valid: true`).
2. **Valid Fresh Timestamp (Epoch Seconds)**: e.g. `Math.floor(Date.now() / 1000)` → Accepted (`valid: true`).
3. **Valid Fresh Timestamp (Epoch Milliseconds)**: e.g. `Date.now()` → Accepted (`valid: true`).
4. **Missing Timestamp (`undefined` / `null`)**: → Rejected (`valid: false`, `reason: "Missing timestamp"`).
5. **Empty Timestamp (`""`, `"   "`)**: → Rejected (`valid: false`).
6. **Malformed Timestamp (`"invalid-date-xyz"`, `"NaN"`)**: → Rejected (`valid: false`, `reason: "Unparseable timestamp string"`).
7. **Stale Timestamp (Past Window)**: e.g. `Date.now() - (6 * 60 * 1000)` (6 minutes ago) → Rejected with HTTP 400.
8. **Future Timestamp (Beyond Window)**: e.g. `Date.now() + (6 * 60 * 1000)` (6 minutes in future) → Rejected with HTTP 400.
9. **Boundary Behavior (Exact Window Limit)**: Test timestamps at 4m 50s (accepted) vs 5m 10s (rejected).

### 7.2 Integration & Provider Regression Test Cases
10. **Valid Retell Webhook Regression**: Valid signature + fresh `event_timestamp` → HTTP 200/202 accepted and processed.
11. **Retell Webhook with Missing Timestamp**: Valid signature + omitted timestamp → HTTP 400 Rejected (`Stale webhook: Missing timestamp`).
12. **Valid Cal.com Webhook Regression**: Valid signature + fresh `createdAt` → HTTP 200/202 accepted and processed.
13. **Cal.com Webhook with Stale Timestamp**: Valid signature + timestamp from 2 hours ago → HTTP 400 Rejected (`Stale webhook: Timestamp outside freshness window...`).
14. **Valid Intake Webhook Regression**: Valid signature + fresh `timestamp` → HTTP 201 processed.
15. **Invalid Signature Regression**: Missing or invalid HMAC signature still rejected with HTTP 401 before/alongside freshness checks.
16. **Full Test Suite Validation**: All existing 144+ unit and integration tests across the repository must continue passing without regressions.
