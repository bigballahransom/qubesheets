// lib/leads/validateSubmission.ts
//
// Defensive validation for raw lead-form submissions before they hit the
// pipeline. normalize() already silently drops malformed fields, so a hostile
// payload won't break anything — but it would still be persisted on
// `LeadSubmission.rawPayload`. This module caps the surface so we never write
// arbitrary-sized blobs to the DB, and rejects obviously-broken submissions
// with a 400 so the client sees an actionable error.
//
// Returns `null` on success or a short human-readable error string on failure.
// Run AFTER the honeypot check (so bots learn nothing) and BEFORE rate-limit
// bookkeeping (so a bot trying to flood with garbage payloads doesn't fill
// the rate-limit bucket with attempts that would never have succeeded).

export const SUBMISSION_LIMITS = {
  // Per-field caps
  NAME_PART_MAX: 200,           // firstName, lastName, fullName
  EMAIL_MAX: 200,
  PHONE_MAX: 50,
  PHONE_TYPE_MAX: 50,
  MOVE_DATE_MAX: 100,
  MOVE_SIZE_MAX: 200,
  ADDRESS_RAW_MAX: 500,
  PLACE_ID_MAX: 300,
  COMPANY_NAME_MAX: 200,
  NOTES_MAX: 5000,
  REFERRER_MAX: 1000,
  UTM_VALUE_MAX: 200,
  HONEYPOT_MAX: 500,           // generous — we accept anything here
  // Overall payload cap (keys we don't recognize get dropped, but the JSON
  // still has to fit in memory). Computed against the parsed-object key count
  // — a quick guard against an attacker dumping 10MB of unknown keys.
  TOTAL_KEYS_MAX: 200,
} as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkStringField(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (!isString(value)) return `${field} must be a string`;
  if (value.length > max) return `${field} exceeds ${max} characters`;
  return null;
}

function checkAddressField(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (isString(value)) {
    return value.length > SUBMISSION_LIMITS.ADDRESS_RAW_MAX
      ? `${field} exceeds ${SUBMISSION_LIMITS.ADDRESS_RAW_MAX} characters`
      : null;
  }
  if (!isObject(value)) return `${field} must be a string or address object`;
  // Object form: { raw, placeId?, lat?, lng? }
  if (value.raw !== undefined) {
    if (!isString(value.raw)) return `${field}.raw must be a string`;
    if (value.raw.length > SUBMISSION_LIMITS.ADDRESS_RAW_MAX) {
      return `${field}.raw exceeds ${SUBMISSION_LIMITS.ADDRESS_RAW_MAX} characters`;
    }
  }
  if (value.placeId !== undefined) {
    if (!isString(value.placeId)) return `${field}.placeId must be a string`;
    if (value.placeId.length > SUBMISSION_LIMITS.PLACE_ID_MAX) {
      return `${field}.placeId exceeds ${SUBMISSION_LIMITS.PLACE_ID_MAX} characters`;
    }
  }
  if (value.lat !== undefined && !isFiniteNumber(value.lat)) {
    return `${field}.lat must be a finite number`;
  }
  if (value.lng !== undefined && !isFiniteNumber(value.lng)) {
    return `${field}.lng must be a finite number`;
  }
  return null;
}

/**
 * Validate a public lead-form submission payload. The body must be an object;
 * known fields are length-capped; UTM-like keys are length-capped; everything
 * else is left to normalize() to drop.
 */
export function validateLeadSubmission(body: unknown): string | null {
  if (!isObject(body)) return 'Submission body must be a JSON object';

  const keys = Object.keys(body);
  if (keys.length > SUBMISSION_LIMITS.TOTAL_KEYS_MAX) {
    return `Submission body has too many fields (max ${SUBMISSION_LIMITS.TOTAL_KEYS_MAX})`;
  }

  // Known string fields
  const checks: Array<[string, number]> = [
    ['firstName', SUBMISSION_LIMITS.NAME_PART_MAX],
    ['lastName', SUBMISSION_LIMITS.NAME_PART_MAX],
    ['fullName', SUBMISSION_LIMITS.NAME_PART_MAX],
    ['email', SUBMISSION_LIMITS.EMAIL_MAX],
    ['phone', SUBMISSION_LIMITS.PHONE_MAX],
    ['phoneType', SUBMISSION_LIMITS.PHONE_TYPE_MAX],
    ['moveDate', SUBMISSION_LIMITS.MOVE_DATE_MAX],
    ['moveSize', SUBMISSION_LIMITS.MOVE_SIZE_MAX],
    ['companyName', SUBMISSION_LIMITS.COMPANY_NAME_MAX],
    ['notes', SUBMISSION_LIMITS.NOTES_MAX],
    ['referrer', SUBMISSION_LIMITS.REFERRER_MAX],
  ];
  for (const [field, max] of checks) {
    const err = checkStringField(body[field], field, max);
    if (err) return err;
  }

  // Addresses can be string or object
  const originErr = checkAddressField(body.origin, 'origin');
  if (originErr) return originErr;
  const destErr = checkAddressField(body.destination, 'destination');
  if (destErr) return destErr;

  // Honeypot: present-and-truthy is a bot signal. We don't reject (the caller
  // returns a silent 200) — but we still cap the size so a bot can't blast
  // through 10MB into rawPayload.
  if (body._hp_company !== undefined) {
    if (!isString(body._hp_company)) {
      return '_hp_company must be a string';
    }
    if (body._hp_company.length > SUBMISSION_LIMITS.HONEYPOT_MAX) {
      return '_hp_company exceeds limit';
    }
  }

  // UTM-like fields — normalize() collects any key matching utm_* or utmX*.
  // Cap their values to keep the persisted payload bounded.
  for (const key of keys) {
    if (/^utm[A-Z]/.test(key) || key.startsWith('utm_')) {
      const value = body[key];
      if (value === undefined || value === null) continue;
      if (!isString(value)) return `${key} must be a string`;
      if (value.length > SUBMISSION_LIMITS.UTM_VALUE_MAX) {
        return `${key} exceeds ${SUBMISSION_LIMITS.UTM_VALUE_MAX} characters`;
      }
    }
  }

  return null;
}
