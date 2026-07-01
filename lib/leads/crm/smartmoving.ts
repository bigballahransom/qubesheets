// lib/leads/crm/smartmoving.ts
import connectMongoDB from '@/lib/mongodb';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import {
  fetchReferralSources,
  pickDefaultReferralSource,
} from '@/lib/smartmoving/referenceData';
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

interface PostLeadAttempt {
  ok: boolean;
  status: number;
  rawText: string;
  parsed: unknown;
}

async function postLead(
  apiKey: string,
  clientId: string,
  body: Record<string, unknown>,
): Promise<PostLeadAttempt> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(SMARTMOVING_LEADS_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
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
  return { ok: response.ok, status: response.status, rawText, parsed };
}

/**
 * SmartMoving returns 400 with a body like
 *   "Unable to resolve referral source. Provide ReferralSource, ReferralSourceId..."
 * when either the referralSource string doesn't match any source in the
 * tenant or the referralSourceId points at a source that no longer exists.
 * Match on the phrase rather than the exact wording so minor upstream
 * copy changes don't defeat the self-heal.
 */
function isUnresolvedReferralSourceError(
  rawText: string,
  status: number,
): boolean {
  if (status !== 400) return false;
  return /resolve\s+referral\s+source/i.test(rawText);
}

/**
 * Refresh referral sources from SmartMoving, pick a new sensible default,
 * persist it on the integration if it changed, and hand the id back so the
 * caller can retry. Returns null when nothing usable was found OR when the
 * pick matches the id that just failed (retrying would fail identically).
 */
async function healReferralSource(params: {
  organizationId: string;
  apiKey: string;
  clientId: string;
  currentDefaultId?: string;
  failedWithReferralSourceId?: string;
}): Promise<string | null> {
  try {
    const sources = await fetchReferralSources(params.apiKey, params.clientId);
    if (sources.length === 0) return null;
    const pick = pickDefaultReferralSource(sources);
    if (!pick) return null;
    // If we just tried this exact id and got the unresolved error, retrying
    // would fail the same way. Bail so the caller returns the original error.
    if (pick.id === params.failedWithReferralSourceId) return null;
    if (pick.id !== params.currentDefaultId) {
      await SmartMovingIntegration.updateOne(
        { organizationId: params.organizationId },
        { $set: { defaultReferralSourceId: pick.id } },
      );
    }
    return pick.id;
  } catch (err) {
    console.error('[smartmoving.healReferralSource] failed', err);
    return null;
  }
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

      // SmartMoving rejects requests that carry both referralSource and
      // referralSourceId ("You cannot specify both..."). Form-level routing
      // wins when set; otherwise fall back to the integration default.
      if (routing.referralSource) {
        body.referralSource = routing.referralSource;
      } else if (integration.defaultReferralSourceId) {
        body.referralSourceId = integration.defaultReferralSourceId;
      }
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

      let attempt = await postLead(
        integration.smartMovingApiKey,
        integration.smartMovingClientId!,
        body,
      );

      // Self-heal: if SmartMoving can't resolve the referral source (either
      // the form-level name doesn't match any source in the tenant, or the
      // stored defaultReferralSourceId is stale), fetch the live list, pick a
      // fresh default, save it back to the integration, and retry once with
      // the new ID. Keeps lead capture working even when config drifts.
      if (
        !attempt.ok &&
        isUnresolvedReferralSourceError(attempt.rawText, attempt.status)
      ) {
        const failedWithReferralSourceId =
          typeof body.referralSourceId === 'string'
            ? body.referralSourceId
            : undefined;
        const healed = await healReferralSource({
          organizationId: ctx.organizationId,
          apiKey: integration.smartMovingApiKey,
          clientId: integration.smartMovingClientId!,
          currentDefaultId: integration.defaultReferralSourceId,
          failedWithReferralSourceId,
        });
        if (healed) {
          delete body.referralSource;
          body.referralSourceId = healed;
          attempt = await postLead(
            integration.smartMovingApiKey,
            integration.smartMovingClientId!,
            body,
          );
        }
      }

      if (!attempt.ok) {
        return {
          ok: false,
          retriable: attempt.status >= 500,
          error: `${attempt.status} ${attempt.rawText}`.trim(),
          raw: attempt.parsed,
        };
      }

      const leadId =
        attempt.parsed && typeof attempt.parsed === 'object' && 'leadId' in attempt.parsed
          ? String((attempt.parsed as { leadId: unknown }).leadId ?? '')
          : '';

      return { ok: true, externalId: leadId, raw: attempt.parsed };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unknown error in smartmoving.send';
      return { ok: false, retriable: true, error: message };
    }
  },
};
