# LeadSprint — market readiness review

**Date:** 2026-09-25 · **Commit reviewed:** `f4b480b` (`arena/01a0d975-leadsprint-boomi`, == `main`)
**Method:** full source read of the API server, worker, provider adapters and console; the
whole verification pipeline executed locally; and the real product booted and driven over
HTTP (`pnpm demo --reset`, embedded PostgreSQL + provider stubs + built SPA on one port).

---

## Verdict

**Yes to a paid, managed pilot. Not yet to self-serve / GA.**

The engineering is genuinely above the bar for this stage: the safety policy gate is real,
tenant scoping is enforced in the database rather than in application hope, the setup gate
makes an unconfigured deployment incapable of dialling anyone, and the docs (including the
audit history) are honest about what is *not* done. This is not a demo dressed up as a
product.

Three defects have to be closed before money changes hands, because all three are silent:
none of them surface as an error to the operator.

| # | Defect | Why it blocks | Status |
|---|---|---|---|
| **P1-1** | Voice usage is **double-counted** (verified live: one 60-second call billed as 2.0 minutes / $0.24) | Customers are invoiced for voice minutes; the meter is wrong by 2× on every call | **Fixed** |
| **P1-2** | The console's **"Call lead" button returns HTTP 201 while doing nothing** after the first attempt on that lead | The operator is told a call succeeded when no call was placed — the single worst failure mode for a trust product | **Fixed** |
| **P1-3** | The job worker has a **double-dial race** (no row locking or atomic claim) | Two calls to one prospect, forever, is precisely what the product promises cannot happen | **Fixed** |
| **P1-4** | A call blocked by quiet hours was **never retried, ever** — the retry job resolved to `already_handled` and marked itself complete | The README promises overnight enquiries are called in the morning; they were not. Same family as P1-2: a silently dropped call | **Fixed** |

All four were fixed on 2026-09-25 (see §6 for the diffs, the tests, and the live
re-verification). Everything else below is a known-scope or GA-stage item, not a blocker for a
pilot — P2-7 (two competing schema-management paths) is also fixed, because the demo and the
docs both walked straight into it.

---

## 1. What was verified working (not read — executed)

### Pipeline

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ 551 packages, lockfile passes the supply-chain policy gate |
| `pnpm run typecheck` (all 4 workspaces) | ✅ clean |
| `pnpm --filter @workspace/api-server run test` | ✅ **151 tests / 16 files pass** |
| `pnpm --filter @workspace/leadsprint run test` | ✅ 12 tests pass |
| `drizzle-kit generate` against the schema | ✅ *"No schema changes, nothing to migrate"* — committed migration, test DDL and Drizzle schema agree |
| `pnpm demo --reset` | ✅ boots PGlite + provider stubs + API + built console on one port |

### Live behaviour against the running product

| Check | Observed |
|---|---|
| `GET /api/readyz` | `{"mode":"demo","providers":{"retell":true,"twilio":false,"calcom":true,"intake":true},"auth":"demo"}` — unconfigured providers degrade honestly |
| Console SPA + unknown `/api/*` path | `200 text/html` / `404 {"error":"Not found"}` (JSON, not an HTML error page) |
| Intake with a forged signature | `401` |
| Intake with `consent_status:"valid"` and no `consent_source` | `400` — *"consent_status \"valid\" requires a non-empty consent_source"* |
| Intake with a stale `timestamp` | `400` — *"Webhook timestamp expired"* |
| Quiet hours, evaluated in the **recipient's** timezone | Hawaii number at 06:50 HST → `policy_blocked`, *"Outside allowed calling hours (21:00–08:00 Pacific/Honolulu, recipient local time)"* |
| Console call idempotency | repeat clicks never create a second call row (correct) |
| Retell callback, unsigned / valid / replayed | `401` / `202 {accepted:true}` / `202 {duplicate:true}` with no second write |

### Structural guarantees confirmed in source

- **Schema-scoped tenancy:** every unique index carries `business_id` —
  `appointments_calendar_external_unique`, `provider_events_provider_external_unique`,
  `calls_provider_call_unique`, both idempotency indexes (`lib/db/src/schema/leadsprint.ts:137,193`).
- **One call path:** intake webhook, console, and cron all funnel through
  `lib/callQueue.ts`; the policy gate is re-evaluated *inside* `dispatchQueuedCall`
  immediately before the provider request, never reused from enqueue time.
- **Fail-closed policy:** consent → suppressed → recipient timezone unknown ⇒ block →
  quiet hours → attempt limit (policy-blocked rows do not consume budget) → kill switch.
- **Setup gate:** `liveCallingBlockedReason()` refuses to dial from a half-configured
  workspace and surfaces as `409 SETUP_INCOMPLETE`.
- **Demo containment:** seeding, simulated availability and demo auth each require an
  explicit flag **and** `NODE_ENV !== production`; the console paints a red demo banner.
- **No fabricated bookings:** no Cal.com config ⇒ `503`, never an appointment row the
  calendar doesn't know about.
- **Provider adapters:** Retell `override_agent_id`, Cal.com `cal-api-version` pinned to
  `2024-08-13` and the `{data:{uid}}` v2 envelope unwrapped; agent tool calls take
  `business_id`/`lead_id` from **signed call metadata, never from model arguments**.

---

## 2. Findings

### P1-1 · Voice usage double-counted (billing)

`POST /api/webhooks/retell` calls `recordVoiceUsage()` for **any** accepted event carrying
`duration_ms`. Retell sends the duration on both `call_ended` *and* `call_analyzed`; the two
payloads differ, so `provider_events` dedupe (keyed on the event hash) cannot catch the
second one.

Reproduced live on one 60-second call:

```
usage before    : voice_minutes 0, cost $0.00
call_ended      : 202 {accepted:true, duplicate:false}   -> voice_minutes 1, cost $0.12
call_analyzed   : 202 {accepted:true, duplicate:false}   -> voice_minutes 2, cost $0.24   ← wrong
replay call_ended: 202 {duplicate:true}                  -> unchanged (dedupe works for identical bodies)
```

Secondary: usage accrues even when **no call row matches** the `call_id`, so a signed event
for a call LeadSprint never placed still bills the customer.

**Fixed 2026-09-25.** Usage now accrues once, on the first terminal report that carries a
duration, and only for a call row LeadSprint actually placed (`routes/webhooks.ts`). The fix
amounted to:

```ts
// only on the terminal transition, only for a known call, only once
const firstTerminalWithDuration =
  terminal && duration != null && callRow != null && callRow.durationSeconds == null;
await db.update(callsTable).set({ /* … */ }).where(/* … */);
if (firstTerminalWithDuration) {
  await recordVoiceUsage(db, businessId, duration / 60, VOICE_COST_PER_MINUTE);
}
```

Add a regression test that replays `call_ended` + `call_analyzed` for one call and asserts
`voice_minutes === 1`.

### P1-2 · "Call lead" reports 201 while silently doing nothing

The console enqueues with a permanent key, `console_${leadId}`. If the first attempt ends
`policy_blocked` (quiet hours is the common case), that row keeps `policy_blocked` forever.
Every subsequent click resolves to `already_handled`, and the route's only branches handle
`policy_blocked` and `setup_incomplete` — so it falls through to **`201` with the stale
blocked row**.

Reproduced live against a Hawaii lead (inside quiet hours):

```
1st POST /api/calls/start -> HTTP 409  call_c9159713-93d  policy_blocked  quiet_hours   (correct)
2nd POST /api/calls/start -> HTTP 201  call_c9159713-93d  policy_blocked  quiet_hours   ← reports success
```

The lead is never called again, not at 10am local time tomorrow either, and the operator's
console says the action succeeded. (The per-call **Retry** button does work — it uses
`retry_<callId>` — which is why this hid for so long.)

**Fixed 2026-09-25.** The console attempt key is now bucketed to the minute
(`console_<leadId>_<minute>`), so a double-click still collapses onto one attempt, and the
route answers 201 **only** when the provider accepted the call — every other outcome is a 409
carrying the reason. The console's `onError` now displays it instead of failing silently.

### P1-3 · Double-dial race in the dispatch worker

`processQueuedJobs()` (in `routes/cron.ts` **and** `lib/scheduler.ts` — the same logic twice)
selects `queued` jobs with no lock, and `dispatchQueuedCall()` is read-then-write:

```ts
if (call.status !== "queued") return { outcome: "already_handled" };   // ← check
…
const live = await startRetellCall({ … });                              // ← act
```

Two workers — internal worker enabled *and* a Coolify scheduled task, or two replicas during
a rolling deploy — can both pass the check and both call Retell. Two real phone calls to one
prospect, which violates the module's own documented guarantee and is exactly the failure
that gets a speed-to-lead vendor fired. Nothing in the repo prevents running both mechanisms
(`.env.example` documents both paths).

**Fixed 2026-09-25.** Two conditional UPDATEs now provide the mutual exclusion — the dispatcher
claims the call, the worker claims the job — and abandoned claims are reclaimed after a TTL so
the queue cannot wedge:

```sql
UPDATE workflow_jobs SET status = 'dispatching'
 WHERE id = $1 AND status = 'queued' RETURNING *;

UPDATE calls SET status = 'in_flight'
 WHERE id = $1 AND business_id = $2 AND status = 'queued' RETURNING *;   -- 0 rows ⇒ someone else dialled
```

plus a startup guard/warning if `ENABLE_INTERNAL_WORKER=true` and the container is not
pinned to a single replica.

### P1-4 · A call blocked by quiet hours was never retried (README promise, not delivered)

Found while re-verifying P1-3 live. `README.md` advertises the retry queue as *"Retries calls
that were queued while Retell wasn't configured, or blocked by quiet hours"*, and
`docs/pilot-scope.md` lists "automatic idempotent call queue with retry" as in scope. Neither
was true for the case that matters most.

The quiet-hours block writes the call row as `policy_blocked`. The retry job survives, but
`dispatchQueuedCall` refuses any row that is not `queued`:

```
call row : call_a11d26b7-1cc | policy_blocked | Blocked — quiet_hours
job      : queued, retryable=true, message="Outside allowed calling hours …"
next drain: { jobs_seen: 1, started: 0, blocked: 0, already_handled: 1 }   ← job marked completed
```

So the retry resolved to `already_handled`, the job was marked completed, and the enquiry was
never called — not that night, not the next morning, not ever. Combined with the fixed timer
(30 minutes × 5 attempts = 2.5 hours), a fixed-interval retry could not have crossed a night
even if the row *had* been re-opened.

**Fixed 2026-09-25.** Three parts:

1. `dispatchQueuedCall` may re-open a call blocked for a reason time clears (quiet hours), and
   still refuses one blocked by a decision (consent, suppression, kill switch) — a retry cannot
   clear those, so it must not try.
2. The block returns `retryAt` — the opening of the next allowed window, computed in the
   *recipient's* timezone by `nextAllowedCallTime()` — and the worker schedules the retry there
   instead of on a fixed tick.
3. The setup gate and provider deferrals still use fixed backoff (they are configuration
   events, not clock events).

Verified live by compressing a night into three minutes: an enquiry was blocked at 07:16
recipient-local with the window ending 07:18, the job waited, and the drain after the window
opened dialled it **exactly once** — `call_73b12c3f-958` moving `policy_blocked → in_progress`
with the correct `business_id`/`lead_id`/`call_id` metadata.

### P2-4 · Two metrics on the Today page lie  — **partly fixed**

- `appointments_today` is `appointments.length` over **all confirmed appointments** — the
  `/today` query has no date filter, so the card counts every booking ever made
  (`routes/leadsprint.ts`, `/today`).
- `unresolved_messages` is a trailing-7-day count of `message` activities with no way to
  resolve one (already acknowledged in `docs/pilot-acceptance.md`).

**Fix.** Filter appointments to the business-timezone day window; add a resolve action to
message activities. *(The appointment count is fixed and tested; a real message-resolve
workflow is still open.)*

### P2-5 · No per-tenant intake secret

`LEAD_INTAKE_WEBHOOK_SECRET` is a single global secret, and `business_id` is taken from the
payload and only checked for existence. Any holder of the secret (every customer's form or
n8n instance, plus us) can create leads in **any** tenant's workspace. Acceptable for one
managed pilot; a hard blocker for self-serve multi-tenancy.

**Fix.** Store a per-business signing secret and verify the signature against the business
named in the payload (or carry `business_id` outside the signed body).

### P2-6 · No team support — the pilot's own customer profile can't use it

`requireAuth` maps each Clerk **user** to its own workspace (`business_${userId}`); there is
no Clerk Organizations integration, no membership or invite model, and `users.role` is
written but never enforced. `docs/pilot-scope.md` defines the customer as a **2–15 agent
team, one office, one configured workspace** — today every teammate who signs in gets a
separate, empty workspace.

**Fix.** Map Clerk `org_id` → `business.id`, seed memberships on org invite, and add the
role check to the settings/business routes.

### P2-7 · Two schema-management paths that silently disable each other  — **fixed**

The repo manages the same schema two ways, and the documented path breaks the automatic one.

`lib/db/src/index.ts` runs `runMigrations()` (the Drizzle journal in `lib/db/drizzle/`) on every
boot; `README.md` and `docs/pilot-acceptance.md` both tell the operator to run
`drizzle-kit push` first. `push` does not write to Drizzle's `__drizzle_migrations` table, so a
push-created database always looks migration-naïve to the migrator — which replays `0000`,
fails, rolls back, and (because the boot path swallows the error and starts anyway) is written
off as noise.

Reproduced on a **fresh** demo database, exactly as `pnpm demo --reset` boots it:

```
[demo] schema   pushing schema (drizzle-kit) … applied
[INFO] Verifying database schema and running migrations...
[ERROR] Database migration could not be completed on boot
        "Failed query: CREATE TABLE \"activities\" ... caused by: error: relation "activities" already exists"
[INFO] Server listening
```

The damage is not the error message — it's structural: because `0000` can never succeed on a
push-created database, **every future migration added to `lib/db/drizzle/` is permanently
blocked from applying there**. Schema changes would silently accumulate as drift on the one
database that matters, while CI stays green (it only greps `testDb.ts` for two index names).

**Fix (applied).** Migrations are now the only mechanism: `pnpm demo` and
`docs/pilot-acceptance.md` run `drizzle-kit migrate` (the same journal the app's boot migrator
uses), the README says plainly never to `push` a deployed database, and a boot that cannot
apply its schema now exits instead of serving traffic — which is what makes the failure
visible rather than a footnote in the logs. A database already created with `push` needs no manual step: the
boot migrator verifies every table the migrations expect is present, records the existing
migrations as applied using Drizzle's own hashes, and starts (see `lib/db/src/index.ts`). The
manifest of that adoption is the log line `[db] This database already had the schema but no
migration history …`. A *partial* schema is never adopted — it still refuses to start.

### P3-7 · "AI receptionist" but no inbound calls

The README's first line sells "AI receptionist + speed-to-lead". The entire pipeline is
outbound: tenant identity comes from `call.metadata.business_id`. An inbound call to the
LeadSprint number has no metadata, so agent tools answer `400`, the call webhook answers
`404`, and nothing lands in the console. Either build the inbound path (dialled number →
business → agent answers → lead created) or stop describing it as an AI receptionist.

### P3-8 · Intake replay protection is conditional

The 300-second freshness check only runs when the caller supplies `timestamp` /
`x-webhook-timestamp`. A captured signed body replays forever (impact is limited — the
duplicate-phone check stops a second lead — but `implementation.md`'s claim of "reject
webhooks older than 300 seconds on intake" is only conditionally true). Intake also bypasses
`provider_events` entirely.

### P3-9 · Boot does not fail closed on a database failure  — **fixed**

`src/index.ts` catches `runMigrations()` errors, logs them, and starts listening anyway —
worker included. A bad `DATABASE_URL` yields a "healthy" container serving 500s.
`/healthz` is dependency-free, so the Docker healthcheck stays green. This is also what
hides P2-7 on every demo and pilot boot. Report schema state on `/readyz` and point the
healthcheck at it.

### P3-10 · Brand and repo hygiene

`index.html` still ships the Replit placeholder: *"LeadSprint Operator Console — built on
Replit. Update this description to reflect the app."* with `robots: index, follow` and a
`robots.txt` that allows crawling the operator console. `.replit`,
`@replit/vite-plugin-*` and the unused `artifacts/mockup-sandbox` remain in a repo whose
documented deploy target is Coolify.

### P3-11 · No monitoring or alerting

Logs only (pino). No error tracking, no alerting, no metrics endpoint. For a product that
places calls on a stranger's phone at 2am, "someone will read the logs" is not an
operational plan. Add error tracking plus an alert on failed/`uncertain` call rate and on a
stalled job queue (a job whose `availableAt` is old and whose `attempts` are climbing).

### P3-12 · Compliance artefacts are missing, not just unverified

`docs/pilot-scope.md` correctly requires the customer to confirm telemarketing, recording,
AI-disclosure and quiet-hours law **in writing** — but there is no artefact in the repo to
sign: no privacy policy, no DPA, no recording/two-party-consent policy, no documented
recording retention (Retell stores the audio and transcripts; the retention cron only prunes
`provider_events` payloads). Own that before the first invoice.

### P3-13 · Operational gaps already acknowledged, still open

Coolify nightly S3 backups are documented but unconfigured; the in-memory rate limiter and
the in-process worker both assume a single replica (see P1-3); SMTP credentials are read
once per process.

---

## 3. Readiness by dimension

| Dimension | State | Notes |
|---|---|---|
| Core promise (speed-to-lead) | ✅ works end to end | Includes the overnight-retry path (P1-4). Verified live; intake → queue → gate → provider → signed callback → console |
| Safety / consent / quiet hours | ✅ strong | Recipient-timezone quiet hours, fail-closed on unknown location, kill switch, attempt budget that policy blocks don't consume |
| Tenant isolation | 🟡 good, one gap | DB-scoped indexes and per-route scoping are correct; intake secret is global, and there is no team/org model |
| Billing accuracy | ✅ fixed | P1-1 — one call, one minute |
| Operator trust | ✅ fixed | P1-2 — 201 means dialled; blocks surface with a reason |
| Concurrency / scale | ✅ safe | P1-3 — jobs and calls are claimed atomically, so a cron and the internal worker can coexist; a single 2-core container is still the right size for 10–60 enquiries/week |
| Test suite | ✅ good | 175 meaningful tests on real SQL (PGlite), not mocks; the acceptance path is still manual |
| CI | ✅ good | typecheck + tests + both builds + codegen drift + DDL/index guards |
| Schema management | ✅ fixed | P2-7 — migrations only, applied by the app; a boot that cannot migrate refuses to serve |
| Failure visibility | 🟡 logs only | No error tracking, no alerting, no metrics |
| Docs / honesty | ✅ unusually good | Pilot scope, acceptance runbook, audit history, "still open" lists maintained |
| Onboarding / GTM | 🟡 manual by design | Managed pilot: $500–1,500 setup + $249–499/mo. Self-serve, Stripe, CRM integrations are explicitly out of scope — correct call |
| Legal / compliance | ❌ artefacts absent | Policies and DPAs don't exist yet |

---

## 4. What "market ready" should mean here

Two different bars, and they should not be conflated.

**Paid managed pilot — 1–2 weeks out.** Fix P1-1, P1-2, P1-3 (or pin to a single replica and
defer P1-3, explicitly). Configure the Coolify database backups. Turn on error tracking and
one alert on failed/uncertain calls. Then the product does what the pitch says, for one
customer, with a human watching — which is exactly what `docs/pilot-scope.md` sells.

**Self-serve / GA — not close, and not claimed.** Needs P2-5 (per-tenant secrets), P2-6
(teams), P3-7 (either inbound or repositioned messaging), billing, monitoring, and the
compliance artefacts. That is a roadmap, not a bug list — and the repo already says so.

**Recommended sequence**

1. ~~Fix P1-1 … P1-4 and P2-7, with regression tests.~~ **Done — see §6.**
2. Promote the rest of `docs/pilot-acceptance.md` §3 into the supertest suite. The new
   `routes/calls.test.ts` and `lib/concurrency.test.ts` cover the calling path; the remaining
   manual checks (Cal.com booking against the stub, the Twilio tenant-scoping matrix, the
   Retell callback round trip) are the ones worth automating next, so a release stops
   depending on a human following a runbook. *(`webhooks.twilio.test.ts` already covers the
   matrix; the booking and callback paths are the gap.)*
3. Turn on error tracking plus one alert on failed/`uncertain` calls and on a stalled job queue,
   and confirm Coolify's nightly S3 backups actually run — then onboard the first pilot with
   manual invoicing.
4. Revisit P2-5 (per-tenant intake secret) and P2-6 (Clerk organizations) only when selling to a
   second customer.

---

## 5. Reflection

The most striking thing about this codebase is that the hard, unglamorous things were done
properly: quiet hours are evaluated in the *recipient's* timezone and a missing timezone
blocks the call rather than guessing; a policy-blocked call does not burn the attempt
budget; a failed transfer becomes a visible message-capture task instead of a silent success;
the Retell agent cannot name its own tenant because the tenant comes from signed call
metadata. Those are decisions made by someone who has thought about what happens when the
software is wrong at 2am. The tests run against real SQL because the guarantees are enforced
by constraints — the author understood that a mocked database would prove nothing.

Four defects, not three: the fix pass found P1-4 by running the product instead of reading
it, which is the same lesson `docs/pilot-acceptance.md` already recorded about the unscoped
signature middleware. Reading found the shape; running found the instance.

All four share a shape worth naming: **each one fails silently in the optimistic
direction.** Usage over-counts rather than erroring. The console reports success
rather than admitting it did nothing. The worker would rather dial twice than return an
error. The safety layer — where the product is careful — assumes the worst; the billing and
dispatch layers assumed the best. Making those two layers as suspicious as the policy gate was
the whole of what stood between this and a pilot, and that is now done.

The residual risk is no longer in the code's logic but in its **shape**: one process, one
database, in-memory rate limits, and a single global intake secret. That shape is correct for
one managed pilot and wrong for anything larger, which is why §4 keeps the two bars — paid
pilot, and self-serve — deliberately separate.

---

## 6. Fix pass — 2026-09-25

Everything below is on `arena/01a0d975-leadsprint-boomi` (uncommitted at the time of writing),
verified with the repo's own pipeline plus the same live checks that exposed the defects.

### Diffs

| Area | File | Change |
|---|---|---|
| Usage billed once | `routes/webhooks.ts` | Read the call row before archiving the event; accrue only on the first terminal report with a duration, and only for a call we placed |
| Console never lies | `routes/leadsprint.ts` | Minute-bucketed attempt key; 201 only for `started`; 409 + reason for everything else; retry refuses non-retryable blocks |
| No double dial | `lib/callQueue.ts`, `lib/scheduler.ts` | Conditional-UPDATE claim of the call and of the job, stale-claim reaper, retry that can re-open a time-based block |
| Overnight retries | `lib/policy.ts` | `nextAllowedCallTime()` — the opening of the next allowed window, in the recipient's timezone |
| One schema path | `lib/db/package.json`, `scripts/src/demo.mjs`, `README.md`, `docs/pilot-acceptance.md`, `replit.md` | `drizzle-kit migrate` everywhere; `push` documented as never-for-production |
| Adopt an existing schema | `lib/db/src/index.ts` | A database that already has the schema but no journal (`push`-created, or restored from a dump) is verified table-by-table and then baselined, so migrations apply instead of the boot refusing to start |
| Fail closed on schema | `artifacts/api-server/src/index.ts` | A boot that cannot apply migrations exits instead of serving |
| Honest Today metric | `routes/leadsprint.ts` | `appointments_today` counted in the business's local day, not all of history |
| Console surfaces blocks | `pages/leads.tsx`, `pages/calls.tsx` | `onError` shows the API's reason instead of staying silent |
| One worker implementation | `routes/cron.ts` | `POST /cron/process-jobs` delegates to `processQueuedJobs()`; the duplicated copy is gone |

### Tests added (151 → 175, all passing)

- `lib/concurrency.test.ts` — concurrent dispatch of one call dials once; two workers draining
  one job dial once; an abandoned claim is reclaimed; a live claim is left alone; an overnight
  enquiry is blocked, then called once the window opens; a decision-blocked call is never
  re-opened.
- `routes/webhooks.usage.test.ts` — `call_ended` + `call_analyzed` bill one minute; a repeated
  terminal report does not re-bill; an unknown `call_id` bills nothing; the row still reconciles.
- `routes/calls.test.ts` — 201 means dialled; a quiet-hours block is a 409; a repeat click in
  the same minute is not a success; a later attempt really re-dials; an unconfigured workspace
  refuses to dial; retry re-queues a time-based block and refuses a decision.
- `routes/usage.test.ts` — `appointments_today` counts only the local day.
- `test/migrationBaseline.test.ts` — a `push`-created database cannot be migrated before
  adoption and migrates cleanly after, against Drizzle's own migrator; adoption is idempotent;
  duplicate-object error codes are recognised through a cause chain and unrelated failures are
  not mistaken for adoption; the expected-table list covers every table the migrations create.

### Verification run

```
pnpm run typecheck                       clean (4 workspaces)
pnpm --filter @workspace/api-server run test   175 passed (20 files)
pnpm --filter @workspace/leadsprint run test    12 passed
pnpm --filter @workspace/api-server run build   ok
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/leadsprint run build   ok
pnpm --filter @workspace/api-client-react run generate && git diff --exit-code lib/…   no drift
pnpm demo --reset                        fresh DB → migrations apply → boots clean
```

And the same live checks that failed before, now:

| Check | Before | After |
|---|---|---|
| One 60-second call, reported by `call_ended` + `call_analyzed` | 2.0 min / $0.24 | **1.0 min / $0.12** |
| Event for a call we never placed | billed | **not billed** |
| Console "Call lead", quiet hours, click 1 / click 2 | 409 / **201 (nothing happened)** | **409 / 409** |
| Console "Call lead" after the window opens | never re-dialled | **201, real call** |
| 10 concurrent `process-jobs` drains on one job | 10 dials | **1 dial** |
| Overnight enquiry (blocked 07:16, window opens 07:18) | never called | **called once at 07:22, same call row** |
| Boot after `drizzle-kit push` | `relation "activities" already exists`, ignored, continued | **migrations apply; a real failure now stops the boot** |

### Deliberately not done in this pass

`P2-5` (per-tenant intake secret), `P2-6` (Clerk organizations and team members), `P3-7`
(inbound calls), `P3-8` (unconditional intake replay protection), `P3-10`–`P3-12` (brand,
monitoring, compliance artefacts), and the message-resolve workflow. Those are self-serve/GA
work; none of them blocks a single managed pilot, and the sequencing in §4 is unchanged.
