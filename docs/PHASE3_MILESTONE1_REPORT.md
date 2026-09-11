# Phase 3 Milestone 1 Report: Multi-Tenant Provider Binding & Usage Enforcement

> **Branch:** `feature/leadsprint-mvp-hardening`  
> **Status:** IMPLEMENTED & VERIFIED  
> **Date:** September 2026  
> **Previous Baseline:** `45215b4` (*Phase 3: production readiness audit*)  

---

## 1. Summary

Phase 3 Milestone 1 hardens LeadSprint for a 2–3 customer controlled pilot by resolving the P0 tenant-isolation and usage enforcement findings from the Phase 3 Production Readiness Audit:

1. **Tenant-Specific Cal.com Event Type Binding**: Calendar availability queries (`getCalAvailability`) and booking creation (`createCalBooking`) now resolve and pass the tenant's `businessesTable.calEventTypeId` instead of relying solely on the global `CALCOM_EVENT_TYPE_ID` env variable.
2. **Tenant-Specific Retell Outbound Phone Number Binding**: Outbound call dispatch (`startRetellCall`) now resolves and passes the tenant's `businessesTable.phoneNumber` as `from_number` instead of relying on global `RETELL_FROM_NUMBER_US` / `RETELL_FROM_NUMBER_IN`.
3. **Usage Entitlement Pre-Dispatch Enforcement**: Added `usage_limit` check to `evaluateCallPolicy()`. Both workflow workers (`worker.ts`) and manual operator triggers (`leadsprint.ts`) evaluate active billing-period `voiceMinutes` against `includedVoiceMinutes` prior to provider dispatch, safely blocking calls when entitlements are exhausted.
4. **Dynamic `unresolved_messages` Metric**: Replaced the hardcoded `unresolved_messages: 1` in `GET /api/today` with a dynamic tenant-scoped SQL query counting active leads whose `nextAction` requires a callback (`ILIKE '%Call back%'`).

---

## 2. Retell Tenant Phone Binding

- **Provider Implementation (`lib/providers.ts`)**:
  - `startRetellCall` accepts optional `fromNumber?: string`. When provided, it takes precedence over global fallback environment variables (`RETELL_FROM_NUMBER_US` / `RETELL_FROM_NUMBER_IN`).
  - `hasRetellConfigForMarket(market, fromNumberOverride)` checks whether Retell credentials and an effective from-number are present for the given market/tenant.
- **Workflow Worker (`lib/worker.ts`)**:
  - Resolves `business.phoneNumber` and validates readiness with `hasRetellConfigForMarket(market, business.phoneNumber)`.
  - Dispatches `startRetellCall` with `fromNumber: business.phoneNumber`.
- **Operator Console Routes (`routes/leadsprint.ts`)**:
  - `POST /api/calls/start` resolves `business.phoneNumber` and dispatches with `fromNumber: business.phoneNumber`.

---

## 3. Cal.com Tenant Event Type Binding

- **Provider Implementation (`lib/providers.ts`)**:
  - `getCalAvailability` accepts `eventTypeId?: string`, querying Cal.com `/v2/slots` with `url.searchParams.set("eventTypeId", eventTypeId)`.
  - `createCalBooking` accepts `eventTypeId?: string`, creating the booking with `eventTypeId: Number(eventTypeId)`.
- **Operator Console Routes (`routes/leadsprint.ts`)**:
  - `hasCalConfig(eventTypeId?: string | null)` verifies whether Cal.com API key and an effective event type ID exist.
  - `POST /api/appointments/availability` resolves `business.calEventTypeId` and passes it to `getCalAvailability`.
  - `POST /api/appointments/book` resolves `business.calEventTypeId` and passes it to `createCalBooking`.

---

## 4. Usage Entitlement Enforcement

- **Policy Engine (`lib/policy.ts`)**:
  - Added `"usage_limit"` to `PolicyBlockReason`.
  - Extended `PolicyBusinessInput` with `includedVoiceMinutes?: number` and `currentVoiceMinutes?: number`.
  - Evaluates:
    ```ts
    if (
      business.includedVoiceMinutes !== undefined &&
      business.currentVoiceMinutes !== undefined &&
      business.currentVoiceMinutes >= business.includedVoiceMinutes
    ) {
      return {
        allowed: false,
        reason: "usage_limit",
        message: `Voice minutes entitlement (${business.includedVoiceMinutes}m) exhausted for this billing period (used: ${business.currentVoiceMinutes.toFixed(1)}m).`,
      };
    }
    ```
- **Pre-Dispatch Integration**:
  - `worker.ts`: Fetches `getActiveUsageRow(job.businessId, now, db)` and passes `includedVoiceMinutes` & `currentVoiceMinutes` into `evaluateCallPolicy()`. If blocked, marks `callsTable.status = "policy_blocked"`, `outcome = "Blocked — usage_limit"`, and `workflowJobsTable.status = "blocked"`.
  - `leadsprint.ts`: Fetches `getActiveUsageRow(BUSINESS_ID, new Date(), db)` and passes `includedVoiceMinutes` & `currentVoiceMinutes` into `evaluateCallPolicy()`. If blocked, returns HTTP 409 with the blocked call DTO.

---

## 5. Dynamic `unresolved_messages`

- **Endpoint (`routes/leadsprint.ts`)**:
  - `GET /api/today` queries `leadsTable` dynamically:
    ```ts
    const [unresolvedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(
        and(
          eq(leadsTable.businessId, BUSINESS_ID),
          ilike(leadsTable.nextAction, "%Call back%"),
        ),
      );
    const unresolvedMessages = unresolvedRow?.count ?? 0;
    ```
  - Returns `metrics.unresolved_messages = unresolvedMessages` (0 if no matching leads exist).

---

## 6. Tenant Isolation Verification

| Area | Isolation Mechanism | Verification |
| :--- | :--- | :--- |
| **Retell From Number** | `business.phoneNumber` passed explicitly per tenant | Verified in `phase3-m1.test.ts` (Business A vs Business B phone isolation) |
| **Cal.com Event Type** | `business.calEventTypeId` passed explicitly per tenant | Verified in `phase3-m1.test.ts` (Business A vs Business B event type isolation) |
| **Usage Tracking** | `usageTable` scoped to `(business_id, period_start, period_end)` | Verified in `phase3-m1.test.ts` & `usage.test.ts` |
| **Unresolved Messages** | `leadsTable.businessId` filtered in SQL query | Verified in `phase3-m1.test.ts` |

---

## 7. Automated Tests

Added dedicated unit and integration tests in `artifacts/api-server/src/phase3-m1.test.ts` (9 tests):
- `A. Retell Tenant Phone Number Routing`:
  - Uses Business A's phone number as `from_number`.
  - Uses Business B's phone number as `from_number`.
  - `hasRetellConfigForMarket` recognizes tenant phone number override.
- `B. Cal.com Tenant Event Type Routing`:
  - Availability query sends tenant-specific event type.
  - Booking creation sends tenant-specific event type.
- `C. Usage Entitlement Pre-Dispatch Policy Gate`:
  - Blocks outbound call when `voiceMinutes == includedVoiceMinutes` (e.g. 300 / 300).
  - Blocks outbound call when `voiceMinutes > includedVoiceMinutes` (e.g. 300.5 / 300).
  - Allows outbound call when `voiceMinutes < includedVoiceMinutes` (e.g. 299 / 300).
- `D. Dynamic Unresolved Messages Evaluation Semantics`:
  - Correctly counts callback leads per business tenant.

**Full Test Suite Summary:** 7 test files, 95 tests — ALL PASSED (0 failures).

---

## 8. Typecheck & Build Results

- **TypeScript (`pnpm run typecheck`)**: Passed cleanly across all 4 workspace packages.
- **API Server Build (`pnpm --filter @workspace/api-server run build`)**: Success (`dist/index.mjs`, `dist/migrate.mjs`).
- **Frontend Build (`pnpm --filter @workspace/leadsprint run build`)**: Success (`dist/`).
- **Diff Check (`git diff --check`)**: Clean (no whitespace or lint errors).

---

## 9. Migration Status

- **Migration Required:** **NO**
- **Existing Schema Used:** `businessesTable.calEventTypeId`, `businessesTable.phoneNumber`, `businessesTable.includedVoiceMinutes` were already present in `lib/db/src/schema/leadsprint.ts`.

---

## 10. Remaining Limitations

1. **Pre-Dispatch vs Real-Time Call Duration (By Design)**: Usage entitlement check happens pre-dispatch. If an account has 299 / 300 minutes used and places a 5-minute call, the final call is completed and usage reaches 304 minutes before subsequent calls are blocked.
2. **Recipient Area-Code Timezone Provenance (P1)**: Quiet hours currently evaluates against `business.timezone`. Deriving timezone from recipient phone area code remains scheduled for subsequent hardening.
3. **Consent Metadata Persistence (P1)**: `contactsTable` records `consentStatus` and `suppressedAt`, but dedicated columns for consent capture timestamp and disclosure text version remain scheduled for Phase 3 Milestone 2.

---

## 11. Files Changed

1. `artifacts/api-server/src/lib/policy.ts` — Added `usage_limit` reason, `includedVoiceMinutes`/`currentVoiceMinutes` input, and entitlement exhaustion check.
2. `artifacts/api-server/src/lib/providers.ts` — Updated `startRetellCall`, `hasRetellConfigForMarket`, `getCalAvailability`, `createCalBooking` to accept and use tenant-specific overrides.
3. `artifacts/api-server/src/lib/worker.ts` — Added usage pre-dispatch retrieval and passed tenant phone number to Retell dispatch.
4. `artifacts/api-server/src/routes/leadsprint.ts` — Updated `hasCalConfig`, `POST /calls/start`, `POST /appointments/availability`, `POST /appointments/book`, and `GET /today` for tenant bindings and dynamic `unresolved_messages`.
5. `artifacts/api-server/src/phase3-m1.test.ts` — [NEW] 9 unit and integration tests for all Milestone 1 deliverables.
6. `docs/PHASE3_MILESTONE1_REPORT.md` — [NEW] Milestone completion and verification report.

---

## 12. Verification Commands

```bash
pnpm test
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/leadsprint run build
git diff --check
git status
```
