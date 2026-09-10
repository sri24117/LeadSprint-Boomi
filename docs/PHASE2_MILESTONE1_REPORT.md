# Phase 2 — Milestone 1: Security Foundation Report

> **Branch:** `feature/leadsprint-mvp-hardening`  
> **Baseline:** Phase 1 commit `afdb8b0`  
> **Date:** 2026-09-10

---

## Summary

Milestone 1 implements the Security Foundation layer for the LeadSprint MVP:
production environment validation, controlled CORS origin policy, route-specific
rate limiting on webhook and cron endpoints, security logging redaction, and
automated tests covering all new behavior.

---

## Changes Implemented

### 1. Environment Validation (`env.ts`)

**File:** [`artifacts/api-server/src/lib/env.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/env.ts) [NEW]

- Zod schema validates all environment variables at startup via `validateEnv()`.
- **Production enforcement:**
  - `DATABASE_URL` — required, non-empty.
  - `CRON_SECRET` — required, minimum 16 characters.
  - `CLERK_SECRET_KEY` — required when `LEADSPRINT_DEMO_AUTH` is not `"true"`.
- **Provider consistency checks (bidirectional):**
  - Retell: `RETELL_API_KEY` ↔ `RETELL_WEBHOOK_SECRET` — if either is set, both are required.
  - Cal.com: `CALCOM_API_KEY` ↔ `CALCOM_WEBHOOK_SECRET` ↔ `CALCOM_EVENT_TYPE_ID` — if any is set, all three are required.
  - Twilio: `TWILIO_ACCOUNT_SID` ↔ `TWILIO_AUTH_TOKEN` ↔ `TWILIO_WEBHOOK_SECRET` — if any is set, all three are required.
- **Safety:** Error messages reference field names only, never secret values.
- **Permissiveness:** Local/demo development requires no provider credentials.

**File:** [`artifacts/api-server/src/index.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/index.ts) [MODIFIED]

- `validateEnv()` called at startup before `app.listen()`.
- `PORT` read from validated env instead of raw `process.env`.

---

### 2. CORS Restriction

**File:** [`artifacts/api-server/src/app.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/app.ts) [MODIFIED]

**Before:** `app.use(cors())` — wide-open, allows any origin.

**After:** Controlled origin policy:
- `CORS_ALLOWED_ORIGINS` environment variable (comma-separated whitelist).
- **Production:** Only explicitly listed origins pass. No wildcard `*`.
- **Development:** `localhost` and `127.0.0.1` on any port are allowed in addition to configured origins.
- **Same-origin / server-to-server:** Requests without an `Origin` header (e.g., webhooks, health probes, same-origin SPA) are always allowed.
- **Credentials:** `credentials: true` for cookie/session support.

---

### 3. Rate Limiting

**File:** [`artifacts/api-server/src/app.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/app.ts) [MODIFIED]

- **Webhook limiter** (`/api/webhooks/*`): 120 requests/minute per IP.
- **Cron limiter** (`/api/cron/*`): 20 requests/minute per IP.
- Both return JSON `429` responses (not HTML).
- Use `draft-7` standard headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`).
- Dashboard / operator console routes are **not** rate-limited by these middleware.
- Limiters are independent — exhausting webhook quota does not affect cron.

**Package:** `express-rate-limit@^8.7.0` added to `@workspace/api-server` dependencies.

---

### 4. Security Logging Redaction

**File:** [`artifacts/api-server/src/lib/logger.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/logger.ts) [MODIFIED]

Pino `redact` paths expanded to cover:
- `req.headers.authorization`, `req.headers.cookie` (existing)
- `req.headers['x-retell-signature']`
- `req.headers['x-twilio-signature']`
- `req.headers['x-leadsprint-signature']`
- `req.headers['x-cron-secret']`
- `req.body.phone`, `req.body.phoneNumber`
- `req.body.toNumber`, `req.body.fromNumber`
- `req.body.from_number`, `req.body.to_number`

---

### 5. Automated Tests

**File:** [`artifacts/api-server/src/lib/env.test.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/lib/env.test.ts) [NEW]

20 tests covering:
- Production failure: missing `DATABASE_URL`
- Production failure: missing/short `CRON_SECRET`
- Production failure: missing `CLERK_SECRET_KEY` when demo auth disabled
- Provider consistency: Retell, Cal.com, Twilio (missing counterpart keys)
- Local/demo permissiveness: no credentials needed
- Valid production: succeeds with full and partial credentials
- Error message safety: secret values never appear in thrown messages

**File:** [`artifacts/api-server/src/app.security.test.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/src/app.security.test.ts) [NEW]

15 tests covering:
- CORS: configured origin allowed, second origin allowed
- CORS: unconfigured origin rejected in production
- CORS: localhost rejected in production
- CORS: same-origin (no Origin header) allowed
- CORS: no wildcard `*` in production
- CORS: `credentials: true` header present
- CORS: localhost allowed in development
- CORS: 127.0.0.1 allowed in development
- CORS: external origin still rejected in development
- Rate limit: webhook 429 after burst
- Rate limit: cron 429 after burst
- Rate limit: healthz not affected by webhook/cron limits
- Rate limit: dashboard routes not affected
- Rate limit: webhook and cron limits are independent

**Framework:** Vitest + supertest

**File:** [`artifacts/api-server/vitest.config.ts`](file:///c:/Users/Swetha/Downloads/LeadSprint-Boomi-main/LeadSprint-Boomi-main/artifacts/api-server/vitest.config.ts) [NEW]

---

### 6. Dependencies Added

| Package | Type | Version |
|---------|------|---------|
| `zod` | dependency | `^4.5.4` |
| `express-rate-limit` | dependency | `^8.7.0` |
| `vitest` | devDependency | `^5.0.0` |
| `supertest` | devDependency | `^7.2.2` |
| `@types/supertest` | devDependency | `^7.2.1` |

---

## Files Changed

| File | Status | Description |
|------|--------|-------------|
| `artifacts/api-server/src/lib/env.ts` | NEW | Zod environment validation schema |
| `artifacts/api-server/src/lib/env.test.ts` | NEW | 20 env validation tests |
| `artifacts/api-server/src/app.security.test.ts` | NEW | 15 CORS + rate-limit tests |
| `artifacts/api-server/vitest.config.ts` | NEW | Vitest configuration |
| `artifacts/api-server/src/app.ts` | MODIFIED | CORS whitelist + rate limiters |
| `artifacts/api-server/src/index.ts` | MODIFIED | validateEnv() at startup |
| `artifacts/api-server/src/lib/logger.ts` | MODIFIED | Security redaction paths |
| `artifacts/api-server/package.json` | MODIFIED | New dependencies + test script |
| `pnpm-lock.yaml` | MODIFIED | Lockfile update |

---

## Verification Results

| Check | Result |
|-------|--------|
| `vitest run` (35 tests) | ✅ PASS |
| `pnpm run typecheck` (full workspace) | ✅ PASS |
| `pnpm --filter @workspace/api-server run build` | ✅ PASS |
| `pnpm --filter @workspace/leadsprint run build` | ✅ PASS |
| `git diff --check` (whitespace) | ✅ CLEAN |

---

## What Was NOT Changed (Milestone 1 Scope)

- ❌ Usage accounting (Milestone 2)
- ❌ Workflow worker logic (Milestone 3)
- ❌ Cal.com reconciliation (Milestone 4)
- ❌ Response DTO safeParse (Milestone 5)
- ❌ Docker / Dockerfile (Milestone 5)
- ❌ CI/CD workflow (Milestone 5)
- ❌ Database schema / migrations
- ❌ Frontend code
- ❌ No n8n, Redis, Kubernetes, NestJS, or microservices

---

## Verdict

**MILESTONE 1: PASS**

All 4 security objectives implemented. 35/35 tests passing. Full workspace typecheck and builds clean.
