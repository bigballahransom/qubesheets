// app/api/embedded-forms/[id]/public/route.ts
//
// Public GET used by the iframe form to render itself. Returns ONLY
// rendering-relevant fields — never credentials, abuse config, or CRM routing.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import LeadFormConfig from '@/models/LeadFormConfig';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    await connectMongoDB();

    const config = await LeadFormConfig.findById(id);
    if (!config || !config.isActive) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    // Build the public projection. Owner-only fields (crmRouting, abuse,
    // createdBy, createdAt, organizationId) are explicitly omitted.
    const postSubmit =
      config.postSubmit?.kind === 'inline-message'
        ? { kind: 'inline-message', message: config.postSubmit.message }
        : { kind: config.postSubmit?.kind };

    const publicConfig = {
      id: String(config._id),
      name: config.name,
      isActive: config.isActive,
      fields: config.fields,
      theme: config.theme,
      postSubmit,
      moveSizeOptions: Array.isArray(config.moveSizeOptions)
        ? config.moveSizeOptions
        : undefined,
      // Wizard step layout. Unset/empty = single-page (the default).
      steps: Array.isArray(config.steps) ? config.steps : undefined,
    };

    return NextResponse.json(publicConfig, { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error('[embedded-forms/:id/public GET] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch form' },
      { status: 500, headers: corsHeaders }
    );
  }
}
