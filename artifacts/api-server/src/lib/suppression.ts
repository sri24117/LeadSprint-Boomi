import crypto from "node:crypto";
import { and, eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  activitiesTable,
  contactsTable,
  type db as defaultDb,
  leadsTable,
  suppressionsTable,
} from "@workspace/db";

// Passed in rather than imported: every route/lib module here holds its own
// swappable db handle so tests can run it against an isolated database.
type Db = typeof defaultDb;

/**
 * Do-not-call handling.
 *
 * Before this module, suppression was written in three places that never
 * agreed with each other: the operator "Suppress" button set a consent value
 * the API schema rejects (so the Leads page 500'd for the whole workspace),
 * the `suppressions` table was written but never read, and phone numbers were
 * compared as raw strings — so "(213) 555-0111" was a brand-new, callable
 * contact even after "+12135550111" asked not to be called.
 *
 * The rules this module enforces:
 *   1. Every phone number is stored and compared in one canonical form.
 *   2. An opt-out is recorded against the NUMBER, per business, and the
 *      safety gate checks that list before every dial — not just the
 *      contact row it happened to arrive on.
 *   3. Every route to an opt-out (operator button, the voice agent's
 *      opt_out tool, an intake payload revoking consent) goes through
 *      `suppressContact`, so they cannot drift apart again.
 */

/**
 * Canonical form for a phone number: E.164 when it can be determined.
 *
 *   "(213) 555-0111" / "213-555-0111" / "12135550111" → "+12135550111"
 *   "+91 98765 43210"                                → "+919876543210"
 *
 * Anything that does not look like a phone number is returned trimmed and
 * unchanged. It is still stored (so the operator can see what arrived) but
 * the area-code lookup will not resolve a timezone for it, and the gate
 * blocks it rather than guessing.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : trimmed;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

/**
 * The digit strings a number may have been stored as. For NANP numbers this
 * is both "12135550111" and "2135550111", since older rows hold whatever the
 * lead source sent ("+1 213…", "(213) 555-0111", "213-555-0111").
 */
function digitKeys(raw: string): string[] {
  const digits = normalizePhone(raw).replace(/[^\d]/g, "");
  if (!digits) return [raw.trim()];
  const keys = new Set([digits]);
  if (digits.length === 11 && digits.startsWith("1")) keys.add(digits.slice(1));
  return Array.from(keys);
}

/**
 * SQL condition: `column` holds the same phone number as `raw`, however
 * either was formatted. Rows written before normalization existed hold
 * whatever the lead source sent, so comparing canonical strings alone would
 * miss them — and a missed match here is a person who opted out being called.
 */
export function samePhone(column: AnyColumn, raw: string): SQL {
  return inArray(sql`regexp_replace(${column}, '[^0-9]', '', 'g')`, digitKeys(raw));
}

export async function isPhoneSuppressed(db: Db, businessId: string, phone: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: suppressionsTable.id })
    .from(suppressionsTable)
    .where(and(eq(suppressionsTable.businessId, businessId), samePhone(suppressionsTable.phone, phone)))
    .limit(1);
  return Boolean(hit);
}

export type SuppressionSource = "operator" | "agent_opt_out" | "intake_revoked";

/**
 * Records a do-not-call decision for one contact: the contact's consent is
 * revoked, every lead on it stops being worked, and the number goes on the
 * business's suppression list so a re-submitted or re-imported copy of it is
 * blocked too. Idempotent — a second opt-out for the same number adds no
 * second suppression row.
 */
export async function suppressContact(db: Db, input: {
  businessId: string;
  contactId: string;
  phone: string;
  reason: string;
  source: SuppressionSource;
}): Promise<void> {
  const { businessId, contactId, reason, source } = input;
  const phone = normalizePhone(input.phone);
  const now = new Date();

  await db
    .update(contactsTable)
    .set({ suppressedAt: now, consentStatus: "revoked" })
    .where(and(eq(contactsTable.id, contactId), eq(contactsTable.businessId, businessId)));

  await db
    .update(leadsTable)
    .set({ status: "suppressed", nextAction: "Do not call — opted out", updatedAt: now })
    .where(and(eq(leadsTable.contactId, contactId), eq(leadsTable.businessId, businessId)));

  if (!(await isPhoneSuppressed(db, businessId, phone))) {
    await db.insert(suppressionsTable).values({
      id: `suppression_${crypto.randomUUID().slice(0, 12)}`,
      businessId,
      phone,
      reason,
      source,
    });
  }

  await db.insert(activitiesTable).values({
    id: `activity_${crypto.randomUUID().slice(0, 12)}`,
    businessId,
    // Must be a value the Activity schema allows (lead, call, booking, alert,
    // import, intake, message, policy) — an unknown type makes the whole
    // activity feed fail response validation.
    type: "policy",
    title: source === "agent_opt_out" ? "Caller asked not to be called again" : "Contact added to do-not-call list",
    detail: `${phone} · ${reason}`,
  });
}
