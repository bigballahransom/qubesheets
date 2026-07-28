// lib/leads/crm/moveright.ts
//
// Unlike the inventory sync (GraphQL + refresh token), lead pushes use
// MoveRight's Intake API: POST /api/intake/token?token=lead_XXX. The token is
// generated in MoveRight admin and encodes the zone, referral source, and
// customer type — so there's no auth header and no referral mapping here.
// `waitForResponse: true` makes MoveRight return the created job's id/code
// instead of a redirect.
import connectMongoDB from '@/lib/mongodb';
import MoverightIntegration, { MOVERIGHT_INTAKE_URL } from '@/models/MoverightIntegration';
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

// Split a full name when the lead lacks explicit first/last. MoveRight's
// intake API also accepts a single `name` field with automatic parsing, but
// explicit givenName/familyName avoids relying on their splitter.
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

function extractZip(raw?: string): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : undefined;
}

export const moveright: CrmAdapter = {
  name: 'moveright',

  async isConfigured(orgId: string): Promise<boolean> {
    try {
      await connectMongoDB();
      const doc = await MoverightIntegration.findOne({
        organizationId: orgId,
      }).lean();
      if (!doc) return false;
      const d = doc as { intakeToken?: string; enabled?: boolean };
      // Lead routing rides on the intake token, not the GraphQL refresh
      // token — an inventory-sync-only setup (no token) never attempts leads.
      return Boolean(d.intakeToken) && d.enabled !== false;
    } catch (err) {
      console.error('[moveright.isConfigured] error', err);
      return false;
    }
  },

  validate(lead: NormalizedLead, _config: ILeadFormConfig): ValidationResult {
    const { firstName } = deriveNameParts(lead);
    if (!firstName) {
      return {
        ok: false,
        reason: 'MoveRight requires a name (fullName or firstName)',
      };
    }
    if (!lead.phone && !lead.email) {
      return {
        ok: false,
        reason: 'MoveRight requires either phone or email',
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
      const integrationDoc = await MoverightIntegration.findOne({
        organizationId: ctx.organizationId,
      }).lean();

      if (!integrationDoc) {
        return {
          ok: false,
          retriable: false,
          error: 'integration not configured',
        };
      }
      const integration = integrationDoc as { intakeToken?: string; enabled?: boolean };

      const routing = config.crmRouting?.moveright ?? {};
      // A per-form token override lets each form report a different referral
      // source (the token encodes it); the integration-level token is the
      // default.
      const intakeToken = routing.intakeToken?.trim() || integration.intakeToken;
      if (!intakeToken || integration.enabled === false) {
        return {
          ok: false,
          retriable: false,
          error: 'integration not configured or disabled',
        };
      }

      const { firstName, lastName } = deriveNameParts(lead);

      const body: Record<string, unknown> = {
        waitForResponse: true,
      };
      if (firstName) body.givenName = firstName;
      if (lastName) body.familyName = lastName;
      const phone = stripPhone(lead.phone);
      if (phone) body.phone = phone;
      if (lead.email) body.email = lead.email;
      if (lead.moveDate) body.moveDate = lead.moveDate; // already YYYY-MM-DD
      if (lead.origin?.raw) body.originAddress = lead.origin.raw;
      if (lead.destination?.raw) body.destAddress = lead.destination.raw;
      const originZip = extractZip(lead.origin?.raw);
      if (originZip) body.areaCode = originZip;
      const destZip = extractZip(lead.destination?.raw);
      if (destZip) body.destinationAreaCode = destZip;
      if (lead.moveSize) body.homeSize = lead.moveSize;
      if (lead.notes) body.customerNotes = lead.notes;
      if (lead.referrer) body.initialWebPage = lead.referrer;
      const gclid = lead.utm?.gclid;
      if (gclid) body.gclid = gclid;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(
          `${MOVERIGHT_INTAKE_URL}?token=${encodeURIComponent(intakeToken)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );
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
          retriable: response.status >= 500 || response.status === 429,
          error: `${response.status} ${rawText}`.trim().slice(0, 500),
          raw: parsed,
        };
      }

      // The intake endpoint reports failures in-body (`error`) even on 200.
      const obj =
        parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      if (obj.error) {
        return {
          ok: false,
          retriable: false,
          error: String(obj.error),
          raw: parsed,
        };
      }

      const job = obj.job as Record<string, unknown> | undefined;
      const externalId = job?.id ? String(job.id) : '';

      return { ok: true, externalId, raw: parsed };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'unknown error in moveright.send';
      return { ok: false, retriable: true, error: message };
    }
  },
};
