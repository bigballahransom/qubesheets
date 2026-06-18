// lib/leads/crm/smartmoving.ts
import connectMongoDB from '@/lib/mongodb';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import type { CrmAdapter, SendCtx, SendResult, ValidationResult } from './types';
import type { NormalizedLead } from '../types';
import type { ILeadFormConfig } from '@/models/LeadFormConfig';

const SMARTMOVING_LEADS_URL =
  'https://api-public.smartmoving.com/v1/api/premium/leads';

// Tight cap so a slow CRM can't stall the customer's form submission.
// SmartMoving normally responds in 200-800ms; 5s covers their p99.
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Strip a normalized E.164 phone (e.g. "+15035551234") down to the 10-digit
 * national number SmartMoving expects. Falls back to the raw value if we can't
 * confidently strip it.
 */
function stripPhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits || undefined;
}

function pickUtm(utm: Record<string, string> | undefined): Record<string, string> {
  if (!utm) return {};
  const out: Record<string, string> = {};
  const map: Record<string, string> = {
    utmSource: utm.utmSource ?? utm.utm_source ?? utm.source ?? '',
    utmMedium: utm.utmMedium ?? utm.utm_medium ?? utm.medium ?? '',
    utmCampaign: utm.utmCampaign ?? utm.utm_campaign ?? utm.campaign ?? '',
    utmContent: utm.utmContent ?? utm.utm_content ?? utm.content ?? '',
    utmKeyword:
      utm.utmKeyword ?? utm.utm_keyword ?? utm.utm_term ?? utm.term ?? '',
    utmAdGroup: utm.utmAdGroup ?? utm.utm_adgroup ?? utm.adgroup ?? '',
    utmCustomTracking:
      utm.utmCustomTracking ?? utm.utm_custom_tracking ?? '',
  };
  for (const [k, v] of Object.entries(map)) {
    if (v) out[k] = v;
  }
  return out;
}

export const smartmoving: CrmAdapter = {
  name: 'smartmoving',

  async isConfigured(orgId: string): Promise<boolean> {
    try {
      await connectMongoDB();
      const doc = await SmartMovingIntegration.findOne({
        organizationId: orgId,
      }).lean();
      if (!doc) return false;
      const d = doc as { smartMovingApiKey?: string; smartMovingClientId?: string };
      return Boolean(d.smartMovingApiKey && d.smartMovingClientId);
    } catch (err) {
      console.error('[smartmoving.isConfigured] error', err);
      return false;
    }
  },

  validate(lead: NormalizedLead, _config: ILeadFormConfig): ValidationResult {
    const hasName =
      Boolean(lead.fullName) || Boolean(lead.firstName && lead.lastName);
    if (!hasName) {
      return {
        ok: false,
        reason: 'SmartMoving requires fullName or both firstName and lastName',
      };
    }
    if (!lead.phone && !lead.email) {
      return {
        ok: false,
        reason: 'SmartMoving requires either phone or email',
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
      const integrationDoc = await SmartMovingIntegration.findOne({
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
        smartMovingApiKey?: string;
        smartMovingClientId?: string;
        defaultReferralSourceId?: string;
      };

      if (!integration.smartMovingApiKey || !integration.smartMovingClientId) {
        return {
          ok: false,
          retriable: false,
          error: 'integration not configured',
        };
      }

      const routing = config.crmRouting?.smartmoving ?? {};

      const body: Record<string, unknown> = {};

      // Prefer the split first/last so SmartMoving stores them in their
      // proper fields. Fall back to fullName only when the consumer
      // (typically the legacy API path) didn't provide them.
      if (lead.firstName || lead.lastName) {
        if (lead.firstName) body.firstName = lead.firstName;
        if (lead.lastName) body.lastName = lead.lastName;
      } else if (lead.fullName) {
        body.fullName = lead.fullName;
      }

      const phone = stripPhone(lead.phone);
      if (phone) body.phoneNumber = phone;
      if (lead.phoneType) body.phoneType = lead.phoneType;
      if (lead.email) body.email = lead.email;
      if (lead.moveDate) body.moveDate = lead.moveDate;
      if (lead.origin?.raw) body.originAddressFull = lead.origin.raw;
      if (lead.destination?.raw)
        body.destinationAddressFull = lead.destination.raw;
      if (lead.moveSize) body.moveSize = lead.moveSize;
      if (lead.notes) body.notes = lead.notes;

      if (routing.referralSource) body.referralSource = routing.referralSource;
      if (integration.defaultReferralSourceId)
        body.referralSourceId = integration.defaultReferralSourceId;
      if (routing.serviceType) body.serviceType = routing.serviceType;
      if (routing.branchId) body.branchId = routing.branchId;

      const utm = pickUtm(lead.utm);
      for (const [k, v] of Object.entries(utm)) body[k] = v;

      if (!body.referralSource && !body.referralSourceId) {
        return {
          ok: false,
          retriable: false,
          error:
            'SmartMoving requires referralSource or referralSourceId — set one on the form config or integration defaults',
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

      let response: Response;
      try {
        response = await fetch(SMARTMOVING_LEADS_URL, {
          method: 'POST',
          headers: {
            'x-api-key': integration.smartMovingApiKey,
            'Ocp-Apim-Subscription-Key': integration.smartMovingClientId,
            'Content-Type': 'application/json',
          },
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

      const leadId =
        parsed && typeof parsed === 'object' && 'leadId' in parsed
          ? String((parsed as { leadId: unknown }).leadId ?? '')
          : '';

      return { ok: true, externalId: leadId, raw: parsed };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unknown error in smartmoving.send';
      return { ok: false, retriable: true, error: message };
    }
  },
};
