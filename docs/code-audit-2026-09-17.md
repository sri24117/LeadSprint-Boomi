# LeadSprint Codebase Audit — 2026-09-17

Comprehensive audit of the LeadSprint monorepo (pnpm workspace) after reading all source files, test harnesses, configs, CI, OpenAPI spec, and documentation.

## Critical Issues

### 1. `appointments_calendar_external_unique` index omits `business_id` (data-integrity / cross-tenant collision)
**File:** `lib/db/src/schema/leadsprint.ts:137`
**Severity:** Critical

The production Drizzle schema defines:
```ts
calendarExternalUnique: uniqueIndex("appointments_calendar_external_unique").on(
  table.calendarProvider, table.externalId
),
```

This index is scoped to `(calendar_provider, external_id)` only — **not** `(business_id, calendar_provider, external_id)`. This contradicts:

- The schema's own code comment on the analogous `calls` table (`lib/db/src/schema/leadsprint.ts:114-119`), which explicitly explains "Provider call ids are only unique within a tenant" and scopes by `business_id`.
- The test DDL (`artifacts/api-server/src/test/testDb.ts:117`), which correctly includes `business_id`: `CREATE UNIQUE INDEX appointments_calendar_external_unique ON appointments (business_id, calendar_provider, external_id);`

**Impact:** Two businesses using separate Cal.com accounts (or Cal.com dev accounts with low-numbered external IDs) could collide if both use the same `external_id` value. The second insert fails with a constraint violation, producing a 500 error instead of a clean per-tenant booking.

**Fix:** Add `table.businessId` as the first column in the index.

### 2. `provider_events_provider_external_unique` index omits `business_id` (cross-tenant event dedup failure)
**File:** `lib/db/src/schema/leadsprint.ts:193`
**Severity:** High

Same pattern as #1:
```ts
providerEventUnique: uniqueIndex("provider_events_provider_external_unique").on(
  table.provider, table.externalEventId
),
```

**Impact:** The `acceptProviderEvent` function in `webhooks.ts:90-96` uses `onConflictDoNothing({ target: [provider, external_event_id] })`. If Retell (or any provider) issues event IDs that happen to match across tenants — possible with sequential IDs or dev stubs — a legitimate event from tenant B would be silently dropped as a "duplicate" of tenant A's event, breaking call status tracking and webhook idempotency.

**Fix:** Add `table.businessId` to the index and update the conflict target in `webhooks.ts:90-96` to include `providerEventsTable.businessId`.

### 3. Console-initiated calls are not idempotent (duplicate calls from double-clicks)
**File:** `artifacts/api-server/src/routes/leadsprint.ts:491`
**Severity:** High

The `/calls/start` route generates a new idempotency key per click:
```ts
idempotencyKey: `console_${id("attempt")}`,
```

This means two clicks (or a slow network retry) produce two different idempotency keys, and the `(business_id, idempotency_key)` unique constraint does not prevent a second call row. The intake path (`webhooks.ts:180`) correctly uses `intakeIdempotencyKey(leadId)` — stable per lead. The console path does not.

**Impact:** Operator double-clicks "Call lead" → two outbound calls placed. The `StartCallBody` Zod schema (`start_call` in api-zod) does not include a idempotency key, so the client cannot supply one.

**Fix:** Either (a) derive the idempotency key from the lead ID like intake does (`console_${leadId}`), or (b) accept a client-supplied idempotency key and surface it in the DTO so the operator console can dedupe client-side.

### 4. Workflow job idempotency key uses call PK instead of stable key (retry path breakage)
**File:** `artifacts/api-server/src/lib/callQueue.ts:137`
**Severity:** High

```ts
await db.insert(workflowJobsTable).values({
  id: id("job"),
  businessId,
  type: "initiate_call",
  idempotencyKey: created.id,  // ← call row's PK, not the stable idempotency key
})
```

The comment at lines 78-79 states: "`idempotencyKey` must be stable for 'the same reason to call'". But the workflow job's idempotency key is set to `created.id` (the call row's PK), not `input.idempotencyKey`. This breaks the retry semantics in `cron.ts:117`:

```ts
const result = await dispatchQueuedCall({
  businessId: job.businessId,
  callId: job.idempotencyKey,  // ← looks up a CALL row by this "call ID"
});
```

If `enqueueCallForLead` is called twice with *different* idempotency keys (e.g., two console clicks), the second call's `onConflictDoNothing` on `(business_id, idempotency_key)` does NOT trigger (different key), so a second call row is created — and a second workflow job is created with `idempotencyKey: secondCall.id`. Both jobs then dispatch via cron. The workflow job's own `(business_id, idempotency_key)` unique index only prevents duplicates of the *same* call, not different calls for the same lead.

Additionally, the console retry path (`leadsprint.ts:526-531`) creates a new call with `retry_${row.id}_${id("attempt")}"` as the idempotency key. The workflow job's idempotency key will be the new call's PK (e.g., `call_abc123`), so cron can still find it. This works, but the coupling is accidental.

**Fix:** Set the workflow job's `idempotencyKey` to `input.idempotencyKey` (the stable key), not `created.id`. Then `cron.ts:117` must map from idempotency key to call ID via a query, not treat the idempotency key as a call ID.

### 5. `PolicyBlockReason` type missing `"location_unknown"` from the union
**File:** `artifacts/api-server/src/lib/policy.ts:18-24` vs `:127-133`
**Severity:** Medium (TypeScript type mismatch)

```ts
export type PolicyBlockReason =
  | "consent_invalid"
  | "suppressed"
  | "location_unknown"   // ← missing from the union
  | "quiet_hours"
  | "attempt_limit"
  | "kill_switch";
```

The function returns `reason: "location_unknown"` at line 128, but the `PolicyDecision.reason` field is typed as `PolicyBlockReason` (line 28), which does not include `"location_unknown"`. This compiles only because `reason` is typed as optional (`reason?: PolicyBlockReason`) and the return is untyped. In strict mode this would be a type error.

**Fix:** Add `"location_unknown"` to the `PolicyBlockReason` union.

### 6. Provisioned usage row uses pre-monthly-id format (`usage_<id>` not `usage_<id>_<YYYY-MM>`)
**File:** `artifacts/api-server/src/middlewares/auth.ts:94-102` vs `lib/usage.ts:49-52`
**Severity:** Medium

When Clerk auth auto-provisions a new business (`auth.ts:94`):
```ts
await db.insert(usageTable).values({
  id: `usage_${businessId}`,
  businessId,
  periodStart: ...,
  periodEnd: ...,
})
.onConflictDoNothing();
```

But `usage.ts:49` generates row IDs as `usage_${businessId}_${YYYY-MM}` (e.g., `usage_business_demo_2026-09`). The provisioned row (`usage_business_demo`) will never match the monthly format that `getCurrentUsageRow()` looks for. On the first `getCurrentUsageRow` call, the provisioned row is invisible, and a new monthly row is created — leaving the provisioned row as dead data with wrong period boundaries.

**Impact:** Each provisioned month has a zero-initialized monthly row (good for accuracy) but also a permanently orphaned pre-monthly row consuming storage. The `period_label` will correctly show the current month name, so this is more of a data hygiene issue than a functional bug — but the orphaned row also has `voice_minutes: 0` and `estimated_cost: 0` (default), which could confuse anyone querying usage by ID pattern.

**Fix:** Either remove the usage row creation in `auth.ts` (let `getCurrentUsageRow` create it lazily), or change the ID format to `usageRowId(businessId)` from `usage.ts:49`.

## High-Priority Issues

### 7. `/calls/:id/retry` creates a non-idempotent workflow job
**File:** `artifacts/api-server/src/routes/leadsprint.ts:529`
**Severity:** Medium

```ts
idempotencyKey: `retry_${row.id}_${id("attempt")}`,
```

Each retry generates a unique idempotency key. The workflow job is inserted with `onConflictDoNothing` on `(business_id, idempotency_key)` — since the key is unique each time, multiple retries can enqueue multiple jobs. If an operator clicks "retry" twice quickly, two workflow jobs are created, both referencing the same call, and `dispatchQueuedCall` will report `already_handled` for the second (since the first already started the call). The outcome is non-destructive (no duplicate call placed), but the workflow job table accumulates cruft and the `alreadyHandled` count in `cron.ts` could be inflated.

**Fix:** Use `retry_${row.id}` (without the random suffix) so retries of the same call share one job row.

### 8. `decision.reason` can be `undefined` when stored as `errorState`
**File:** `artifacts/api-server/src/lib/callQueue.ts:275`
**Severity:** Medium

```ts
errorState: decision.reason,
```

The `PolicyDecision.reason` field is typed as `reason?: PolicyBlockReason` (optional). When `!decision.allowed` is true, `reason` is always set (every `return` in `evaluateCallPolicy` for the `allowed: false` path includes a `reason`). However, TypeScript cannot prove this, and the `calls.errorState` column is `text NOT NULL` (via Drizzle). If someone adds a new block reason at the top of `evaluateCallPolicy` that forgets the `reason` field, the insert would fail with a NOT NULL violation or store `undefined`.

**Fix:** Add a type guard or assertion: `errorState: decision.reason ?? "policy_blocked"`.

### 9. OpenAPI spec documents `/auth/login` but no login route exists (contract drift)
**File:** `lib/api-spec/openapi.yaml:72-89`
**Severity:** Medium

The spec defines `operationId: login` at `/auth/login` with a `LoginInput` schema, but `routes/index.ts` only mounts `/auth/me` and `/auth/logout`. There is no login handler anywhere. The spec also defines call status values (`provider_requesting`, `provider_accepted`) that don't match the actual code (`queued`, `in_progress`, `uncertain`, `policy_blocked`).

**Fix:** Either implement the login route or remove it from the spec. Synchronize the `Call.status` enum with the actual values in `callQueue.ts:159-165` and the schema.

### 10. No CI check for codegen drift or schema/test-DDL sync
**File:** `.github/workflows/ci.yml`
**Severity:** Medium

CI runs:
1. `pnpm run typecheck` — all workspace packages
2. `pnpm --filter @workspace/api-server run test` — unit tests
3. `pnpm --filter @workspace/api-server run build` — esbuild bundle
4. `pnpm --filter @workspace/leadsprint run build` — frontend Vite build

The prior code review (`docs/code-review-2026-09-07.md`) noted that CI should check codegen drift (Orval-generated client vs. OpenAPI spec). This was never implemented — the 4 recommendations in that review remain unaddressed. The critical schema drift in issue #1 (appointments index) would **not** be caught by CI because:

- The test DDL (`testDb.ts`) is hardcoded inline SQL, not generated from the Drizzle schema. There is no diff check.
- The `@electric-sql/pglite` dependency is used in tests, but the production database is real PostgreSQL. DDL differences can exist undetected.

**Fix:** Add a CI step that compares the Drizzle schema against the test DDL, or (preferably) have tests generate DDL from the schema rather than maintaining inline SQL. Add an Orval codegen drift check: `orval generate && git diff --exit-code`.

## Medium-Priority Issues

### 11. `@replit/connectors-sdk` is an unused root dependency
**File:** `package.json:13`
**Severity:** Low

`@replit/connectors-sdk` is declared as a direct dependency but is not imported anywhere in the codebase (verified by grep across all source). It's also not in `minimumReleaseAgeExclude`.

**Fix:** Remove from `package.json` dependencies, or add actual usage.

### 12. `lib/integrations/*` workspace glob references non-existent directory
**File:** `pnpm-workspace.yaml:40`
**Severity:** Low

The workspace config lists `lib/integrations/*` under `packages`, but no such directory exists:
```
packages:
  - artifacts/*
  - lib/*
  - lib/integrations/*  ← does not exist
  - scripts
```

**Fix:** Remove the `lib/integrations/*` line, or create the directory with a `package.json`.

### 13. `express.json()` verify handler overwrites `rawBody` on each middleware call
**File:** `artifacts/api-server/src/app.ts:58-70`
**Severity:** Low

Both `express.json()` and `express.urlencoded()` use the same `verify` callback that sets `rawBody`. In Express 5, if both middlewares are mounted (JSON first, then URL-encoded), and a JSON body arrives, only the JSON parser fires — fine. But the `rawBody` property is set to `Buffer.from(buffer)` which creates a copy. This is correct and safe, but if a body is sent as `application/x-www-form-urlencoded`, the JSON parser skips, the URL-encoded parser runs, and `rawBody` captures the URL-encoded buffer — which then needs to be parsed differently for signature verification. The webhooks (`webhooks.ts:55`) assume `rawBody` is the original request buffer, but with URL-encoded bodies, it would be URL-encoded bytes. All provider webhooks send JSON, so this is not currently a problem, but it's a latent bug if any webhook ever switches to form encoding.

### 14. `transporter()` caches nodemailer transporter globally
**File:** `artifacts/api-server/src/lib/mailer.ts:14-29`
**Severity:** Low

```ts
let cachedTransporter: Transporter | undefined;
function transporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;
  // ...
  cachedTransporter = nodemailer.createTransport({...});
}
```

If SMTP config changes at runtime (env var update, feature flag), the cached transporter is never refreshed. For a pilot deployment with static config this is fine. The `smtpConfigured()` check reads env fresh each time, so the function would return `false` (skip email) if SMTP is removed — but if SMTP creds rotate, the old transporter with stale credentials stays cached.

**Fix:** Document that SMTP config is read once at first send and cached for the process lifetime. For a pilot this is acceptable.

## Positive Findings (no action needed)

- **Fail-closed safety policy** (`policy.ts`): Consent, suppression, timezone, quiet-hours, attempt limits, and kill switch all fail closed. The policy gate is re-evaluated at dispatch time, not just enqueue time — a lead suppressed between queue and dial is correctly blocked.
- **Tenant scoping**: Nearly all queries use `business_id` in WHERE clauses. `WorkspaceScopeError` fails closed when no workspace is resolved.
- **Demo auth guard**: Requires both `LEADSPRINT_DEMO_AUTH=true` and `NODE_ENV !== production`. Logs loudly and refuses in production.
- **CORS hardening**: Loopback-only in dev, exact allowlist when configured, no CORS in production. Denied origins get 403 JSON, not 500.
- **Signature verification**: Retell (custom v={ts},d={hex} HMAC scheme), Twilio (standard HMAC-SHA1), Cal.com (HMAC-SHA256), and intake webhook (generic HMAC-SHA256) all verified with timing-safe comparison.
- **Raw body capture**: `express.json({ verify: ... })` captures raw body for signature verification on all provider webhooks.
- **Single-source availability/booking**: `getAvailabilityForBusiness` and `bookAppointmentForLead` are shared by both the console routes and the Retell agent tool endpoints — no logic fork.
- **Monthly usage rows**: `getCurrentUsageRow` uses deterministic IDs (`usage_<business>_<YYYY-MM>`) to handle first-of-month race conditions via primary key conflict.
- **Retell `override_agent_id` fix**: The providers.ts comment correctly notes Retell's API expects `override_agent_id`, not `agent_id` (lines 121-126).
- **Cal.com v2 API version pinning**: `cal-api-version` header pinned to `2024-08-13` (providers.ts:245).
- **Cal.com v2 response parsing**: Correctly extracts `data.uid` with fallback chain (providers.ts:309-317).

## Summary

| # | Issue | File | Severity |
|---|-------|------|----------|
| 1 | `appointments_calendar_external_unique` missing `business_id` scope | `lib/db/src/schema/leadsprint.ts:137` | Critical |
| 2 | `provider_events_provider_external_unique` missing `business_id` scope | `lib/db/src/schema/leadsprint.ts:193` | High |
| 3 | Console call enqueue not idempotent | `leadsprint.ts:491` | High |
| 4 | Workflow job idempotency key uses call PK, not stable key | `callQueue.ts:137` | High |
| 5 | `PolicyBlockReason` missing `"location_unknown"` | `policy.ts:18-24` | Medium |
| 6 | Provisioned usage row uses wrong ID format | `auth.ts:94-102` | Medium |
| 7 | Retry creates non-idempotent workflow jobs | `leadsprint.ts:529` | Medium |
| 8 | `decision.reason` can be `undefined` in `errorState` | `callQueue.ts:275` | Medium |
| 9 | OpenAPI spec has `/auth/login` and stale status enums | `openapi.yaml:72-89` | Medium |
| 10 | No CI check for codegen or schema/test-DDL drift | `ci.yml` | Medium |

Critical and high items should be addressed before any production customer onboarding.
