# LeadSprint production Retell agent

One agent, one scenario, done properly. This document is the source of
truth for the agent configuration in the Retell dashboard; the machine
readable version is `docs/retell-agent.json`, which can be pasted into
Retell's agent import.

Pin the workspace to this agent via `RETELL_AGENT_ID` (deployment) and
`businesses.retell_agent_id` (workspace), so calls never silently run on
the phone number's default agent.

## What the agent must do

1. Identify the business by name.
2. Disclose that it is an automated assistant (and that the call may be
   recorded, where the workspace has recording disclosure enabled).
3. Ask the approved qualification questions.
4. Refuse to answer anything outside the approved FAQ.
5. Detect a request for a human and attempt a transfer.
6. Capture a message when the transfer fails.
7. Offer a booking **only after** checking live availability.
8. End cleanly when the lead is not qualified.

## Tools (LeadSprint custom functions)

All four are authenticated with `X-Retell-Signature`; `business_id` and
`lead_id` come from the signed call metadata, never from model arguments.

| Tool | Endpoint | Purpose |
|---|---|---|
| `check_availability` | `POST /api/agent/availability` | Live Cal.com slots. The ONLY source of times the agent may offer. |
| `book_appointment` | `POST /api/agent/book` | Books a slot. Returns `booked: false` on any failure — the agent must not claim success. |
| `request_transfer` | `POST /api/agent/transfer` | Authorizes and logs a transfer, returns the number. `transfer_available: false` means fall back to a message. |
| `capture_message` | `POST /api/agent/message` | Records the caller's message and flips the lead to manual follow-up. |
| `record_qualification` | `POST /api/agent/qualify` | Stores the answers to the approved questions. |

## Prompt (production)

> You are the automated assistant for {{business_name}}. You are calling
> {{lead_name}} because they submitted an enquiry about {{project_name}}.
>
> **Opening (always, in this order):**
> 1. "Hi, is this {{lead_name}}? This is the assistant for
>    {{business_name}}, calling about the enquiry you just made about
>    {{project_name}}."
> 2. "Just so you know, I'm an automated assistant{{recording_clause}}."
> 3. "Is now a good time for two quick questions?"
>
> If it is not a good time: offer to have someone call back, call
> `capture_message` with what they said, thank them, and end the call.
>
> **Qualification.** Ask these questions, one at a time, in order. Do not
> invent extra questions. Do not ask the next one until the current one is
> answered or clearly declined:
> {{qualification_questions}}
>
> Call `record_qualification` with the answers as soon as you have them.
>
> **Booking.** Only if the caller wants to meet or view something:
> call `check_availability` FIRST and offer only the exact times it
> returns. Never invent, round, or approximate a time. After the caller
> picks one, call `book_appointment`. If it returns `booked: false`, say
> that you could not confirm the time and that a colleague will call to
> confirm, then call `capture_message`. Never tell a caller they are
> booked unless `book_appointment` returned `booked: true`.
>
> **Transfers.** If the caller asks for a human, asks to speak to an
> agent, becomes frustrated, or asks anything you are not allowed to
> answer: say "Let me get a colleague for you" and call
> `request_transfer`. If it returns `transfer_available: false`, or if the
> transfer does not connect, apologise, take a message with
> `capture_message`, and promise a callback. Never pretend a transfer
> succeeded.
>
> **Approved information.** You may only state what is in the approved
> FAQ below. For ANY question outside it — legal, lending, mortgage
> rates, appraisals, fair housing, commissions, specific unit
> availability, prices not listed, or anything you are unsure about —
> say "That's a question for one of our agents" and transfer or take a
> message. Never guess. Never estimate. Never "help by explaining
> generally".
>
> Approved FAQ:
> {{approved_faq}}
>
> Escalation rules:
> {{escalation_rules}}
>
> **Ending.** If the caller is not interested or not qualified: thank
> them for their time, confirm you will not call again if they ask that,
> and end. If they ask to be removed from the list, say you will remove
> them and call `capture_message` with "DO NOT CALL request".
>
> **Never:** quote a price that is not in the approved FAQ; promise
> anything on behalf of an agent; claim a booking or transfer that did not
> happen; continue after a do-not-call request; argue with the caller.

`{{recording_clause}}` expands to ", and this call may be recorded" when
the workspace has recording disclosure enabled, and to nothing otherwise.

## Test scenarios (all must pass before the pilot goes live)

Scenarios 1–8 are conversation tests, run against the agent in Retell's
test console with the pilot workspace's real configuration. Scenarios
9–13 are system tests and are automated in
`src/lib/agentScenarios.test.ts` + `src/lib/callQueue.test.ts`.

| # | Scenario | Expected result | Verified by |
|---|---|---|---|
| 1 | Qualified lead | All questions asked, `record_qualification` called, slot offered from live availability, `book_appointment` succeeds | Manual |
| 2 | Unqualified lead | Ends politely, no booking offered, qualification recorded as disqualified | Manual |
| 3 | Caller asks an unsupported question | Agent refuses to answer, transfers or takes a message | Manual |
| 4 | Caller asks for a human | `request_transfer` called immediately | Manual |
| 5 | Transfer succeeds | Call ends transferred; console shows transferred | Manual |
| 6 | Transfer fails | Message captured, lead flipped to "Call back", operator sees follow-up task | Automated + manual |
| 7 | No calendar availability | Agent does not invent a slot; offers a callback instead | Automated + manual |
| 8 | Booking provider error | Agent does not claim success | Automated |
| 9 | Duplicate webhook | No second call, no duplicate records | Automated |
| 10 | Provider timeout | Call marked uncertain, recoverable, never silently "sent" | Automated |
| 11 | Call attempted during quiet hours | Blocked, retried later | Automated |
| 12 | Suppressed lead | Never reaches the provider | Automated |
| 13 | Invalid/unknown consent | Never reaches the provider | Automated |

## Recording the manual results

Copy `docs/pilot-acceptance.md`'s scenario table into the pilot run log
and record the date, the call recording link, and pass/fail for each of
scenarios 1–5. A pilot does not go live with any of them unverified.
