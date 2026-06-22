// lib/leads/validateConfig.ts
//
// Defensive validation for /api/embedded-forms POST + PATCH bodies. Mongoose
// will accept arbitrary payloads as long as the schema doesn't reject them,
// and a buggy or malicious admin can otherwise stuff multi-megabyte blobs
// into the document. This module enforces type + length + count caps so the
// surface stays predictable.
//
// Returns `null` on success or a short human-readable error string on failure.
// Callers turn the error into a 400 response.

import type { FieldKey } from '@/models/LeadFormConfig';

export const CONFIG_LIMITS = {
  NAME_MAX: 200,
  THEME_TITLE_MAX: 200,
  THEME_SUBTITLE_MAX: 500,
  THEME_BUTTON_TEXT_MAX: 80,
  THEME_BUTTON_COLOR_MAX: 30,
  LOGO_URL_MAX: 2000,
  INLINE_MESSAGE_MAX: 5000,
  CRM_FIELD_MAX: 200,
  ALLOWED_DOMAINS_MAX: 20,
  DOMAIN_MAX: 200,
  RATE_PER_HOUR_MIN: 1,
  RATE_PER_HOUR_MAX: 1000,
  FIELDS_MAX: 50,
  MOVE_SIZE_OPTIONS_MAX: 50,
  MOVE_SIZE_OPTION_MAX: 100,
  MOVE_SIZE_ROUTING_MAX: 50,
  STEPS_MAX: 10,
  STEP_HEADING_MAX: 200,
  ASSIGNEES_MAX: 50,
  ASSIGNEE_ID_MAX: 100,
  TIMEZONE_MAX: 100,
  HOURS_TIME_MAX: 10, // "HH:MM" — give a little slack
} as const;

const VALID_FIELD_KEYS: ReadonlySet<FieldKey> = new Set([
  'firstName', 'lastName', 'fullName', 'email', 'phone', 'phoneType',
  'moveDate', 'moveSize', 'origin', 'destination', 'companyName',
]);

const VALID_POST_SUBMIT_KINDS = new Set([
  'inline-message',
  'redirect-chooser',
  'schedule-call',
  'self-survey-or-schedule',
  'business-hours',
]);

const VALID_TERMINAL_KINDS = new Set([
  'inline-message',
  'redirect-chooser',
  'schedule-call',
  'self-survey-or-schedule',
]);

const VALID_SLOT_MINUTES = new Set([15, 30, 45, 60]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// --- Field-by-field validators ---------------------------------------------

function validateName(v: unknown): string | null {
  if (!isString(v) || !v.trim()) return 'name must be a non-empty string';
  if (v.length > CONFIG_LIMITS.NAME_MAX) {
    return `name exceeds ${CONFIG_LIMITS.NAME_MAX} characters`;
  }
  return null;
}

function validateTheme(v: unknown): string | null {
  if (!isObject(v)) return 'theme must be an object';
  if (!isString(v.title) || !v.title.trim()) return 'theme.title must be a non-empty string';
  if (v.title.length > CONFIG_LIMITS.THEME_TITLE_MAX) {
    return `theme.title exceeds ${CONFIG_LIMITS.THEME_TITLE_MAX} characters`;
  }
  if (v.subtitle !== undefined) {
    if (!isString(v.subtitle)) return 'theme.subtitle must be a string';
    if (v.subtitle.length > CONFIG_LIMITS.THEME_SUBTITLE_MAX) {
      return `theme.subtitle exceeds ${CONFIG_LIMITS.THEME_SUBTITLE_MAX} characters`;
    }
  }
  if (v.buttonText !== undefined) {
    if (!isString(v.buttonText)) return 'theme.buttonText must be a string';
    if (v.buttonText.length > CONFIG_LIMITS.THEME_BUTTON_TEXT_MAX) {
      return `theme.buttonText exceeds ${CONFIG_LIMITS.THEME_BUTTON_TEXT_MAX} characters`;
    }
  }
  if (v.buttonColor !== undefined) {
    if (!isString(v.buttonColor)) return 'theme.buttonColor must be a string';
    if (v.buttonColor.length > CONFIG_LIMITS.THEME_BUTTON_COLOR_MAX) {
      return `theme.buttonColor exceeds ${CONFIG_LIMITS.THEME_BUTTON_COLOR_MAX} characters`;
    }
  }
  if (v.logoUrl !== undefined) {
    if (!isString(v.logoUrl)) return 'theme.logoUrl must be a string';
    if (v.logoUrl.length > CONFIG_LIMITS.LOGO_URL_MAX) {
      return `theme.logoUrl exceeds ${CONFIG_LIMITS.LOGO_URL_MAX} characters`;
    }
  }
  return null;
}

function validateFields(v: unknown): string | null {
  if (!Array.isArray(v)) return 'fields must be an array';
  if (v.length > CONFIG_LIMITS.FIELDS_MAX) {
    return `fields exceeds ${CONFIG_LIMITS.FIELDS_MAX} entries`;
  }
  for (let i = 0; i < v.length; i++) {
    const f = v[i];
    if (!isObject(f)) return `fields[${i}] must be an object`;
    if (!isString(f.id) || !VALID_FIELD_KEYS.has(f.id as FieldKey)) {
      return `fields[${i}].id must be one of: ${Array.from(VALID_FIELD_KEYS).join(', ')}`;
    }
    if (!isBoolean(f.enabled)) return `fields[${i}].enabled must be a boolean`;
    if (!isBoolean(f.required)) return `fields[${i}].required must be a boolean`;
  }
  return null;
}

function validateCrmRouting(v: unknown): string | null {
  if (v === null) return null;
  if (!isObject(v)) return 'crmRouting must be an object';

  if (v.smartmoving !== undefined) {
    const sm = v.smartmoving;
    if (!isObject(sm)) return 'crmRouting.smartmoving must be an object';
    for (const key of ['branchId', 'referralSource', 'serviceType'] as const) {
      if (sm[key] !== undefined) {
        if (!isString(sm[key])) return `crmRouting.smartmoving.${key} must be a string`;
        if ((sm[key] as string).length > CONFIG_LIMITS.CRM_FIELD_MAX) {
          return `crmRouting.smartmoving.${key} exceeds ${CONFIG_LIMITS.CRM_FIELD_MAX} characters`;
        }
      }
    }
  }

  if (v.supermove !== undefined) {
    const sv = v.supermove;
    if (!isObject(sv)) return 'crmRouting.supermove must be an object';
    // projectType + jobType are required by the Supermove adapter — surface the
    // problem early so the editor's save button can flag it.
    if (!isString(sv.projectType) || !sv.projectType.trim()) {
      return 'crmRouting.supermove.projectType must be a non-empty string';
    }
    if (!isString(sv.jobType) || !sv.jobType.trim()) {
      return 'crmRouting.supermove.jobType must be a non-empty string';
    }
    for (const key of ['projectType', 'jobType', 'salespersonEmail'] as const) {
      if (sv[key] !== undefined) {
        if (!isString(sv[key])) return `crmRouting.supermove.${key} must be a string`;
        if ((sv[key] as string).length > CONFIG_LIMITS.CRM_FIELD_MAX) {
          return `crmRouting.supermove.${key} exceeds ${CONFIG_LIMITS.CRM_FIELD_MAX} characters`;
        }
      }
    }
  }
  return null;
}

function validateBusinessHours(v: unknown, path: string): string | null {
  if (!isObject(v)) return `${path} must be an object`;
  if (!isString(v.startTime) || v.startTime.length > CONFIG_LIMITS.HOURS_TIME_MAX) {
    return `${path}.startTime must be a short HH:MM string`;
  }
  if (!isString(v.endTime) || v.endTime.length > CONFIG_LIMITS.HOURS_TIME_MAX) {
    return `${path}.endTime must be a short HH:MM string`;
  }
  if (!isString(v.timezone) || v.timezone.length > CONFIG_LIMITS.TIMEZONE_MAX) {
    return `${path}.timezone must be a string up to ${CONFIG_LIMITS.TIMEZONE_MAX} characters`;
  }
  if (!Array.isArray(v.days)) return `${path}.days must be an array`;
  if (v.days.length > 7) return `${path}.days has too many entries`;
  for (const d of v.days) {
    if (!isFiniteNumber(d) || d < 0 || d > 6 || !Number.isInteger(d)) {
      return `${path}.days entries must be integers 0-6`;
    }
  }
  return null;
}

function validateTerminalAction(v: unknown, path: string): string | null {
  if (!isObject(v)) return `${path} must be an object`;
  if (!isString(v.kind) || !VALID_TERMINAL_KINDS.has(v.kind)) {
    return `${path}.kind must be one of: ${Array.from(VALID_TERMINAL_KINDS).join(', ')}`;
  }
  if (v.kind === 'inline-message') {
    if (!isString(v.message)) return `${path}.message must be a string`;
    if (v.message.length > CONFIG_LIMITS.INLINE_MESSAGE_MAX) {
      return `${path}.message exceeds ${CONFIG_LIMITS.INLINE_MESSAGE_MAX} characters`;
    }
  }
  return null;
}

function validatePostSubmit(v: unknown): string | null {
  if (!isObject(v)) return 'postSubmit must be an object';
  if (!isString(v.kind) || !VALID_POST_SUBMIT_KINDS.has(v.kind)) {
    return `postSubmit.kind must be one of: ${Array.from(VALID_POST_SUBMIT_KINDS).join(', ')}`;
  }
  if (v.kind === 'business-hours') {
    const during = validateTerminalAction(v.duringHours, 'postSubmit.duringHours');
    if (during) return during;
    const after = validateTerminalAction(v.afterHours, 'postSubmit.afterHours');
    if (after) return after;
    const hours = validateBusinessHours(v.hours, 'postSubmit.hours');
    if (hours) return hours;
    return null;
  }
  return validateTerminalAction(v, 'postSubmit');
}

function validateAbuse(v: unknown): string | null {
  if (v === null) return null;
  if (!isObject(v)) return 'abuse must be an object';
  if (v.domainAllowlist !== undefined) {
    if (!Array.isArray(v.domainAllowlist)) return 'abuse.domainAllowlist must be an array';
    if (v.domainAllowlist.length > CONFIG_LIMITS.ALLOWED_DOMAINS_MAX) {
      return `abuse.domainAllowlist exceeds ${CONFIG_LIMITS.ALLOWED_DOMAINS_MAX} entries`;
    }
    for (const d of v.domainAllowlist) {
      if (!isString(d)) return 'abuse.domainAllowlist entries must be strings';
      if (d.length > CONFIG_LIMITS.DOMAIN_MAX) {
        return `abuse.domainAllowlist entry exceeds ${CONFIG_LIMITS.DOMAIN_MAX} characters`;
      }
    }
  }
  if (v.ratePerIpPerHour !== undefined) {
    if (!isFiniteNumber(v.ratePerIpPerHour) || !Number.isInteger(v.ratePerIpPerHour)) {
      return 'abuse.ratePerIpPerHour must be an integer';
    }
    if (
      v.ratePerIpPerHour < CONFIG_LIMITS.RATE_PER_HOUR_MIN ||
      v.ratePerIpPerHour > CONFIG_LIMITS.RATE_PER_HOUR_MAX
    ) {
      return `abuse.ratePerIpPerHour must be between ${CONFIG_LIMITS.RATE_PER_HOUR_MIN} and ${CONFIG_LIMITS.RATE_PER_HOUR_MAX}`;
    }
  }
  return null;
}

function validateSchedulingSettings(v: unknown): string | null {
  if (v === null) return null;
  if (!isObject(v)) return 'schedulingSettings must be an object';
  if (v.hours !== undefined) {
    const err = validateBusinessHours(v.hours, 'schedulingSettings.hours');
    if (err) return err;
  }
  if (v.slotMinutes !== undefined) {
    if (!isFiniteNumber(v.slotMinutes) || !VALID_SLOT_MINUTES.has(v.slotMinutes)) {
      return `schedulingSettings.slotMinutes must be one of: ${Array.from(VALID_SLOT_MINUTES).join(', ')}`;
    }
  }
  for (const [key, max] of [
    ['maxConcurrentPerSlot', 50],
    ['leadTimeHours', 168],
    ['advanceWindowDays', 60],
  ] as const) {
    if (v[key] !== undefined) {
      if (!isFiniteNumber(v[key]) || !Number.isInteger(v[key])) {
        return `schedulingSettings.${key} must be an integer`;
      }
      const n = v[key] as number;
      if (n < 0 || n > max) {
        return `schedulingSettings.${key} must be between 0 and ${max}`;
      }
    }
  }
  if (v.assigneeUserIds !== undefined) {
    if (!Array.isArray(v.assigneeUserIds)) return 'schedulingSettings.assigneeUserIds must be an array';
    if (v.assigneeUserIds.length > CONFIG_LIMITS.ASSIGNEES_MAX) {
      return `schedulingSettings.assigneeUserIds exceeds ${CONFIG_LIMITS.ASSIGNEES_MAX} entries`;
    }
    for (const id of v.assigneeUserIds) {
      if (!isString(id)) return 'schedulingSettings.assigneeUserIds entries must be strings';
      if (id.length > CONFIG_LIMITS.ASSIGNEE_ID_MAX) {
        return `schedulingSettings.assigneeUserIds entry exceeds ${CONFIG_LIMITS.ASSIGNEE_ID_MAX} characters`;
      }
    }
  }
  return null;
}

function validateMoveSizeOptions(v: unknown): string | null {
  if (v === null) return null;
  if (!Array.isArray(v)) return 'moveSizeOptions must be an array';
  if (v.length > CONFIG_LIMITS.MOVE_SIZE_OPTIONS_MAX) {
    return `moveSizeOptions exceeds ${CONFIG_LIMITS.MOVE_SIZE_OPTIONS_MAX} entries`;
  }
  for (const opt of v) {
    if (!isString(opt)) return 'moveSizeOptions entries must be strings';
    if (opt.length > CONFIG_LIMITS.MOVE_SIZE_OPTION_MAX) {
      return `moveSizeOptions entry exceeds ${CONFIG_LIMITS.MOVE_SIZE_OPTION_MAX} characters`;
    }
  }
  return null;
}

function validateSteps(v: unknown): string | null {
  if (v === null) return null;
  if (!Array.isArray(v)) return 'steps must be an array';
  if (v.length > CONFIG_LIMITS.STEPS_MAX) {
    return `steps exceeds ${CONFIG_LIMITS.STEPS_MAX} entries`;
  }
  const seenFields = new Set<string>();
  for (let i = 0; i < v.length; i++) {
    const step = v[i];
    if (!isObject(step)) return `steps[${i}] must be an object`;
    if (step.heading !== undefined) {
      if (!isString(step.heading)) return `steps[${i}].heading must be a string`;
      if (step.heading.length > CONFIG_LIMITS.STEP_HEADING_MAX) {
        return `steps[${i}].heading exceeds ${CONFIG_LIMITS.STEP_HEADING_MAX} characters`;
      }
    }
    if (!Array.isArray(step.fields)) {
      return `steps[${i}].fields must be an array`;
    }
    if (step.fields.length > VALID_FIELD_KEYS.size) {
      return `steps[${i}].fields has too many entries`;
    }
    for (const f of step.fields) {
      if (!isString(f) || !VALID_FIELD_KEYS.has(f as FieldKey)) {
        return `steps[${i}].fields contains an unknown field "${String(f)}"`;
      }
      // A field can live on at most one step — otherwise the same input
      // would render twice, with two pieces of state and ambiguous validation.
      if (seenFields.has(f)) {
        return `field "${f}" appears on multiple steps; each field belongs to at most one step`;
      }
      seenFields.add(f);
    }
  }
  return null;
}

function validateMoveSizeRouting(v: unknown): string | null {
  if (v === null) return null;
  if (!Array.isArray(v)) return 'moveSizeRouting must be an array';
  if (v.length > CONFIG_LIMITS.MOVE_SIZE_ROUTING_MAX) {
    return `moveSizeRouting exceeds ${CONFIG_LIMITS.MOVE_SIZE_ROUTING_MAX} entries`;
  }
  for (let i = 0; i < v.length; i++) {
    const rule = v[i];
    if (!isObject(rule)) return `moveSizeRouting[${i}] must be an object`;
    if (!isString(rule.option)) return `moveSizeRouting[${i}].option must be a string`;
    if (rule.option.length > CONFIG_LIMITS.MOVE_SIZE_OPTION_MAX) {
      return `moveSizeRouting[${i}].option exceeds ${CONFIG_LIMITS.MOVE_SIZE_OPTION_MAX} characters`;
    }
    if (!isString(rule.kind) || !VALID_TERMINAL_KINDS.has(rule.kind)) {
      return `moveSizeRouting[${i}].kind must be one of: ${Array.from(VALID_TERMINAL_KINDS).join(', ')}`;
    }
  }
  return null;
}

// --- Public API ------------------------------------------------------------

/**
 * Validate a body for the embedded-forms PATCH route. Every field is optional
 * — only fields actually present in `body` are checked. Use this AFTER the
 * route has decided which fields the caller is allowed to update.
 */
export function validateConfigPatch(body: Record<string, unknown>): string | null {
  if (body.name !== undefined) {
    const err = validateName(body.name);
    if (err) return err;
  }
  if (body.isActive !== undefined && !isBoolean(body.isActive)) {
    return 'isActive must be a boolean';
  }
  if (body.crmRouting !== undefined) {
    const err = validateCrmRouting(body.crmRouting);
    if (err) return err;
  }
  if (body.fields !== undefined) {
    const err = validateFields(body.fields);
    if (err) return err;
  }
  if (body.postSubmit !== undefined) {
    const err = validatePostSubmit(body.postSubmit);
    if (err) return err;
  }
  if (body.theme !== undefined) {
    const err = validateTheme(body.theme);
    if (err) return err;
  }
  if (body.abuse !== undefined) {
    const err = validateAbuse(body.abuse);
    if (err) return err;
  }
  if (body.schedulingSettings !== undefined) {
    const err = validateSchedulingSettings(body.schedulingSettings);
    if (err) return err;
  }
  if (body.moveSizeOptions !== undefined) {
    const err = validateMoveSizeOptions(body.moveSizeOptions);
    if (err) return err;
  }
  if (body.moveSizeRouting !== undefined) {
    const err = validateMoveSizeRouting(body.moveSizeRouting);
    if (err) return err;
  }
  if (body.steps !== undefined) {
    const err = validateSteps(body.steps);
    if (err) return err;
  }
  return null;
}

/**
 * Validate a body for the embedded-forms POST (create) route. Same field-by-
 * field caps as PATCH, but `name`, `theme`, and `postSubmit` are required.
 */
export function validateConfigCreate(body: Record<string, unknown>): string | null {
  if (body.name === undefined) return 'name is required';
  if (body.theme === undefined) return 'theme is required';
  if (body.postSubmit === undefined) return 'postSubmit is required';
  return validateConfigPatch(body);
}
