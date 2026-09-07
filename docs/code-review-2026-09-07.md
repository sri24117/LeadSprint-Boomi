# LeadSprint code review — 2026-09-07

Full read-through of the monorepo (`artifacts/api-server`, `artifacts/leadsprint`,
`lib/db`, `lib/api-spec` / `api-zod` / `api-client-react`, Dockerfile, CI) plus a
working local deploy of the production shape (single Express process serving the
API and the built SPA on one port, PostgreSQL behind `DATABASE_URL`).

Everything below was verified by running it, not just by reading.

## Fixed in this branch

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | **High** | Any activity row whose `type` isn't in the OpenAPI enum makes `GET /activity` **and** `GET /today` throw a `ZodError` → HTTP 500. The server writes three such types today: `intake` (intake webhook), `message` (failed transfer), `policy` (policy-blocked call). So one webhook lead — or one blocked call, i.e. the safety feature working — permanently breaks the console home page. | Added `intake`, `message`, `policy` to `Activity.type` in `openapi.yaml`, re-ran codegen. |
| 2 | **High** | With `CLERK_SECRET_KEY` unset, every operator-console route returned an HTML **500** (`Missing Clerk Secret Key` thrown inside `clerkMiddleware`), contradicting the README's "fails closed into demo mode". | `routes/index.ts` now short-circuits with a JSON **401** when Clerk isn't configured. |
| 3 | Medium | `publishableKeyFromHost(getClerkProxyHost(req) ?? "")` throws `Host must not be empty` on any request without a `Host` header (HTTP/1.0 clients, some probes) → 500. | Guarded; falls back to `CLERK_PUBLISHABLE_KEY`. |
| 4 | Medium | No API error handler and no `/api` 404: unknown paths and any thrown async error rendered Express's default **HTML** page (with a stack trace when `NODE_ENV != production`). | JSON `404 {"error":"Not found"}` at the end of the API router, plus a JSON 500 error handler mounted on `/api` that logs the real error server-side. |
| 5 | Medium | `app` never set `trust proxy`. Behind Coolify/Traefik, `req.protocol` is `http`, so the Twilio status-webhook signature — computed over the public `https://` URL — can never validate. | `TRUST_PROXY` env (default `1`), documented in `.env.example`. |
| 6 | Medium | `void ensureSeedData()` at module load: if the DB is unreachable at boot the rejection is unhandled and Node exits — taking down `/healthz`, webhooks and cron, which are supposed to survive a database outage. | Attached a `.catch()` that logs. |
| 7 | Low | Retell webhook set `durationSeconds: duration` where `duration` is `null` for non-terminal events, wiping a previously recorded duration on every later status update. | Only writes when present. |
| 8 | Low | Generated clients were stale relative to `openapi.yaml` — the `ReadinessStatus` schema (`/readyz`) existed in the spec but had never been generated into `api-client-react`/`api-zod`. | Re-ran `pnpm --filter @workspace/api-spec run codegen`. CI should also verify this (see below). |
| 9 | Low | `.env` was **not** in `.gitignore`, although `.env.example` and the README both tell you to create one (`.dockerignore` did exclude it). One `git add -A` from committing live provider secrets. | Added `.env` / `.env.*` with a `!.env.example` exception. |
| 10 | — | No way to run the operator console locally without a Clerk instance. | Added an explicitly gated demo-auth mode (below). |

### Demo auth mode (local only)

`LEADSPRINT_DEMO_AUTH=true` (server) + `VITE_LEADSPRINT_DEMO_AUTH=true` (frontend
build) run the console against the seeded `business_demo` workspace with **no
authentication**. Guard rails:

- The server ignores the flag when `NODE_ENV=production` and logs an error.
- When active it logs a `WARN` at boot and `GET /api/readyz` reports `"auth":"demo"`.
- The console shows a permanent red "Demo auth" banner and the sign-in/sign-up
  routes render a notice instead of Clerk components.

## Not fixed — recommendations

1. **No tests anywhere.** `policy.ts` (consent → suppression → quiet hours →
   attempt limit → kill switch) is the highest-risk code in the product and is
   verified by nothing but the type checker. It's pure and trivially unit
   testable — quiet-hours parsing alone has an overnight-window branch, a
   degenerate-window branch and a timezone fallback.
2. **CI doesn't catch contract drift.** `.github/workflows/ci.yml` runs
   typecheck + build. Add a step that re-runs codegen and fails if
   `git diff --exit-code lib/api-client-react lib/api-zod` is dirty; that would
   have caught finding #8, and finding #1 would have been a compile error had
   the server used the generated `ActivityType` union when inserting rows.
3. **Response-validation failures shouldn't be 500s.** Every handler does
   `Schema.parse(...)` on the way out. A single unexpected DB value takes the
   endpoint down (that's finding #1). Prefer `safeParse` + log + serve the raw
   DTO, or validate only in non-production.
4. **Seeding demo data at import time.** `ensureSeedData()` writes "Northstar
   Realty" and four fake leads into *any* database, including production, and
   `scopedBusinessId()` silently falls back to `business_demo` when a request
   has no business. Gate the seed behind an env flag and make the fallback a
   hard error instead.
5. **Usage accounting is unscoped.** The Retell webhook does
   `UPDATE usage SET voice_minutes = ... WHERE business_id = ?` with no period
   filter, so it hits every billing period row for that business; `GET /usage`
   hardcodes `period_label: "September 2026"` and `included_minutes: 300`, and
   `/today` hardcodes `unresolved_messages: 1`.
6. **`cors()` is wide open.** The SPA is served same-origin by this very
   process, so `app.use(cors())` only widens the attack surface. Restrict to a
   configured origin list (or drop it) unless a separate frontend host is real.
7. **No rate limiting** on `/api/webhooks/*` or `/api/cron/*`. Both are public
   endpoints doing DB work before/while authenticating; the cron secret compare
   is timing-safe but unbounded in attempts.
8. **Docker image runs as root.** `node:24-bookworm-slim` defaults to root and
   the final stage copies the whole build context including `node_modules` and
   sources. Add `USER node` and consider copying only `dist` + prod deps.
9. **`calls_provider_call_unique` is global**, not per business, and the Twilio
   status handler looks up a call by `provider_call_id` across all tenants.
   Scope both by `business_id`.
10. **Auth bootstrap edge case.** In `requireAuth`, if the business insert
    conflicts but the user row doesn't exist, `[user]` is `undefined` and the
    operator gets a 503 they can't recover from; the `onConflictDoNothing()
    .returning()` pattern has the same hole for the user insert.
11. Replit-specific config (`.replit`, `@replit/vite-plugin-*`) is still in a
    repo whose documented target is Coolify — harmless but worth pruning.

## Verified working locally

- `pnpm run typecheck` — clean across all 9 workspace projects.
- API-server esbuild bundle and Vite SPA build — clean.
- `drizzle-kit push` against a real PostgreSQL 18 instance — schema applies.
- `GET /api/healthz`, `GET /api/readyz` (US + IN markets).
- Signed `POST /api/webhooks/intake`: accepted, replay → `duplicate`, bad
  signature → 401.
- `POST /api/cron/{process-jobs,retention,weekly-report}`: 401 without
  `x-cron-secret`, correct JSON summaries with it (weekly report reports
  `skipped_no_smtp` rather than failing, as designed).
- Console API: `/auth/me`, `/today`, `/leads`, `/leads/:id`, `/calls`,
  `/appointments`, `/activity`, `/usage`, `/reports/weekly`,
  `/business-settings` (GET + PATCH), `/leads/import`, `/leads/:id/suppress`.
- Safety policy end-to-end: a call attempted at 07:16 America/New_York was
  written as `policy_blocked` / `quiet_hours` with a 409; after suppressing the
  lead the same call was blocked as `consent_invalid`. No provider request was
  made in either case, and both are visible in the activity feed.
