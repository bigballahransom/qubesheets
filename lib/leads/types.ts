// lib/leads/types.ts
import type { FieldKey } from '@/models/LeadFormConfig';
export type { FieldKey };

export interface NormalizedAddress {
  raw: string;        // human-readable formatted address
  placeId?: string;   // Google Places place_id
  lat?: number;
  lng?: number;
}

// Snapshot of a custom-field answer. The label is captured at submit time so
// renaming or deleting the custom field later doesn't orphan old submissions.
export interface NormalizedCustomFieldValue {
  id: string;
  label: string;
  value: string;
}

export interface NormalizedLead {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;          // E.164 format (+1XXXXXXXXXX) after normalize step
  phoneType?: 'mobile' | 'home' | 'work';
  moveDate?: string;       // YYYY-MM-DD
  moveSize?: string;
  origin?: NormalizedAddress;
  destination?: NormalizedAddress;
  companyName?: string;
  // Admin-defined custom fields, in the form's configured order. Captured by
  // Qube Sheets only — the CRM adapters ignore this.
  custom?: NormalizedCustomFieldValue[];
  utm?: Record<string, string>;
  referrer?: string;
  notes?: string;
}

export type LeadSource =
  | { kind: 'embed'; configId: string; ip?: string; userAgent?: string; referrer?: string }
  | { kind: 'api'; apiKeyId: string; organizationId: string };

// `schedulerUrl` on the scheduler-bearing kinds is the hosted standalone
// scheduler page (/schedule-call/[submissionId]) — third-party integrations
// (JS plugin onSuccess) link customers there instead of embedding our
// scheduler UI. `submissionId` remains for callers building their own
// scheduler against the public schedule-call API.
export type PostSubmitAction =
  | { kind: 'inline-message'; message: string }
  | { kind: 'redirect-chooser'; uploadUrl: string }
  | { kind: 'schedule-call'; submissionId: string; schedulerUrl: string }
  // Customer-facing chooser that offers BOTH self-survey (Record / Photos)
  // AND schedule-a-call in the same view. The iframe holds both handles —
  // uploadUrl for the self-survey buttons and submissionId for the
  // scheduler — and dispatches based on which one the customer picks. The
  // hosted chooser at uploadUrl offers all three options itself, so plain
  // redirects (JS plugin default) also get the full choice.
  | {
      kind: 'self-survey-or-schedule';
      uploadUrl: string;
      submissionId: string;
      schedulerUrl: string;
    };

export interface IngestResult {
  ok: true;
  projectId: string;
  customerId: string;
  submissionId: string;
  uploadToken?: string;
  action: PostSubmitAction;
}
