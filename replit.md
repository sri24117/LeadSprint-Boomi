# LeadSprint Operator Console

LeadSprint is an operator console for real-estate teams to turn new enquiries into qualified, human-ready sales handoffs across US and India market profiles.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run migrate` — apply DB migrations (dev and production)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/leadsprint/src/App.tsx` — operator routes, data hooks, actions, and authenticated-console shell
- `artifacts/leadsprint/src/index.css` — LeadSprint signal-desk visual language and responsive theme
- `artifacts/api-server/src/routes/leadsprint.ts` — preview-safe API routes, demo seed data, policy-aware call/lead/booking actions
- `lib/api-spec/openapi.yaml` — source of truth for API operations and generated client contracts
- `lib/db/src/schema/leadsprint.ts` — PostgreSQL schema for business, contacts, leads, calls, appointments, usage, jobs, events, and suppression

## Architecture decisions

- One shared application supports market-specific business configuration; market differences are data, not separate products.
- Provider actions are intentionally preview-safe and visible as demo mode until Retell, telephony, and Cal.com credentials are connected.
- Lead and call records are persisted before provider work so later adapters can reconcile uncertain paid actions instead of blindly retrying.
- The API contract is OpenAPI-first; React Query hooks and server validators are generated from the shared specification.

## Product

- Today overview with operational metrics, setup warnings, upcoming verified appointments, and recent activity
- Lead search, filtering, qualification updates, manual calls, suppression, follow-up, booking, and CSV import
- Call log with state, outcome, transfer/booking status, summary, and error visibility
- Verified appointments, business setup, weekly pilot reporting, and current usage metering

## User preferences

_No cross-project preferences recorded._

## Gotchas

- Provider actions should remain fail-closed and visibly simulated until provider integrations are configured.
- Regenerate the API client after changing `lib/api-spec/openapi.yaml`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
