# LeadSprint

AI receptionist + speed-to-lead for small businesses. Twilio number → Retell
AI voice agent → qualification → Cal.com booking or human transfer →
operator console. See `docs/leadsprint-provider-setup.md` for the product
architecture and `Coolify + Git + Collaboration Deploy Sheet` for the
infra/collaboration workflow this repo is meant to be deployed with.

## Stack

pnpm monorepo · Express 5 API (`artifacts/api-server`) · React/Vite operator
console (`artifacts/leadsprint`) · PostgreSQL via Drizzle ORM (`lib/db`) ·
Clerk auth · OpenAPI-first contract with codegen (`lib/api-spec`,
`lib/api-zod`, `lib/api-client-react`).

## Local development

```bash
corepack enable
pnpm install
pnpm --filter @workspace/db run push        # push schema to DATABASE_URL
pnpm --filter @workspace/api-server run dev  # API on the port you set
pnpm --filter @workspace/leadsprint run dev  # frontend Vite dev server
```

Requires `DATABASE_URL` at minimum. Everything else (Clerk, Retell, Twilio,
Cal.com, SMTP) fails closed into demo mode when unset — check
`GET /api/readyz` to see what's live vs. demo.

## Production deploy (Docker / Coolify)

This repo builds to a single container that serves both the API and the
built frontend on one port — the shape Coolify's "Git Repository" resource
expects.

```bash
docker build -t leadsprint .
docker run -p 5000:5000 --env-file .env leadsprint
```

On Coolify: **Add Resource → Git Repository (with GitHub App) → Dockerfile**
build method, point at this repo's `main` branch, set the application port
to `5000` (or whatever `PORT` you configure), and add the environment
variables from `.env.example` in the Coolify UI. Full walkthrough in the
deploy sheet PDF.

### Database

Run the schema push once against your production `DATABASE_URL` before
first deploy (from a machine that can reach it, or as a Coolify one-off
command):

```bash
pnpm --filter @workspace/db run push
```

### Scheduled jobs

Three endpoints are meant to run on a schedule (Coolify → Scheduled Tasks,
or any cron), authenticated with the `CRON_SECRET` env var via the
`x-cron-secret` header — not a Clerk session:

| Endpoint | Suggested schedule | What it does |
|---|---|---|
| `POST /api/cron/process-jobs` | every 5–10 min | Retries calls that were queued while Retell wasn't configured, or blocked by quiet hours, re-checking the safety policy each time. |
| `POST /api/cron/weekly-report` | weekly | Emails each business owner their weekly numbers (no-ops per business if SMTP isn't configured). |
| `POST /api/cron/retention` | daily | Prunes raw provider-event payloads and stale activity rows past `RETENTION_DAYS`. Never touches leads, calls, contacts, or appointments. |

```bash
curl -X POST https://your-domain/api/cron/process-jobs \
  -H "x-cron-secret: $CRON_SECRET"
```

### Health checks

- `GET /api/healthz` — liveness, no dependencies.
- `GET /api/readyz` — reports demo vs. live mode per provider. Both work
  without Clerk configured; only the operator-console routes under
  `requireAuth` need a Clerk session.

## Safety policy

Every outbound call goes through `artifacts/api-server/src/lib/policy.ts`
before any provider request is made: consent → suppression → quiet hours →
attempt limit → `LEADSPRINT_KILL_SWITCH`. Blocked attempts are recorded as
`policy_blocked` calls with a reason, visible in the operator console.

## CI

`.github/workflows/ci.yml` runs `pnpm run typecheck` and builds both the
API server and the frontend on every push/PR to `main` — this is the check
that would have caught a build-breaking bug before it reached main.
