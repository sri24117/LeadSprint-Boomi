# LeadSprint pilot legal pack — DRAFT

> **Status: working draft, NOT legal advice and NOT yet reviewed by counsel.**
> Have a US attorney review all four documents before a customer signs anything
> (checklist item C1). Replace every `[BRACKETED]` placeholder (C10). Nothing here
> has been verified against any specific state's law.

Contents: 1 · Pilot agreement · 2 · Data processing addendum · 3 · Calling, recording
and AI-disclosure policy · 4 · Privacy notice

---

## 1. Pilot agreement (summary terms)

**Parties:** [YOUR COMPANY NAME] ("Provider") and [CUSTOMER NAME] ("Customer").

1. **Service.** Provider configures one LeadSprint workspace that places outbound
   AI-voice follow-up calls to Customer's new property enquiries, qualifies them,
   and books appointments or transfers to Customer's staff, as described in
   `docs/pilot-scope.md`.
2. **Term and fees.** [30/60/90]-day pilot. Setup fee $[500–1,500]. Monthly fee
   $[249–499]. Third-party voice, telephony and SMS usage is [included up to
   N minutes / passed through at cost].
3. **Customer responsibilities (conditions of service).** Customer represents and
   warrants that:
   a. every phone number it submits was collected with **prior express consent**
      (for calls placed with an artificial or prerecorded voice, prior express
      *written* consent where the call is marketing) that covers calls of this kind
      from Customer or its agents;
   b. it has recorded the source of that consent in LeadSprint's `consent_source`
      field for each lead, and Provider may rely on it;
   c. it has checked the numbers against the National Do Not Call Registry and its
      own internal suppression list where required, and will add opt-outs to
      LeadSprint's suppression list promptly;
   d. it has confirmed in writing, for each state where it calls, the calling-hour,
      telemarketing-registration, and call-recording rules (`docs/pilot-scope.md`).
4. **Provider safeguards (what the product does, not a guarantee of legal compliance).**
   LeadSprint refuses to dial a contact without recorded consent, a suppressed
   contact, outside the recipient's local calling hours, past the attempt limit, or
   while the kill switch is on. Customer can stop all calls instantly with the kill
   switch.
5. **No guarantee of outcomes.** Provider does not guarantee leads contacted,
   appointments booked, or revenue.
6. **Customer indemnity.** Customer indemnifies Provider against claims arising
   from Customer's lead data or from calls placed to numbers lacking valid consent.
7. **Limitation of liability.** Provider's aggregate liability is capped at fees
   paid in the prior [3] months. [COUNSEL TO CONFIRM ENFORCEABILITY.]
8. **Termination.** Either party on [14] days' written notice. On termination
   Provider exports Customer's data and deletes it within [30] days, subject to §2.
9. **Governing law.** [STATE].

## 2. Data processing addendum (DPA)

**Roles.** Customer is the controller (business) of lead and call data; Provider is
its processor/service provider and processes it only to deliver the pilot.

| Item | Terms |
|---|---|
| Data processed | Lead name, phone, email, enquiry details, consent evidence, call metadata, AI-generated call summaries, call recordings/transcripts held by the voice provider |
| Purpose | Placing and reconciling follow-up calls; booking; reporting |
| Sub-processors | Retell AI (voice), Twilio (telephony), Cal.com (scheduling), Clerk (operator login), [HOSTING/COOLIFY HOST], [SMTP PROVIDER], PostgreSQL host |
| Security | TLS in transit; tenant-scoped database access; signed webhooks; secrets in environment only; nightly encrypted backups [CONFIRM C5] |
| Retention | Raw provider event payloads and activity rows pruned after `RETENTION_DAYS` (default 90). Leads, calls, contacts, appointments are kept for the term. **Recordings and transcripts are retained by Retell under their policy — [CONFIRM AND STATE PERIOD; LeadSprint does not delete them].** |
| Subject requests | Provider forwards access/deletion requests to Customer within [5] business days and executes Customer's instruction. |
| Breach | Provider notifies Customer without undue delay and within [72] hours of confirming a breach affecting Customer data. |
| Return/deletion | On termination, as in §1.8. |

## 3. Calling, recording and AI-disclosure policy

This is the policy the Retell agent script and the workspace settings implement.
Align the script in `docs/retell-agent.md` to it.

1. **Disclosure.** The agent identifies the business and states that it is an
   automated assistant in the first sentence, before any question
   ("…I'm an automated assistant, and this call may be recorded.").
2. **Consent first.** No call is placed without recorded consent. An AI-generated
   voice is treated as an artificial voice for telemarketing rules; do not rely on
   "inquiry = consent" unless counsel confirms it for the specific form wording.
3. **Recording.** Recording is off unless the workspace enables it. If enabled, the
   disclosure above is mandatory; for all-party-consent states the caller must be
   told before recording starts. Counsel to confirm the state list.
4. **Quiet hours.** No calls outside 08:00–21:00 recipient local time (or stricter
   state rule); the system derives local time from the number and blocks when unknown.
5. **Opt-out.** Any "stop"/"don't call me" ends the call, adds the number to the
   suppression list the same day, and is honoured permanently.
6. **Human handoff.** Anything outside approved FAQ is transferred or captured as a
   message; the agent never invents pricing, availability or legal advice.
7. **Kill switch.** Customer or Provider can set `LEADSPRINT_KILL_SWITCH` to stop all
   dialling immediately.

## 4. Privacy notice (for the Provider's website)

**[YOUR COMPANY NAME] — Privacy notice** · Effective [DATE] · Contact [PRIVACY EMAIL]

- **Operator console users:** we collect name, email and login data (via Clerk) to
  provide access.
- **Leads and call data:** we process this on behalf of our business customers;
  they decide what is collected. If you were called by an assistant on behalf of a
  business, contact that business to access or delete your data, or to stop calls.
- **Calls:** calls may be placed by an automated assistant and may be recorded; you
  are told at the start of the call.
- **Sharing:** only with the sub-processors listed in §2, to deliver the service.
- **Retention:** see §2. **Security:** see §2.
- **Your rights:** depending on where you live you may have rights to access,
  correct or delete data; email [PRIVACY EMAIL].
- **Changes:** we will post updates here.
