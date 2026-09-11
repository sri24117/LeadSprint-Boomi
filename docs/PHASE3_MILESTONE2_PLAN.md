# Phase 3 Milestone 2 Implementation Plan: Consent Evidence & Recipient Timezone Provenance (Final)

> **Document Type:** Audit & Technical Implementation Plan (READ-ONLY / NO CODE CHANGES YET)  
> **Status:** FINAL APPROVED PLAN (AFFIRMATIVE CONSENT REFINED)  
> **Date:** September 2026  
> **Baseline Commit:** `a7b1dbd` (*Phase 3: multi-tenant provider binding and usage enforcement*)  
> **Source of Truth:** `docs/PHASE3_PRODUCTION_READINESS_AUDIT.md` & `LeadSprint_US_Sellable_MVP_Final (1).docx` (v2.0)  

---

## 1. Executive Summary & Core Principles

Phase 3 Milestone 1 established tenant-specific telephony/calendar routing, pre-dispatch usage limits, and dynamic dashboard metrics.

Milestone 2 addresses the two core P1 compliance and outbound safety gaps identified in the Phase 3 Production Readiness Audit:
1. **Consent Evidence Persistence**: Establishing an application-enforced append-only consent tracking model capturing timestamps, capture sources, disclosure versions, and lifecycle events — **strictly requiring explicit affirmative consent and never manufacturing consent**.
2. **Recipient Timezone Provenance & Dual-Gate Quiet Hours**: Resolving recipient timezone (via explicit intake or US area-code inference heuristic) and enforcing quiet hours across *both* recipient and business timezones.

---

## 2. Mandatory Principle: Consent Creation Requires Explicit Affirmative Consent

The LeadSprint platform enforces a strict anti-fabrication compliance rule:
- **Do NOT treat any of the following as proof of opt-in consent:**
  - Receiving a lead
  - Importing a CSV row
  - Receiving a webhook
  - Creating a contact
  - Receiving an IP address or User Agent
  - Receiving a disclosure version or disclosure text
  - Receiving a timestamp or capture source
- **The system must NEVER manufacture, infer, or synthesize consent evidence.**

### Supporting Evidence Alone is NOT Consent:
DO NOT create an `opt_in` or `re_consent` event merely because any of the following supporting metadata exist:
- `consent_disclosure_version`
- `disclosure_text`
- `consent_captured_at` / `consent_date`
- `consent_source` / `source`
- `intakeIp` / `ipAddress`
- `userAgent`

### Required Affirmative Signal Rule:
Consent event creation **strictly requires an EXPLICIT AFFIRMATIVE CONSENT SIGNAL** from the intake/import contract (e.g. `consent_given = true` or an existing trusted consent-status field explicitly supplied with an affirmative value defined by the contract).

### Exact Evaluation Cases:
- **Case 1: Standard Contact Data Only**
  `{ name, phone, email }`
  $\to$ **NO consent event created**. Contact created with `consentCapturedAt = NULL`, `consentSource = NULL`, `consentDisclosureVersion = NULL`.
- **Case 2: Disclosure Version / Metadata Without Affirmative Signal**
  `{ name, phone, email, consent_disclosure_version: "v1_pilot" }`
  $\to$ **NO consent event created**. A disclosure version alone is not proof of consent.
- **Case 3: Explicit Affirmative Consent with Supporting Evidence**
  `{ name, phone, email, consent_given: true, consent_disclosure_version: "v1_pilot", consent_captured_at: "..." }`
  $\to$ **Create `opt_in` event** in `consent_events` and persist all supplied evidence.
- **Case 4: Explicit Non-Consent**
  `{ name, phone, email, consent_given: false }`
  $\to$ **NO opt_in event created**.
- **Case 5: Historical CSV with Explicit Documented Consent**
  CSV row: `consent_given = true`, `consent_date = <supplied timestamp>`, `source = "historical_import"`
  $\to$ **Create `opt_in` event** preserving the supplied historical timestamp and source.

---

## 3. CSV Historical Import Semantics

CSV import itself is **NEVER** evidence of consent. Only an explicit affirmative consent field/value in the CSV may create an `opt_in` or `re_consent` event.

- **If the CSV contains only contact data (`name`, `phone`, `email`):**
  - Create/update contact according to existing behavior.
  - **Do NOT create an `opt_in` event.**
  - **Do NOT fabricate `consentCapturedAt`.**
  - **Do NOT fabricate `disclosureVersion`.**
  - **Do NOT claim the CSV import itself proves consent.**
  - `consentCapturedAt`, `consentSource`, and `consentDisclosureVersion` remain `NULL`.
- **If the CSV contains metadata (`consent_date`, `disclosure_version`) but NO affirmative consent signal:**
  - Create/update contact.
  - **Do NOT create an `opt_in` event.**
- **If the imported record is explicitly identified as an affirmative historical consent record (`consent_given = true`):**
  - Set `consentSource = "historical_import"`.
  - Create a `consent_events` record with `eventType = "opt_in"` and `source = "historical_import"`.
  - Preserve the supplied historical consent timestamp in `consent_events.capturedAt` and `contacts.consentCapturedAt`.
  - Preserve any supplied disclosure version/text and metadata.

---

## 4. Canonical Vocabularies

### A. Canonical Event Type Vocabulary (`eventType`)
The `consent_events.eventType` column strictly accepts only the following canonical values:
- **`opt_in`**: Contact affirmatively provided explicit consent to be contacted.
- **`opt_out`**: Contact affirmatively requested not to be contacted.
- **`suppression`**: Operator placed contact on business suppression list / internal DNC.
- **`re_consent`**: Contact re-affirmed consent after prior revocation or expiration.
- **`revocation`**: Contact revoked previously granted consent.

*(No alternative spellings such as `suppressed`, `revoked`, or informal synonyms are permitted).*

### B. Canonical Source Vocabulary (`consentSource` / `source`)
The canonical source vocabulary consists strictly of:
- **`web_form`**: Direct submission via web lead intake form with affirmative consent checkbox/disclosure.
- **`csv_import`**: Bulk CSV file containing explicit affirmative consent columns.
- **`api_intake`**: Authenticated inbound webhook API request (`/api/webhooks/intake`) with explicit affirmative consent payload.
- **`operator_verbal`**: Verbal consent received by operator during phone call.
- **`historical_import`**: Explicit historical consent record imported from legacy CRM/database.
- **`operator_console`**: Manual action performed in the owner console (e.g., manual suppression).

**Important Source Rule:**
- `"unknown"` is **NOT** a valid enum/string value.
- For a contact whose consent source is genuinely unknown or unrecorded:
  - `consentSource = NULL`
- Existing historical contacts without modern evidence will have:
  - `consentStatus = "valid"`
  - `consentCapturedAt = NULL`
  - `consentSource = NULL`
  - `consentDisclosureVersion = NULL`
- This represents: **"Valid — evidence metadata unavailable"**.

### C. Canonical Timezone Provenance Vocabulary (`timezoneProvenance`)
- **`explicit_intake`**: Timezone was provided directly by the lead in the intake payload or CSV.
- **`area_code_inferred`**: Timezone was inferred from the 3-digit US NANP area code. *(Heuristic only — not authoritative recipient location)*.
- **`business_fallback`**: Timezone could not be determined (toll-free, unmapped, or international) and defaulted to business timezone.

---

## 5. Append-Only Audit Trail & Timestamp Semantics

### A. Append-Only Audit Trail Semantics
The `consent_events` table serves as an **application-enforced append-only audit trail**:
- Application code will **only execute `INSERT` statements** against `consent_events`.
- **No `UPDATE` or `DELETE` API endpoints or database queries** will exist for `consent_events`.
- Historical consent events are never altered or overwritten by normal application flows.
- When disclosure text is recorded with a consent event, the exact text is stored immutably with that event row.
- *(Note: Database-level row-lock triggers or restricted PostgreSQL roles are out of scope for this MVP milestone; immutability is strictly enforced by application data-access layer design).*

### B. Consent Event Timestamp Semantics
- A supplied consent timestamp is **supporting evidence only**; it does not by itself establish that consent occurred without an affirmative signal.
- When affirmative consent is present, `consent_events.capturedAt` must represent the **timestamp of the actual consent event when known**.
- Do **not** silently replace a supplied historical consent timestamp with the database insertion time.
- If no timestamp was supplied for a new explicit affirmative consent event, use the application capture timestamp (`new Date()`).
- For historical imports, preserve the supplied historical timestamp in both `contacts.consentCapturedAt` and `consent_events.capturedAt`.

---

## 6. Distinguish Network Provenance from Consent Evidence

- **`intakeIp` / `ipAddress`**: Represents HTTP request and network provenance only. It is **NOT itself proof of consent**.
- **Durable Consent Evidence** is established solely by the combination of:
  1. Affirmative consent signal (`consent_given = true` or contract-defined affirmative field)
  2. `eventType` (`opt_in` / `re_consent`)
  3. `capturedAt` (verifiable timestamp of agreement)
  4. `source` (channel of consent capture from canonical vocabulary)
  5. `disclosureVersion` & `disclosureText` (specific terms presented to and agreed by the recipient)
  6. Network metadata (`ipAddress`, `userAgent`) attached to the event when available.

---

## 7. Timezone Provenance & Dual-Gate Quiet Hours Specification

### A. Timezone Provenance Distinction
- **Explicit Intake (`explicit_intake`)**: Direct user input from form/CSV. Authoritative.
- **Area-Code Inferred (`area_code_inferred`)**: Derived from US 3-digit NPA (e.g. `212` $\to$ `America/New_York`, `415` $\to$ `America/Los_Angeles`). **This is a heuristic and NOT authoritative location provenance** (e.g., users who moved states while retaining their phone number).
- **Business Fallback (`business_fallback`)**: Used when area code is toll-free (`800`, `888`, etc.), unmapped, or non-US.

### B. Dual-Gate Quiet-Hours Evaluation Logic
```text
IF recipient timezone is explicitly supplied OR successfully area-code inferred:
    evaluate recipient timezone
    AND
    evaluate business timezone

    call is allowed only if BOTH are outside quiet hours.

IF recipient timezone cannot be resolved (business_fallback):
    evaluate business timezone only.
```
*(Prevents redundant duplicate evaluation of the business timezone when recipient timezone is unresolvable).*

---

## 8. Backward Compatibility & Existing Contacts

- **Callable Status**: Existing contacts with `consentStatus = "valid"` **remain callable** for backward compatibility with active test suites and initial pilots.
- **Evidence Metadata**: A valid status does **not** imply modern digital consent evidence exists. For historical contacts without evidence:
  - `consentStatus = "valid"`
  - `consentCapturedAt = NULL`
  - `consentSource = NULL`
  - `consentDisclosureVersion = NULL`
  - `timezoneProvenance = "business_fallback"`
- **Operator UI Presentation**: The operator console will display:
  `"Valid — evidence metadata unavailable"`
  so operators are not misled into believing modern digital evidence was captured.
- **No Forced Re-Consent**: Existing records will not be invalidated or made uncallable in this milestone.

---

## 9. Proposed Database Schema Changes (Migration 0004)

### 1. New Table: `consent_events`
```ts
export const consentEventsTable = pgTable("consent_events", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => businessesTable.id),
  contactId: text("contact_id").notNull().references(() => contactsTable.id),
  eventType: text("event_type").notNull(), // "opt_in" | "opt_out" | "suppression" | "re_consent" | "revocation"
  source: text("source").notNull(),        // "web_form" | "csv_import" | "api_intake" | "operator_verbal" | "historical_import" | "operator_console"
  disclosureVersion: text("disclosure_version"),
  disclosureText: text("disclosure_text"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").notNull().default({}),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  businessContactIdx: index("consent_events_business_contact_idx").on(table.businessId, table.contactId),
  capturedAtIdx: index("consent_events_captured_at_idx").on(table.capturedAt),
}));
```

### 2. Additive Columns to `contactsTable`:
```ts
consentCapturedAt: timestamp("consent_captured_at", { withTimezone: true }),
consentSource: text("consent_source"), // Nullable: NULL when evidence source is unrecorded (no "unknown" string)
consentDisclosureVersion: text("consent_disclosure_version"),
intakeIp: text("intake_ip"),
recipientTimezone: text("recipient_timezone"),
timezoneProvenance: text("timezone_provenance").notNull().default("business_fallback"),
```

---

## 10. Proposed Intake, Import & Implementation Requirements

### A. Contract Inspection Requirement (Implementation Safety)
- **Before implementing consent event creation, inspect the existing intake OpenAPI/Zod schema and identify the exact existing affirmative consent field/value. Do not invent or reinterpret a field.**
- **If no affirmative consent field currently exists:**
  - DO NOT infer consent.
  - Preserve standard contact creation behavior.
  - Do NOT create `opt_in` events.
  - Document that explicit affirmative consent capture requires a future API/UI contract addition.

### B. Phone Normalization & Area-Code Inference (`lib/phone.ts`)
- Add `inferTimezoneFromPhone(phone: string)`:
  - Maps US NANP area codes to primary IANA timezones (`America/New_York`, `America/Chicago`, `America/Denver`, `America/Phoenix`, `America/Los_Angeles`, `America/Anchorage`, `Pacific/Honolulu`).
  - Detects toll-free prefixes (`800`, `888`, `877`, `866`, `855`, `844`, `833`) and returns `business_fallback`.

### C. Inbound Webhook (`routes/webhooks.ts`)
- Accepts optional `consent_given`, `consent_status`, `consent_captured_at`, `consent_disclosure_version`, `consent_source`, `disclosure_text`, `recipient_timezone`.
- Extracts client IP (`req.ip` / `x-forwarded-for`) as network provenance `intakeIp`.
- **Consent Rule**:
  - IF explicit affirmative consent is provided (e.g. `consent_given === true` or contract-defined affirmative signal):
    - Sets contact evidence fields (`consentCapturedAt`, `consentSource`, `consentDisclosureVersion`, `intakeIp`).
    - Appends row into `consent_eventsTable` (`eventType: "opt_in"`, `source: "api_intake"`, `capturedAt: consentCapturedAt || new Date()`).
  - IF affirmative consent is NOT provided (even if disclosure_version, timestamp, or IP are present):
    - Sets contact evidence fields as `NULL`.
    - **No `consent_events` row is created.**

### D. CSV Import (`routes/leadsprint.ts`)
- Supports optional CSV columns: `consent_given`, `consent_source`, `consent_date`, `disclosure_version`, `disclosure_text`, `timezone`.
- **Consent Rule**:
  - IF CSV row contains explicit affirmative consent (`consent_given === true` / `"true"` / `"yes"`):
    - Sets contact evidence fields.
    - Appends row into `consent_eventsTable` (`eventType: "opt_in"`, `source: "csv_import"` or `"historical_import"`, preserving supplied timestamp).
  - IF CSV row does NOT contain explicit affirmative consent:
    - Creates contact with `consentCapturedAt = NULL`, `consentSource = NULL`, `consentDisclosureVersion = NULL`.
    - **No `consent_events` row is created.**

### E. Operator Suppression (`routes/leadsprint.ts`)
- Updates `contactsTable.consentStatus = "suppressed"`.
- Appends `consent_eventsTable` row (`eventType: "suppression"`, `source: "operator_console"`).

### F. Policy Engine (`lib/policy.ts`)
- Implements dual-gate quiet hours check:
  - If `recipientTimezone && timezoneProvenance !== "business_fallback"`: evaluates recipient timezone AND business timezone.
  - Otherwise: evaluates business timezone only.

---

## 11. Frontend UI Impact

1. **Lead Detail View (`artifacts/leadsprint/src/App.tsx`)**:
   - **Compliance & Consent Section**:
     - Status Badge: `Valid` (Green), `Pending` (Yellow), `Suppressed` (Red), `Revoked` (Gray).
     - For historical contacts without evidence: `"Valid — evidence metadata unavailable"`.
     - For contacts with evidence: Captured timestamp, source tag (`web_form`, `csv_import`, `historical_import`), disclosure version (e.g. `v1_pilot`).
     - Timezone display: e.g. `America/Los_Angeles (Inferred from Area Code 415)` or `America/New_York (Explicit intake)`.
2. **CSV Import Modal**:
   - Optional mapping selectors for Affirmative Consent Given, Consent Date, Consent Source, Disclosure Version, and Timezone.

---

## 12. Comprehensive Automated Test Plan

### A. Consent Model & Negative Anti-Fabrication Tests
1. **Intake with NO Explicit Consent (Negative Test)**:
   - Inbound webhook payload with only contact data (`name`, `phone`, `email`).
   - Asserts contact created with `consentCapturedAt = NULL`, `consentSource = NULL`, `consentDisclosureVersion = NULL`.
   - Asserts **0** rows created in `consent_eventsTable` (no opt-in event manufactured).
2. **Disclosure Version Without Affirmative Consent (Negative Test)**:
   - Payload has `consent_disclosure_version: "v1_pilot"` but NO affirmative consent signal (`consent_given` is absent/false).
   - Asserts **0** `opt_in` rows created in `consent_eventsTable`.
3. **Consent Timestamp Without Affirmative Consent (Negative Test)**:
   - Payload has `consent_captured_at: "2026-09-01T12:00:00Z"` but NO affirmative consent signal.
   - Asserts **0** `opt_in` rows created in `consent_eventsTable`.
4. **IP Address Without Affirmative Consent (Negative Test)**:
   - Payload from known IP with `intakeIp` recorded, but NO affirmative consent signal.
   - Asserts **0** `opt_in` rows created in `consent_eventsTable`.
5. **Source Without Affirmative Consent (Negative Test)**:
   - Payload has `consent_source: "web_form"` but NO affirmative consent signal.
   - Asserts **0** `opt_in` rows created in `consent_eventsTable`.
6. **Explicit Affirmative Consent (Positive Test)**:
   - Payload with explicit affirmative consent (`consent_given: true`, disclosure version, timestamp).
   - Asserts contact created with evidence fields and **exactly 1** `opt_in` row in `consent_eventsTable`.
7. **CSV with ONLY Contact Data (Negative Test)**:
   - CSV row containing only `name`, `phone`, `email`.
   - Asserts contact imported with `NULL` evidence fields and **0** consent events created.
8. **CSV with Explicit Historical Consent**:
   - CSV row with explicit affirmative consent (`consent_given = true`), historical timestamp, and disclosure version.
   - Asserts `consent_eventsTable` record is created with `eventType: "opt_in"`, `source: "historical_import"`, preserving supplied historical timestamp.
9. **Existing Valid Contact Without Evidence (Legacy Backward Compatibility)**:
   - Contact with `consentStatus = "valid"` and `consentCapturedAt = NULL`, `consentSource = NULL`.
   - Asserts contact remains callable by policy engine.
   - Asserts UI presents `"Valid — evidence metadata unavailable"`.
10. **NULL consentSource Acceptance**:
    - Validates that `NULL` consent source is accepted and properly handled for legacy contacts without throwing or rejecting.
11. **Canonical Vocabularies Enforcement**:
    - Validates that `eventType` accepts only `opt_in`, `opt_out`, `suppression`, `re_consent`, `revocation`.
    - Validates that `source` accepts only `web_form`, `csv_import`, `api_intake`, `operator_verbal`, `historical_import`, `operator_console`.
12. **Append-Only Behavior**:
    - Multiple lifecycle transitions (opt-in $\to$ suppression $\to$ re-consent) append rows without updating or deleting past events.
13. **Tenant Isolation**:
    - Queries on `consent_eventsTable` filter strictly by `business_id`.

### B. Timezone Provenance & Dual-Gate Quiet Hours Tests
1. **Explicit Recipient Timezone**: `explicit_intake` timezone is respected.
2. **Area-Code Inferred Timezone**: `212` $\to$ `America/New_York`, `415` $\to$ `America/Los_Angeles`, `312` $\to$ `America/Chicago`, `303` $\to$ `America/Denver`.
3. **Business Fallback Timezone**: Toll-free (`800`) or unmapped numbers evaluate business timezone once.
4. **Dual-Gate Cross-Timezone Evaluation**:
   - East Coast business calling West Coast lead at 8:15 AM EDT (5:15 AM PDT) $\to$ **BLOCKED** by recipient quiet hours.
   - West Coast business calling East Coast lead at 9:30 PM EDT (6:30 PM PDT) $\to$ **BLOCKED** by recipient quiet hours.
   - Daytime calling valid in both timezones (2:00 PM EDT / 11:00 AM PDT) $\to$ **ALLOWED**.
5. **DST Transition Verification**: Accurate time calculation during standard vs daylight saving transitions.

---

## 13. Migration & Safety Evaluation

- **Migration Required:** **YES**.
- **Migration Name:** `0004_consent_evidence_and_recipient_timezone.sql`.
- **Safety**: Strictly additive schema changes (one new table, six nullable/defaulted columns). No column drops, no table alterations, no destructive data operations.

---

## 14. Files Affected

1. `lib/db/src/schema/leadsprint.ts`
2. `lib/db/drizzle/0004_consent_evidence_and_recipient_timezone.sql`
3. `lib/db/drizzle/meta/_journal.json`
4. `artifacts/api-server/src/lib/phone.ts`
5. `artifacts/api-server/src/lib/policy.ts`
6. `artifacts/api-server/src/lib/worker.ts`
7. `artifacts/api-server/src/routes/leadsprint.ts`
8. `artifacts/api-server/src/routes/webhooks.ts`
9. `artifacts/leadsprint/src/App.tsx`
10. `artifacts/api-server/src/phase3-m2.test.ts`
