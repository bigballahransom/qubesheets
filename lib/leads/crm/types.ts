// lib/leads/crm/types.ts
import type { NormalizedLead } from '../types';
import type { ILeadFormConfig } from '@/models/LeadFormConfig';
import type { LeadSyncDestination } from '@/models/LeadSyncAttempt';

export interface SendCtx {
  organizationId: string;
  projectId: string;
  customerId: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export type SendResult =
  | { ok: true; externalId: string; raw?: unknown }
  | { ok: false; retriable: boolean; error: string; raw?: unknown };

export interface CrmAdapter {
  readonly name: LeadSyncDestination;
  // Cheap check: are credentials present in the integration model for this org?
  isConfigured(orgId: string): Promise<boolean>;
  // Sync, pure validation: are the lead + config sufficient to attempt send?
  validate(lead: NormalizedLead, config: ILeadFormConfig): ValidationResult;
  // The actual send. Must never throw — return SendResult.
  send(lead: NormalizedLead, config: ILeadFormConfig, ctx: SendCtx): Promise<SendResult>;
}
