# LeadSprint — the 10-minute sales demo

The demo that closes pilots is not a tour of screens. It is one story told in
ten minutes: **a lead arrives → the safety policy decides what happens → the AI
calls (or is stopped from calling) → the call is reconciled → an appointment
exists → the operator has a clear desk.** Everything below is scripted so it
works at any hour of the day, on any machine, with no real phone calls.

## 0. Pre-flight (10 minutes before the meeting)

```bash
git pull
pnpm demo            # boots Postgres + schema + provider stubs + API + console
```

While it boots, check:

| Check | Command | Expect |
|---|---|---|
| App is up | `curl -s localhost:5000/api/healthz` | `{"status":"ok"}` |
| Demo mode | `curl -s localhost:5000/api/readyz` | `"auth":"demo"`, `retell:true`, `calcom:true` (stubs) |
| Console loads | open `http://localhost:5000/` | Today page, "Northstar Realty" workspace |

`pnpm demo --reset` starts from a fresh demo database if a previous demo left
messy state. `Ctrl+C` in the demo terminal stops everything.

Have open in advance: the console (Today page), a terminal (for the two
webhook commands), and — live mode only — your own phone charged and loud.

## 1. The beats

### Beat 1 — the problem (0:00–0:30)

> "Your best leads are decided in the first five minutes. If nobody picks up,
> they call the next firm. LeadSprint answers, qualifies, and books — 24/7 —
> and puts a human in the loop only when it matters."

Open **Today**. Point at the metrics strip (new leads, calls in progress,
appointments today) and the setup warnings — "it tells you exactly what's
live and what's in safe demo mode. No surprises."

### Beat 2 — the pipeline (0:30–1:30)

Open **Leads**.

> "Every lead lands here with its source, its qualification answers, a score,
> and — this is the part that keeps you out of legal trouble — the consent
> evidence. Who gave it, where, and when."

Filter by score. Show one `hot` lead. Note the consent status column.

### Beat 3 — safety before speed (1:30–3:30)

Open **Business settings**, scroll to the calling policy: quiet hours,
max call attempts, AI and recording disclosure.

> "Before LeadSprint is allowed to call anyone, every call passes this policy
> gate — consent, do-not-call, quiet hours in the *recipient's* time zone,
> attempt limits, and a kill switch. And if the deployment isn't fully
> configured, it can't dial at all. Watch."

Run the **safety script** (section 2). Narrate the response as it lands:

- `accepted: true` — the lead is recorded (data is never lost)
- `policy_blocked — quiet_hours` — "the call was refused *before* anyone was
  dialed, because it's outside this person's calling hours. That refusal is
  in the console, with the reason. Let's look at the Calls page."

Open **Calls** — the blocked call is there, status `policy_blocked`,
reason visible. Then restore quiet hours (section 2) and move on.

> "You can see every blocked attempt. Nothing happens silently."

### Beat 4 — the AI dials (3:30–6:30)

Run the **dial script** (section 2).

- `status: started` — "the call is live. On the Calls page it's
  `in_progress`." (Open **Calls**, refresh — the row is there.)
- **Live mode only:** the customer's phone actually rings; the AI
  introduces itself, asks the qualification questions, and hangs up.
- Wait ~10s, run the **callback script** (section 2):
  `completed | 184 s | agent_hangup` — "the provider reported the outcome;
  LeadSprint reconciled it to the right lead, the right workspace, the right
  call. Usage just accrued."

Point at **Usage** — voice minutes and estimated cost updated.

> "And if the AI can't resolve it, it transfers to a human. Failed transfers
> become a message capture on the Today page — the lead never disappears."

### Beat 5 — the appointment (6:30–8:00)

Open **Appointments**.

> "Qualified leads book straight into your calendar. This one is confirmed —
> time, timezone, property, lead details, all in one row your team can act on."

If Cal.com is live, the booking is real; in stub mode it's the same flow with
a simulated calendar. Either way the console row is identical.

### Beat 6 — the operator's desk (8:00–9:00)

Open **Reports** (the trailing-7-days pilot report — the label is the actual
window, so the numbers and the label always agree) and **Usage**.

> "Every week you see: leads in, calls attempted, connected, qualified,
> booked, transfer rate, minutes, and what the providers cost you. That's
> your pilot scorecard — it's also what we'll measure success against."

### Beat 7 — the ask (9:00–10:00)

> "Pilot: 30 days, one number, one market. You keep every lead and every
> record — they're yours in your database. We charge a setup fee and a
> monthly rate; if it doesn't beat your missed-lead cost, walk away. What
> number should we point at you?"

## 2. The scripts (run from any terminal)

All three hit the demo API on port 5000. Intake requests are signed with the
demo secret `devsecret` — exactly like a real gateway signs them.

```bash
BASE=http://localhost:5000

# Signs a body and POSTs it to /api/webhooks/intake (same HMAC scheme as production).
intake() {
  local body="$1"
  local sig
  sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac devsecret -hex | sed 's/.*= //')
  curl -s -X POST "$BASE/api/webhooks/intake" \
    -H 'content-type: application/json' \
    -H "x-leadsprint-signature: sha256=$sig" \
    -d "$body"
}
```

### Safety script (Beat 3) — works at any hour

```bash
# 1. Temporarily set quiet hours to all day — the policy gate refuses everything.
curl -s -X PATCH $BASE/api/business-settings -H 'content-type: application/json' \
  -d '{"quiet_hours":"00:00-23:59"}' > /dev/null

# 2. Send a consented lead. Expect: accepted, call policy_blocked (quiet_hours).
intake '{"business_id":"business_demo","name":"Quiet Hours Lead","phone":"+19175550110","email":"qh@example.com","message":"Called about the listing","consent_status":"valid","consent_source":"website enquiry form"}'

# 3. Restore the normal quiet hours.
curl -s -X PATCH $BASE/api/business-settings -H 'content-type: application/json' \
  -d '{"quiet_hours":"21:00-08:00"}' > /dev/null
```

### Dial script (Beat 4) — pick an in-window area code

The policy checks the **recipient's** time zone, derived from the US area
code. Pick any area code whose local time is inside 08:00–21:00 *now* (at
least 3 of the 6 US zones are always open):

| Zone | Sample area codes | Local time when UTC is |
|---|---|---|
| America/New_York (UTC−4) | 917, 212, 646 | 12:00–01:00 |
| America/Chicago (UTC−5) | 214, 312, 773 | 13:00–02:00 |
| America/Denver (UTC−6) | 303, 720, 305 | 14:00–03:00 |
| America/Los_Angeles (UTC−7) | 213, 209, 949 | 15:00–04:00 |
| America/Anchorage (UTC−8) | 907 | 16:00–05:00 |
| Pacific/Honolulu (UTC−10) | 808 | 18:00–07:00 |

```bash
# (substitute an in-window area code for 213)
intake '{"business_id":"business_demo","name":"Demo Buyer","phone":"+12135550111","email":"buyer@example.com","message":"First-time buyer, can I book a viewing?","consent_status":"valid","consent_source":"Instagram DM"}'
# Expect: {"accepted":true,...,"call":{"call_id":"call_...","status":"started"}}
```

### Callback script (Beat 4) — reconcile the call

Retell's real callbacks are signed `v=<unix_ms>,d=<hmac(body+ts)>`. This
reproduces the scheme against the demo webhook secret. The stub names
provider calls `stub_call_<n>` where n is the nth dial this demo session
(first dial = `stub_call_1`).

```bash
BODY='{"event":"call_ended","call":{"call_id":"stub_call_1","metadata":{"business_id":"business_demo","market":"US"},"duration_ms":184000,"disconnection_reason":"agent_hangup"}}'
TS=$(date +%s%3N)
D=$(node -e "console.log(require('crypto').createHmac('sha256','retellsecret').update(process.argv[1]+process.argv[2]).digest('hex'))" "$BODY" "$TS")
curl -s -X POST $BASE/api/webhooks/retell \
  -H 'content-type: application/json' \
  -H "x-retell-signature: v=$TS,d=$D" \
  -d "$BODY"
# Expect: {"accepted":true,"duplicate":false}
# Then in the console: the call row is completed | 184 s | agent_hangup.
```

> **Tip:** run each script *once* before the meeting so your hands are fast.
> The console refreshes on its own; keep it on Calls during Beat 4.

## 3. Live mode (real phone call)

The stubs are the reliable default. For the "your phone rings" moment:

1. Retell: create the agent from `docs/retell-agent.json`, buy/assign one US
   number. Retell bills per minute — budget 2–3 test calls.
2. Cal.com: create one event type, copy its API key + event-type ID.
3. Start the API with real credentials instead of stubs (drop the
   `RETELL_API_URL`/`CALCOM_API_URL` overrides — unset, they hit the real
   APIs):

   ```bash
   RETELL_API_KEY=sk-... RETELL_AGENT_ID=agent_... RETELL_FROM_NUMBER_US=+1212... \
   RETELL_WEBHOOK_SECRET=... CALCOM_API_KEY=cal-... CALCOM_EVENT_TYPE_ID=... \
   # re-run pnpm demo's API step manually, or edit scripts/src/demo.mjs env
   ```

4. **Set the demo business's phone number** to your own, then use the dial
   script with your number's area code — the AI calls you live.
5. Keep the stubs running as the fallback: if the provider is slow or
   flaky mid-pitch, restart the demo in stub mode and continue.

Full provider setup: `docs/leadsprint-provider-setup.md`.

## 4. Objection handling

| Objection | Answer (two lines) |
|---|---|
| "Is this legal? TCPA, consent…" | Every call requires recorded consent evidence — who, where, when. No evidence, no dial. Quiet hours run in the *recipient's* time zone, attempts are capped, and every block is logged with its reason. The safety gate is the first feature, not the last. |
| "What if it calls the wrong person / bad number?" | Area-code time-zone resolution fails closed — unknown location means no call. Attempt limits stop runaway redials, and a kill switch stops everything instantly. |
| "What happens when the AI can't handle it?" | It transfers to your team. If the transfer fails, the caller's message is captured and appears on your Today page as a follow-up. A lead never silently disappears. |
| "Who owns the data?" | You do. Leads, calls, recordings metadata and appointments live in your own database; we can hand you the export any time, and retention is bounded (90 days for raw provider events by default). |
| "Is the caller told it's an AI?" | Yes — AI and recording disclosure are on by default and are business settings your team controls. |
| "How much will it cost?" | Pilot is 30 days, one number, one market: setup fee + monthly. Provider minutes are passed through at cost (Retell voice ~$0.12/min). If cost-per-booked-appointment isn't better than what you're missing today, you walk. |
| "We already have a receptionist / answering service." | LeadSprint doesn't replace your team — it answers what they can't: nights, weekends, overflow, and every lead in under a minute. The operator console is where your team works. |
| "How long until it's live?" | Your pilot number is live this week: one business, one market, the agent script tuned to your qualification questions. |

## 5. If something goes wrong

| Symptom | Fix |
|---|---|
| `port 5000 already in use` | `lsof -ti:5000 \| xargs kill` — or restart with `DEMO_PORT=5001 pnpm demo` |
| Stale/messy demo data | `pnpm demo --reset` (fresh database, re-seeded) |
| Console blank | Rebuild: `pnpm --filter @workspace/leadsprint run build`, then restart `pnpm demo` |
| `401 Invalid intake signature` | You're signing with the wrong secret — the demo uses `devsecret` (see section 2) |
| Call stuck `in_progress` | Run the callback script (section 2), or wait for the cron worker: `curl -X POST $BASE/api/cron/process-jobs -H 'x-cron-secret: devcron'` |
| Provider stub down | Restart it: `node scripts/src/provider-stub.mjs` (or `pnpm demo` again) |
