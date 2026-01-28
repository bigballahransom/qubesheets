import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import Branding from '@/models/Branding';

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

    const settings = await OrganizationSettings.findOne({ organizationId: orgId });
    const formConfig = settings?.websiteFormConfig;

    if (!formConfig || !formConfig.isActive) {
      return NextResponse.json(
        { error: 'Form not available' },
        { status: 404, headers: corsHeaders }
      );
    }

    const branding = await Branding.findOne({ organizationId: orgId });

    return NextResponse.json(
      {
        formConfig: {
          formTitle: formConfig.formTitle,
          formSubtitle: formConfig.formSubtitle,
          buttonText: formConfig.buttonText,
          buttonColor: formConfig.buttonColor,
          successMessage: formConfig.successMessage,
          fields: formConfig.fields.filter((f: any) => f.enabled),
        },
        branding: branding
          ? {
              companyName: branding.companyName,
              companyLogo: branding.companyLogo,
            }
          : null,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error fetching form config:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
