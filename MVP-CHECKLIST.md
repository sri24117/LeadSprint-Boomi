# LeadSprint — MVP launch checklist

**As of:** 2026-10-03 · **Base:** `sri24117/LeadSprint-Boomi` (`main`, = the supplied zip) + the changes in this pass
**Bar being checked:** *paid, managed pilot* (1–3 US real-estate teams, manual onboarding, human watching).
Self-serve / GA is a separate bar — see Part F.

Legend: ✅ done and verified · 🟡 done, needs a human/external step · ⬜ not done · 🚫 deliberately out of scope

---

## Which repo? (decision)

| | `LeadSprint-Boomi` (A) | `AI-voice-Agent` (B) |
|---|---|---|
| Same product | yes | yes — an earlier snapshot of A |
| Test files | 21 (175 tests) | 12 |
| Consent evidence, call queue, onboarding gate, agent auth | ✅ | ❌ absent |
| Atomic dispatch (no double-dial), overnight retry | ✅ | ❌ |
| One-command demo, boot migrator + adoption, sales script, audit docs | ✅ | ❌ |
| Verdict | **Sell this one** | Archive it; nothing in B is missing from A |

B was not merged: A contains every capability B has, plus the four silent-failure fixes
(P1-1…P1-4) that B predates. The supplied zip is byte-identical to A (ignoring line endings).

---

## Part A — Product works (verified by running it, 2026-10-03)

| # | Check | Evidence | |
|---|---|---|---|
| A1 | `pnpm install --frozen-lockfile` | clean | ✅ |
| A2 | Typecheck, all 4 workspaces | exit 0 | ✅ |
| A3 | API test suite on real SQL (PGlite) | 175 passed before this pass; 183 after (see A4) | ✅ |
| A4 | New checks written first (red), then implemented (green) — `routes/cron.alerts.test.ts`, 8 checks | red 8/8 → green 8/8 | ✅ |
| A5 | API + console production builds | exit 0 | ✅ |
| A6 | `pnpm demo --reset` boots on a fresh DB: migrations apply, no errors, server listens | observed | ✅ |
| A7 | Live `GET /api/readyz`, `/today`, `/leads` | 200, seeded data correct | ✅ |
| A8 | Forged intake signature → 401; unknown `/api/*` → JSON 404; cron without secret → 401 | observed | ✅ |
| A9 | Operator console renders and shows the setup-complete banner | screenshot | ✅ |
| A10 | Safety gate (consent → suppression → quiet hours in *recipient* tz → attempts → kill switch) | covered by `policy.test.ts`, `calls.test.ts`, `concurrency.test.ts` | ✅ |
| A11 | Billing: one call = one billed minute; unknown call id bills nothing | `webhooks.usage.test.ts` | ✅ |
| A12 | Overnight enquiry is called once, in the morning | `concurrency.test.ts` | ✅ |
| A13 | **Not yet done by anyone:** a real call through real Twilio + Retell + Cal.com | needs your accounts | 🟡 |

## Part B — Fixed in this pass

| # | Item (review ref) | Change | |
|---|---|---|---|
| B1 | No alerting (P3-11) | `POST /api/cron/health-alerts` — emails `ALERT_EMAIL` on failed/uncertain calls ≥ threshold in 24h or an overdue job queue; future-dated quiet-hours retries are *not* "stalled"; per-tenant | ✅ |
| B2 | HTML injection in weekly email (new finding) | business name / period label were interpolated raw into HTML; now escaped | ✅ |
| B3 | Replit placeholder metadata + crawlable console (P3-10) | real description; `noindex, nofollow`; `robots.txt` disallows all | ✅ |
| B4 | "AI receptionist" claim but outbound-only (P3-7) | README repositioned to outbound speed-to-lead, with the limit stated | ✅ |
| B5 | Compliance artefacts absent (P3-12) | drafted pack in `docs/compliance/pilot-legal-pack.md` — **needs a lawyer** | 🟡 |
| B6 | Nothing to sell with | `docs/sales-kit.md` — offer, pricing, outreach, objections, close | ✅ |

## Part C — Before the first invoice (blocking, in order)

| # | Task | Owner | |
|---|---|---|---|
| C1 | Have a US attorney review `docs/compliance/pilot-legal-pack.md` (TCPA: an AI-generated voice is an "artificial voice" and needs prior express consent; recording consent by state; DPA) | you | ⬜ |
| C2 | Deploy to Coolify from `main`; set every var in `.env.example`; confirm `GET /api/readyz` shows `auth:"clerk"` and **not** `demo` | you | ⬜ |
| C3 | Set `CRON_SECRET`; schedule `process-jobs` (5 min), `health-alerts` (15 min), `weekly-report` (weekly), `retention` (daily) | you | ⬜ |
| C4 | Set SMTP + `ALERT_EMAIL`; trigger one alert by hand and confirm the email arrives (until you do, `notified:false` is the only signal) | you | ⬜ |
| C5 | Turn on Coolify nightly S3 backups; do one **restore** drill (`docs/backup-restore.md`) | you | ⬜ |
| C6 | Create Twilio number, Retell agent (`docs/retell-agent.json`), Cal.com event type; run the live-call path in `docs/pilot-acceptance.md` §3 against *your own phone* | you | ⬜ |
| C7 | Pin to **one** replica if `ENABLE_INTERNAL_WORKER=true` (rate limiter + worker are single-process by design) | you | ⬜ |
| C8 | Remove `LEADSPRINT_DEMO_AUTH` / `VITE_LEADSPRINT_DEMO_AUTH` from the production environment (refused in prod, but don't rely on it) | you | ⬜ |
| C9 | Customer signs the pilot agreement + written confirmation of telemarketing/recording/AI-disclosure compliance (`docs/pilot-scope.md`) | customer | ⬜ |
| C10 | Replace placeholder contact details in the legal pack (company name, address, privacy email) | you | ⬜ |

## Part D — Pilot operations (week 1 with a customer)

| # | Task | |
|---|---|---|
| D1 | Onboard the workspace by hand; setup checklist in console must read "Setup complete" | ⬜ |
| D2 | Customer's consent source verified on a sample of 10 leads *before* the first live dial | ⬜ |
| D3 | First 20 calls reviewed by a human daily (transcripts, outcome, billing minutes) | ⬜ |
| D4 | Kill switch tested once with the customer watching | ⬜ |
| D5 | Weekly report email received by the owner | ⬜ |
| D6 | Success metric agreed in writing: median time-to-first-contact, % contacted ≤ 5 min, booked appointments | ⬜ |

## Part E — Known gaps, ranked, with the honest reason each is not fixed here

| Ref | Gap | Why not now | Trigger to fix |
|---|---|---|---|
| P2-4b | "Unresolved messages" card has no resolve action (needs schema migration + OpenAPI codegen + UI) | Not pilot-blocking; label already says "waiting on a reply" | First customer complains |
| P3-8 | Intake `timestamp` is optional, so a captured signed body can be replayed | Making it mandatory breaks forms/n8n flows in the sales demo; duplicate-phone check already contains the damage | Before self-serve; add `provider_events` dedupe on intake |
| P2-5 | One global intake secret (any holder can write to any tenant) | Fine for one managed customer | Before the **second** customer |
| P2-6 | No team/org model (each Clerk user = own workspace) | Pilot profile is a 2–15 agent team, so **ask each pilot to share one login or have you invite via one workspace** until built | Second customer, or first complaint |
| P3-7 | Inbound calls not supported | Repositioned instead of built | Customer asks |
| — | Weekly-report cron loads all rows into memory (O(N)) | 10–60 enquiries/week; harmless at pilot scale | > 1k leads/business |
| — | `artifacts/mockup-sandbox` and `.replit*` files still in repo | Unused; removal needs lockfile churn | Cleanup PR |
| — | Error tracking (Sentry etc.), metrics endpoint | `health-alerts` covers the two failures that matter | After first incident |

## Part F — 🚫 Out of scope until the pilot pays (from `docs/pilot-scope.md`)

Stripe/self-serve billing · SMS/WhatsApp · multi-provider voice · per-tenant provider credentials ·
CRM marketplace · prompt editor · white-label · India market.

---

## Definition of "ready to sell a pilot"

All of Part A ✅ (A13 on your own phone), B ✅, and **C1–C10 ✅**. Today: A and B are done;
C is entirely yours because it needs your accounts, your lawyer and your customer.
