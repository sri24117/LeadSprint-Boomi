/**
 * Rendering helpers for the workspace's vertical profile. The API sends the
 * profile with the session; the console reads field labels and values from it
 * instead of hard-coding one industry. These helpers are only used for
 * non-real-estate verticals: real estate keeps its original screens exactly.
 */

import type { Lead, VerticalProfile } from '@workspace/api-client-react';

/** The members of a profile the console reads (the generated type satisfies it). */
export type ProfileLike = Pick<VerticalProfile, 'id' | 'appointment_label' | 'urgency_levels' | 'fields'>;
type Field = ProfileLike['fields'][number];

/** Before the session loads there is no profile: behave exactly as the console always has. */
export function isRealEstateProfile(profile: ProfileLike | undefined): boolean {
  return !profile || profile.id === 'real_estate';
}

/** The raw stored value of a field for a lead, or '' when there is none. */
export function fieldValue(lead: Lead, field: Field): string {
  const raw =
    field.storage === 'column'
      ? (lead as unknown as Record<string, unknown>)[field.key]
      : (lead.details as Record<string, unknown> | undefined)?.[field.key];
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/** The value as shown to an operator: enum labels, and "Not provided" when empty. */
export function displayValue(lead: Lead, field: Field): string {
  const raw = fieldValue(lead, field);
  if (!raw) return 'Not provided';
  return field.options.find((option) => option.value === raw)?.label ?? raw;
}

function filledLabel(lead: Lead, field: Field): string {
  const raw = fieldValue(lead, field);
  if (!raw) return '';
  return field.options.find((option) => option.value === raw)?.label ?? raw;
}

/** Two lines for the lead list: the headline field, then the other list fields that have a value. */
export function listSummary(lead: Lead, profile: ProfileLike): { primary: string; secondary: string } {
  const values = profile.fields.filter((f) => f.in_list).map((f) => filledLabel(lead, f)).filter(Boolean);
  if (values.length === 0) return { primary: 'Details pending', secondary: '' };
  return { primary: values[0]!, secondary: values.slice(1).join(' · ') };
}

/** Every filled field as "Label: value", for the CSV export. */
export function detailsText(lead: Lead, profile: ProfileLike): string {
  return profile.fields
    .map((f) => ({ label: f.label, value: filledLabel(lead, f) }))
    .filter((entry) => entry.value)
    .map((entry) => `${entry.label}: ${entry.value}`)
    .join('; ');
}

export function isEmergency(lead: Lead): boolean {
  return lead.urgency === 'emergency';
}

export function needsConsent(lead: Lead): boolean {
  return lead.consent_status === 'unknown';
}
