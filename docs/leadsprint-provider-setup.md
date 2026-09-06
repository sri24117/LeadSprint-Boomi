# LeadSprint provider setup

LeadSprint is safe to run in demo mode. Missing provider variables do not
trigger a partial live action: calls remain queued, availability is simulated,
and bookings are not written until Cal.com accepts the booking.

Add these variables only in the API server's deployment environment. Never put
provider secrets in the browser bundle or in the repository.

## Clerk

Managed Clerk provisions these automatically:

- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `VITE_CLERK_PUBLISHABLE_KEY`

The browser uses the Clerk session cookie. The API derives the local operator
and business scope from the authenticated Clerk user.

## Retell

Required for live outbound calls:

- `RETELL_API_KEY`
- `RETELL_AGENT_ID`
- `RETELL_FROM_NUMBER_US` for the US profile
- `RETELL_FROM_NUMBER_IN` for the India profile
- `RETELL_WEBHOOK_SECRET`

`RETELL_FROM_NUMBER` may be used as a single-number fallback during a pilot.
Retell should send signed callbacks to:

`POST /api/webhooks/retell`

The outbound metadata includes `business_id`, `lead_id`, and `call_id`, which
are used to reconcile the callback to the correct tenant.

## Twilio telephony routes

Required for a configured carrier route:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER_US`
- `TWILIO_FROM_NUMBER_IN`

Twilio status callbacks go to:

`POST /api/webhooks/twilio/status`

The route accepts Twilio's standard `X-Twilio-Signature`. A
`TWILIO_WEBHOOK_SECRET` HMAC signature is also supported for an internal
gateway or queue in front of Twilio.

## Cal.com

Required for live availability and booking:

- `CALCOM_API_KEY`
- `CALCOM_EVENT_TYPE_ID`
- `CALCOM_WEBHOOK_SECRET`

Optional:

- `CALCOM_API_URL` (defaults to `https://api.cal.com/v2`)

Cal.com callbacks go to:

`POST /api/webhooks/calcom`

## Signed lead intake

External forms or n8n can create a lead through:

`POST /api/webhooks/intake`

Sign the exact request body with HMAC-SHA256 and send the lowercase hex digest
in `X-LeadSprint-Signature` or `X-Retell-Signature`. Required fields are
`business_id`, `name`, and `phone`; duplicate phone numbers are rejected for
the same business.

## Readiness

`GET /api/readyz` reports `live` or `demo` plus non-secret provider booleans.
It remains HTTP 200 when optional providers are missing so the operator
console can run safely while setup is in progress.