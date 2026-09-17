# LeadSprint — Project Rules

## What This Is

LeadSprint is a **managed AI sales workflow engine** for real-estate businesses. It is NOT a chatbot, NOT a CRM, NOT a generic automation platform. It is a **policy-first operator console** that turns inbound property enquiries into qualified conversations and booked appointments via AI voice calls.

The commercial model is **$500 setup + $399/month** for a managed pilot with one operator, one business number, one calendar, and one database.

## Product Status

This is **Sellable V1.0** — technically ready for a 1–3 customer managed pilot. The next milestone is **V1 → Revenue**, not V1.1 with more features. Do not enter an endless engineering phase. All feature work should be justified by "does this help close or serve Customer #1?"

---

## Architecture

### Monorepo Structure (pnpm workspaces)

```
artifacts/api-server   → Express + Drizzle backend (Node 20, TypeScript)
artifacts/leadsprint   → React + Vite SPA (operator console)
lib/db                 → Drizzle ORM schema, migrations, seed data
lib/api-spec           → OpenAPI 3.1 contract (source of truth for API shape)
lib/api-client-react   → Generated TanStack Query hooks (via Orval — DO NOT HAND-EDIT)
lib/api-zod            → Generated Zod request/response validators (via Orval — DO NOT HAND-EDIT)
scripts/               → Build and utility scripts
docs/                  → Pilot scope, provider setup, acceptance criteria, retell agent config
```

### Key Constraints

- **pnpm only.** The `preinstall` script rejects npm and yarn. Use `pnpm` for all package operations.
- **TypeScript ~5.9.** The root `tsconfig.base.json` is shared across all packages via `references`.
- **Zod 3 runtime.** The codegen targets Zod 3 API. Do NOT use Zod 4 features in generated code. See `.agents/memory/api-contract-generator.md`.
- **Code generation is one-way.** `lib/api-client-react` and `lib/api-zod` are generated from `lib/api-spec/openapi.yaml`. Never hand-edit generated files. Change the OpenAPI spec, then run `pnpm codegen`.

---

## Multi-Tenant Isolation (Critical)

Every database table has a `business_id` column. **Every query MUST filter by `req.leadSprintBusinessId`.** There are no exceptions. Cross-tenant data leaks are a P0 severity bug.

The auth middleware (`middlewares/auth.ts`) sets `req.leadSprintBusinessId` and `req.leadSprintUserId` from the Clerk session. All downstream route handlers MUST use these values — never trust a `business_id` from the request body or URL params for scoping.

**Auto-provisioning:** When a Clerk user signs in for the first time, `requireAuth` creates both a `businesses` row and a `users` row. This is intentional — it's the self-serve onboarding path.

---

## Route Architecture

The Express router (`routes/index.ts`) is layered:

1. **Unauthenticated routes first** (no Clerk dependency):
   - `healthRouter` — `GET /healthz`, `GET /readyz`
   - `webhooksRouter` — provider callbacks (Retell, Twilio, Cal.com), each with their own HMAC verification
   - `cronRouter` — scheduler endpoints, authenticated by `CRON_SECRET` header
   - `agentRouter` — Retell LLM tool endpoints, authenticated by `X-Retell-Signature`

2. **Clerk middleware** applied only after this point

3. **Authenticated operator routes** via `leadsprintRouter` — all lead, call, appointment, report, and settings endpoints

**Demo auth mode:** When `LEADSPRINT_DEMO_AUTH=true` and `NODE_ENV !== production`, the auth middleware is replaced with a passthrough that injects the seeded demo business/user IDs. This is impossible to enable in production (the check is intentional).

---

## Safety Policy Engine (DO NOT WEAKEN)

The policy engine (`lib/policy.ts`) is the most important code in the system. It evaluates these gates **immediately before every outbound call**:

1. **Consent** — `consent_status` must be `valid` with a recorded `consent_source` and `consent_at`
2. **Suppression** — contact must not have a `suppressed_at` timestamp
3. **Quiet hours** — recipient's local time (derived from phone area code) must be outside the business's configured quiet window
4. **Usage limits** — voice minutes must not exceed the billing period allocation
5. **Attempt limits** — number of call attempts must not exceed `max_call_attempts`
6. **Kill switch** — `LEADSPRINT_KILL_SWITCH=true` blocks all outbound

**Never weaken, bypass, or add exceptions to these gates.** They exist for TCPA/TRAI compliance and customer trust. If a policy check seems wrong, fix the data, not the gate.

---

## Webhook Security

| Provider | Verification | Env Var |
|---|---|---|
| Retell | HMAC-SHA256 via `X-Retell-Signature` | `RETELL_WEBHOOK_SECRET` |
| Twilio | `twilio.validateRequest()` against `X-Twilio-Signature` | `TWILIO_AUTH_TOKEN` |
| Cal.com | HMAC-SHA256 (TODO — not yet implemented) | `CALCOM_WEBHOOK_SECRET` |
| Lead intake | HMAC-SHA256 via `X-Webhook-Signature` | `LEAD_INTAKE_WEBHOOK_SECRET` |
| Cron | Header `x-cron-secret` must match | `CRON_SECRET` |

**All provider webhooks use idempotent processing** via the `provider_events` table. Duplicate delivery is silently accepted and not reprocessed.

---

## Database Patterns

- **ORM:** Drizzle ORM with PostgreSQL
- **IDs:** All primary keys are `text` (ULIDs or prefixed composite strings like `usage_business123_2026-09`)
- **Timestamps:** All `timestamp with time zone`, never naive
- **Unique constraints:** Business-scoped (e.g., `calls_provider_call_unique` is `(business_id, provider, provider_call_id)`, not just `provider_call_id`)
- **Idempotency:** Call creation uses `idempotency_key` with a unique index to prevent duplicate calls from replayed webhooks or retries

---

## Frontend Conventions

- **Router:** Wouter (not React Router)
- **State management:** TanStack Query (server state only, no global client state)
- **UI components:** Custom components in `App.tsx` and `components/` — no component library (shadcn setup exists but is not actively used for most UI)
- **Auth:** Clerk React SDK with `@clerk/themes` shadcn theme
- **Styling:** CSS custom properties defined in `index.css`, Tailwind-like utility classes via Vite
- **Test IDs:** All interactive elements have `data-testid` attributes

### Current Frontend Issue

All 6 pages (Today, Leads, Calls, Appointments, Reports, Settings) plus shared components live in a single 663-line `App.tsx`. This is the known tech debt — functional but unmaintainable. The `pages/` directory exists but only has `not-found.tsx`.

---

## Environment Variables

All required and optional env vars are documented in `.env.example` with inline comments explaining their purpose and failure mode. The system is designed to **fail closed**: missing provider credentials disable that specific provider (visible on `GET /readyz`) rather than crashing.

---

## Calling Flow (The Core Workflow)

```
Lead arrives (webhook or CSV import)
  → Duplicate check (same business + same phone)
  → Consent evidence validation
  → Contact created with recipient timezone (from area code)
  → Lead created
  → Idempotent call job created (workflow_jobs table)
  → Worker claims job (with lease/lock)
  → Policy engine re-evaluates all gates
  → Retell API creates call
  → AI conversation runs
  → Transfer to human OR appointment booking
  → Retell webhook fires (call_ended → call_analyzed)
  → Call record updated with summary, outcome, duration
  → Usage table incremented
  → Activity logged
```

---

## Common Gotchas

1. **The `preinstall` script uses `sh`** — it breaks on Windows without Git Bash. Use WSL or Docker for development.
2. **Codegen must run after spec changes.** If you modify `openapi.yaml`, you must regenerate. The generated hooks and validators will be stale otherwise.
3. **`/today` and `/reports/weekly` load all leads/calls into memory.** This is known — acceptable for pilot scale (< 500 leads) but needs SQL aggregation before scaling.
4. **Supply chain protection:** `pnpm-workspace.yaml` enforces `minimumReleaseAge: 1440` (24 hours). New npm packages must be at least 1 day old.
5. **The usage table is only written to by auth middleware** (initial row creation) — voice minutes and costs need to be incremented in the webhook handlers.
