# Phase 2 Milestone 4 Report: Cal.com Webhook Lifecycle Reconciliation

## 1. Current Cal.com Webhook Behavior Before Changes
Prior to Milestone 4, `POST /api/webhooks/calcom` in [`artifacts/api-server/src/routes/webhooks.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/webhooks.ts):
- Verified HMAC-SHA256 signature and timestamp freshness window.
- Verified presence of `metadata.business_id`.
- Deduplicated incoming payloads into `provider_eventsTable` via `acceptProviderEvent()`.
- Immediately returned HTTP `202 Accepted` (`{ accepted: true, duplicate: !accepted }`).
- **Never reconciled application state**: It never updated `appointmentsTable`, `leadsTable`, or `activitiesTable`. As a result, when bookings were confirmed, rescheduled, or cancelled in Cal.com, the changes had zero effect on the workspace database.

## 2. Payload Fields Used
The implementation strictly adheres to the verified Cal.com webhook contract established in [`docs/PHASE2_IMPLEMENTATION_PLAN.md`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/docs/PHASE2_IMPLEMENTATION_PLAN.md) Section 6 without inventing arbitrary fields:
- `body.triggerEvent`: Lifecycle event identifier (`"BOOKING_CONFIRMED"`, `"BOOKING_CREATED"`, `"BOOKING_RESCHEDULED"`, `"BOOKING_CANCELLED"`).
- `payload.uid`: The durable Cal.com booking UID (with fallback to `payload.bookingId ?? payload.id ?? body.uid`).
- `payload.startTime`: Rescheduled start ISO timestamp.
- `payload.endTime`: Rescheduled end ISO timestamp.
- `metadata.business_id`: Resolved hierarchically from `body.metadata.business_id` or `body.payload.metadata.business_id` (matches where `createCalBooking` sets tenant metadata).
- `createdAt` / `payload.createdAt` / `x-timestamp`: Timestamp candidate evaluated for replay/freshness window.

## 3. Signature / Freshness Verification
- **HMAC-SHA256 Authentication**: Authenticated using `verifyWebhookSignature(rawBody, signature, config.calcom.webhookSecret)` with timing-safe comparison (`crypto.timingSafeEqual`).
- **Header Flexibility**: `signatureFor(req)` was updated to support `x-cal-signature-256`, `x-calcom-signature`, `x-retell-signature`, and `x-leadsprint-signature`.
- **Freshness Window**: Preserves the 5-minute freshness window (`verifyTimestampFreshness`), rejecting stale payloads with HTTP 400 (`{"error": "Stale webhook: ..."}`).
- **Authentication Placement**: Authentication and freshness verification strictly precede all database lookups, deduplication, and transaction handling. Invalid or expired requests reject immediately with no side effects.

## 4. BOOKING_CONFIRMED Behavior
- Executed inside a database transaction (`db.transaction(async (tx) => { ... })`).
- Resolves tenant-scoped appointment by `(businessId, externalId: uid)`.
- Updates `appointmentsTable.status = "confirmed"` without duplicating rows.
- Preserves all other appointment attributes, contact details, and external UID.
- Does not increment usage billing counters (usage is exclusively accounted at initial booking).
- Supports `BOOKING_CREATED` identically to ensure consistency if Cal.com sends either creation or confirmation triggers.

## 5. BOOKING_RESCHEDULED Behavior
- Executed inside a database transaction (`db.transaction(async (tx) => { ... })`).
- Resolves tenant-scoped appointment by `(businessId, externalId: uid)`.
- Extracts `payload.startTime` and `payload.endTime`:
  - If valid ISO strings are supplied, updates `startTime` and `endTime`.
  - If either timing field is missing or unparseable, safely preserves existing appointment timestamps, logs a structured warning anomaly, and does NOT invent dates.
- Updates appointment `status = "confirmed"`.
- Updates associated lead:
  - `nextAction = "Appointment rescheduled"`
  - `updatedAt = new Date()`
  - Scoped by `(leadsTable.id = appointment.leadId, leadsTable.businessId = businessId)`.
- Inserts an audit record into `activitiesTable`:
  - `type = "booking"`
  - `title = "Appointment rescheduled"`
  - `detail = "Showing rescheduled for <ISO_START>."`
  - Tenant-scoped by `businessId`.

## 6. BOOKING_CANCELLED Behavior
- Executed inside a database transaction (`db.transaction(async (tx) => { ... })`).
- Resolves tenant-scoped appointment by `(businessId, externalId: uid)`.
- Updates appointment `status = "cancelled"`.
- **Preserves record**: Appointment is NOT deleted from the database.
- Updates associated lead:
  - `nextAction = "Reschedule showing"` (exact planned semantic)
  - `updatedAt = new Date()`
  - Scoped by `(leadsTable.id = appointment.leadId, leadsTable.businessId = businessId)`.
  - Lead is NOT deleted from the database.
- Inserts an audit record into `activitiesTable`:
  - `type = "booking"`
  - `title = "Appointment cancelled"`
  - `detail = "Cal.com booking <UID> was cancelled."`
  - Tenant-scoped by `businessId`.

## 7. Appointment Lookup Strategy
- Strict tenant-scoped query:
  ```ts
  const [appointment] = await tx
    .select()
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.businessId, businessId),
        eq(appointmentsTable.externalId, uid),
      ),
    )
    .limit(1);
  ```
- If the appointment is not found:
  - No fake appointment is created.
  - No cross-tenant lookup is attempted.
  - Logs structured warning: `logger.warn({ businessId, uid, triggerEvent }, "Cal.com webhook appointment not found for tenant")`.
  - Safely returns HTTP 202 without state mutation.

## 8. Tenant Isolation
- Lookup is guarded by `eq(appointmentsTable.businessId, businessId)`.
- Lead update is guarded by `and(eq(leadsTable.id, appointment.leadId), eq(leadsTable.businessId, businessId))`.
- Activity insertion is stamped with `businessId`.
- A webhook sent with `businessId: "biz_B"` and `uid: "cal_uid_shared"` cannot inspect, read, or mutate an appointment owned by `"biz_A"`. Verified via explicit test suite `TEST 4`.

## 9. Transaction Boundaries
- All multi-step state mutations (Appointment update + Lead update + Activity insert) execute atomically inside `await db.transaction(async (tx) => { ... })`.
- If an exception occurs inside the transaction block:
  - All database mutations are rolled back atomically (no partial commit of appointment or lead state).
  - The `providerEventsTable` deduplication record for this event is deleted:
    ```ts
    await db.delete(providerEventsTable).where(
      and(
        eq(providerEventsTable.provider, "Cal.com"),
        eq(providerEventsTable.externalEventId, externalEventId),
      ),
    );
    ```
  - Allows safe retry by the provider without being falsely blocked as a duplicate.
  - Returns HTTP 500 error signal.

## 10. Replay / Idempotency Behavior
- Relies on durable `provider_eventsTable` unique index on `(provider, external_event_id)`.
- First webhook receipt: `acceptProviderEvent()` returns `true`, mutations execute, returns `202 { accepted: true, duplicate: false }`.
- Duplicate webhook receipt: `acceptProviderEvent()` returns `false`, bypasses all mutations, prevents duplicate activities and side effects, and immediately returns `202 { accepted: true, duplicate: true }`.

## 11. Unknown Event Behavior
- Validly signed webhooks with unsupported trigger events (e.g. `"PING"` or unhandled Cal.com triggers) are accepted by `acceptProviderEvent()`.
- The `switch (triggerEvent)` falls through to the `default` case:
  `logger.info({ triggerEvent, businessId }, "Unhandled Cal.com event type received")`.
- No appointments, leads, or activities are mutated.
- Endpoint safely returns `202 { accepted: true, duplicate: false }`.

## 12. Tests Added
Focused Cal.com webhook test suite added in [`artifacts/api-server/src/routes/webhooks.test.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/routes/webhooks.test.ts):
1. **TEST 1 — BOOKING_CONFIRMED**: Status updated to confirmed; no duplicate appointment rows; no double-counting.
2. **TEST 2 — BOOKING_RESCHEDULED**: Start/end time updated; status confirmed; `lead.nextAction = "Appointment rescheduled"`; booking activity created atomically.
3. **TEST 3 — BOOKING_CANCELLED**: Status cancelled; `lead.nextAction = "Reschedule showing"`; booking activity created; appointment and lead preserved.
4. **TEST 4 — TENANT ISOLATION**: Business B cannot mutate Business A's appointment with identical external UID.
5. **TEST 5 — UNKNOWN APPOINTMENT**: Non-existent UID does not create fake appointments or mutate state.
6. **TEST 6 — DUPLICATE WEBHOOK**: Identical event detected as duplicate (`duplicate: true`); zero duplicate activities or side effects.
7. **TEST 7 — MISSING START/END**: Reschedule without start/end times preserves existing timestamps safely without crash.
8. **TEST 8 — SIGNATURE FAILURE**: Invalid HMAC signature rejected with HTTP 401; zero DB mutations.
9. **TEST 9 — FRESHNESS FAILURE**: Expired timestamp (>5 min old) rejected with HTTP 400; zero DB mutations.
10. **TEST 10 — TRANSACTION FAILURE**: Simulated transaction failure rolls back all writes atomically; clears provider event for retry.
11. **BONUS TEST**: Header validation (`x-calcom-signature`) and metadata resolution from `payload.metadata.business_id`.
12. **BONUS TEST**: Unknown trigger events handled gracefully without state mutation.

## 13. Test Results
Command:
```bash
pnpm --filter @workspace/api-server run test
```
Result:
```
 ✓ src/lib/env.test.ts (20 tests)
 ✓ src/app.security.test.ts (15 tests)
 ✓ src/lib/usage.test.ts (15 tests)
 ✓ src/lib/worker.test.ts (16 tests)
 ✓ src/routes/webhooks.test.ts (12 tests)

 Test Files  5 passed (5)
      Tests  78 passed (78)
   Duration  2.06s
```

## 14. Typecheck Result
Command:
```bash
pnpm run typecheck
```
Result:
```
$ tsc --build
Scope: 4 of 9 workspace projects
artifacts/leadsprint typecheck: Done (0 errors)
artifacts/api-server typecheck: Done (0 errors)
scripts typecheck: Done (0 errors)
artifacts/mockup-sandbox typecheck: Done (0 errors)
```

## 15. API Build Result
Command:
```bash
pnpm --filter @workspace/api-server run build
```
Result:
```
$ node ./build.mjs
  dist\index.mjs                   3.8mb
  ...
Done in 632ms
Exit code: 0
```

## 16. Frontend Build Result
Command:
```bash
pnpm --filter @workspace/leadsprint run build
```
Result:
```
vite v7.3.6 building client environment for production...
✓ built in 3.33s
Exit code: 0
```

## 17. git diff --check
Command:
```bash
git diff --check
```
Result: Clean (no whitespace errors or merge markers).

## 18. Migration Status
- Migration Required: **NO**
- The existing schema (`appointmentsTable`, `leadsTable`, `activitiesTable`, `providerEventsTable`) fully supports Cal.com lifecycle reconciliation without additions or modifications.

## 19. Production Migration Confirmation
- Production migration executed: **NO**
- No migrations executed, queued, or modified.

## 20. Known Limitations
- Cal.com reschedule reasons (`payload.rescheduleReason`) and cancellation reasons (`payload.cancellationReason`) are not stored in dedicated table columns since `appointmentsTable` does not possess a `cancellationReason` column; reasons are preserved in the raw JSON payload in `provider_eventsTable` and logged in `activitiesTable.detail`.
