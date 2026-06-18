// lib/leads/crm/supermove.ts
import connectMongoDB from '@/lib/mongodb';
import SupermoveIntegration from '@/models/SupermoveIntegration';
import type { CrmAdapter, SendCtx, SendResult, ValidationResult } from './types';
import type { NormalizedLead } from '../types';
import type { ILeadFormConfig } from '@/models/LeadFormConfig';

// Tight cap so a slow webhook can't stall the customer's form submission.
const REQUEST_TIMEOUT_MS = 5_000;

function stripPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return undefined;
}

function deriveFullName(lead: NormalizedLead): string | undefined {
  if (lead.fullName) return lead.fullName;
  const parts = [lead.firstName, lead.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

export const supermove: CrmAdapter = {
  name: 'supermove',

  async isConfigured(orgId: string): Promise<boolean> {
    try {
      await connectMongoDB();
      const doc = await SupermoveIntegration.findOne({
        organizationId: orgId,
      }).lean();
      if (!doc) return false;
      const d = doc as { webhookUrl?: string; enabled?: boolean };
      return Boolean(d.webhookUrl) && d.enabled !== false;
    } catch (err) {
      console.error('[supermove.isConfigured] error', err);
      return false;
    }
  },

  validate(lead: NormalizedLead, config: ILeadFormConfig): ValidationResult {
    const fullName = deriveFullName(lead);
    if (!fullName) {
      return {
        ok: false,
        reason: 'Supermove requires fullName (or firstName + lastName)',
      };
    }
    const routing = config.crmRouting?.supermove;
    if (!routing?.projectType) {
      return {
        ok: false,
        reason: 'Supermove requires crmRouting.supermove.projectType',
      };
    }
    if (!routing?.jobType) {
      return {
        ok: false,
        reason: 'Supermove requires crmRouting.supermove.jobType',
      };
    }
    if (!lead.origin?.raw && !lead.destination?.raw) {
      return {
        ok: false,
        reason: 'Supermove requires at least one of origin or destination address',
      };
    }
    return { ok: true };
  },

  async send(
    lead: NormalizedLead,
    config: ILeadFormConfig,
    ctx: SendCtx
  ): Promise<SendResult> {
    try {
      await connectMongoDB();
      const integrationDoc = await SupermoveIntegration.findOne({
        organizationId: ctx.organizationId,
      }).lean();

      if (!integrationDoc) {
        return {
          ok: false,
          retriable: false,
          error: 'integration not configured or disabled',
        };
      }
      const integration = integrationDoc as {
        webhookUrl?: string;
        enabled?: boolean;
      };
      if (!integration.webhookUrl || integration.enabled === false) {
        return {
          ok: false,
          retriable: false,
          error: 'integration not configured or disabled',
        };
      }

      const routing = config.crmRouting?.supermove;
      if (!routing?.projectType || !routing?.jobType) {
        return {
          ok: false,
          retriable: false,
          error:
            'Supermove crmRouting.projectType and crmRouting.jobType are required',
        };
      }

      const fullName = deriveFullName(lead) ?? '';
      const phone = stripPhone(lead.phone);

      const primaryContact: Record<string, unknown> = {
        full_name: fullName,
      };
      if (lead.email) primaryContact.email = lead.email;
      if (phone) primaryContact.phone_number = phone;

      const locations: Array<Record<string, unknown>> = [];
      if (lead.origin?.raw) locations.push({ address: lead.origin.raw });
      if (lead.destination?.raw)
        locations.push({ address: lead.destination.raw });

      const job: Record<string, unknown> = {
        job_type: routing.jobType,
        locations,
      };
      if (lead.moveDate) job.date = lead.moveDate;

      const displayName = fullName || lead.email || 'New lead';

      const utm = lead.utm ?? {};
      const milestone: Record<string, unknown> = {
        kind: 'LEAD_CREATED',
        timestamp: new Date().toISOString(),
      };
      if (lead.referrer) milestone.referrer_url = lead.referrer;
      const utmSource = utm.utmSource ?? utm.utm_source ?? utm.source;
      if (utmSource) milestone.utm_source = utmSource;
      const utmMedium = utm.utmMedium ?? utm.utm_medium ?? utm.medium;
      if (utmMedium) milestone.utm_medium = utmMedium;
      const utmCampaign = utm.utmCampaign ?? utm.utm_campaign ?? utm.campaign;
      if (utmCampaign) milestone.utm_campaign = utmCampaign;
      const utmContent = utm.utmContent ?? utm.utm_content ?? utm.content;
      if (utmContent) milestone.utm_content = utmContent;
      const utmTerm =
        utm.utmKeyword ?? utm.utm_keyword ?? utm.utm_term ?? utm.term;
      if (utmTerm) milestone.utm_term = utmTerm;

      const body: Record<string, unknown> = {
        project_type: routing.projectType,
        client: {
          name: fullName,
          primary_contact: primaryContact,
        },
        jobs: [job],
        name: displayName,
        milestones: [milestone],
        is_test: false,
      };

      if (routing.salespersonEmail) {
        body.salesperson = { email: routing.salespersonEmail };
        body.coordinator = { email: routing.salespersonEmail };
      }

      if (lead.moveSize) {
        body.values = { PROJECT_SIZE: lead.moveSize };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

      let response: Response;
      try {
        response = await fetch(integration.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const rawText = await response.text();
      let parsed: unknown = undefined;
      if (rawText) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = rawText;
        }
      }

      if (!response.ok) {
        return {
          ok: false,
          retriable: response.status >= 500,
          error: `${response.status} ${rawText}`.trim(),
          raw: parsed,
        };
      }

      return { ok: true, externalId: '', raw: parsed };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unknown error in supermove.send';
      return { ok: false, retriable: true, error: message };
    }
  },
};
