import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import { generateUploadToken } from '@/lib/upload-link-helpers';
import { logProjectCreated } from '@/lib/activity-logger';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(
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

    const data = await request.json();

    // Validate required fields
    const customerName = data.customerName?.trim();
    const customerPhone = data.customerPhone?.trim();

    if (!customerName) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!customerPhone) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate phone format (10 digits)
    const phoneDigits = customerPhone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      return NextResponse.json(
        { error: 'Please enter a valid 10-digit phone number' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Format phone to +1XXXXXXXXXX
    const formattedPhone = `+1${phoneDigits}`;

    // Create Project
    const project = await Project.create({
      name: customerName,
      customerName: customerName,
      phone: formattedPhone,
      userId: 'global-self-survey-link',
      organizationId: orgId,
      metadata: {
        source: 'global-self-survey-link',
        createdViaApi: true,
      },
    });

    // Log activity: Project created via Global Self-Survey Link
    try {
      await logProjectCreated(
        project._id.toString(),
        customerName,
        'global-self-survey-link',
        'global-self-survey-link',
        orgId,
        {
          customerName,
          customerPhone: formattedPhone,
        }
      );
    } catch (logError) {
      console.warn('Failed to log project creation activity:', logError);
      // Don't fail the request if logging fails
    }

    // Generate upload token and create CustomerUpload record
    const uploadToken = generateUploadToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await CustomerUpload.create({
      projectId: project._id,
      userId: 'global-self-survey-link',
      organizationId: orgId,
      customerName: customerName,
      customerPhone: formattedPhone,
      uploadToken: uploadToken,
      expiresAt: expiresAt,
      isActive: true,
    });

    return NextResponse.json(
      {
        success: true,
        projectId: project._id.toString(),
        uploadToken: uploadToken,
        customerName: customerName,
      },
      { status: 201, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Error creating project from Global Self-Survey Link:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500, headers: corsHeaders }
    );
  }
}
