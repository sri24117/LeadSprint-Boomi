# Pilot acceptance — end-to-end verification

Unit tests and typechecks do not prove the product works. During Day 7–8
verification the entire operator-console API was returning
`401 Invalid Retell signature` for every request while the full test suite
passed, because a webhook signature middleware was mounted unscoped. Static
checks cannot catch that class of failure.

This document is the runbook for booting the real stack and verifying the
critical path against a real Postgres wire connection and real HTTP requests,
before any pilot customer is onboarded.

## 1. Boot the stack

Four terminals (or the Arena process tools).

```bash
# 1. Local Postgres (embedded PGlite behind a real TCP wire socket, no Docker)
pnpm --filter @workspace/scripts run dev-postgres
# -> postgres://postgres:postgres@127.0.0.1:5433/postgres

# 2. Apply the schema
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/postgres" \
  pnpm --filter @workspace/db run push --force

# 3. Provider stub, stands in for Retell + Cal.com so nothing dials a real phone
node scripts/src/provider-stub.mjs

# 4. Build, then run the API with the SPA attached
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/leadsprint run build
pnpm --filter @workspace/api-server run build

DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/postgres" \
DATABASE_POOL_MAX=1 \
LEADSPRINT_DEMO_AUTH=true LEADSPRINT_DEMO_SEED=true \
LEAD_INTAKE_WEBHOOK_SECRET=devsecret CRON_SECRET=devcron \
RETELL_API_URL=http://127.0.0.1:5510/retell RETELL_API_KEY=stub_key \
RETELL_AGENT_ID=agent_stub RETELL_FROM_NUMBER_US=+12125550100 \
RETELL_WEBHOOK_SECRET=retellsecret \
CALCOM_API_URL=http://127.0.0.1:5510/cal CALCOM_API_KEY=cal_stub \
CALCOM_EVENT_TYPE_ID=99 \
PORT=5000 STATIC_DIR="$PWD/artifacts/leadsprint/dist/public" \
  node artifacts/api-server/dist/index.mjs
```

`DATABASE_POOL_MAX=1` is required for the embedded dev database, which serves
one connection at a time. Production should leave it unset (defaults to 10).

`RETELL_API_URL` / `CALCOM_API_URL` exist only so this test can redirect the
provider calls. **Never set them on a customer deployment** — unset, they
default to the real provider APIs.

## 2. Helper: sign an intake request

```bash
intake() {
  local body="$1"
  local sig
  sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac devsecret -hex | sed 's/.*= //')
  curl -s -X POST localhost:5000/api/webhooks/intake \
    -H 'content-type: application/json' \
    -H "x-leadsprint-signature: sha256=$sig" -d "$body"
}
```

## 3. The checks

Each check states the request and the response that counts as a pass. All of
these were executed and passed on branch `arena/01a0a8e1-leadsprint-boomi`.

### 3.1 Setup gate blocks calling until configured

With `RETELL_*` / `CALCOM_*` unset:

```
GET /api/onboarding/checklist
-> ready_for_live_calls: false, missing_required: [provider_retell, provider_calcom]
```

An intake with good consent still records the lead but refuses to dial:

```
-> {"accepted":true,"consent_status":"valid",
    "call":{"status":"setup_incomplete",
            "detail":"Setup incomplete — live calling is disabled until these are
                      configured: Retell voice provider configured, Cal.com calendar
                      provider configured."}}
```

**This is the single most important guarantee in the product: an
unconfigured deployment cannot call anyone.**

### 3.2 Consent is enforced at the boundary

| Request | Expected |
| --- | --- |
| no consent fields | `accepted: true`, `consent_status: "unknown"`, never dialled |
| `consent_status: "valid"` with no `consent_source` | **400** — `consent_status "valid" requires a non-empty consent_source` |
| `consent_status: "valid"` + `consent_source: "website enquiry form"` | `accepted: true`, `consent_status: "valid"`, call enqueued |

A caller cannot assert consent without saying where it came from.

### 3.3 Duplicate intake is idempotent

Replaying byte-identical intake:

```
-> {"accepted":false,"reason":"duplicate"}
```

One lead, one call job. The lead is not called twice.

### 3.4 Forged intake is rejected

```
x-leadsprint-signature: sha256=deadbeef
-> 401 {"error":"Invalid intake signature"}
```

### 3.5 Quiet hours block the call

Observed live at 02:48 America/New_York:

```
-> {"call":{"status":"policy_blocked",
            "detail":"Outside allowed calling hours (21:00–08:00 America/New_York,
                      recipient local time)."}}
```

The gate is evaluated in the recipient's local time, immediately before the
provider request — not only at enqueue time.

### 3.6 The vertical slice actually dials

With providers configured and the calling window open, a single signed intake
produced this request to Retell with no human involvement:

```json
{
  "from_number": "+12125550100",
  "to_number": "+12125558888",
  "override_agent_id": "agent_stub",
  "metadata": {
    "business_id": "business_demo",
    "lead_id": "lead_e60f82d6-f0e",
    "call_id": "call_065500a0-e46",
    "market": "US"
  }
}
```

Response: `{"call":{"status":"started"}}`.

`metadata` must always carry `business_id`, `lead_id` and `call_id` — the
Retell callback is only reconcilable because of them.

### 3.7 The provider callback reconciles the call

```
POST /api/webhooks/retell  (signed: x-retell-signature: v=<ms>,d=<hmac(body+ts)>)
  event=call_ended, duration_ms=184000, disconnection_reason=agent_hangup
-> {"accepted":true,"duplicate":false}
```

The call row becomes `completed | 184 s | agent_hangup` in `GET /api/calls`.

### 3.8 Duplicate and unsigned callbacks

```
replay same callback -> {"accepted":true,"duplicate":true}   (no second write)
unsigned callback    -> 401 {"error":"Invalid Retell signature"}
```

### 3.9 The console renders every call state

`GET /api/calls` after the above:

```
completed      | Live Test 2 | 184 s | agent_hangup
policy_blocked | Live Test   |       | Blocked — quiet_hours
queued         | Real Lead   |       | Queued for provider
```

`queued`, `policy_blocked` and `uncertain` are all filterable in the console,
and `uncertain` / `failed` / `policy_blocked` expose the reconcile-and-retry
action in the call drawer.

## 4. Regression suite

```bash
pnpm --filter @workspace/api-server run typecheck   # clean
pnpm --filter @workspace/api-server run test        # 87 tests
pnpm --filter @workspace/leadsprint run typecheck   # clean
pnpm --filter @workspace/leadsprint run test        # 12 tests
```

Note: the repo-wide `pnpm run typecheck` exits non-zero because of a
pre-existing error in `artifacts/mockup-sandbox/vite.config.ts`. Verify
per package until that is fixed.

## 5. Still open before a live pilot

These are Day 9–10 hardening items, deliberately not yet done:

- `/usage` hard-codes the period label `"September 2026"` instead of deriving
  it from the billing period.
- `/today` hard-codes `unresolved_messages: 1`.
- The `calls_provider_call_unique` constraint is global rather than scoped by
  `business_id`, and the Twilio status webhook looks up calls across tenants.
- `app.use(cors())` is fully open.
- No rate limiting on the webhook or cron routes.
- The Dockerfile runs as root.
- No backup/restore procedure has been exercised.
