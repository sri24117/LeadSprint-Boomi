# LeadSprint — market-readiness audit

**Date:** 2026-11-18 · **Baseline:** `0a152fdebce9d2d4ddd34ddb46603ab0200a208f`

## Decision

**NO-GO for public / self-serve launch. Not yet approved for live paid pilots.**
A narrowly scoped, operator-managed outbound-callback pilot is the credible next
milestone, after the safety, reliability and operational acceptance gates below.
The backend is substantially more complete than the newer console screens.
This is a repository/code-and-test audit, not a penetration test, legal opinion,
production deployment verification, or a market-demand/competitor study.

No production URL, deployment configuration, logs, database, or live provider
accounts were available. No real calls, messages, bookings or payments were made.
A green build is not evidence that a customer's Clerk or provider configuration works.

## 1. The screenshot: why API-key setup is blocked

The old `AuthError` screen combined two different failures:

- The browser's Clerk SDK reports a signed-in session.
- `/api/auth/me` fails; `requireAuth` returns **401 Authentication required** when
  the API has no verified user. This happens before workspace business settings
  or provider-key validation. It is not evidence of a bad Retell/Cal.com key.

### Code defects fixed in this branch

1. **Clerk instance keys were rewritten from the app hostname.** Both `App.tsx`
   and `routes/index.ts` called `publishableKeyFromHost(host, configuredKey)`.
   Inspection of the installed Clerk implementation shows that the fallback is
   preserved for *development* keys, but production keys are replaced by a key
   derived from `clerk.<app hostname>`. That is not necessarily the configured
   Clerk instance, especially on custom/proxy/preview domains. Both sides now
   use the configured publishable key unchanged (apart from trimming whitespace).
   Server regression tests verify that Host / X-Forwarded-Host do not select it.
2. **No explicit session-token bridge.** `setAuthTokenGetter` existed in the API
   client but was never registered by the console. Same-origin cookies can work,
   but cookies alone are an unreliable deployment assumption. `ClerkApiAuth` now
   installs Clerk's renewable `getToken` before mounting API consumers, requests
   the current bearer token per fetch, and clears registration on logout/unmount.
   No tokens or secret keys are put in localStorage or the frontend build.
3. **Misleading error copy.** A 401 no longer claims the sign-in is valid or that
   the problem is necessarily an incomplete workspace. It explains API-session
   verification and the instance/build-time checks.
4. **Docker dropped proxy configuration.** `VITE_CLERK_PROXY_URL` was read by the
   console but not declared as a Docker build argument/environment variable. It
   now reaches the frontend build when explicitly configured.
5. **Partial signup could be permanent.** Business creation, owner creation and
   usage creation were separate writes. A business left behind after an error
   caused later attempts to skip creating its owner. Provisioning is now one
   transaction, retries safely, repairs an orphaned business without overwriting
   its settings, and refuses to move an existing user across workspaces.

These are verified code defects, **not a confirmed diagnosis of the live deployment**.
Mismatched Clerk instances, stale build variables, expired sessions, proxy configuration
and production Clerk domain settings must still be checked during redeployment.

### Deployment checklist (no secrets in chat)

1. In the deployment's environment UI set `VITE_CLERK_PUBLISHABLE_KEY` at
   **build time**, and `CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` at runtime.
   The two publishable values must match and all three belong to the same Clerk
   instance/environment. Do not mix `pk_test`/`sk_test` with live keys.
2. Rebuild/redeploy this branch's changes through your normal release process.
   A container restart cannot change baked-in `VITE_*` values.
3. Set `VITE_CLERK_PROXY_URL` only if deliberately using a Clerk proxy configured
   for this instance. Otherwise leave it empty. Configure production domains and
   redirects in Clerk, and preserve the correct public host/protocol at the proxy.
4. Sign out and back in. In browser DevTools, check `/api/auth/me`: it should
   return 200 for the signed-in user. A 401 still means authentication, not voice
   provider setup; a 503 or 500 requires workspace/database/server-log inspection.
   Never share Authorization headers, cookies, session tokens or API-key values.
5. Only then configure Retell/Cal.com/Twilio **server-side environment variables**
   from `.env.example`, and complete business onboarding. This repository does
   not implement a secure per-customer API-key vault or UI key-saving endpoint.
6. Verify `/api/readyz` database status and `/api/onboarding/checklist` under an
   authenticated session. Provider flags reflect presence of settings, **not a
   successful credential/permission/phone-number ownership test**.

## 2. Findings and remaining launch blockers

Severity is impact if the relevant path is enabled, not a claim of an observed exploit.
**Open** findings below were not silently fixed or assumed safe.

| ID | Priority / status | Finding, evidence and required action |
|---|---|---|
| AUTH-1 | P1 · fixed in branch | Host-derived live Clerk key + missing token bridge; see §1. Live Clerk acceptance still required. |
| AUTH-2 | P1 · fixed in branch | Non-atomic signup/orphaned workspace; transactional provisioning and regression tests added. |
| UI-1 | P1 · contained, features not implemented | `pages/agents.tsx`, `agent-builder.tsx`, `live-calls.tsx`, `teams.tsx`, `analytics.tsx`, `billing.tsx` use static records, local state and/or timers. “Deployed to Retell”, invitations, live transfer/hangup, metrics, paid invoices and card details were not backed by those actions. Routes now show an unavailable notice in Clerk-authenticated workspaces; local demo routes retain prototypes under an explicit simulation warning. Do not market these features as delivered. |
| SAFE-1 | **P0 · open before SMS enablement** | `routes/webhooks.ts`, missed-call SMS block: terminal Retell events schedule a two-minute in-process `setTimeout` and call `sendTwilioSms` without rechecking consent, suppression, quiet hours or the kill switch at send time. Both `call_ended` and `call_analyzed` can schedule separate messages. There is no durable send claim; a restart loses it. SMS usage is not accrued here. Do not enable this path for a customer as-is. Replace with a durable, per-call-idempotent job, channel-specific consent and STOP handling, send-time policy checks, provider idempotency/reconciliation, usage and delivery tracking. |
| REL-1 | P1 · open | Retell usage checks `callBefore.durationSeconds == null` before updating the call and incrementing usage. Distinct terminal events processed concurrently can both observe null and accrue. Existing sequential dedupe tests do not prove exactly-once accrual. Use a transaction/row lock or atomic claim coupled to usage, and test simultaneous `call_ended` / `call_analyzed`. This is a code-inspection race finding; not claimed as a reproduced production overcharge. |
| REL-2 | P1 · open | `acceptProviderEvent` records `processedAt` before downstream call/usage/activity writes. These do not share a transaction. A failure after event insertion can cause retries to be treated as duplicates even though processing never finished. Introduce durable event-processing state + retry or a transaction/outbox. Test failure injection after acceptance. |
| REL-3 | P1 · open | Provider `fetch` calls in `lib/providers.ts` have no explicit abort deadline. The scheduler processes jobs serially and stale claims have a TTL; a hung request can stall a tick and invalidate assumptions in the comments about bounded dispatch time. Add bounded deadlines, known-rejection vs uncertain classification, reconciliation and tests; do not blindly re-dial an uncertain outcome. |
| SEC-1 | P1 · open, release gate | Dependency audit reports high-severity runtime advisories and critical development-tool advisories; see §3. Patch supported versions in a dedicated tested upgrade. Scanner presence is not proof of endpoint exploitability, but it is not a clean release bill of health. |
| ONB-1 | P1 for self-serve · open | A new workspace defaults to “New LeadSprint workspace”, empty phone and no calendar link. `buildOnboardingChecklist` requires these, but Settings disables business name, omits a business-phone editor, and PATCH does not support name/phone/calendar-event/agent linkage. New users cannot complete onboarding independently. Supply a supported admin provisioning flow or extend schema/API/UI with validation and tests; do not tell users adding provider keys alone completes setup. |
| TEN-1 | P1 for shared multi-customer service · open | Intake and provider credentials are deployment-global. Intake payload chooses `business_id` under the global secret. Teams/organizations/RBAC management are not implemented; signup creates an owner workspace per Clerk user. Use separate deployments/secrets for initial pilots or implement tenant-owned encrypted secrets, memberships, role checks and rotation before a shared self-serve rollout. |
| IN-1 | P1 for India sales · open | US/IN market selectors and from-number configuration are not complete India support. CSV import infers recipient timezone only with `timezoneForUSPhoneNumber`; `+91` contacts get null and the safe calling gate blocks unknown timezones. Add verified recipient location/timezone capture, proper number validation and country-specific acceptance tests. Obtain local legal/provider review; do not infer India launch readiness from an IN toggle. |
| OPS-1 | P1 before paid pilot · unverified | Backups/restore scripts, health-alert endpoints, cron and worker exist. No evidence was supplied of production schedules, successful restore, external monitoring, delivered alerts, rollback drill, RPO/RTO or support ownership. Run and record them. Alert on findings/notification failure, not just HTTP 200 from the health-alert endpoint. |
| LEG-1 | P1 before live outreach · open/unverified | `docs/compliance/pilot-legal-pack.md` is expressly a draft with placeholders and no counsel sign-off. Calling/recording/AI disclosure, SMS authorization, DNC responsibilities, subprocessors, retention and incident terms require customer/jurisdiction review. Code safeguards are not a legal compliance certification. |
| DATA-1 | P2 · open | Retention prunes raw provider events and old activities, not full customer lifecycle data or provider recordings. Implement/test customer export/deletion, consent-evidence retention, provider deletion and account offboarding before claiming comprehensive deletion support. |
| SEC-2 | P2 · open | Rate limits are process-local; there is no demonstrated distributed limit/tenant quota system. A production CSP is intentionally absent. Preserve single-instance scope initially, review trusted proxy/forwarded headers, add a tested Clerk-compatible CSP and centralized abuse controls before broad exposure. |
| PERF-1 | P2 · open | Several list/report paths read all tenant rows and issue per-row detail queries; no broad load-test evidence. Production JS bundle is about 504 kB minified and emits a size warning. Add pagination, query budgets, representative tenant load tests and route-level code splitting. |

### Important product distinctions

- Core offering: **outbound callbacks to consented enquiries**, qualification,
  calendar booking and human escalation. It is not a proven inbound receptionist,
  live supervisor, agent-design platform, CRM integration suite or payment system.
- “Connected” next to a configured agent/event ID in Settings is not an authenticated
  provider connection test. Add provider validation and actionable errors before
  describing key onboarding as self-service.
- Existing monthly “included minutes” and cost assumptions are product estimates,
  not an enforceable billing/metering contract. Manual pilot invoicing is more honest
  than simulated subscriptions.
- A single managed customer with separate credentials is materially different from
  a shared, multi-tenant SaaS. Scope and pricing must reflect actual operator work.

## 3. Dependency review

Snapshot from the installed frozen lockfile and npm advisory service on this date:

| Command | Critical | High | Moderate | Low |
|---|---:|---:|---:|---:|
| `pnpm audit --prod --json` | 0 | 8 | 18 | 1 |
| `pnpm audit --json` (all dependencies) | 3 | 14 | 34 | 7 |

These are **scanner-reported advisory counts**, not distinct exploitable product
bugs. Advisories may overlap and change after this report. All-dependency scope is
important: this monorepo declares much of the frontend/bundler stack in devDependencies,
yet the compiled frontend output ships to customers. A production-dependency-only
scan is therefore not a complete review of the browser-delivered surface.

Runtime examples: Nodemailer 6.x has multiple advisories; Express resolves
`body-parser@2.3.0` (compressed-body DoS); Zod 3.25.76 has an oversized-collection
advisory; `http-proxy-middleware > micromatch > picomatch` and the rate-limiter's
`ip-address` also appear. Development scope flags Vitest/tinypool critical advisories;
we run `vitest run`, not a public Vitest UI server. Do not expose test/dev tools.

Required next step: review each advisory's reachable inputs and compatible fixed
version, upgrade direct/transitive dependencies without bypassing the repo's
minimum-release-age policy, regenerate contracts if moving Zod majors, rerun
all tests/builds, audit again, and document any accepted residual risk. No blind
`audit fix --force` or untested major upgrade was made during this auth fix.

## 4. What is already solid

- Server-side tenant predicates and signed provider/agent webhooks are widely
  covered by real-SQL tests, including cross-workspace negatives.
- The voice call policy is fail-closed for consent, suppression, unknown timezone,
  quiet hours, attempts and a deployment kill switch. This does **not** currently
  extend to the missed-call SMS path.
- Queue dispatch has conditional database claims and uncertain-state handling;
  these are better foundations than timer-only calling automation.
- Cal.com failures do not become fabricated bookings; unconfigured calling is gated.
- Migration failure prevents boot; migration-baselining, DB readiness and JSON
  error behavior have regression coverage.
- Non-root runtime image, scoped CORS, security headers, ignored environment files,
  lockfile and CI exist. No tracked `.env`, `.pem`, `.key` or credential-named files
  were found in the filename check; this is not a complete secret-history scan.
- Backup, acceptance, pilot-scope and legal draft documents already exist; operations
  need execution evidence, not another claim that documentation alone proves safety.

## 5. Verification performed

- Frozen dependency install succeeded (pnpm 12.5.1; sandbox Node 22.22.3;
  production Docker/CI target Node 24 — image/Node-24 execution not performed here).
- Baseline full API run: **362 passed, 1 failed, 35 files**. The failure was a
  clock-dependent test fixture: “now + 2h” can cross midnight in the business's
  timezone. The test now freezes **Date only** to a deterministic daytime value;
  the targeted usage suite passes. No production date logic was changed for this.
- Added four real-SQL provisioning tests (idempotence, orphan recovery, rollback,
  tenant ownership); two server Clerk-configuration tests; five browser token-bridge
  tests; two prototype-boundary tests. The latter prove hidden prototype children
  do not mount in customer workspaces.
- Console: **41 tests passed**. Typechecks passed for all workspace targets.
- API and console production builds passed; console emitted the bundle-size warning.
- OpenAPI client/Zod regeneration succeeded with no generated-file drift.
- Full post-fix API rerun: **367 passed, 36 files**, exit 0. The two new
  Clerk-configuration regressions were added after that run started and passed
  separately (**2/2**); 369 API test cases were exercised successfully across
  those runs. The real-app middleware/security tests ran after the key-pinning
  change and passed. No live Clerk verification is implied by mocked-config tests.
- `git diff --check` passed.

**Not verified:** real Clerk sign-in/session refresh across the deployed domain,
Docker image boot, actual provider credentials, a paid-provider call → callback →
booking → transfer → opt-out round trip, real SMTP/SMS delivery, external cron,
load/soak behavior, security penetration test, production backup restore, or legal
approval. Tests use local SQL and stubbed providers/configuration where applicable.

## 6. Recommended release order

1. **Restore operator access:** deploy key-pinning/token-bridge fixes; complete §1
   on the real domain. Keep demo auth off on every public production deployment.
2. **Close safety/reliability blockers:** durable policy-gated SMS or remove/disable
   that path; atomic webhook usage and durable event processing; bounded provider
   deadlines; regression tests for concurrency, crashes, late/out-of-order events.
3. **Harden the release:** triage/patch dependency advisories, verify backups/restore,
   external alerts, worker scheduling, rollback and support ownership.
4. **One managed pilot:** configure a real customer via a supported admin process;
   complete consent/recording/legal sign-off and the end-to-end acceptance runbook.
   Use only genuine dashboard/leads/calls/appointments/reports/settings workflows.
   Keep prototypes unavailable and invoice manually under a signed agreement.
5. **Earn self-serve later:** onboarding completion, encrypted per-tenant credentials,
   organizations/RBAC, real agent management/billing, provider credential checks,
   export/deletion, stronger observability and tested scale limits.

Commercial validation should measure actual time-to-first-call (including queued
quiet-hours cases), connect/qualification/booking rates, opt-out/complaint rate,
provider cost per qualified booking, and operator minutes per customer. Compare
against that customer's existing follow-up process before expanding the pitch.
