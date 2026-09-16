# LeadSprint pilot scope — frozen

**Status:** frozen for the 14-day ship. Anything not listed under "In scope" is
explicitly out of scope until the first pilot customer is live and paying.

## The promise

> Every new property enquiry gets a fast qualification call, a verified booking
> attempt, or a human-ready follow-up summary.

The customer is not buying "an AI receptionist". They are buying a measurable
outcome: **new enquiries are contacted quickly and converted into qualified
conversations or booked appointments.**

## Pilot customer profile (one, not many)

| Dimension | Frozen choice |
|---|---|
| Customer type | Real-estate team receiving inbound property enquiries |
| Team size | 2–15 agents, one office |
| Market | **US** (single market; India parity is explicitly deferred) |
| Volume | 10–60 new enquiries/week |
| Voice provider | **Retell** only |
| Calendar provider | **Cal.com** only |
| Lead source | **One** of: signed intake webhook, or CSV import |
| Phone numbers | One outbound number, one transfer number |
| Onboarding | Manual, done by us, one configured workspace per customer |
| Billing | Manual invoice / payment link |

## In scope

- Signed webhook intake **or** CSV import (one source per pilot).
- Consent evidence captured at intake; no consent, no call.
- Automatic idempotent call queue with retry.
- Safety policy gate re-evaluated immediately before every provider request.
- Qualification call using the approved script.
- Human transfer, with failed-transfer message capture and a follow-up task.
- Verified Cal.com booking (only after live availability is checked).
- Operator console: leads, calls, appointments, suppression, consent, reports.
- Setup checklist that blocks live calling until configuration is complete.
- Kill switch.

## Out of scope (do not build now)

Stripe subscriptions · WhatsApp/SMS · multiple voice providers · self-serve
multi-tenant provider credentials · mobile apps · advanced analytics · custom
workflow builder · CRM marketplace integrations · AI prompt editor · full
white-labeling · US **and** India at the same time.

## The call flow (exact)

1. **Enquiry arrives** — signed intake webhook (`POST /api/webhooks/intake`) or
   CSV import.
2. **Duplicate check** — same business + same phone ⇒ rejected as duplicate, no
   second lead, no second call.
3. **Consent check** — `consent_status` must be `valid` with a recorded
   `consent_source`. Anything else stays `unknown` and is never dialed.
4. **Lead created**, recipient timezone derived from the phone number.
5. **Idempotent `initiate_call` job created** — one job per lead intake, keyed
   so replays cannot create a second job.
6. **Worker picks the job up** (cron, `POST /api/cron/process-jobs`).
7. **Policy gate runs again immediately before dialing**: consent → not
   suppressed → recipient timezone known → outside quiet hours → attempt limit
   → kill switch off.
8. **Retell call created** with metadata `business_id`, `lead_id`, `call_id`.
9. **Call happens** (script below).
10. **Signed Retell callback** reconciles the call and the lead.
11. **Operator sees** the outcome, the summary, and one clear next action.

## Approved qualification script

The agent must, in order:

1. **Identify the business**: "Hi, this is the assistant for {business name},
   calling about the enquiry you just made about {project}."
2. **Disclose AI involvement** (and recording, where enabled): "Just so you
   know, I'm an automated assistant, and this call may be recorded."
3. **Confirm it's a good time.** If not, offer a callback and end cleanly.
4. **Ask the approved qualification questions** — configured per business, and
   for the pilot exactly these four:
   - What area are you looking in?
   - What's your target budget range?
   - When are you hoping to move?
   - Would you like to schedule a viewing or a call with an agent?
5. **Offer a booking only after checking live availability** via
   `POST /api/agent/availability`. Never invent a slot; never confirm a booking
   Cal.com has not confirmed.
6. **End cleanly** if the lead is not qualified — thank them, confirm no further
   calls if they ask, and record the outcome.

### Hard rules for the agent

- Answer **only** from the approved FAQ. Anything about legal, lending,
  appraisal, fair housing, or availability outside the configured information
  → transfer or take a message.
- If the caller asks for a human at any point → attempt a transfer immediately.
- If the transfer does not connect → capture a message and tell the caller a
  human will call back. Never pretend the transfer worked.
- Never state a price, a commitment, or a confirmation the system has not
  verified.

## Safety and launch gates

These are gates, not polish. None may be waived for the first pilot:

- [ ] Contacts default to `consent_status: unknown`.
- [ ] Consent source and timestamp are recorded for every callable contact.
- [ ] Consent state is visible on every lead in the console.
- [ ] Suppression, quiet hours, attempt limits, and the kill switch are enforced
      on every path that can dial.
- [ ] Demo seeding is impossible in production.
- [ ] No silent fallback to the demo workspace.
- [ ] The app refuses live calling until the setup checklist is complete.
- [ ] The pilot customer has verified telemarketing, recording, AI-disclosure,
      and provider requirements for their jurisdiction **in writing**.

## Pricing (first three customers: managed pilot, not a subscription)

- **Setup:** $500 – $1,500 (one business, one number, one calendar, one
  qualification workflow; we do the configuration and prompt changes).
- **Monthly:** $249 – $499.
- **Voice/provider usage:** billed separately, or included up to a stated
  monthly minute limit.

## Definition of done

The pilot ships only when this exact scenario passes end to end — see
`docs/pilot-acceptance.md`.
