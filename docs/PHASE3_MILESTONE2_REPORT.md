# Phase 3 Milestone 2 Report: Consent Evidence & Recipient Timezone Provenance

> **Document Type:** Milestone Completion Report
> **Status:** CORRECTION PASS COMPLETE (Uncommitted local changes, Migration 0004 NOT executed)
> **Date:** September 2026
> **Baseline Commit:** `a7b1dbd` (*Phase 3: multi-tenant provider binding and usage enforcement*)

---

## Executive Summary

Phase 3 Milestone 2 has been fully implemented in accordance with `docs/PHASE3_MILESTONE2_PLAN.md`.

All compliance and outbound safety gaps identified in the Phase 3 Production Readiness Audit for consent evidence tracking and recipient timezone resolution have been resolved.

A **correction pass** was subsequently applied to address three P0/P1 issues identified in code review. The correction pass introduces no schema changes, no new migration, and no behavioral regressions.

---

## Correction Pass Summary (Applied Post-Implementation)

Three issues were identified and corrected:

### Issue 1 — Historical Consent Timestamp Integrity (P0)

**Before (prohibited):**
```ts
consentCapturedAt = isNaN(parsed.getTime()) ? new Date() : parsed;
```

**After (correct):**
- A new `parseConsentTimestamp(candidate)` helper in `lib/phone.ts` enforces:
  - Absent/null candidate → `{ date: new Date(), wasSupplied: false }` (current capture time is allowed)
  - Valid supplied candidate → `{ date: parsed, wasSupplied: true }` (preserved exactly)
  - Invalid supplied candidate → `{ date: null, wasSupplied: true, invalid: true }` (caller must reject)
- **Intake handler** (`webhooks.ts`): Invalid `consent_captured_at` returns HTTP 400; no fabricated timestamp is persisted.
- **CSV import** (`leadsprint.ts`): Row with invalid supplied timestamp is **skipped** (counted as `skipped`). No fabricated timestamp is persisted.

### Issue 2 — Canonical Consent Source Validation (P0)

**Before (prohibited):** arbitrary strings accepted; `rawSource || "csv_import"` would pass invalid inputs through.

**After (correct):**
- A new `validateConsentSource(rawSource, defaultSource)` helper in `lib/phone.ts` enforces:
  - Canonical value → returned as-is
  - Absent/null → returns the trusted `defaultSource` for that flow
  - Invalid non-canonical string → returns `null` (caller must reject)
  - `"unknown"` is never generated
- Canonical vocabulary: `web_form`, `csv_import`, `api_intake`, `operator_verbal`, `historical_import`, `operator_console`
- **Intake handler**: Invalid source returns HTTP 400
- **CSV import**: Row with invalid source is skipped
- **Suppression handler**: Already correctly hardcoded to `operator_console` (no change needed)

### Issue 3 — Explicit Timezone Validation (P1)

**Before (incorrect):** Any non-empty string was accepted as `explicit_intake` timezone without validation.

**After (correct):**
- A new `isValidIanaTimezone(tz)` helper in `lib/phone.ts` uses `Intl.DateTimeFormat` to validate IANA timezone identifiers.
- Both intake (`webhooks.ts`) and CSV import (`leadsprint.ts`) now:
  - If supplied timezone is valid IANA → accepted as `explicit_intake`
  - If supplied timezone is invalid → falls back to area-code inference; if inference fails → `business_fallback`
  - Invalid timezone strings are never persisted with `explicit_intake` provenance

---

## Correction Pass — Test & Build Verification

| Suite / Verification Step | Result | Details |
| :--- | :---: | :--- |
| **Phase 3 M2 Tests (incl. correction pass)** | **PASS** | **37/37** tests passing in `src/phase3-m2.test.ts` (23 original + 14 new CP tests) |
| **Full Vitest Test Suite (`pnpm test`)** | **PASS** | **132/132 tests passing** across 8 suites |
| **TypeScript Typecheck (`pnpm run typecheck`)** | **PASS** | 0 errors across all packages |
| **API Server Production Build** | **PASS** | `dist/index.mjs` built cleanly via esbuild |
| **Frontend Production Build** | **PASS** | `dist/public` built cleanly via Vite |
| **`git diff --check`** | **PASS** | 0 whitespace/formatting errors |
| **Migration Execution Status** | **NOT EXECUTED** | `0004_consent_evidence_and_recipient_timezone.sql` created but NOT run against any database |

---

## Correction Pass — New Tests Added (D/E/F)

**D. Timestamp Integrity (5 tests):**
- CP-1: Valid historical timestamp preserved exactly
- CP-2: Invalid historical timestamp rejected (not substituted with `now`)
- CP-3: Invalid explicit intake timestamp rejected
- CP-4: Absent timestamp (null) uses current capture time
- CP-5: Absent timestamp (undefined) uses current capture time

**E. Canonical Source Validation (5 tests):**
- CP-6: All 6 canonical sources accepted
- CP-7: Invalid/non-canonical source rejected (returns `null`)
- CP-8: Null/absent source returns provided default
- CP-9: `"unknown"` is never generated
- CP-10: NULL `consentSource` accepted for legacy contacts

**F. Timezone Validation (4 tests):**
- CP-11: `America/New_York` accepted as valid IANA timezone
- CP-12: `America/Los_Angeles` accepted as valid IANA timezone
- CP-13: Invalid timezone falls back to area-code inference
- CP-14: Invalid timezone + unmapped phone falls back to `business_fallback`

---

## Core Verified Outcomes (Original M2)

1. **Consent Anti-Fabrication**: Opt-in consent events (`eventType = "opt_in"`) are ONLY created when an explicit affirmative consent signal (`consent_given === true` or contract-defined affirmative field) is present in the intake or import payload.
2. **Contract Inspection Finding**: Existing intake and CSV contracts were inspected. Neither legacy intake contract provided a default affirmative consent field. The intake and import handlers accept optional explicit affirmative consent signals (`consent_given`, `consentGiven`) while preserving standard contact creation with `NULL` evidence metadata when affirmative consent is absent.
3. **CSV Import Semantics**: CSV rows without explicit affirmative consent create contacts with `consentCapturedAt = NULL`, `consentSource = NULL`, and `consentDisclosureVersion = NULL`, creating 0 consent events.
4. **Append-Only Audit Trail**: `consent_events` table captures lifecycle events (`opt_in`, `suppression`, `re_consent`, `opt_out`, `revocation`). No `UPDATE` or `DELETE` endpoints or queries exist for consent events.
5. **Recipient Timezone Provenance & Dual-Gate Quiet Hours**: Timezone is resolved via valid IANA explicit intake (`explicit_intake`), 3-digit US area code inference heuristic (`area_code_inferred`), or toll-free/unmapped fallback (`business_fallback`). The policy engine enforces dual-gate quiet hours.
6. **Backward Compatibility**: Legacy contacts with `consentStatus = "valid"` and `NULL` evidence metadata remain callable.
7. **Additive Migration 0004**: Created and registered but **NOT executed against any database.**

---

## Working Tree State

- **8 modified files**, **3 untracked files** (all Milestone 2 changes)
- **Not committed. Not pushed. Migration 0004 not executed.**
