import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Branding from '@/models/Branding';
import Template from '@/models/Template';
import OrganizationSettings from '@/models/OrganizationSettings';

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

    // This endpoint is only hit by the global self-survey landing page, so
    // we surface the global-link flag specifically. The other two flow
    // flags (customer-link, walkthrough) don't apply here. Defaults true.
    let photosEnabled = true;
    try {
      const orgSettings = await OrganizationSettings.findOne({ organizationId: orgId });
      if (orgSettings && orgSettings.photosEnabledGlobalLink === false) {
        photosEnabled = false;
      }
    } catch (settingsError) {
      console.warn('Error fetching org photo settings:', settingsError);
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
        photosEnabled,
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
