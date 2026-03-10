// app/api/projects/[projectId]/upload-link/route.ts
// API for generating customer upload links without sending SMS
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CustomerUpload from '@/models/CustomerUpload';
import crypto from 'crypto';

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

// GET - Get existing active upload link for project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const { projectId } = await params;

    // Verify project ownership
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Find existing active upload link
    const existingLink = await CustomerUpload.findOne({
      projectId,
      isActive: true
    });

    if (!existingLink) {
      return NextResponse.json({
        exists: false,
        message: 'No active upload link found'
      });
    }

    const uploadUrl = `${getBaseUrl()}/customer-upload/${existingLink.uploadToken}`;

    return NextResponse.json({
      exists: true,
      uploadToken: existingLink.uploadToken,
      uploadUrl,
      customerName: existingLink.customerName,
      customerPhone: existingLink.customerPhone || null,
      expiresAt: existingLink.expiresAt,
      createdAt: existingLink.createdAt
    });

  } catch (error) {
    console.error('Error getting upload link:', error);
    return NextResponse.json(
      { error: 'Failed to get upload link' },
      { status: 500 }
    );
  }
}

// POST - Generate new upload link without sending SMS
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();

    const { projectId } = await params;

    // Verify project ownership
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { customerName, customerPhone } = await request.json();

    if (!customerName) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      );
    }

    // Deactivate any existing active links for this project
    await CustomerUpload.updateMany(
      { projectId, isActive: true },
      { $set: { isActive: false } }
    );

    // Generate unique upload token
    const uploadToken = crypto.randomBytes(32).toString('hex');

    // Create customer upload record (no expiration)
    const customerUploadData: any = {
      projectId,
      userId,
      customerName,
      uploadToken,
      isActive: true,
    };

    // Only add customerPhone if provided
    if (customerPhone) {
      customerUploadData.customerPhone = customerPhone;
    }

    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      customerUploadData.organizationId = authContext.organizationId;
    }

    await CustomerUpload.create(customerUploadData);

    // Create upload URL
    const uploadUrl = `${getBaseUrl()}/customer-upload/${uploadToken}`;

    return NextResponse.json({
      success: true,
      uploadToken,
      uploadUrl,
      message: 'Upload link generated successfully'
    });

  } catch (error) {
    console.error('Error generating upload link:', error);
    return NextResponse.json(
      { error: 'Failed to generate upload link' },
      { status: 500 }
    );
  }
}
