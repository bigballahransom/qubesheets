// app/api/embedded-forms/[id]/route.ts
//
// Authenticated org-scoped read/update/soft-delete for a single LeadFormConfig.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import LeadFormConfig from '@/models/LeadFormConfig';
import { getAuthContext } from '@/lib/auth-helpers';
import { validateConfigPatch } from '@/lib/leads/validateConfig';

// Whitelist of fields that PATCH callers may modify. Note the explicit
// exclusion of organizationId, createdBy, _id, createdAt, updatedAt.
const PATCH_ALLOWED_FIELDS = [
  'name',
  'isActive',
  'crmRouting',
  'fields',
  'postSubmit',
  'theme',
  'abuse',
  'schedulingSettings',
  'moveSizeOptions',
  'moveSizeRouting',
  'steps',
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const authResult = await getAuthContext();
    if (authResult instanceof NextResponse) return authResult;
    if (authResult.isPersonalAccount || !authResult.organizationId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    await connectMongoDB();

    const config = await LeadFormConfig.findOne({
      _id: id,
      organizationId: authResult.organizationId,
    });
    if (!config) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('[embedded-forms/:id GET] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch embedded form' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const authResult = await getAuthContext();
    if (authResult instanceof NextResponse) return authResult;
    if (authResult.isPersonalAccount || !authResult.organizationId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Restrict to the whitelist BEFORE validating so a stray field doesn't
    // produce a confusing error about a field the caller wasn't trying to set.
    const update: Record<string, unknown> = {};
    for (const key of PATCH_ALLOWED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        update[key] = (body as Record<string, unknown>)[key];
      }
    }

    const validationError = validateConfigPatch(update);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    await connectMongoDB();

    const updated = await LeadFormConfig.findOneAndUpdate(
      { _id: id, organizationId: authResult.organizationId },
      { $set: update },
      { new: true }
    );
    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[embedded-forms/:id PATCH] error:', error);
    return NextResponse.json(
      { error: 'Failed to update embedded form' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const authResult = await getAuthContext();
    if (authResult instanceof NextResponse) return authResult;
    if (authResult.isPersonalAccount || !authResult.organizationId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    await connectMongoDB();

    // Soft delete — flip isActive false; never remove the row.
    const updated = await LeadFormConfig.findOneAndUpdate(
      { _id: id, organizationId: authResult.organizationId },
      { $set: { isActive: false } },
      { new: true }
    );
    if (!updated) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[embedded-forms/:id DELETE] error:', error);
    return NextResponse.json(
      { error: 'Failed to delete embedded form' },
      { status: 500 }
    );
  }
}
