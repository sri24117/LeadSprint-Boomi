# LeadSprint Implementation Plan: SQL Aggregation, Webhook Replay Protection & Console Modularization

**Target Milestone**: Reliability & Scale Hardening for Managed Pilot  
**Target Branch**: `arena/<task-id>-performance-and-modularization`  
**Base Branch**: `main`  
**Test Requirement**: 100% passing tests (`pnpm --filter api-server test`, `pnpm --filter api-server build`, `pnpm --filter leadsprint build`)

---

## 1. Executive Summary & Objective

LeadSprint is in Sellable V1.0 for real-estate sales teams. All core voice and calendar flows pass, and the internal worker scheduler handles call dispatching. Before onboarding multiple real-estate tenants, three key architectural improvements are required:

1. **SQL-Level Aggregation for `/api/today` & `/api/reports/weekly`**:
   - *Current state*: Loads every lead, call, and appointment for the business into Node.js memory and calculates totals/averages via JavaScript `.filter()` and `.reduce()`.
   - *Target state*: Push counting and summing down to PostgreSQL using Drizzle ORM SQL helpers (`sql<number>\`count(*)\``, `sum()`, conditional counts). Memory drops from O(N) to O(1).
2. **Webhook Timestamp Freshness & Replay Attack Defense**:
   - *Current state*: Webhooks are idempotent via the `provider_events` table, but payloads with very old timestamps or replayed network packets are not rejected by freshness.
   - *Target state*: Validate webhook timestamp freshness (reject webhooks older than 300 seconds / 5 minutes) on intake and provider webhooks.
3. **Frontend Console Modularization (`App.tsx`)**:
   - *Current state*: All 6 pages (`Today`, `Leads`, `Calls`, `Appointments`, `Reports`, `Settings`) plus modal dialogs are bundled into a single monolithic 663-line `App.tsx`.
   - *Target state*: Extract the 6 page components cleanly into `artifacts/leadsprint/src/pages/` while keeping `App.tsx` clean as the main shell and router.

---

## 2. Strict Architectural Invariants (DO NOT BREAK)

1. **Multi-Tenant Isolation**:
   - Every database query MUST filter by `req.leadSprintBusinessId` (or `scopedBusinessId(req)`).
   - Cross-tenant data leaks are P0 security bugs.
2. **Package Manager**:
   - Use `pnpm` exclusively. `npm` and `yarn` are blocked by preinstall scripts.
3. **TypeScript & Codegen**:
   - Do NOT edit generated files in `lib/api-client-react` or `lib/api-zod`.
   - Ensure strict TypeScript typing (~5.9) compiles cleanly.
4. **Safety Policy Engine**:
   - The 6 policy gates (consent, suppression, quiet hours, usage, attempts, kill switch) in `artifacts/api-server/src/lib/policy.ts` MUST NOT be bypassed or weakened.
5. **Fail-Closed Principle**:
   - Missing configurations or corrupted payloads reject or fail safely rather than crashing or guessing defaults.

---

## 3. Detailed Specification & File Changes

### Task 1: SQL Aggregation for `/api/today` and `/api/reports/weekly`

**File to modify**: `artifacts/api-server/src/routes/leadsprint.ts`

#### 1.1 `/api/today` Route Optimization
Replace memory loading of `leadsTable` and `callsTable`:
- Query only the required aggregate numbers from Postgres:
  - Total active leads: `count(leadsTable.id)` for this `businessId`.
  - Leads requiring attention / new leads: count where `status = 'new'`.
  - Qualified leads: count where `status IN ('qualified', 'booked')`.
  - Calls completed today / active calls: count from `callsTable`.
- Appointments: Query only upcoming confirmed appointments (limit to 10 or in-window), not the entire history.
- Unresolved messages: Query count directly via `sql<number>\`count(*)\`` for message-type activities within trailing 7 days.

#### 1.2 `/api/reports/weekly` Route Optimization
Replace `calls.reduce(...)` and `leads.filter(...)` with SQL aggregation:
```typescript
import { sql, and, eq, gte } from "drizzle-orm";

const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

// Aggregate call metrics directly in PostgreSQL
const [callStats] = await db
  .select({
    callsAttempted: sql<number>`count(*)::int`,
    callsConnected: sql<number>`count(*) filter (where ${callsTable.status} in ('completed', 'in_progress'))::int`,
    transferredCount: sql<number>`count(*) filter (where ${callsTable.transferred} = true)::int`,
    failedActions: sql<number>`count(*) filter (where ${callsTable.status} in ('failed', 'uncertain'))::int`,
    totalDurationSeconds: sql<number>`coalesce(sum(${callsTable.durationSeconds}), 0)::int`,
  })
  .from(callsTable)
  .where(and(eq(callsTable.businessId, BUSINESS_ID), gte(callsTable.createdAt, weekAgo)));

// Aggregate lead metrics directly in PostgreSQL
const [leadStats] = await db
  .select({
    leadsReceived: sql<number>`count(*)::int`,
    qualifiedLeads: sql<number>`count(*) filter (where ${leadsTable.status} in ('qualified', 'booked'))::int`,
  })
  .from(leadsTable)
  .where(and(eq(leadsTable.businessId, BUSINESS_ID), gte(leadsTable.createdAt, weekAgo)));

// Aggregate appointment count in PostgreSQL
const [apptStats] = await db
  .select({
    appointmentsBooked: sql<number>`count(*)::int`,
  })
  .from(appointmentsTable)
  .where(and(eq(appointmentsTable.businessId, BUSINESS_ID), gte(appointmentsTable.startTime, weekAgo)));
```
- Compute `voiceMinutes = Number(((callStats?.totalDurationSeconds ?? 0) / 60).toFixed(2))`.
- Compute `transferRate = callStats?.callsAttempted ? (callStats.transferredCount / callStats.callsAttempted) : 0`.
- Maintain identical API contract response structure adhering to `GetWeeklyReportResponse`.

---

### Task 2: Webhook Timestamp Freshness & Replay Tolerance Window

**File to modify**: `artifacts/api-server/src/routes/webhooks.ts`

#### Requirements:
1. Implement a helper function `isTimestampFresh(timestamp: Date | string | number | undefined, maxAgeSeconds = 300): boolean`:
   - If timestamp is missing or invalid: fail closed or evaluate tolerance according to provider standard.
   - If `Math.abs(Date.now() - new Date(timestamp).getTime()) > maxAgeSeconds * 1000`, consider it expired.
2. In `POST /api/webhooks/intake`:
   - Check `body.timestamp` or header `x-webhook-timestamp` (if provided).
   - If a timestamp is explicitly provided and exceeds 300 seconds skew, reject with `400 Bad Request` or `401 Unauthorized` (`{ error: "Webhook timestamp expired" }`).
3. In `POST /api/webhooks/calcom`:
   - Cal.com webhook payloads include `createdAt: string`.
   - Verify `isTimestampFresh(body.createdAt, 300)`. If stale, reject with `401 Unauthorized` (`{ error: "Stale Cal.com webhook timestamp" }`).
4. Update unit tests in `artifacts/api-server/src/routes/webhooks.twilio.test.ts` or create a new test file `artifacts/api-server/src/routes/webhooks.freshness.test.ts` to verify timestamp expiration rejection.

---

### Task 3: Modularize Operator Console Pages

**Directory to populate**: `artifacts/leadsprint/src/pages/`  
**File to refactor**: `artifacts/leadsprint/src/App.tsx`

#### Current State:
`App.tsx` contains:
- `TodayView` (~lines 150-250)
- `LeadsView` (~lines 250-380)
- `CallsView` (~lines 380-450)
- `AppointmentsView` (~lines 450-520)
- `ReportsView` (~lines 520-580)
- `SettingsView` (~lines 580-640)
- Modals, navigation bar, and router shell

#### Action Items:
1. Create individual page components under `artifacts/leadsprint/src/pages/`:
   - `artifacts/leadsprint/src/pages/today.tsx` -> `TodayPage`
   - `artifacts/leadsprint/src/pages/leads.tsx` -> `LeadsPage`
   - `artifacts/leadsprint/src/pages/calls.tsx` -> `CallsPage`
   - `artifacts/leadsprint/src/pages/appointments.tsx` -> `AppointmentsPage`
   - `artifacts/leadsprint/src/pages/reports.tsx` -> `ReportsPage`
   - `artifacts/leadsprint/src/pages/settings.tsx` -> `SettingsPage`
2. Keep shared reusable widgets (such as stat cards, badges, modal dialogs) in `artifacts/leadsprint/src/components/`.
3. Simplify `artifacts/leadsprint/src/App.tsx` to:
   - Header / Navigation tabs
   - Wouter `<Route path="...">` definitions linking to the respective page component
   - Global layout and notification banners
4. Retain all existing `data-testid` attributes on interactive elements so UI tests and end-to-end flows remain 100% compatible.

---

## 4. Verification & Testing Plan

Run the full automated test and build pipeline to verify:

```powershell
# 1. Typecheck and build API server
pnpm --filter api-server build

# 2. Run backend test suite (all tests must pass)
pnpm --filter api-server test

# 3. Typecheck and build Frontend SPA
pnpm --filter leadsprint build

# 4. Verify no OpenAPI drift
pnpm --filter @workspace/api-client-react run generate
git diff --exit-code lib/api-client-react lib/api-zod
```

Acceptance criteria:
- Zero TypeScript errors across all workspaces.
- All 142+ unit tests in `api-server` pass.
- Both `/api/today` and `/api/reports/weekly` return identical data shapes verified by Zod schemas.
- `leadsprint` bundle builds cleanly with zero missing imports or broken routes.

---

## 5. Arena Agent Step-by-Step Execution Guide

When running this task as an Arena Agent:

1. **Check out a clean feature branch**:
   ```powershell
   git checkout -b arena/perf-aggregation-and-modularization
   ```
2. **Execute Task 1 (SQL Aggregation)**:
   - Edit `artifacts/api-server/src/routes/leadsprint.ts`.
   - Run `pnpm --filter api-server test` to confirm `/api/today`, `/api/reports/weekly`, and `/api/usage` tests pass.
3. **Execute Task 2 (Webhook Timestamp Freshness)**:
   - Edit `artifacts/api-server/src/routes/webhooks.ts`.
   - Add unit tests for stale timestamp rejection.
4. **Execute Task 3 (Frontend Page Extraction)**:
   - Extract page views from `artifacts/leadsprint/src/App.tsx` into `artifacts/leadsprint/src/pages/`.
   - Run `pnpm --filter leadsprint build` to confirm clean compilation.
5. **Commit and Push**:
   ```powershell
   git add .
   git commit -m "feat: sql aggregation for reports, webhook replay defense, and page modularization"
   git push -u origin arena/perf-aggregation-and-modularization
   ```
6. **Submit PR**: Open a pull request against `main`.
