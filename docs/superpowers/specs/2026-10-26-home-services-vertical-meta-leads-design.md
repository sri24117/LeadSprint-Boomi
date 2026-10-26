# Home-services vertical + Meta lead intake (US) — design

**Status:** draft for review · **Date:** 2026-10-26 · **Market:** US only
**Piece:** 1 of 6 in the AC/plumbing programme (see "Programme context").

## 1. Goal and success criteria

AC-repair and plumbing companies get Meta (Facebook/Instagram) leads. This piece
delivers, inside LeadSprint, the flow:

> Meta lead arrives → AI voice agent calls within about a minute → qualifies the
> job → books a service visit, or hands off to a person.

Success means:

1. An end-to-end demo of that flow for a fictional plumbing/AC company, runnable
   with `pnpm demo` and stub providers.
2. A configuration a first real client could be onboarded onto (one deployment per
   client), with Meta leads delivered through a no-code connector.
3. Real estate behaves exactly as before. All existing API and console tests still
   pass unchanged.

## 2. Programme context (not built in this piece)

| # | Piece | This spec |
|---|---|---|
| 1 | Home-services profile | **In** |
| 2 | Meta lead intake (no-code connector path) | **In** |
| 3 | Voice callback with a plumbing/AC script | **In** |
| 4 | Chat reply agent (Messenger/WhatsApp/SMS) | Out — later piece |
| 5 | Booking depth (arrival windows, multiple event types, dispatch) | Out — later piece |
| 6 | Inbound missed-call answering | Out — later piece |

## 3. Decisions already made

- Model verticals as **profile files plus a flexible `details` field** (not typed
  columns per vertical, not a fork).
- Meta leads arrive through the **existing intake endpoint** fed by a no-code
  connector (Zapier, Make, or Meta's CRM integration). Native Meta Graph API
  integration is a later piece.
- **US only.** UK/PECR and UK phone handling are a separate piece.
- One deployment per client (own Retell, Twilio, Cal.com credentials and database).

## 4. Non-goals

Chat agent; inbound answering; native Meta API; UK or India; SMS/WhatsApp alerts;
technician dispatch; price quoting by the AI; multiple Cal.com event types per
workspace; per-tenant intake secrets; changing the calling-hours floor, consent
gate, suppression list, or opt-out behaviour.

## 5. Architecture

### 5.1 Vertical profile registry

New directory `artifacts/api-server/src/lib/verticals/` containing:

- `index.ts` — `getProfile(verticalId)`; unknown ids fall back to `real_estate`.
- `realEstate.ts` — describes the **current** behaviour (legacy columns, current
  labels, current script). No behaviour change.
- `homeServices.ts` — the new profile.

A profile is a plain object with: `id`, `label`, `fields` (key, label, type
`text | enum`, enum values, whether shown in the lead list), `urgencyLevels`,
`defaultQualificationQuestions`, `defaultApprovedFaq`, `emergencyKeywords`,
`appointmentLabel`, and `agent` (path to the agent definition and the prompt-variable
builder).

`homeServices` fields: `service_type` (enum: `ac_repair`, `ac_install`, `plumbing_repair`,
`plumbing_install`, `water_heater`, `drain`, `other`), `problem` (text), `urgency`
(enum, see 5.4), `zip` (text), `address` (text), `property_type`
(enum: `home`, `apartment`, `commercial`), `preferred_time` (text). `urgency` is
stored in the `leads.urgency` column (so it can be filtered and sorted); every other
home-services field is stored in `leads.details`.

### 5.2 Data model (one additive migration)

| Table | Change |
|---|---|
| `businesses` | `vertical text not null default 'real_estate'`; `notify_email text null`; `service_area_zips jsonb not null default '[]'`; `pricing_policy text null` |
| `leads` | `details jsonb not null default '{}'`; `urgency text null` |
| `contacts` | `consent_evidence text null` (the consent wording the person saw, plus the form id) |

All defaults keep existing rows and deployments valid with no backfill. The test
database DDL in `artifacts/api-server/src/test/testDb.ts` is updated to match. The
legacy lead columns (`property_type`, `budget_label`, `location`, `timeline`) stay
and keep their `"Not specified"` defaults for non-real-estate leads.

### 5.3 API contract

The OpenAPI spec is updated and the Zod schemas and React client regenerated with
the repo's existing codegen. CI's codegen-drift check must pass.

- The business/session response gains `vertical` and a serialisable `profile`
  (labels, fields, urgency levels, appointment label).
- The Lead DTO gains `details`, `urgency`, and `consent_evidence`.
- Business settings gain `vertical`, `notify_email`, `service_area_zips`,
  `pricing_policy` (validated: ZIP entries are 3 to 5 digits; email is a valid address).

### 5.4 Intake (`POST /api/webhooks/intake`)

New optional body fields: `details` (object; at most 20 keys; keys 1 to 40 chars;
values are strings of at most 500 chars, numbers, or booleans; anything else is
rejected with 400), `urgency`, `form_id`, `consent_given` (boolean),
`consent_text` (string, at most 1000 chars). Existing fields and behaviour are
unchanged.

**Authentication.** HMAC signature stays the default. A second option accepts the
header `x-leadsprint-key` equal to the intake secret, compared in constant time, and
only when `INTAKE_ALLOW_KEY_AUTH=true` (default `false`). This exists because no-code
tools cannot easily compute HMAC. It is weaker (a captured request can be replayed), so
TLS is required and the docs say HMAC is preferred.

**Consent mapping for Meta.** When `source` is `meta_lead_ads`, consent is `valid`
only if `consent_given === true` AND `consent_text` is non-empty AND `form_id` is
present. Then `consent_source = "meta_lead_form:<form_id>"`, `consent_at` = now, and
`consent_evidence = consent_text`. Otherwise consent stays `unknown`, and the
existing safety gate refuses the call (`consent_invalid`), recording it as a
blocked call. The console shows such leads with a "Needs consent" tag. Other sources
behave exactly as today.

**Urgency.** `classifyUrgency(profile, { urgency, problem })` returns one of
`emergency`, `same_day`, `this_week`, `quote`. A supplied valid `urgency` wins. Otherwise
it is `emergency` when `problem` contains any profile `emergencyKeywords` (case-insensitive:
`gas smell`, `gas leak`, `smell gas`, `smells like gas`, `smell of gas`,
`carbon monoxide`, `burst pipe`, `pipe burst`, `flooding`, `sewage`, `no water`,
`sparks`, `burning smell`), else `this_week`. Both word orders are listed because
people say "smell gas" as often as "gas smell"; this was found by a test during
implementation.

**Service area.** If the business has a non-empty `service_area_zips` and the lead
supplies a ZIP (`details.zip`, or the first 5-digit sequence in `details.address`) that
matches none of the entries (exact match, or the entry is a prefix of the ZIP), the lead
is created, no call is queued, `next_action` is "Out of service area — review", and an
activity is recorded. If no ZIP is supplied, the call proceeds and the agent asks.

### 5.5 Emergency handling

- The safety gate is **unchanged**. Emergency leads are called immediately when the
  recipient's local time is inside the existing 08:00–20:00 window, and deferred to
  the window opening otherwise.
- For every `emergency` lead, an email is sent at intake to `businesses.notify_email`
  (when set and SMTP is configured) via a new `sendBusinessAlertEmail(to, subject, lines)`
  in the mailer, containing name, phone, problem, urgency, address or ZIP, and source.
  Content is HTML-escaped. A failed send is logged and never fails or delays intake.

### 5.6 Voice agent

**Finding that changes the work.** Today `startRetellCall` sends only `metadata` to
Retell. It never sends `retell_llm_dynamic_variables`, so placeholders such as
`{{lead_name}}` and `{{project_name}}` in the existing agent prompt are never filled
per call. This applies to real estate as well. This piece therefore adds a
`buildCallVariables` function and sends its result as `retell_llm_dynamic_variables`
for both verticals (additive: the request gains one field and nothing is removed).

New `docs/retell-agent-home-services.json` and `.md` (same tool set as the existing
agent, including `opt_out`). Per-call prompt variables are built from the lead's
`details` and the business: business name, lead name, service type, problem, urgency,
ZIP or address, service-area statement, approved FAQ, and `pricing_policy`.

Script rules, which are hard requirements in the prompt:

- Open by naming the business and disclosing it is an automated assistant.
- For a gas smell, carbon monoxide, flooding, sparks, or burning smell: stop
  qualifying, tell the caller to leave the area if unsafe and call 911, offer to
  connect a person, and call `request_transfer` or `capture_message`. Never give
  troubleshooting steps for these.
- Never quote a price. If `pricing_policy` is set, state exactly that text; otherwise
  say a technician will confirm cost.
- Out-of-area ZIP after qualification: decline politely, call `capture_message`, end.
- The existing transfer, message-capture and opt-out rules apply unchanged.

The `qualify` agent tool writes, for `home_services`, into `details` (`service_type`,
`problem`, `zip`, `address`, `property_type`, `preferred_time`), updates the
`leads.urgency` column when it supplies urgency, and sets `qualification_status` and
`intent_score`. For `real_estate` it writes the legacy columns
exactly as today.

### 5.7 Booking

The existing availability and booking tools and the single Cal.com event type per
deployment are reused. The appointment's existing `service_or_property` text is set
from the lead's `service_type` label for `home_services`, and the preferred arrival
window the caller states is included in the booking notes.

### 5.8 Console

- Lead list "Need" column and the lead panel render fields from `profile.fields`
  instead of hard-coded real-estate labels.
- An "Emergency" badge on `emergency` leads and a "Needs consent" tag where applicable.
- Business settings: vertical selector, notify email, service-area ZIPs, pricing policy.
- Real-estate workspaces see exactly what they see today.

### 5.9 Demo and docs

- `pnpm demo --vertical home_services` seeds "Frostline HVAC & Plumbing" (Texas,
  `America/Chicago`) with four fake leads: an AC not cooling (same day), a burst pipe
  (emergency), a water-heater quote, and an out-of-area lead.
- `docs/sales-demo-home-services.md`: a 10-minute demo script for trades.
- `docs/meta-lead-ads.md`: connector field mapping for Zapier/Make, key-auth setup,
  and recommended US consent wording for the Meta form, marked as requiring counsel's
  review before use.

## 6. Safety invariants (must not regress)

1. No call without recorded valid consent, no call to a suppressed number, no call
   outside 08:00–20:00 recipient local time, kill switch, attempt limit: all unchanged.
2. Key authentication is off by default and refuses requests without the exact secret.
3. `details` content is validated and size-limited, rendered only through React
   escaping in the console, and HTML-escaped in emails.
4. The agent never gives hazard troubleshooting and never quotes prices.

## 7. Testing strategy (tests written first)

- **Unit:** profile registry shape (every profile has required members; unknown id
  falls back to real estate); `classifyUrgency`; `details` validation limits;
  `isOutOfArea` (exact, prefix, missing ZIP, empty list).
- **Route (supertest, PGlite):** intake with HMAC and with key auth (off by default,
  wrong key 401, right key accepted when enabled); Meta consent mapping (valid only with
  all three of flag, text, form id; otherwise blocked as `consent_invalid`); `details`
  and `urgency` persisted; emergency triggers the email through a stubbed mailer and an
  email failure does not fail intake; out-of-area is created, not queued; `qualify`
  writes `details` for home services and legacy columns for real estate.
- **Regression:** the full existing suite (226 API, 18 console) passes unchanged.
- **Console (vitest):** profile-driven label helper.
- **Live:** a scripted run against `pnpm demo --vertical home_services`, in the style
  of the opt-out live test, plus a visual check of the console.

## 8. Rollout

The migration is additive with defaults, so existing deployments are unaffected. The
first trades client gets its own deployment and subdomain, with `vertical` set to
`home_services` in Settings, the Retell agent imported from the new definition, and a
Zapier/Make connection following `docs/meta-lead-ads.md`.

## 9. Risks and open items

- The Meta form's consent wording and the AI-call script need review by a US attorney
  before real use. Consent evidence is asserted by the sender, the same trust model as
  today's intake.
- No-code field mappings vary by connector; the docs cover Zapier and Make only.
- Emergency alerts depend on SMTP being configured; SMS alerts are a later piece.
- One Cal.com event type per workspace limits clients who want separate AC and plumbing
  calendars until piece 5.
