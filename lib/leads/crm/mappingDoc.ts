// lib/leads/crm/mappingDoc.ts
//
// Human-readable documentation of how lead fields land in each CRM payload,
// rendered by the editor's CRM Routing tab so admins can see exactly what a
// renamed field still maps to. Client-safe on purpose — the adapters import
// Mongoose and can't be pulled into client components.
//
// KEEP IN SYNC with the adapters in this directory: every entry mirrors a
// body assignment in the corresponding adapter's send(), and every
// requirement mirrors its validate(). If an adapter changes what it sends,
// change it here too.

import type { FieldKey } from '@/models/LeadFormConfig';

export type CrmKey = 'smartmoving' | 'supermove' | 'chariot' | 'moverbase';

export const CRM_DISPLAY_NAME: Record<CrmKey, string> = {
  smartmoving: 'SmartMoving',
  supermove: 'Supermove',
  chariot: 'Chariot',
  moverbase: 'Moverbase',
};

// Admin-facing names for the underlying fields (labels may be renamed per
// form; these identify the field itself).
export const MAPPING_FIELD_NAMES: Record<FieldKey, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  phoneType: 'Phone type',
  moveDate: 'Move date',
  moveSize: 'Move size',
  origin: 'Origin',
  destination: 'Destination',
  companyName: 'Company name',
};

// Order rows render in the mapping table.
export const MAPPING_DISPLAY_ORDER: FieldKey[] = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'phoneType',
  'moveDate',
  'moveSize',
  'origin',
  'destination',
  'companyName',
];

export interface CrmFieldTarget {
  // Destination field in the CRM payload, written the way it appears there.
  target: string;
  // Transformation applied on the way out, when there is one.
  note?: string;
}

export const CRM_FIELD_MAPPINGS: Record<
  CrmKey,
  Partial<Record<FieldKey, CrmFieldTarget>>
> = {
  smartmoving: {
    firstName: { target: 'firstName' },
    lastName: { target: 'lastName' },
    fullName: {
      target: 'fullName',
      note: 'only when first/last name are not collected',
    },
    email: { target: 'email' },
    phone: { target: 'phoneNumber', note: 'sent as a 10-digit number' },
    phoneType: { target: 'phoneType' },
    moveDate: { target: 'moveDate' },
    moveSize: { target: 'moveSize' },
    origin: { target: 'originAddressFull' },
    destination: { target: 'destinationAddressFull' },
  },
  supermove: {
    firstName: {
      target: 'client.primary_contact.full_name',
      note: 'combined with last name into one full name',
    },
    lastName: {
      target: 'client.primary_contact.full_name',
      note: 'combined with first name into one full name',
    },
    fullName: { target: 'client.primary_contact.full_name' },
    email: { target: 'client.primary_contact.email' },
    phone: {
      target: 'client.primary_contact.phone_number',
      note: 'sent as a 10-digit number',
    },
    moveDate: { target: 'jobs[0].date' },
    moveSize: { target: 'values.PROJECT_SIZE' },
    origin: { target: 'jobs[0].locations[].address' },
    destination: { target: 'jobs[0].locations[].address' },
  },
  chariot: {
    firstName: { target: 'first_name' },
    lastName: { target: 'last_name' },
    fullName: { target: 'name' },
    email: { target: 'email' },
    phone: { target: 'phone_number', note: 'sent as a 10-digit number' },
    phoneType: { target: 'phone_type' },
    moveDate: { target: 'move_date' },
    moveSize: { target: 'move_size' },
    origin: { target: 'origin_address' },
    destination: { target: 'destination_address' },
  },
  moverbase: {
    firstName: { target: 'firstName', note: 'truncated to 20 characters' },
    lastName: { target: 'lastName', note: 'truncated to 25 characters' },
    fullName: {
      target: 'firstName + lastName',
      note: 'split on the first space',
    },
    companyName: { target: 'companyName', note: 'truncated to 25 characters' },
    email: { target: 'email' },
    phone: { target: 'phone', note: 'sent as a 10-digit number' },
    moveDate: { target: 'date' },
    moveSize: {
      target: 'size',
      note: 'matched to Moverbase size list; unrecognized sizes omitted',
    },
    origin: { target: 'from', note: 'city/state/ZIP parsed from the address' },
    destination: {
      target: 'to',
      note: 'city/state/ZIP parsed from the address',
    },
  },
};

/**
 * Hard requirements each adapter's validate() enforces before sending.
 * A requirement is satisfied when every field in at least one `anyOf`
 * group has a value on the submitted lead. The editor uses these to warn
 * when the form's enabled/required toggles can't guarantee (or even allow)
 * a requirement, since leads failing validate() are skipped for that CRM.
 */
export interface CrmRequirement {
  description: string;
  anyOf: FieldKey[][];
}

export const CRM_REQUIREMENTS: Record<CrmKey, CrmRequirement[]> = {
  smartmoving: [
    {
      description: 'a name (first + last, or full name)',
      anyOf: [['firstName', 'lastName'], ['fullName']],
    },
    { description: 'a phone or email', anyOf: [['phone'], ['email']] },
  ],
  supermove: [
    {
      description: 'a name',
      anyOf: [['firstName'], ['lastName'], ['fullName']],
    },
    {
      description: 'an origin or destination address',
      anyOf: [['origin'], ['destination']],
    },
  ],
  chariot: [
    {
      description: 'a name',
      anyOf: [['firstName'], ['lastName'], ['fullName']],
    },
    { description: 'a phone or email', anyOf: [['phone'], ['email']] },
  ],
  moverbase: [
    {
      description: 'a first name (or full name)',
      anyOf: [['firstName'], ['fullName']],
    },
    { description: 'a phone or email', anyOf: [['phone'], ['email']] },
  ],
};
