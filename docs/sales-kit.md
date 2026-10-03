# LeadSprint sales kit — selling the managed pilot

Use with `docs/sales-demo.md` (the 10-minute demo) and `docs/pilot-scope.md` (what is
and isn't included). **Do not sell anything this kit doesn't say the product does.**
Do not start selling until checklist items C1–C6 are done; until then you are selling
a *pilot start date*, not a live service.

## 1. Who to sell to (one profile)

US real-estate teams of 2–15 agents, one office, getting 10–60 online enquiries a
week from Zillow/Realtor/Facebook/IG/landing pages, where enquiries sit unanswered
for hours. Buyer: team lead / broker-owner. Not: solo agents (too small), brokerages
over 50 agents (need CRM integrations and teams — not built).

## 2. The offer

> "Every new enquiry gets a call back in about a minute — qualified, and booked on
> your calendar or handed to a human — inside consent and quiet-hours rules.
> 30-day pilot. If it doesn't beat your current response time, you stop."

| | |
|---|---|
| Setup | $500–1,500 one-off (we configure the workspace, script, calendar, number) |
| Monthly | $249–499 |
| Pilot term | 30 days, cancel on 14 days' notice |
| Success metric (agree in writing) | % of enquiries contacted within 5 minutes; booked appointments; median time-to-first-contact vs. their baseline |
| Billing | Manual invoice or payment link (no Stripe yet) |

Anchor the price against one extra closed deal's commission, not against software.

## 3. Outreach

**Cold email (≤ 90 words)**
> Subject: How long do your Zillow leads wait?
>
> Hi [Name] — most teams I speak to take 2–6 hours to reach a new online enquiry;
> studies consistently show the odds of connecting fall sharply after the first
> few minutes. LeadSprint calls every new enquiry back in about a minute with an AI
> assistant that qualifies them and books straight into your calendar, or hands the
> call to an agent — only for people who gave consent, and never outside calling hours.
> Running a 30-day pilot with a few [CITY] teams. Worth a 10-minute demo this week?

*(Do not quote a specific statistic unless you can cite its source.)*

**LinkedIn DM** — "Quick one: how fast does a new online enquiry get a human response
at [TEAM]? We're piloting an assistant that calls back in ~1 minute and books the
showing. Happy to show a 10-min demo."

**Follow-up (day 3)** — one line + the 10-minute demo link/time slots. Max two follow-ups.

## 4. Discovery (5 questions, 5 minutes)

1. How many online enquiries a week? From where?
2. Median time to first contact today — honestly?
3. What happens to enquiries after 6pm and on weekends?
4. How do they record where a lead's consent came from?
5. Who would watch the console during the first two weeks?

Disqualify if: no way to show consent evidence, < 10 enquiries/week, or they want
cold-calling a purchased list. **We don't do the last one.**

## 5. Demo → close

Run `docs/sales-demo.md` exactly. Close on the metric, not the tech:
"Let's agree the number we're measured on, start on [date], and review at day 14."

## 6. Objections

| Objection | Answer (true to the product) |
|---|---|
| "Is this legal?" | "It only calls people with recorded consent, inside local calling hours, with a built-in do-not-call list and kill switch. You confirm your own state rules in writing — we give you the policy pack to take to your attorney." |
| "Will it sound like a robot?" | "It says it's an automated assistant at the start — that disclosure is part of the script. Listen to a sample call in the demo." |
| "What if it says something wrong?" | "It only answers from the FAQ you approve and transfers or takes a message for anything else. It never invents availability — it offers only slots the calendar returns." |
| "What about inbound calls?" | "Not yet — it's outbound follow-up on new enquiries. Tell us if inbound matters to you." |
| "Does it integrate with my CRM?" | "Not in the pilot — leads come in by signed webhook or CSV. CRM integration is next if the pilot works." |
| "Can my whole team log in?" | "In the pilot, one shared workspace login. Team accounts are on the roadmap." *(true — P2-6)* |
| "What's the commitment?" | "30 days, 14 days' notice, we export your data." |

## 7. After "yes"

1. Send the pilot agreement (`docs/compliance/pilot-legal-pack.md` §1) + DPA (§2).
2. Collect: transfer number, calendar, business hours, approved FAQ, qualification questions, lead source, and **a sample of consent evidence**.
3. Run MVP-CHECKLIST Part D. Review the first 20 calls daily with them.
4. Day 14 review against the agreed metric; day 30 convert or stop.
