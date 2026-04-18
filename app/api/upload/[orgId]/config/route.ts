import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Branding from '@/models/Branding';
import Template from '@/models/Template';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { orgId } = await params;
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization ID required' },
        { status: 400, headers: corsHeaders }
      );
    }

    await connectMongoDB();

    // Fetch organization branding
    const branding = await Branding.findOne({ organizationId: orgId });

    // Fetch custom instructions template if available
    let instructions = null;
    try {
      const template = await Template.findOne({
        organizationId: orgId,
        templateType: 'customer_instructions'
      });
      if (template) {
        instructions = template.content;
      }
    } catch (templateError) {
      console.warn('Error fetching custom instructions:', templateError);
    }

    return NextResponse.json(
      {
        branding: branding
          ? {
              companyName: branding.companyName,
              companyLogo: branding.companyLogo,
            }
          : null,
        instructions,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error fetching upload config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
