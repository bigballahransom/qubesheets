// lib/leads/crm/chariot.ts
import connectMongoDB from '@/lib/mongodb';
import ChariotIntegration, { chariotApiBaseUrl } from '@/models/ChariotIntegration';
import type { CrmAdapter, SendCtx, SendResult, ValidationResult } from './types';
import type { NormalizedLead } from '../types';
import type { ILeadFormConfig } from '@/models/LeadFormConfig';

// Tight cap so a slow CRM can't stall the customer's form submission.
const REQUEST_TIMEOUT_MS = 5_000;

function stripPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits || undefined;
}

function deriveFullName(lead: NormalizedLead): string | undefined {
  if (lead.fullName) return lead.fullName;
  const parts = [lead.firstName, lead.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

export const chariot: CrmAdapter = {
  name: 'chariot',

  async isConfigured(orgId: string): Promise<boolean> {
    try {
      await connectMongoDB();
      const doc = await ChariotIntegration.findOne({
        organizationId: orgId,
      }).lean();
      if (!doc) return false;
      const d = doc as { authToken?: string; clientSubdomain?: string; enabled?: boolean };
      return Boolean(d.authToken && d.clientSubdomain) && d.enabled !== false;
    } catch (err) {
      console.error('[chariot.isConfigured] error', err);
      return false;
    }
  },

  validate(lead: NormalizedLead, _config: ILeadFormConfig): ValidationResult {
    const hasName = Boolean(deriveFullName(lead));
    if (!hasName) {
      return {
        ok: false,
        reason: 'Chariot requires fullName (or firstName + lastName)',
      };
    }
    if (!lead.phone && !lead.email) {
      return {
        ok: false,
        reason: 'Chariot requires either phone or email',
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
      const integrationDoc = await ChariotIntegration.findOne({
        organizationId: ctx.organizationId,
      }).lean();

      if (!integrationDoc) {
        return {
          ok: false,
          retriable: false,
          error: 'integration not configured',
        };
      }
      const integration = integrationDoc as {
        clientSubdomain?: string;
        authToken?: string;
        accountId?: string;
        enabled?: boolean;
      };

      if (!integration.clientSubdomain || !integration.authToken || integration.enabled === false) {
        return {
          ok: false,
          retriable: false,
          error: 'integration not configured or disabled',
        };
      }

      const routing = config.crmRouting?.chariot ?? {};
      const fullName = deriveFullName(lead) ?? '';
      const phone = stripPhone(lead.phone);

      // Lead payload mirrors SmartMoving/Supermove transforms. Chariot's
      // /api/external/lead accepts arbitrary fields; we keep the shape
      // conservative until the partner publishes a full schema.
      const body: Record<string, unknown> = {
        name: fullName,
      };
      if (lead.firstName) body.first_name = lead.firstName;
      if (lead.lastName) body.last_name = lead.lastName;
      if (phone) body.phone_number = phone;
      if (lead.phoneType) body.phone_type = lead.phoneType;
      if (lead.email) body.email = lead.email;
      if (lead.moveDate) body.move_date = lead.moveDate;
      if (lead.moveSize) body.move_size = lead.moveSize;
      if (lead.origin?.raw) body.origin_address = lead.origin.raw;
      if (lead.destination?.raw) body.destination_address = lead.destination.raw;
      if (lead.notes) body.notes = lead.notes;
      if (routing.referralSource) body.referral_source = routing.referralSource;
      if (routing.salespersonEmail) body.salesperson_email = routing.salespersonEmail;

      const utm = lead.utm ?? {};
      const utmSource = utm.utmSource ?? utm.utm_source ?? utm.source;
      const utmMedium = utm.utmMedium ?? utm.utm_medium ?? utm.medium;
      const utmCampaign = utm.utmCampaign ?? utm.utm_campaign ?? utm.campaign;
      const utmContent = utm.utmContent ?? utm.utm_content ?? utm.content;
      const utmTerm = utm.utmKeyword ?? utm.utm_keyword ?? utm.utm_term ?? utm.term;
      const utmObj: Record<string, string> = {};
      if (utmSource) utmObj.utm_source = utmSource;
      if (utmMedium) utmObj.utm_medium = utmMedium;
      if (utmCampaign) utmObj.utm_campaign = utmCampaign;
      if (utmContent) utmObj.utm_content = utmContent;
      if (utmTerm) utmObj.utm_term = utmTerm;
      if (Object.keys(utmObj).length > 0) body.utm = utmObj;
      if (lead.referrer) body.referrer_url = lead.referrer;

      // Chariot supports both header auth (X-Account-Id / X-Auth-Token) and
      // in-payload meta auth. Send headers; include meta as a belt-and-braces
      // fallback for endpoints that only support payload auth.
      const meta: Record<string, string> = { auth_token: integration.authToken };
      if (integration.accountId) meta.account_id = integration.accountId;
      body.meta = meta;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Auth-Token': integration.authToken,
      };
      if (integration.accountId) headers['X-Account-Id'] = integration.accountId;

      const url = `${chariotApiBaseUrl(integration.clientSubdomain)}/lead`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
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

      // Chariot's lead endpoint may not return a structured ID; surface the
      // best candidate we can find and fall back to empty string.
      let externalId = '';
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        const candidate = obj.id ?? obj.lead_id ?? obj.leadId ?? obj.uuid;
        if (candidate !== undefined && candidate !== null) externalId = String(candidate);
      }

      return { ok: true, externalId, raw: parsed };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unknown error in chariot.send';
      return { ok: false, retriable: true, error: message };
    }
  },
};
