/**
 * Consent evidence — a launch gate, not polish.
 *
 * Before LeadSprint places an outbound call it must be able to answer
 * "why is it lawful to call this person?" with a recorded source and a
 * timestamp. The database default for a new contact is therefore
 * "unknown" (see lib/db schema), which the policy gate blocks.
 *
 * Only an explicit, evidenced statement from the lead source can move a
 * contact to "valid":
 *   - the signed intake webhook must send consent_status + consent_source
 *   - the CSV import must send a consent source for the whole batch
 *   - the operator console must show the resulting state on every lead
 */

export const CONSENT_STATUSES = ["unknown", "valid", "revoked"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export interface ConsentEvidence {
  consentStatus: ConsentStatus;
  consentSource: string | null;
  consentAt: Date | null;
}

export class ConsentEvidenceError extends Error {
  readonly statusCode = 400;
}

export function isConsentStatus(value: unknown): value is ConsentStatus {
  return (
    typeof value === "string" &&
    (CONSENT_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Normalizes consent fields supplied by a lead source into evidence that
 * is safe to store. Fails closed:
 *   - a missing/unrecognized status becomes "unknown" (never "valid")
 *   - "valid" without a non-empty source is rejected outright, because a
 *     callable contact with no recorded reason is exactly the state this
 *     gate exists to prevent
 */
export function normalizeConsentEvidence(input: {
  status?: unknown;
  source?: unknown;
  at?: unknown;
  now?: Date;
}): ConsentEvidence {
  const now = input.now ?? new Date();
  const source =
    typeof input.source === "string" && input.source.trim()
      ? input.source.trim().slice(0, 200)
      : null;

  if (!isConsentStatus(input.status)) {
    // Unknown/absent status is not an error — it just isn't callable yet.
    return { consentStatus: "unknown", consentSource: source, consentAt: null };
  }

  if (input.status === "valid") {
    if (!source) {
      throw new ConsentEvidenceError(
        'consent_status "valid" requires a non-empty consent_source (where and how consent was captured).',
      );
    }
    let capturedAt = now;
    if (typeof input.at === "string" && input.at.trim()) {
      const parsed = new Date(input.at);
      if (Number.isNaN(parsed.getTime())) {
        throw new ConsentEvidenceError("consent_at must be an ISO 8601 timestamp.");
      }
      capturedAt = parsed;
    }
    return { consentStatus: "valid", consentSource: source, consentAt: capturedAt };
  }

  if (input.status === "revoked") {
    return { consentStatus: "revoked", consentSource: source, consentAt: now };
  }

  return { consentStatus: "unknown", consentSource: source, consentAt: null };
}

/** Operator-facing one-liner describing the consent state of a contact. */
export function describeConsent(evidence: {
  consentStatus: string;
  consentSource?: string | null;
  consentAt?: Date | null;
}): string {
  if (evidence.consentStatus === "valid") {
    const when = evidence.consentAt ? evidence.consentAt.toISOString().slice(0, 10) : "date not recorded";
    return `Consent recorded via ${evidence.consentSource ?? "unspecified source"} (${when}).`;
  }
  if (evidence.consentStatus === "revoked") {
    return "Consent revoked — this contact must not be called.";
  }
  return "No consent evidence recorded — calling is blocked until a source is captured.";
}
