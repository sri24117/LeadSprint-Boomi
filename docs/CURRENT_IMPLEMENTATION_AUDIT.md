# LeadSprint Current Implementation Audit

> **Branch:** `feature/leadsprint-mvp-hardening`  
> **Audit date:** 2026-09-10  
> **Auditor:** Deep-read of every source file; no application files modified.

---

## 1. What Already Works

| Area | Status |
|------|--------|
| **Health endpoints** | GET /api/healthz and GET /api/readyz are unauthenticated, separate from operator-console routes, and return provider booleans + auth mode. |
| **Clerk authentication** | requireAuth in middlewares/auth.ts validates a Clerk session, auto-provisions a business+user+usage row on first login, and attaches req.leadSprintBusinessId / req.leadSprintUserId. |
| **Demo auth mode** | LEADSPRINT_DEMO_AUTH=true + NODE_ENV !== production bypasses Clerk; the server refuses the flag in production. |
| **Tenant scoping** | Every operator-console route reads scopedBusinessId(req). All DB queries carry eq(table.businessId, BUSINESS_ID). |
| **Lead CRUD** | List (search/status/score filters), get, patch (status/next_action/qualification_status), import (phone-level duplicate check per business), suppress. |
| **Call safety gate** | evaluateCallPolicy() in lib/policy.ts: consent valid -> not suppressed -> not in quiet hours -> under attempt limit -> kill switch off. Runs before every provider request. |
| **Quiet-hours parsing** | Same-day and overnight windows (e.g. 21:00-08:00) via Intl.DateTimeFormat in business timezone; UTC fallback on invalid timezone. |
| **Kill switch** | LEADSPRINT_KILL_SWITCH=true immediately blocks all new outbound calls globally. |
| **Retell outbound call** | startRetellCall() in lib/providers.ts POSTs to /v2/create-phone-call with from_number, to_number, agent_id, and metadata. Falls back to queued demo job when unconfigured. |
| **Retell webhook** | POST /api/webhooks/retell validates HMAC-SHA256 signature, deduplicates via provider_events (onConflictDoNothing), updates call status/duration/transferred, handles failed-transfer recovery. |
| **Cal.com availability** | getCalAvailability() calls /v2/slots with eventTypeId, start, end, timezone. Falls back to simulated 30-min slots when unconfigured. |
| **Cal.com booking** | createCalBooking() calls POST /v2/bookings; stores returned booking ID as appointments.external_id. Demo fallback: local cal_ prefixed ID. |
| **Cal.com webhook** | POST /api/webhooks/calcom validates HMAC-SHA256, deduplicates into provider_events. |
| **Twilio status webhook** | POST /api/webhooks/twilio/status validates both Twilio's SHA-1 HMAC and a secondary shared-secret HMAC; maps CallSid to business via provider_call_id. |
| **Intake webhook** | POST /api/webhooks/intake validates HMAC-SHA256; checks business exists; deduplicates on phone-per-business. |
| **Workflow job queue** | workflow_jobs table with availableAt, lockedAt, attempts, and idempotency unique index. cron/process-jobs drains initiate_call backlog, re-runs policy gate per job, retries on quiet-hours or failure. |
| **Usage tracking** | Retell webhook increments voice_minutes and estimated_cost. Booking increments booking_count. |
| **Data retention cron** | POST /api/cron/retention deletes provider_events and activities older than RETENTION_DAYS (default 90). |
| **Weekly email report** | POST /api/cron/weekly-report iterates all businesses, sends weekly stats via SMTP (nodemailer). No-ops gracefully when SMTP unconfigured. |
| **Business settings** | GET and PATCH for all operational fields (market, timezone, quiet hours, attempt limit, disclosures, FAQ, qualification questions). |
| **Provider idempotency** | provider_events table with (provider, external_event_id) unique index + onConflictDoNothing — each webhook processed at most once. |
| **Schema unique indexes** | calls: (provider, provider_call_id) and (business_id, idempotency_key). appointments: (calendar_provider, external_id). workflow_jobs: (business_id, idempotency_key). |
| **Docker image** | Single-container: builds API (esbuild) + SPA (Vite), serves both from Express on one port. HEALTHCHECK calls /api/healthz. |
| **CI pipeline** | GitHub Actions: typecheck + API build + frontend build on push/PR to main. |
| **Frontend** | Full operator-console SPA: Today, Leads (list + detail + CSV import + suppress + call-now + book), Calls, Appointments, Reports, Business Settings - all backed by real API calls via TanStack Query. |
| **Clerk proxy** | clerkProxyMiddleware proxies Clerk FAPI through the backend in production, enabling single-domain deployment. |
| **JSON error handling** | Unknown /api/* paths return JSON 404. Unhandled async errors return JSON 500 with server-side logging. |

---

## 2. Critical Blockers

> **P0 - Must fix before any real customer.**

### 2.1 - Demo seed runs unconditionally against every database

**Severity:** P0
**Exact file/path:** artifacts/api-server/src/routes/leadsprint.ts lines 85-124
**Current behavior:** ensureSeedData() fires at module-load time (every process start including production), writing "Northstar Realty" / "Maya Patel" into whatever database DATABASE_URL points to. It fires again on every GET /auth/me. scopedBusinessId() returns the business_demo ID as a hard fallback when req.leadSprintBusinessId is missing - any request slipping past auth silently sees demo data.
**Required behavior:** Seed data must be gated behind LEADSPRINT_DEMO_AUTH=true. In production or without the flag, scopedBusinessId() must throw a hard error rather than silently routing to business_demo.
**Recommended change:** Move ensureSeedData() inside the demoAuthEnabled block in routes/index.ts. Replace the fallback in scopedBusinessId() with throw new Error("No business scope on authenticated request") when not in demo mode.

### 2.2 - No transaction boundaries on multi-step writes

**Severity:** P0
**Exact file/path:** artifacts/api-server/src/routes/leadsprint.ts (all POST handlers), routes/webhooks.ts
**Current behavior:** Every multi-step write (intake: insert contact -> insert lead -> insert activity; booking: insert appointment -> update lead -> update usage; suppress: update contact -> update lead -> insert suppression) is a sequence of independent await db.insert/update calls. A crash after step 1 leaves the DB in an inconsistent half-written state with no rollback.
**Required behavior:** All multi-step writes that must succeed or fail atomically must be wrapped in db.transaction(async (tx) => { ... }).
**Recommended change:** Wrap intake, suppress, book, and requireAuth provisioning in transactions. Use the transaction client tx in place of db for all writes inside the block.

### 2.3 - Per-business Retell agent binding is absent

**Severity:** P0
**Exact file/path:** artifacts/api-server/src/lib/providers.ts lines 103-127
**Current behavior:** startRetellCall() sends agent_id: values.agentId - a single global agent ID from the RETELL_AGENT_ID env var. businesses.retell_agent_id exists in the schema and is shown in Business Settings but is never used in the actual API call.
**Required behavior:** Each business must use its own Retell agent. The call must use businesses.retellAgentId (with RETELL_AGENT_ID as a single-agent pilot fallback).
**Recommended change:** Accept agentId as a parameter in startRetellCall(). Resolve it in the call-start route as: business.retellAgentId ?? env("RETELL_AGENT_ID").

### 2.4 - No phone number normalization to E.164

**Severity:** P0
**Exact file/path:** artifacts/api-server/src/routes/webhooks.ts lines 80-82; routes/leadsprint.ts lines 269-274
**Current behavior:** Phone numbers are stored as-is from the request body. Duplicate checking is raw string equality - "(555) 123-4567" and "+15551234567" are treated as different contacts. Retell receives the un-normalized string as to_number.
**Required behavior:** All inbound phone numbers must be normalized to E.164 before storage and before any provider call.
**Recommended change:** Add an E.164 normalization function (or libphonenumber-js) applied to every inbound phone field before DB insert.

### 2.5 - Auth bootstrap race: unrecoverable 503 when business exists but user does not

**Severity:** P0
**Exact file/path:** artifacts/api-server/src/middlewares/auth.ts lines 54-103
**Current behavior:** When requireAuth provisions a new user: it inserts the business with onConflictDoNothing().returning(). If the business already exists (conflict), the return is undefined. The code then re-selects the user filtering on both userId AND businessId - but the user does not exist yet. [user] is undefined and the operator gets a permanent 503 with no recovery path.
**Required behavior:** If the business already exists (conflict), re-select it and then insert the user normally. The operator must never be permanently locked out.
**Recommended change:** After the business insert conflict, do db.select().from(businessesTable).where(eq(businessesTable.id, businessId)) to get the existing business, then proceed to the user insert.

### 2.6 - calls_provider_call_unique index is cross-tenant; Twilio webhook too

**Severity:** P0
**Exact file/path:** lib/db/src/schema/leadsprint.ts line 98; artifacts/api-server/src/routes/webhooks.ts line 208
**Current behavior:** uniqueIndex("calls_provider_call_unique").on(table.provider, table.providerCallId) - scoped by provider + call ID only, no business_id. The Twilio status webhook looks up calls by providerCallId across all tenants.
**Required behavior:** Provider call ID must be unique per (business_id, provider, providerCallId). Tenant A's Retell call ID must not block Tenant B.
**Recommended change:** Change the unique index to include table.businessId. Update the Twilio status webhook call lookup to include business scope.

### 2.7 - Webhook replay attacks: no timestamp freshness check

**Severity:** P0
**Exact file/path:** artifacts/api-server/src/routes/webhooks.ts - all webhook handlers
**Current behavior:** Signature verification checks only HMAC correctness. A valid signed payload from minutes or hours ago can be replayed indefinitely. The provider_events idempotency prevents re-processing the same event ID, but an attacker with a captured payload can replay it until its event ID is consumed.
**Required behavior:** After verifying the HMAC, reject any webhook whose embedded event timestamp is outside a configurable freshness window (e.g. +/- 5 minutes).
**Recommended change:** After signature validation, extract the provider timestamp and compare to Date.now(). Reject with 400 if outside the window.

---

## 3. High Priority Improvements

> **P1 - Must fix before pilot with a real customer.**

### 3.1 - Usage accounting is period-unscoped and hardcoded

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/routes/webhooks.ts lines 166-169; routes/leadsprint.ts lines 505-506, 426-427
**Current behavior:** The Retell webhook does UPDATE usage SET voice_minutes = voice_minutes + ? WHERE business_id = ? with no period filter - it increments ALL rows for the business (including past periods). GET /usage hardcodes period_label: "September 2026" and included_minutes: 300. GET /today hardcodes unresolved_messages: 1.
**Required behavior:** Usage must accumulate only into the current period row. Period label and included minutes must come from the database. unresolved_messages must be computed or removed.
**Recommended change:** Add AND period_start <= NOW() AND period_end >= NOW() to the usage update. Store includedVoiceMinutes on the business. Compute period_label from the row. Remove hardcoded unresolved_messages: 1.

### 3.2 - No atomic job claiming (no FOR UPDATE SKIP LOCKED)

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/routes/cron.ts lines 81-86
**Current behavior:** cron/process-jobs selects jobs with status='queued' AND available_at <= now then loops sequentially. Two concurrent cron invocations can both select and start Retell calls for the same job, double-calling a contact.
**Required behavior:** Job claiming must be atomic. Use SELECT ... FOR UPDATE SKIP LOCKED LIMIT n, or a CAS update: UPDATE workflow_jobs SET status='running', locked_at=now WHERE id=? AND status='queued' RETURNING *.
**Recommended change:** Use raw SQL: UPDATE ... FOR UPDATE SKIP LOCKED. Drizzle has no native abstraction for this.

### 3.3 - CORS is wide open

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/app.ts line 53
**Current behavior:** app.use(cors()) with no configuration - allows requests from any origin. The SPA is served same-origin so this is unnecessary and actively harmful.
**Required behavior:** CORS must be disabled or restricted to a configured origin whitelist.
**Recommended change:** app.use(cors({ origin: env("CORS_ORIGIN") || false })).

### 3.4 - No rate limiting on webhooks or cron endpoints

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/app.ts, routes/webhooks.ts, routes/cron.ts
**Current behavior:** All endpoints are unbounded. A webhook flood can overwhelm the DB.
**Required behavior:** Rate-limit POST /api/webhooks/* (e.g. 100 req/min per IP) and POST /api/cron/* (e.g. 10 req/min per IP).
**Recommended change:** Add express-rate-limit middleware applied to webhook and cron paths before the signature check.

### 3.5 - No database migrations - schema managed by drizzle-kit push

**Severity:** P1
**Exact file/path:** lib/db/drizzle.config.ts
**Current behavior:** Schema changes are applied by running drizzle-kit push against the target database. No migration files, no version history, no automatic schema application on deploy.
**Required behavior:** A production deployment must apply schema changes via versioned, idempotent migration files. A Dockerfile step must run drizzle-kit migrate before the server starts.
**Recommended change:** Run drizzle-kit generate to produce SQL migration files. Commit the /drizzle directory. Add a migration step to the Dockerfile CMD.

### 3.6 - Docker image runs as root

**Severity:** P1
**Exact file/path:** Dockerfile (runtime stage - no USER directive)
**Current behavior:** The final stage uses node:24-bookworm-slim with no USER directive. The process runs as root inside the container.
**Required behavior:** Container must run as a non-root user.
**Recommended change:** Add USER node in the runtime stage.

### 3.7 - Response-shape Schema.parse() failures cause HTTP 500 on valid data

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/routes/leadsprint.ts (every handler, e.g. lines 221, 288, 362)
**Current behavior:** Every response goes through Schema.parse(). A DB value that does not match the schema (new activity type, unexpected null, status value not in enum) throws a ZodError -> HTTP 500. This is the exact class of bug that broke the console in the prior code review.
**Required behavior:** Use safeParse() with a fallback: log the validation warning but serve the raw DTO rather than crashing the endpoint.
**Recommended change:** Replace Schema.parse(data) with: const r = Schema.safeParse(data); if (!r.success) { req.log.warn({ err: r.error }, "Response shape mismatch"); res.json(data); return; } res.json(r.data);

### 3.8 - Cal.com webhook does not reconcile bookings or cancellations

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/routes/webhooks.ts lines 228-243
**Current behavior:** POST /api/webhooks/calcom validates the signature, deduplicates the event, and returns 202. It never touches the appointments table. A Cal.com cancellation, reschedule, or BOOKING_CONFIRMED event has zero effect on application state.
**Required behavior:** Must parse triggerEvent (BOOKING_CANCELLED, BOOKING_RESCHEDULED, BOOKING_CONFIRMED) and apply the state change to the matching appointment and lead.
**Recommended change:** After acceptProviderEvent(), extract body.triggerEvent, look up appointment by body.payload.uid, and update status, startTime, endTime, and lead nextAction accordingly.

### 3.9 - CI does not catch API contract drift

**Severity:** P1
**Exact file/path:** .github/workflows/ci.yml
**Current behavior:** CI runs typecheck + build only. It does not re-run orval codegen and cannot detect stale generated clients. Contract drift (like the prior Activity.type enum bug) can be committed to main silently.
**Required behavior:** CI must include a step that re-runs codegen and fails if the generated files differ.
**Recommended change:** Add: pnpm --filter @workspace/api-spec run codegen && git diff --exit-code lib/api-client-react lib/api-zod

### 3.10 - Booking endpoint does not guard against duplicate appointments

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/routes/leadsprint.ts lines 397-429
**Current behavior:** POST /appointments/book does not check whether a confirmed appointment already exists for the lead. A network retry or double-click calls Cal.com twice and creates two appointment rows.
**Required behavior:** Before calling Cal.com, check for an existing confirmed appointment for the lead_id.
**Recommended change:** Add db.select().from(appointmentsTable).where(and(eq(appointmentsTable.leadId, ...), eq(appointmentsTable.status, 'confirmed'))).limit(1) before the Cal.com call.

---

## 4. Demo-Only Functionality

The following items are demo shortcuts that **must not reach a real customer** without being removed or properly gated:

| Item | Location | Risk |
|------|----------|------|
| ensureSeedData() writes "Northstar Realty"/"Maya Patel" into any DB | routes/leadsprint.ts:85-124 | **P0** - corrupts production DB |
| BUSINESS_ID = "business_demo" hardcoded constant exported | routes/leadsprint.ts:65-71 | **P0** - fallback bypasses auth |
| scopedBusinessId() silently returns BUSINESS_ID when req.leadSprintBusinessId is undefined | routes/leadsprint.ts:81-83 | **P0** - unauthenticated requests see demo data |
| Cal.com not configured -> fake [0,1,2,3] 30-min slots from 1 PM UTC | routes/leadsprint.ts:388-394 | **P1** - shows fake availability to operator |
| Cal.com not configured -> local cal_<uuid> booking ID (never provider-confirmed) | routes/leadsprint.ts:405 | **P1** - booking has no external ID to reconcile |
| period_label: "September 2026" and included_minutes: 300 hardcoded | routes/leadsprint.ts:506 | **P1** - wrong for any other month or plan |
| unresolved_messages: 1 hardcoded in GET /today | routes/leadsprint.ts:485 | **P2** - misleading metric always shows 1 |
| calEventTypeId: "cal_demo_showing" and retellAgentId: "retell_demo_agent" in seed data | routes/leadsprint.ts:100-101 | **P2** - fake provider IDs |
| VITE_LEADSPRINT_DEMO_AUTH=true removes all Clerk UI from the frontend build | App.tsx:98-105 | **P0 risk** if accidentally set on a public deployment |
| Demo sign-in uses only localStorage with no server validation | App.tsx:278-307 | **P0** - trivially bypassed by setting leadsprint_operator_signed_in=true in devtools |
| DemoAuthBanner component returns null - no visible demo warning | App.tsx:204-206 | **P2** - no visual indicator when running without auth |
| scripts/src/hello.ts is a placeholder with no content | scripts/src/hello.ts | **P3** - dead code |

---

## 5. Database Gaps

### 5.1 - No consent evidence table / auditable TCPA trail

**Severity:** P1
**Exact file/path:** lib/db/src/schema/leadsprint.ts - contactsTable
**Current behavior:** contacts.consent_status is a plain text field defaulting to "valid". There is no record of when consent was given, how (form, verbal, import), what text version the contact agreed to, or who recorded it.
**Required behavior:** A consent_events table: contact_id, business_id, type (opt-in/opt-out/import), source, consent_text_version, ip_address, recorded_at.
**Recommended change:** Create consent_events table. Populate on intake webhook, CSV import, and explicit operator suppression actions.

### 5.2 - No index on suppressions(business_id, phone) - full table scan on DNC check

**Severity:** P1
**Exact file/path:** lib/db/src/schema/leadsprint.ts - suppressionsTable
**Current behavior:** suppressions has no index beyond the primary key. Suppression checks operate on contacts.suppressed_at, but any DNC pre-check query on the suppression list itself would full-scan.
**Required behavior:** Unique index on (business_id, phone) to prevent duplicate suppression records and enable fast lookup.
**Recommended change:** Add uniqueIndex("suppressions_business_phone_unique").on(table.businessId, table.phone).

### 5.3 - No plan/entitlement table - usage cap hardcoded

**Severity:** P1
**Exact file/path:** lib/db/src/schema/leadsprint.ts; routes/leadsprint.ts line 506
**Current behavior:** included_minutes: 300 is hardcoded in the GET /usage response. No plan, tier, or entitlement model exists. Usage is tracked but never checked against a cap before starting a call.
**Required behavior:** Minimum: businesses.included_voice_minutes field. GET /usage must return the actual configured quota. Call-start must check available minutes.
**Recommended change:** Add includedVoiceMinutes: integer("included_voice_minutes").notNull().default(300) to businessesTable. Read it in GET /usage response.

### 5.4 - No source_event_id on leads - source-level deduplication impossible

**Severity:** P2
**Exact file/path:** lib/db/src/schema/leadsprint.ts - leadsTable
**Current behavior:** Lead deduplication in intake is by (business_id, phone). Two form submissions from the same person with a different phone format create two leads. No field stores an external source event ID.
**Required behavior:** leadsTable should have an optional sourceEventId field with a unique index on (businessId, sourceEventId) where non-null.
**Recommended change:** Add sourceEventId: text("source_event_id") + uniqueIndex("leads_business_source_event_unique").on(table.businessId, table.sourceEventId).

### 5.5 - Missing composite indexes for all common query patterns

**Severity:** P2
**Exact file/path:** lib/db/src/schema/leadsprint.ts
**Current behavior:** No indexes on leads(business_id, status), leads(business_id, score), calls(business_id, status), calls(lead_id), contacts(business_id, phone), activities(business_id, created_at). All queries on these patterns do full table scans.
**Required behavior:** Composite indexes for each common filter pattern.
**Recommended change:** Add one index per common query pattern in the schema definition.

### 5.6 - contacts.preferred_language stored but never passed to Retell

**Severity:** P3
**Exact file/path:** lib/db/src/schema/leadsprint.ts; lib/providers.ts lines 114-119
**Current behavior:** preferred_language is stored and displayed in the lead detail UI but is not included in the Retell call metadata.
**Required behavior:** Pass language: contact.preferredLanguage in the Retell metadata.
**Recommended change:** Add language to the metadata object in startRetellCall().

---

## 6. Intake and Consent Gaps

### 6.1 - Intake webhook deduplication uses phone string equality, not provider_events

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/routes/webhooks.ts lines 91-94
**Current behavior:** Intake deduplication checks contacts WHERE phone = ?. If the same body is retried with a differently-formatted phone, a second contact+lead is created. The acceptProviderEvent() / provider_events deduplication used for Retell/Cal.com/Twilio is NOT used for intake.
**Required behavior:** Call acceptProviderEvent() first on the intake webhook. If it returns false (event already seen), return 200/duplicate immediately without creating any records.
**Recommended change:** Add const accepted = await acceptProviderEvent({ ... }) before the contact/lead insert. If !accepted, return early.

### 6.2 - Consent status defaults to "valid" for all imported/webhook leads

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/routes/webhooks.ts line 98; routes/leadsprint.ts line 273
**Current behavior:** contactsTable.consentStatus defaults to "valid". Every imported contact and every webhook lead gets valid consent automatically with no evidence.
**Required behavior:** An import or webhook alone is not consent. Contacts without explicit consent fields should default to "pending". The policy gate already checks consentStatus !== "valid" - so changing the default immediately gates unconsented leads.
**Recommended change:** Change consentStatus default to "pending". Intake webhook must accept consented_at and consent_source fields and set consentStatus: "valid" only when present.

### 6.3 - CSV import creates leads but no workflow job for automated outreach

**Severity:** P2
**Exact file/path:** artifacts/api-server/src/routes/leadsprint.ts lines 262-281
**Current behavior:** POST /leads/import inserts contacts and leads but creates no workflow_jobs row. The operator must manually click "Call now" for each lead. There is no automated follow-up path from import - which is the core value proposition.
**Required behavior:** Import should optionally enqueue an initiate_call workflow job per lead when auto_call: true is passed.
**Recommended change:** Add auto_call boolean to ImportLeadsBody. If true, insert a workflow_job per lead with a configurable delay.

---

## 7. Policy and Safety Gaps

### 7.1 - Policy gate does not check business activation state

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/lib/policy.ts - evaluateCallPolicy()
**Current behavior:** The policy gate checks consent, suppression, quiet hours, attempt limit, and kill switch. It does not check whether the business is properly configured (non-empty phone number, valid Retell agent, non-empty transfer number). A call can be placed for a business that has never been set up.
**Required behavior:** Add a business-level activation check: phoneNumber non-empty, retellAgentId set, transferNumber non-empty.
**Recommended change:** Add PolicyBusinessInput.isConfigured: boolean. Block with reason: "business_not_configured" if false.

### 7.2 - Quiet-hours format is unvalidated on save

**Severity:** P2
**Exact file/path:** artifacts/api-server/src/routes/leadsprint.ts - PATCH /business-settings; lib/policy.ts:53-55
**Current behavior:** quiet_hours is saved as a raw string. isWithinQuietHours() silently returns false if the format does not match the regex - a typo silently disables quiet-hours enforcement with no error or warning.
**Required behavior:** Validate the quiet-hours format on write. Return 400 if invalid.
**Recommended change:** Add a Zod refinement to UpdateBusinessSettingsBody.quiet_hours that validates against the same regex used in policy.ts.

### 7.3 - No contact-level timezone - quiet hours use business timezone only

**Severity:** P2
**Exact file/path:** artifacts/api-server/src/lib/policy.ts
**Current behavior:** Quiet-hours enforcement uses the business timezone. A lead in a different state (e.g. business in ET, contact in PT) can be called during their local quiet hours.
**Required behavior:** Store contact timezone. Use the more restrictive of business and contact timezone for quiet-hours checks.
**Recommended change:** Add contactTimezone: text("contact_timezone") to contactsTable. Pass and use it in evaluateCallPolicy().

### 7.4 - No concurrent-call guard per contact phone number

**Severity:** P2
**Exact file/path:** artifacts/api-server/src/routes/leadsprint.ts lines 306-307
**Current behavior:** The in-progress check is callsTable.leadId = lead_id AND status = 'in_progress'. One contact can have multiple leads (multiple form submissions). Two simultaneous calls to the same phone via two different lead IDs are not blocked.
**Required behavior:** Before placing a call, verify no in_progress call exists for the same contact_id or phone number across any lead.
**Recommended change:** Add a check joining callsTable with contactsTable WHERE contactsTable.phone = ? AND callsTable.status = 'in_progress'.

---

## 8. Retell Integration Gaps

### 8.1 - Per-business agent not used (see Section 2.3 - P0)

### 8.2 - Retell call metadata missing contact_id, language, timezone

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/lib/providers.ts lines 114-119
**Current behavior:** Retell metadata includes { business_id, lead_id, call_id, market }. Missing: contact_id, preferred_language, contact_timezone.
**Required behavior:** Retell should receive enough metadata to route and personalize the call. Minimum: contact_id, language, timezone_override.
**Recommended change:** Add contact_id, language, and timezone to the metadata object in startRetellCall().

### 8.3 - Retell webhook: call_analysis is an object, mapped as string

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/routes/webhooks.ts line 158
**Current behavior:** summary: typeof body.call_analysis === "string" ? body.call_analysis : undefined. Retell's actual call_analysis response shape is an object { summary: string, custom_analysis_data: object, in_voicemail: boolean }. The type check fails, so summary is never updated from the placeholder "Call queued for the approved qualification script."
**Required behavior:** Parse body.call_analysis as an object and extract (body.call_analysis as any).summary. Also capture in_voicemail to set a voicemail outcome.
**Recommended change:** summary: (typeof body.call_analysis === "object" && body.call_analysis !== null && typeof (body.call_analysis as any).summary === "string") ? (body.call_analysis as any).summary : undefined

### 8.4 - uncertain call state has no automated reconciliation

**Severity:** P1
**Exact file/path:** artifacts/api-server/src/routes/leadsprint.ts lines 347-349
**Current behavior:** When startRetellCall() throws, the call is set to status: "uncertain". There is no mechanism to reconcile this state - it remains uncertain forever unless an operator manually retries. No Retell API polling is ever done.
**Required behavior:** A reconciliation cron endpoint should query Retell's GET /v2/get-call/{call_id} for uncertain calls older than N minutes and update their state.
**Recommended change:** Add POST /api/cron/reconcile-calls that finds calls WHERE status='uncertain' AND created_at < NOW() - INTERVAL '10 minutes', queries Retell for each, and updates the DB.

### 8.5 - Transfer destination not validated before call starts

**Severity:** P2
**Exact file/path:** lib/db/src/schema/leadsprint.ts; lib/providers.ts
**Current behavior:** business.transferNumber is stored and used in agent configuration but not validated before call start. A missing or empty transfer number means the agent silently fails when a human handoff is requested.
**Required behavior:** Validate transferNumber is non-empty before placing any call.
**Recommended change:** Add transfer_not_configured as a policy block reason. Check in evaluateCallPolicy() or the call-start handler.

---

## 9. Cal.com Integration Gaps

### 9.1 - Cal.com webhook does not act on booking events (see Section 3.8 - P1)

### 9.2 - Availability window is UTC midnight-to-midnight, not business-local day

**Severity:** P2
**Exact file/path:** artifacts/api-server/src/routes/leadsprint.ts lines 372-374
**Current behavior:** start = date + T00:00:00Z, end = start + 24h. This queries UTC midnight-to-midnight - misaligned with the business's local day. A business in UTC+5:30 requesting slots for "today" gets UTC slots, missing the first 5.5 hours of their local business day.
**Required behavior:** Compute start and end as the business-local day boundaries in UTC.
**Recommended change:** Use Intl.DateTimeFormat or a date library to convert the requested date into the business timezone's day start and end in UTC.

### 9.3 - Booking stores Cal.com numeric id, but Cal.com webhooks identify by uid (UUID)

**Severity:** P2
**Exact file/path:** artifacts/api-server/src/lib/providers.ts lines 232-238; routes/webhooks.ts line 241
**Current behavior:** createCalBooking() returns body?.id ?? body?.booking?.id - the numeric ID. Cal.com webhooks identify bookings by uid (UUID string, stable). The appointments.external_id column stores the numeric ID, making reconciliation by booking UID impossible.
**Required behavior:** Store Cal.com's booking uid (UUID) as external_id. The webhook handler must look up appointments by body.payload.uid.
**Recommended change:** In createCalBooking(), return body?.uid ?? body?.booking?.uid. Update the webhook handler accordingly.

---


## 10. Workflow Jobs and Cron Execution

### 10.1 - Stuck job recovery mechanism is missing

**Severity:** P1  
**Exact file/path:** artifacts/api-server/src/routes/cron.ts  
**Current behavior:** If a worker process crashes or times out while executing a job (status = 'running'), the job remains locked in status 'running' forever. The job runner only queries status = 'queued'.  
**Required behavior:** Jobs in status 'running' with locked_at older than a stale threshold (e.g. 10 minutes) must be reset back to 'queued' or marked 'failed'.  
**Recommended change:** Add a cleanup query in POST /api/cron/process-jobs: UPDATE workflow_jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND locked_at < NOW() - INTERVAL '10 minutes'.

### 10.2 - Retry delay calculation is hardcoded and un-persisted

**Severity:** P2  
**Exact file/path:** artifacts/api-server/src/routes/cron.ts lines 112-115  
**Current behavior:** When a job fails, `attempts` is incremented. However, the calculation for the next execution time does not update `available_at` in the DB when handling specific errors, meaning immediate re-pickup on the next cron cycle if `attempts < maxAttempts`.  
**Required behavior:** Retried jobs must update `available_at = NOW() + exponential_backoff(attempts)`.  
**Recommended change:** Set `availableAt = new Date(Date.now() + Math.pow(2, attempts) * 60 * 1000)` when re-queueing failed jobs.

---

## 11. Security, Auth & Tenant Isolation Gaps

### 11.1 - Cron endpoints un-gated when CRON_SECRET is unconfigured

**Severity:** P1  
**Exact file/path:** artifacts/api-server/src/routes/cron.ts lines 18-24  
**Current behavior:** If CRON_SECRET env var is not set, cron endpoints allow any unauthenticated caller to trigger job processing, retention cleanup, and weekly reports.  
**Required behavior:** In production, if CRON_SECRET is missing, cron endpoints must fail closed (return 500 / startup check fails).  
**Recommended change:** Fail server startup if NODE_ENV === 'production' and CRON_SECRET is not provided.

### 11.2 - Missing environment variable validation schema at startup

**Severity:** P2  
**Exact file/path:** artifacts/api-server/src/index.ts  
**Current behavior:** process.env variables are read ad-hoc across various route files and utility modules. If a required secret (e.g., CLERK_SECRET_KEY in non-demo mode) is missing, errors only surface when a user hits the affected route.  
**Required behavior:** Validate all required environment variables at application boot using Zod schema parsing (env.ts).  
**Recommended change:** Create src/lib/env.ts with a strong Zod schema and call it in index.ts before starting the HTTP server.

---

## 12. Twilio Integration Gaps

### 12.1 - CallSid lookup assumes providerCallId uniqueness without tenant scoping

**Severity:** P1  
**Exact file/path:** artifacts/api-server/src/routes/webhooks.ts line 208  
**Current behavior:** Twilio webhook searches callsTable strictly by providerCallId. If multiple business tenants use Twilio and somehow share a CallSid structure or if provider call IDs overlap across providers, cross-tenant mutation is possible.  
**Required behavior:** Webhook processing must verify that the updated call record matches the expected business.  
**Recommended change:** Ensure providerCallId lookups include tenant verification or enforce global uniqueness across provider CallSids in DB constraint.

---

## 13. Developer Experience, Testing & CI/CD Gaps

### 13.1 - Zero automated unit/integration test suite in codebase

**Severity:** P1  
**Exact file/path:** root package.json, `artifacts/api-server`  
**Current behavior:** There are no automated test files (*.test.ts or *.spec.ts) for policy gate evaluation, webhook HMAC validation, auth middleware, or job runner logic.  
**Required behavior:** A comprehensive Vitest test suite testing policy checks, webhook verification, auth scoping, and DTO schemas.  
**Recommended change:** Add Vitest to @workspace/api-server and write unit tests for lib/policy.ts, lib/providers.ts, and routes/webhooks.ts.

---

## 14. Recommended Action Plan & Phase Roadmap

### Phase 1: P0 Hardening & Critical Security Blockers
1. Gate ensureSeedData() behind LEADSPRINT_DEMO_AUTH=true and enforce hard auth failures in scopedBusinessId().
2. Wrap all multi-step database mutations (intake, booking, suppression, auth user provisioning) in Drizzle transactions (db.transaction()).
3. Wire per-business retell_agent_id from business settings into startRetellCall().
4. Add E.164 phone normalization across intake webhooks, CSV imports, and outbound call triggers.
5. Fix the auth user provisioning race condition when business exists but user row does not.
6. Scope provider call unique constraint by (business_id, provider, provider_call_id).
7. Add timestamp freshness window verification to all webhook HMAC validations.

### Phase 2: P1 System Reliability & Integration Hardening
1. Scope usage tracking updates to the active billing period (period_start / period_end).
2. Implement atomic job locking (FOR UPDATE SKIP LOCKED or CAS) in process-jobs.
3. Configure explicit CORS origin whitelist and apply rate limiting to /api/webhooks/* and /api/cron/*.
4. Replace runtime schema parse() crashes with safeParse() + warning logs.
5. Implement versioned SQL migrations (drizzle-kit generate) and Docker startup execution.
6. Reconcile Cal.com webhook events (BOOKING_CANCELLED, BOOKING_RESCHEDULED, BOOKING_CONFIRMED) with DB state.
7. Set container user USER node in Dockerfile for non-root execution.
8. Enforce codegen diff checks in CI pipeline.

### Phase 3: P2 & Polish
1. Implement auditable consent_events table for compliance tracking.
2. Add validation for quiet hours string formatting in business settings API.
3. Pass contact timezone into quiet-hours policy checks.
4. Add contact phone number concurrent-call check across all active leads.
5. Add automated uncertain call reconciliation cron job.
6. Add Vitest suite for core policy and webhook verification logic.

