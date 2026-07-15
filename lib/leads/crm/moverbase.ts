// lib/leads/crm/moverbase.ts
import connectMongoDB from '@/lib/mongodb';
import MoverbaseIntegration, {
  MOVERBASE_API_BASE,
  moverbaseAuthHeader,
} from '@/models/MoverbaseIntegration';
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

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

// Split a full name when the lead lacks explicit first/last. Moverbase has no
// single-name field, so everything after the first token becomes the last name.
function deriveNameParts(lead: NormalizedLead): { firstName?: string; lastName?: string } {
  if (lead.firstName || lead.lastName) {
    return { firstName: lead.firstName, lastName: lead.lastName };
  }
  const full = (lead.fullName || '').trim();
  if (!full) return {};
  const tokens = full.split(/\s+/);
  if (tokens.length === 1) return { firstName: tokens[0] };
  return { firstName: tokens[0], lastName: tokens.slice(1).join(' ') };
}

// Map free-text move size (e.g. "2 Bedroom House", "Studio Apartment") to
// Moverbase's size enum. Unknown sizes are omitted (Moverbase defaults to N/A).
function mapMoveSize(moveSize?: string): number | undefined {
  if (!moveSize) return undefined;
  const s = moveSize.toLowerCase();

  if (s.includes('office')) return s.includes('large') ? 102 : 101;
  if (s.includes('studio')) return s.includes('large') ? 2 : 1;

  const bedroomMatch = s.match(/(\d+)\s*(?:\+)?\s*(?:bed|br\b)/);
  if (!bedroomMatch) return undefined;
  const bedrooms = parseInt(bedroomMatch[1], 10);
  const isHouse = s.includes('house') || s.includes('home') || s.includes('town');

  if (isHouse) {
    if (bedrooms <= 2) return 10;
    if (bedrooms === 3) return 11;
    return 12;
  }
  if (bedrooms === 1) return 3;
  if (bedrooms === 2) return 5;
  if (bedrooms === 3) return 7;
  if (bedrooms >= 4) return 9;
  return undefined;
}

// Moverbase from/to are structured address objects; our normalized leads carry
// a raw formatted string. Extract "City, ST 12345" conservatively — a wrong
// structured address is worse than none.
function parseAddress(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  const cityStateZip = raw.match(/(?:^|,)\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?(?:,|$)/);
  if (cityStateZip) {
    return {
      city: cityStateZip[1].trim().slice(0, 25),
      state: cityStateZip[2],
      postalCode: cityStateZip[3],
      country: 'US',
    };
  }
  const zipOnly = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipOnly) {
    return { postalCode: zipOnly[1], country: 'US' };
  }
  return undefined;
}

export const moverbase: CrmAdapter = {
  name: 'moverbase',

  async isConfigured(orgId: string): Promise<boolean> {
    try {
      await connectMongoDB();
      const doc = await MoverbaseIntegration.findOne({
        organizationId: orgId,
      }).lean();
      if (!doc) return false;
      const d = doc as { apiKey?: string; enabled?: boolean };
      return Boolean(d.apiKey) && d.enabled !== false;
    } catch (err) {
      console.error('[moverbase.isConfigured] error', err);
      return false;
    }
  },

  validate(lead: NormalizedLead, _config: ILeadFormConfig): ValidationResult {
    const { firstName } = deriveNameParts(lead);
    if (!firstName) {
      return {
        ok: false,
        reason: 'Moverbase requires a name (fullName or firstName)',
      };
    }
    if (!lead.phone && !lead.email) {
      return {
        ok: false,
        reason: 'Moverbase requires either phone or email',
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
      const integrationDoc = await MoverbaseIntegration.findOne({
        organizationId: ctx.organizationId,
      }).lean();

      if (!integrationDoc) {
        return {
          ok: false,
          retriable: false,
          error: 'integration not configured',
        };
      }
      const integration = integrationDoc as { apiKey?: string; enabled?: boolean };
      if (!integration.apiKey || integration.enabled === false) {
        return {
          ok: false,
          retriable: false,
          error: 'integration not configured or disabled',
        };
      }

      const routing = config.crmRouting?.moverbase ?? {};
      const { firstName, lastName } = deriveNameParts(lead);

      // Moverbase enforces hard per-field length limits (see developers.moverbase.com,
      // Leads Resource) — truncate rather than let the whole lead 400.
      const body: Record<string, unknown> = {};
      if (firstName) body.firstName = truncate(firstName, 20);
      if (lastName) body.lastName = truncate(lastName, 25);
      if (lead.companyName) body.companyName = truncate(lead.companyName, 25);
      const phone = stripPhone(lead.phone);
      if (phone) body.phone = truncate(phone, 15);
      if (lead.email) body.email = truncate(lead.email, 100);
      if (lead.moveDate) body.date = lead.moveDate;
      if (lead.notes) body.note = truncate(lead.notes, 80);

      const sizeId = mapMoveSize(lead.moveSize);
      if (sizeId !== undefined) body.size = { id: sizeId };

      const from = parseAddress(lead.origin?.raw);
      if (from) body.from = from;
      const to = parseAddress(lead.destination?.raw);
      if (to) body.to = to;

      if (routing.referralId && /^\d+$/.test(routing.referralId)) {
        body.referral = { id: parseInt(routing.referralId, 10) };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(`${MOVERBASE_API_BASE}/leads`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: moverbaseAuthHeader(integration.apiKey),
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
          // 429 = Moverbase rate limit (60 req/min) — worth retrying alongside 5xx
          retriable: response.status >= 500 || response.status === 429,
          error: `${response.status} ${rawText}`.trim(),
          raw: parsed,
        };
      }

      let externalId = '';
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (obj.id !== undefined && obj.id !== null) externalId = String(obj.id);
      }

      return { ok: true, externalId, raw: parsed };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unknown error in moverbase.send';
      return { ok: false, retriable: true, error: message };
    }
  },
};
