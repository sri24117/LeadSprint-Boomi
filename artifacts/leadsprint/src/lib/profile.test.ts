import { describe, expect, it } from 'vitest';
import {
  detailsText,
  displayValue,
  fieldValue,
  isEmergency,
  isRealEstateProfile,
  listSummary,
  needsConsent,
  type ProfileLike,
} from './profile';

const homeProfile: ProfileLike = {
  id: 'home_services',
  appointment_label: 'Service visit',
  urgency_levels: [
    { value: 'emergency', label: 'Emergency' },
    { value: 'same_day', label: 'Same day' },
  ],
  fields: [
    {
      key: 'service_type',
      label: 'Service',
      type: 'enum',
      options: [
        { value: 'ac_repair', label: 'AC repair' },
        { value: 'drain', label: 'Drain / sewer' },
      ],
      in_list: true,
      storage: 'details',
    },
    { key: 'urgency', label: 'Urgency', type: 'enum', options: [{ value: 'emergency', label: 'Emergency' }, { value: 'same_day', label: 'Same day' }], in_list: true, storage: 'column' },
    { key: 'problem', label: 'Problem', type: 'text', options: [], in_list: false, storage: 'details' },
    { key: 'zip', label: 'ZIP code', type: 'text', options: [], in_list: true, storage: 'details' },
    { key: 'preferred_time', label: 'Preferred time', type: 'text', options: [], in_list: true, storage: 'details' },
  ],
};

const realEstateProfile: ProfileLike = {
  id: 'real_estate',
  appointment_label: 'Viewing',
  urgency_levels: [],
  fields: [
    { key: 'property_type', label: 'Property type', type: 'text', options: [], in_list: true, storage: 'column' },
    { key: 'budget_label', label: 'Budget', type: 'text', options: [], in_list: true, storage: 'column' },
  ],
};

const lead = (over: Record<string, unknown> = {}) =>
  ({
    urgency: 'emergency',
    consent_status: 'valid',
    property_type: 'Condo',
    budget_label: '$700k',
    details: { service_type: 'ac_repair', problem: 'No cooling', zip: '78701' },
    ...over,
  }) as never;

describe('isRealEstateProfile', () => {
  it('is true only for the real-estate profile', () => {
    expect(isRealEstateProfile(realEstateProfile)).toBe(true);
    expect(isRealEstateProfile(homeProfile)).toBe(false);
    expect(isRealEstateProfile(undefined)).toBe(true); // before the session loads, behave as today
  });
});

describe('fieldValue', () => {
  it('reads details-stored fields from lead.details', () => {
    expect(fieldValue(lead(), homeProfile.fields[0]!)).toBe('ac_repair');
    expect(fieldValue(lead(), homeProfile.fields[3]!)).toBe('78701');
  });

  it('reads column-stored fields from the lead itself', () => {
    expect(fieldValue(lead(), homeProfile.fields[1]!)).toBe('emergency');
    expect(fieldValue(lead(), realEstateProfile.fields[0]!)).toBe('Condo');
  });

  it('is empty for anything missing, null, or not a simple value', () => {
    expect(fieldValue(lead({ details: {} }), homeProfile.fields[0]!)).toBe('');
    expect(fieldValue(lead({ urgency: null }), homeProfile.fields[1]!)).toBe('');
    expect(fieldValue(lead({ details: undefined }), homeProfile.fields[0]!)).toBe('');
    expect(fieldValue(lead({ details: { zip: { nested: 1 } } }), homeProfile.fields[3]!)).toBe('');
  });

  it('stringifies numbers and booleans', () => {
    expect(fieldValue(lead({ details: { zip: 78701 } }), homeProfile.fields[3]!)).toBe('78701');
  });
});

describe('displayValue', () => {
  it('shows an enum value as its label', () => {
    expect(displayValue(lead(), homeProfile.fields[0]!)).toBe('AC repair');
    expect(displayValue(lead(), homeProfile.fields[1]!)).toBe('Emergency');
  });

  it('shows an unrecognised enum value as written', () => {
    expect(displayValue(lead({ details: { service_type: 'chimney sweep' } }), homeProfile.fields[0]!)).toBe('chimney sweep');
  });

  it('says "Not provided" for an empty value', () => {
    expect(displayValue(lead({ details: {} }), homeProfile.fields[3]!)).toBe('Not provided');
  });
});

describe('listSummary', () => {
  it('puts the first list field first and the rest on a second line, skipping empty ones', () => {
    expect(listSummary(lead(), homeProfile)).toEqual({ primary: 'AC repair', secondary: 'Emergency · 78701' });
  });

  it('includes a preferred time when there is one', () => {
    const l = lead({ details: { service_type: 'drain', zip: '78660', preferred_time: 'tomorrow AM' } });
    expect(listSummary(l, homeProfile)).toEqual({ primary: 'Drain / sewer', secondary: 'Emergency · 78660 · tomorrow AM' });
  });

  it('still shows something useful when the lead has no details yet', () => {
    expect(listSummary(lead({ details: {}, urgency: null }), homeProfile)).toEqual({ primary: 'Details pending', secondary: '' });
  });

  it('works for a profile whose first list field is empty', () => {
    const l = lead({ details: { zip: '78701' }, urgency: null });
    expect(listSummary(l, homeProfile)).toEqual({ primary: '78701', secondary: '' });
  });
});

describe('detailsText (for export)', () => {
  it('lists every filled field as "Label: value"', () => {
    expect(detailsText(lead(), homeProfile)).toBe('Service: AC repair; Urgency: Emergency; Problem: No cooling; ZIP code: 78701');
  });

  it('is empty when there is nothing to list', () => {
    expect(detailsText(lead({ details: {}, urgency: null }), homeProfile)).toBe('');
  });
});

describe('badges', () => {
  it('flags emergencies', () => {
    expect(isEmergency(lead())).toBe(true);
    expect(isEmergency(lead({ urgency: 'same_day' }))).toBe(false);
    expect(isEmergency(lead({ urgency: null }))).toBe(false);
  });

  it('flags a lead that needs consent', () => {
    expect(needsConsent(lead({ consent_status: 'unknown' }))).toBe(true);
    expect(needsConsent(lead({ consent_status: 'valid' }))).toBe(false);
    expect(needsConsent(lead({ consent_status: 'revoked' }))).toBe(false);
  });
});
