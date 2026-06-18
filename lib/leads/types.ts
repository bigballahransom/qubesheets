// lib/leads/types.ts
import type { FieldKey } from '@/models/LeadFormConfig';
export type { FieldKey };

export interface NormalizedAddress {
  raw: string;        // human-readable formatted address
  placeId?: string;   // Google Places place_id
  lat?: number;
  lng?: number;
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
  utm?: Record<string, string>;
  referrer?: string;
  notes?: string;
}

export type LeadSource =
  | { kind: 'embed'; configId: string; ip?: string; userAgent?: string; referrer?: string }
  | { kind: 'api'; apiKeyId: string; organizationId: string };

export type PostSubmitAction =
  | { kind: 'inline-message'; message: string }
  | { kind: 'redirect-chooser'; uploadUrl: string }
  | { kind: 'schedule-call'; submissionId: string }
  // Customer-facing chooser that offers BOTH self-survey (Record / Photos)
  // AND schedule-a-call in the same view. The iframe holds both handles —
  // uploadUrl for the self-survey buttons and submissionId for the
  // scheduler — and dispatches based on which one the customer picks.
  | { kind: 'self-survey-or-schedule'; uploadUrl: string; submissionId: string };

export interface IngestResult {
  ok: true;
  projectId: string;
  customerId: string;
  submissionId: string;
  uploadToken?: string;
  action: PostSubmitAction;
}
