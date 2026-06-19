// app/api/settings/embeddable-lead-forms/route.ts
//
// Org-admin settings surface for the embeddable lead form. Thin wrapper over the
// lead-intake module's server helpers.
//
//   GET  -> auto-provision (if needed) and return the org's DEFAULT lead form.
//   POST -> update website domain / active toggle / display name on that form.
//
// Org-safety: the org is derived ONLY from the authenticated session, and the
// form is ALWAYS re-derived server-side via getOrCreateDefaultForm(orgId). A
// client-sent organizationId or formId is never trusted for identity, so one org
// can never read or mutate another org's form.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';
import {
  getOrCreateDefaultForm,
  updateForm,
} from '@/features/lead-intake/lib/leadForms';
import { normalizeHost } from '@/features/lead-intake/lib/cors';

export const runtime = 'nodejs';

// Cap on additional allowed origins per form (the primary one is websiteDomain).
const MAX_ALLOWED_DOMAINS = 20;

const ORG_ONLY = {
  error: 'Embeddable lead form settings are only available for organization members',
};

// Shape returned to the settings UI. Never leaks internal/org fields.
function present(form: {
  formId: string;
  name: string;
  websiteDomain?: string;
  allowedDomains?: string[];
  isActive: boolean;
}) {
  return {
    formId: form.formId,
    name: form.name,
    websiteDomain: form.websiteDomain ?? '',
    allowedDomains: form.allowedDomains ?? [],
    isActive: form.isActive,
  };
}

export async function GET(_request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(ORG_ONLY, { status: 403 });
    }

    const form = await getOrCreateDefaultForm(authContext.organizationId);
    return NextResponse.json(present(form));
  } catch (error) {
    console.error('Error loading embeddable lead form settings:', error);
    return NextResponse.json(
      { error: 'Failed to load embeddable lead form settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(ORG_ONLY, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Collect only the fields we allow editing, with light validation. Any
    // client-sent formId/organizationId is intentionally ignored.
    const attrs: {
      name?: string;
      websiteDomain?: string;
      allowedDomains?: string[];
      isActive?: boolean;
    } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: 'name must be a non-empty string' },
          { status: 400 }
        );
      }
      if (body.name.length > 200) {
        return NextResponse.json({ error: 'name is too long' }, { status: 400 });
      }
      attrs.name = body.name.trim();
    }

    if (body.websiteDomain !== undefined) {
      if (typeof body.websiteDomain !== 'string') {
        return NextResponse.json(
          { error: 'websiteDomain must be a string' },
          { status: 400 }
        );
      }
      if (body.websiteDomain.length > 200) {
        return NextResponse.json({ error: 'websiteDomain is too long' }, { status: 400 });
      }
      // Empty string clears the configured domain.
      attrs.websiteDomain = body.websiteDomain.trim();
    }

    if (body.allowedDomains !== undefined) {
      if (!Array.isArray(body.allowedDomains)) {
        return NextResponse.json(
          { error: 'allowedDomains must be an array' },
          { status: 400 }
        );
      }
      if (body.allowedDomains.length > MAX_ALLOWED_DOMAINS) {
        return NextResponse.json(
          { error: `allowedDomains is limited to ${MAX_ALLOWED_DOMAINS} entries` },
          { status: 400 }
        );
      }
      const normalized: string[] = [];
      for (const entry of body.allowedDomains) {
        if (typeof entry !== 'string') {
          return NextResponse.json(
            { error: 'allowedDomains entries must be strings' },
            { status: 400 }
          );
        }
        if (entry.length > 200) {
          return NextResponse.json(
            { error: 'an allowedDomains entry is too long' },
            { status: 400 }
          );
        }
        // Store with the SAME normalization the CORS allow-list check uses.
        const host = normalizeHost(entry);
        if (host && !normalized.includes(host)) normalized.push(host);
      }
      attrs.allowedDomains = normalized;
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        return NextResponse.json({ error: 'isActive must be a boolean' }, { status: 400 });
      }
      attrs.isActive = body.isActive;
    }

    if (Object.keys(attrs).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Re-derive the canonical default form from the AUTHED org — never the client.
    const form = await getOrCreateDefaultForm(authContext.organizationId);
    const updated = await updateForm(authContext.organizationId, form.formId, attrs);
    if (!updated) {
      // Should not happen (we just provisioned it), but never 200 on a no-op.
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    return NextResponse.json(present(updated), { status: 200 });
  } catch (error) {
    console.error('Error saving embeddable lead form settings:', error);
    return NextResponse.json(
      { error: 'Failed to save embeddable lead form settings' },
      { status: 500 }
    );
  }
}
