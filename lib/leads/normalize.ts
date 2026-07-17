// lib/leads/normalize.ts
//
// Pure, deterministic normalization of raw form payloads. No I/O, no DB calls.
// The caller is responsible for validation (required fields, etc.); this module
// only shapes the data into a NormalizedLead and silently drops unrecognized
// or disabled fields.

import type {
  NormalizedAddress,
  NormalizedCustomFieldValue,
  NormalizedLead,
} from './types';
import type { FieldKey, ILeadFormConfig } from '@/models/LeadFormConfig';

// Hard cap on a single custom-field answer; validateSubmission enforces the
// same limit at the API boundary.
const CUSTOM_VALUE_MAX = 2000;

/**
 * Normalize a raw form payload into a NormalizedLead.
 *
 * Only fields that are `enabled: true` in the form config are written to the
 * output. Unrecognized keys (other than utm_* / utmX*) are dropped. Validation
 * — including required-field enforcement — is a separate concern; this is a
 * pure shape transformation.
 */
export function normalize(
  raw: Record<string, unknown>,
  config: ILeadFormConfig,
): NormalizedLead {
  const enabled = new Set<FieldKey>(
    (config.fields || [])
      .filter((f) => f.enabled)
      .map((f) => f.id),
  );

  const out: NormalizedLead = {};

  // Names. The form sends `firstName` + `lastName` separately so we can
  // preserve them for CRM destinations that want split values. The
  // legacy `fullName` field stays for API consumers / back-compat.
  //
  // Resolution order:
  //   1. firstName + lastName fields if either is enabled and provided
  //      → use directly; build fullName from them
  //   2. fullName field if enabled and provided
  //      → split into firstName/lastName as before
  if (enabled.has('firstName') || enabled.has('lastName')) {
    const firstName = asTrimmedString(raw.firstName);
    const lastName = asTrimmedString(raw.lastName);
    if (firstName) out.firstName = firstName;
    if (lastName) out.lastName = lastName;
    if (firstName || lastName) {
      out.fullName = [firstName, lastName].filter(Boolean).join(' ');
    }
  }

  if (!out.fullName && enabled.has('fullName')) {
    const fullName = asTrimmedString(raw.fullName);
    if (fullName) {
      out.fullName = fullName;
      const tokens = fullName.split(/\s+/).filter(Boolean);
      if (tokens.length === 1) {
        out.firstName = tokens[0];
        out.lastName = '';
      } else if (tokens.length > 1) {
        out.lastName = tokens[tokens.length - 1];
        out.firstName = tokens.slice(0, -1).join(' ');
      }
    }
  }

  // email
  if (enabled.has('email')) {
    const email = asTrimmedString(raw.email);
    if (email) {
      out.email = email.toLowerCase();
    }
  }

  // phone -> E.164 (+1XXXXXXXXXX) for US numbers; undefined otherwise
  if (enabled.has('phone')) {
    const phoneRaw = asTrimmedString(raw.phone);
    if (phoneRaw) {
      const digits = phoneRaw.replace(/\D+/g, '');
      if (digits.length === 10) {
        out.phone = `+1${digits}`;
      } else if (digits.length === 11 && digits.startsWith('1')) {
        out.phone = `+${digits}`;
      }
      // anything else -> leave undefined; downstream validation will reject
    }
  }

  // phoneType
  if (enabled.has('phoneType')) {
    const pt = asTrimmedString(raw.phoneType);
    if (pt === 'mobile' || pt === 'home' || pt === 'work') {
      out.phoneType = pt;
    }
  }

  // moveDate -> YYYY-MM-DD
  if (enabled.has('moveDate')) {
    const md = raw.moveDate;
    const ymd = parseMoveDate(md);
    if (ymd) {
      out.moveDate = ymd;
    }
  }

  // moveSize (pass-through string)
  if (enabled.has('moveSize')) {
    const ms = asTrimmedString(raw.moveSize);
    if (ms) {
      out.moveSize = ms;
    }
  }

  // origin
  if (enabled.has('origin')) {
    const origin = parseAddress(raw.origin);
    if (origin) {
      out.origin = origin;
    }
  }

  // destination
  if (enabled.has('destination')) {
    const destination = parseAddress(raw.destination);
    if (destination) {
      out.destination = destination;
    }
  }

  // companyName
  if (enabled.has('companyName')) {
    const company = asTrimmedString(raw.companyName);
    if (company) {
      out.companyName = company;
    }
  }

  // Custom fields: values arrive under raw.custom keyed by the field's stable
  // id. Only ids present in the config are kept (unknown keys dropped), select
  // answers must match a configured option, and each kept value snapshots the
  // field's label at submit time.
  const customFields = Array.isArray(config.customFields)
    ? config.customFields
    : [];
  if (
    customFields.length > 0 &&
    raw.custom &&
    typeof raw.custom === 'object' &&
    !Array.isArray(raw.custom)
  ) {
    const rawCustom = raw.custom as Record<string, unknown>;
    const custom: NormalizedCustomFieldValue[] = [];
    for (const cf of customFields) {
      const value = asTrimmedString(rawCustom[cf.id]);
      if (!value) continue;
      if (
        cf.type === 'select' &&
        Array.isArray(cf.options) &&
        cf.options.length > 0 &&
        !cf.options.includes(value)
      ) {
        continue;
      }
      custom.push({
        id: cf.id,
        label: cf.label,
        value: value.slice(0, CUSTOM_VALUE_MAX),
      });
    }
    if (custom.length > 0) {
      out.custom = custom;
    }
  }

  // utm: always collect (not gated by config.fields, since FieldKey doesn't
  // include utm — utm tracking is a parallel concern).
  const utm: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (/^utm[A-Z]/.test(key) || key.startsWith('utm_')) {
      const v = asTrimmedString(raw[key]);
      if (v) utm[key] = v;
    }
  }
  if (Object.keys(utm).length > 0) {
    out.utm = utm;
  }

  // referrer pass-through
  const referrer = asTrimmedString(raw.referrer);
  if (referrer) {
    out.referrer = referrer;
  }

  // notes pass-through (kept on NormalizedLead type but not in FieldKey)
  const notes = asTrimmedString((raw as Record<string, unknown>).notes);
  if (notes) {
    out.notes = notes;
  }

  return out;
}

function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function parseMoveDate(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s) return undefined;

  // YYYY-MM-DD (exact match) — accept directly, but validate the date is real
  const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    const dt = new Date(`${y}-${m}-${d}T00:00:00Z`);
    if (!Number.isNaN(dt.getTime())) {
      // Round-trip check — guards against e.g. 2024-02-31
      const iso = dt.toISOString().slice(0, 10);
      if (iso === `${y}-${m}-${d}`) return iso;
    }
    return undefined;
  }

  // Otherwise treat as ISO-ish
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toISOString().slice(0, 10);
}

function parseAddress(v: unknown): NormalizedAddress | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? { raw: t } : undefined;
  }
  if (typeof v !== 'object') return undefined;
  const obj = v as Record<string, unknown>;
  const raw = asTrimmedString(obj.raw);
  if (!raw) return undefined;
  const addr: NormalizedAddress = { raw };
  const placeId = asTrimmedString(obj.placeId);
  if (placeId) addr.placeId = placeId;
  if (typeof obj.lat === 'number' && Number.isFinite(obj.lat)) addr.lat = obj.lat;
  if (typeof obj.lng === 'number' && Number.isFinite(obj.lng)) addr.lng = obj.lng;
  return addr;
}
