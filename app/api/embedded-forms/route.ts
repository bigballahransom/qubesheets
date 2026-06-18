// app/api/embedded-forms/route.ts
//
// Authenticated org-scoped list + create for LeadFormConfig documents.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import LeadFormConfig from '@/models/LeadFormConfig';
import { getAuthContext } from '@/lib/auth-helpers';

export async function GET(): Promise<NextResponse> {
  try {
    const authResult = await getAuthContext();
    if (authResult instanceof NextResponse) return authResult;
    if (authResult.isPersonalAccount || !authResult.organizationId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 401 });
    }

    await connectMongoDB();

    const configs = await LeadFormConfig.find({
      organizationId: authResult.organizationId,
    }).sort({ createdAt: -1 });

    return NextResponse.json({ configs });
  } catch (error) {
    console.error('[embedded-forms GET] error:', error);
    return NextResponse.json(
      { error: 'Failed to list embedded forms' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await getAuthContext();
    if (authResult instanceof NextResponse) return authResult;
    if (authResult.isPersonalAccount || !authResult.organizationId) {
      return NextResponse.json({ error: 'Organization required' }, { status: 401 });
    }

    const body = await request.json();

    if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }
    if (!body?.postSubmit || typeof body.postSubmit !== 'object') {
      return NextResponse.json(
        { error: 'postSubmit is required' },
        { status: 400 }
      );
    }
    if (
      !body?.theme ||
      typeof body.theme !== 'object' ||
      !body.theme.title ||
      typeof body.theme.title !== 'string'
    ) {
      return NextResponse.json(
        { error: 'theme.title is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    const created = await LeadFormConfig.create({
      organizationId: authResult.organizationId,
      createdBy: authResult.userId,
      name: body.name.trim(),
      isActive: body.isActive ?? true,
      crmRouting: body.crmRouting ?? {},
      fields: Array.isArray(body.fields) ? body.fields : [],
      postSubmit: body.postSubmit,
      theme: body.theme,
      abuse: body.abuse,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('[embedded-forms POST] error:', error);
    return NextResponse.json(
      { error: 'Failed to create embedded form' },
      { status: 500 }
    );
  }
}
