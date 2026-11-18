# LeadSprint — checklist and plan to sell

**Prepared:** 2026-11-18
**Current decision:** prospecting and discovery can start; production activation is
blocked pending launch acceptance. Offer a conditional, managed pilot—not a
finished self-serve SaaS. Do not promise a delivery date before the blockers are scoped.

Based on `docs/market-readiness-audit-2026-11-18.md` and the initial commercial
scope in `docs/pilot-scope.md`. This is an execution checklist, not evidence that
an unchecked item is complete. Suggested pricing below is a proposal, not market research.

## 1. What to sell first

### Offer: managed lead-follow-up pilot

> We help small real-estate teams follow up with consented property enquiries
> through AI-assisted outbound calls, approved qualification questions, verified
> calendar booking, and human escalation—with an operator overseeing the service.

Do not sell guaranteed sales or guaranteed bookings. Fast callbacks are subject
to consent, recipient timezone, allowed calling hours and provider availability.
Set a measurable response-time target only after measuring the live service.

**First customer profile**

- US real-estate team, approximately 2–15 agents and 10–60 enquiries per week.
- One office, one approved workflow, and someone available for escalations.
- Has a documented lawful basis/consent for the proposed AI voice follow-up.
- Has enough lead volume to measure outcomes and agrees to a limited pilot.
- Can provide approved FAQs, qualification questions, calendar access and a human
  transfer destination.

US is the repository's initial pilot scope, not a legal clearance. Do not sell
India readiness based on the market selector. The home-services profile exists,
but validate its emergency-escalation behavior and acceptance separately before
making it a second offer. Do not market the system as an emergency response service.

### Included in the initial pilot—only after live acceptance

- One configured workspace and one selected lead source: signed webhook or CSV.
- Consent and suppression checks, calling-hours controls and attempt limits.
- Retell outbound qualification using the customer's approved information.
- Cal.com availability checks and confirmed bookings.
- Human escalation/transfer, subject to a verified configuration and fallback.
- Genuine lead/call/appointment views, reports and recorded next actions.
- Manual setup, agreed support coverage and a weekly outcome review.
- Manual invoicing with clearly stated provider-usage treatment.

**CSV limitation:** do not promise automatic instant callbacks to every imported
row until that exact import-to-dispatch workflow is acceptance-tested. CSV is
not a real-time lead-source integration.

### Explicit exclusions

- Inbound call answering / 24×7 human receptionist coverage.
- Cold calling, purchased contact lists or outreach without appropriate consent.
- Automatic SMS or WhatsApp campaigns.
- Self-serve agent builder/deployment, real-time listen-in/takeover controls,
  team invitations/RBAC, advanced analytics or automatic subscriptions.
- Native CRM marketplace integrations, unlimited customization, guaranteed ROI.
- Fully self-service onboarding or customer-managed per-tenant secret storage.

Some excluded console screens are prototypes. They are blocked in authenticated
customer workspaces and labeled as simulations in local demo mode.

## 2. Suggested package and commercial terms

Start with **one package**, not three tiers:

| Item | Illustrative starting quote |
|---|---|
| Pilot period | 30 days, starting after acceptance and customer activation approval |
| Setup | $750 one-time |
| Managed service | $299 for the pilot month |
| Provider usage | Separately itemized under an agreed rate/budget; confirm actual vendor costs first |
| Scope | One business/workspace, one lead source, one number, one calendar, one approved script |
| Support | Explicit business hours, named contact, severity/escalation rules |
| Success review | Weekly review and an end-of-pilot continuation decision |

These numbers sit within the existing scope document's proposed ranges: setup
$500–$1,500 and monthly service $249–$499. They are not validated willingness-to-pay.
If provider accounts are customer-owned and billed directly, say that instead
of charging those same costs again. Do not quote tax treatment without checking it.

Before quoting, estimate:

`contribution = service fee − provider costs you absorb − hosting allocation − payment costs − support/onboarding labor`

Agree who pays for failed/uncertain attempts and how usage disputes are reconciled.
Do not invoice from the prototype billing screen. Separate recurring labor from
one-time setup so a low monthly fee does not hide an unprofitable service.

### Written terms needed

- [ ] Scope, exclusions, start/acceptance conditions and deliverables.
- [ ] Fee schedule, usage rates/budget, taxes and payment due dates.
- [ ] Cancellation/refund treatment if launch acceptance cannot be met.
- [ ] Customer responsibilities for lead consent, DNC and approved scripts.
- [ ] AI/recording disclosures and legal review for the actual calling locations.
- [ ] Data processing, subprocessors, retention, incident notification and deletion.
- [ ] Support hours, escalation contact and limitations of service.
- [ ] No guarantee of appointments, revenue or legal compliance.

Use the legal pack only as a draft for qualified review, not as a signed-ready template.

## 3. Engineering launch checklist—complete before activation

**Owner: engineering. Sign-off must include evidence, not just checked boxes.**

### A. Access and deployment

- [ ] Deploy the current branch's Clerk key-pinning/session-token fixes.
- [ ] Frontend build-time publishable key and server runtime publishable key match;
  secret key belongs to that same Clerk instance/environment.
- [ ] Sign in on the real production domain; `/api/auth/me` returns 200.
- [ ] Verify session renewal, logout, account switching and unauthenticated denial.
- [ ] Demo auth and demo seeding are off; no fake customer data appears.
- [ ] Production Docker/Node-24 deployment boots with the intended migration set.
- [ ] No secret keys enter frontend variables, client storage, logs or screenshots.

### B. Safety and message/call correctness—release blockers

- [ ] Remove/disable automatic missed-call SMS or replace it with durable,
  idempotent, send-time policy-gated jobs and channel-specific consent/opt-out handling.
  Until fixed, prevent the existing SMS path from becoming active; merely hiding a
  console button does not stop webhook-driven sends.
- [ ] Fix concurrent terminal-webhook usage accrual; simultaneous events bill once.
- [ ] Fix event acceptance/processing durability; a crash does not permanently
  mark unfinished work as processed.
- [ ] Bound provider requests with explicit deadlines and reconcile uncertain
  outcomes without blindly re-dialing.
- [ ] Test duplicates, retries, crashes and late/out-of-order provider callbacks.
- [ ] Recheck consent, suppression, allowed hours, attempt limits and kill switch
  on every enabled outreach path.
- [ ] Confirm invalid or missing timezone/consent blocks outreach rather than guesses.

### C. Security and customer isolation

- [ ] Triage and patch high-severity production dependency advisories; review
  critical development-tool advisories and do not expose test/dev servers publicly.
- [ ] Rerun frozen install, audit, typechecks, all tests, codegen drift checks and builds.
- [ ] Verify another customer's IDs cannot read/change/call/book in this workspace.
- [ ] For initial pilots, isolate deployments/provider accounts/secrets per customer,
  or implement and verify equivalent tenant-owned credentials and authorization.
- [ ] Confirm webhook signatures, HTTPS, proxy trust, CORS and secret rotation.
- [ ] Do not let a second operator create an unrelated workspace by assuming teams
  and invitations already exist. Define supported access manually until memberships work.

## 4. Operational and customer acceptance checklist

**Owners: operations + customer. Required before a paid live pilot starts.**

- [ ] Choose one customer, one market and one source; record the exact scope.
- [ ] Use a supported, auditable provisioning process to fill required business
  name, phone, script, calendar and provider links that the current UI cannot edit.
- [ ] Verify credentials with actual provider requests, not configuration-presence badges.
- [ ] Set recipient location/timezone and consent evidence for test contacts.
- [ ] Run a consented test enquiry → policy decision → call → signed callback →
  visible qualification outcome → real calendar availability → confirmed booking.
- [ ] Test human escalation and failed-transfer message/manual-follow-up handling.
- [ ] Test opt-out, suppression, outside-hours deferral and kill-switch activation.
- [ ] Verify webhook-source automatic dispatch; document manual steps for CSV.
- [ ] Verify worker/cron scheduling, queue recovery and alert delivery to a real inbox.
- [ ] Restore a backup into a separate database and verify important records.
- [ ] Record rollback procedure, recovery targets, support owner and escalation contacts.
- [ ] Customer approves script, FAQ, lead source, disclosure wording and calling hours.
- [ ] Obtain legal/customer approval for calling, recording and data-processing terms.
- [ ] Agree provider/customer data retention and a manual export/deletion/offboarding procedure.
- [ ] Obtain written activation sign-off; retain evidence without exposing tokens or personal data.

Use `docs/pilot-acceptance.md` for the detailed technical runbook. Local stub tests
are necessary, but do not substitute for authorized live-provider acceptance.

## 5. Sales material checklist—can prepare now

**Owner: founder/sales. Prospecting does not require live customer outreach by the product.**

- [ ] One-page offer: buyer, problem, actual workflow, scope, exclusions, price and CTA.
- [ ] Short demo using fictional/authorized data; clearly distinguish live backend
  behavior from stubs and prototypes. Show real leads/calls/bookings, not fake billing.
- [ ] Discovery-call script covering lead volume, current response times,
  qualification process, consent collection, calendar, escalation staff and budget.
- [ ] Pilot proposal with conditional launch acceptance and measurable success criteria.
- [ ] Reviewed agreement/DPA/privacy notice and a payment/invoicing process.
- [ ] Customer intake form and onboarding checklist.
- [ ] Weekly reporting template and a support/escalation contact sheet.
- [ ] FAQ explaining what happens when a call fails, consent is absent, the caller
  opts out, the calendar is unavailable or a person asks for a human.
- [ ] No invented logos, testimonials, case-study outcomes or unsupported response-time claims.

### Simple discovery questions

1. How many new enquiries arrive each week, and from which source?
2. How quickly does a person currently follow up, including nights/weekends?
3. What do you ask before deciding an enquiry is qualified?
4. What consent wording and evidence do you collect for AI voice follow-up?
5. Who takes a transfer or follows up if escalation fails?
6. What would make a 30-day pilot worth continuing?

If the buyer lacks appropriate consent or expects unimplemented features, do not
force-fit the sale. Change the scope or decline that use case.

## 6. Execution sequence and exit gates

| Phase | Work | Exit gate |
|---|---|---|
| 1. Scope + demand | Select the initial buyer; prepare offer/demo; hold discovery calls | Qualified buyer agrees to the limited, conditional pilot scope |
| 2. Engineering hardening | Access, SMS safety, webhook reliability, timeouts, dependency remediation | Engineering checklist passes with reproducible evidence |
| 3. Production acceptance | Isolated customer setup, live acceptance, legal review, backups and alerts | Engineering, operations and customer approve activation |
| 4. One pilot | Activate under supervision; review failures and outcomes weekly | Measured results, manageable support burden and a continuation decision |
| 5. Repeatability | Document actual setup effort, margin, failures and customer feedback | A second customer can be onboarded without improvised access or unsafe shortcuts |
| 6. Self-serve expansion | Real onboarding, tenant secrets/RBAC, billing and connected feature implementations | Separate GA readiness review; do not infer it from a successful single pilot |

Do not assign a guaranteed calendar deadline until the open engineering and legal
work is estimated. Sales preparation and discovery can run alongside hardening;
live activation cannot skip the exit gates.

## 7. What to measure during the pilot

Agree definitions, targets and the baseline with the customer before activation.

- Eligible enquiries received; invalid/duplicate/consent-blocked enquiries reported separately.
- Enquiry-to-first-attempt latency during allowed hours; overnight deferrals separately.
- Connection rate, qualified-conversation rate, confirmed-booking rate and booking attendance.
- Transfer success and completion of manual follow-up tasks.
- Opt-outs, complaints, duplicate/unauthorized calls or messages.
- Provider failures/uncertain outcomes, queue delay and operator recovery time.
- Actual provider costs and operator minutes per customer/qualified conversation/booking.
- Comparison with the customer's prior follow-up process; no causal revenue claims
  based only on a small uncontrolled pilot.

**Stop activation immediately** for a suspected unauthorized/duplicate outreach
incident, broken opt-out enforcement, customer-data exposure or uncontrolled cost
spike. Use the kill switch for calls and separately disable any enabled message
path; the current call kill switch does not make the unsafe SMS path safe. Investigate,
remediate and re-accept before restarting.

## Bottom line

Sell a narrow, honest, managed service outcome—not every screen in the app.
Prepare and prospect now. Start live delivery only after engineering, operational
and customer/legal acceptance. Broaden the feature list only when those workflows
are implemented and independently verified.
