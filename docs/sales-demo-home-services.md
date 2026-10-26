# Home-services demo (AC repair & plumbing) — 10 minutes

The same engine as the real-estate demo, set up for an AC and plumbing company:
a Meta lead arrives, the AI calls within a minute, the job is qualified, and a
service visit is booked. Nothing here dials a real phone.

## 1. Boot it

```bash
pnpm demo --vertical home_services
```

This seeds **Frostline HVAC & Plumbing** (Austin, `America/Chicago`) on a fresh demo
database and serves the console on `http://localhost:5000/`. It starts with five leads:

| Lead | What it shows |
|---|---|
| Marisol Vega | AC not cooling, same-day, **booked** service visit, consent wording on file |
| Jordan Blake | **Emergency**: burst pipe, a call in progress right now |
| Chen Wei | A quote request (cold lead) |
| Tom Becker | **Out of service area** (ZIP 10001): kept for review, never called |
| Lena Ortiz | **Needs consent**: the Meta form gave none, so the AI will not call |

Check it: `curl -s localhost:5000/api/readyz` shows `"auth":"demo"`.

## 2. The flow (talking points)

1. **Today / Leads.** "Every lead from your Facebook ads lands here, with the job, how
   urgent it is, and the ZIP. Emergencies are flagged." Open Jordan Blake's panel.
2. **Consent.** Open Marisol's panel: the exact wording she agreed to is stored.
   Open Lena's: "Needs consent". "We don't call anyone without it. That protects you."
3. **A new Meta lead.** Run the intake script below. A call starts within seconds.
4. **An emergency.** Run the emergency script. The lead shows an **Emergency** badge,
   and (with SMTP configured) the owner is emailed at once.
5. **Out of area.** Run the out-of-area script: the lead appears flagged, no call placed.
6. **The call finishes.** Run the callback script; open **Calls** and **Appointments**.
7. **Settings.** Show Industry, the emergency email, the service-area ZIPs, and the cost
   wording. "The assistant never quotes a price except what you set here."
8. **The ask** (same as the real-estate demo's pilot offer).

## 3. The scripts

```bash
BASE=http://localhost:5000

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

Calls are only placed between **08:00 and 20:00 in the lead's local time**. The
scripts use Austin numbers (`512`); outside those hours the call is deferred, which
is itself a good thing to show ("it waits until it's allowed to call").

### A Meta lead (Beat 3)

```bash
intake '{"business_id":"business_demo","name":"Priya Nair","phone":"+15125550177","source":"meta_lead_ads","campaign":"AC tune-up spring","form_id":"form_demo_1","consent_given":true,"consent_text":"I agree to be contacted by an automated assistant by phone about my request.","details":{"service_type":"ac_repair","problem":"AC is running but the house will not cool","zip":"78704"}}'
# Expect 201: {"accepted":true,...,"urgency":"this_week","call":{"status":"started"}}
```

### An emergency (Beat 4)

```bash
intake '{"business_id":"business_demo","name":"Sam Rivera","phone":"+15125550166","source":"meta_lead_ads","campaign":"Emergency plumbing","form_id":"form_demo_1","consent_given":true,"consent_text":"I agree to be contacted by an automated assistant by phone about my request.","details":{"service_type":"plumbing_repair","problem":"I can smell gas near the water heater","zip":"78745"}}'
# Expect "urgency":"emergency" and the Emergency badge in the console.
```

### Out of area (Beat 5)

```bash
intake '{"business_id":"business_demo","name":"Alex Kim","phone":"+15125550155","source":"meta_lead_ads","form_id":"form_demo_1","consent_given":true,"consent_text":"I agree to be contacted by an automated assistant by phone about my request.","details":{"service_type":"ac_install","problem":"New AC for an apartment","zip":"10001"}}'
# Expect "call":{"status":"not_queued"} and next action "Out of service area — review".
```

### No consent (shows the safety gate)

```bash
intake '{"business_id":"business_demo","name":"Casey Fox","phone":"+15125550144","source":"meta_lead_ads","form_id":"form_demo_2","details":{"service_type":"drain","problem":"Slow kitchen drain","zip":"78660"}}'
# Expect the lead saved as "Needs consent" and a blocked call (consent_invalid): nobody is dialed.
```

### The call finishes (Beat 6)

The stub names provider calls `stub_call_<n>` (the first dial in this session is
`stub_call_1`). Use the same callback script as `docs/sales-demo.md`, substituting
the number of the call you want to complete.

## 4. Live mode

Same as `docs/sales-demo.md` section 3, using the home-services agent in
`docs/retell-agent-home-services.json` (see `docs/retell-agent-home-services.md`) and
a Meta connection per `docs/meta-lead-ads.md`.
