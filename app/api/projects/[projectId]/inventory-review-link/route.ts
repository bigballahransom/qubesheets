// app/api/projects/[projectId]/inventory-review-link/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryReviewLink from '@/models/InventoryReviewLink';
import crypto from 'crypto';

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

// GET - Get existing active review link for project
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

    // Find existing active review link
    const existingLink = await InventoryReviewLink.findOne({
      projectId,
      isActive: true
    });

    if (!existingLink) {
      return NextResponse.json({
        exists: false,
        message: 'No active review link found'
      });
    }

    const reviewUrl = `${getBaseUrl()}/inventory-review/${existingLink.reviewToken}`;

    return NextResponse.json({
      exists: true,
      reviewToken: existingLink.reviewToken,
      reviewUrl,
      expiresAt: existingLink.expiresAt,
      customerName: existingLink.customerName,
      customerPhone: existingLink.customerPhone,
      signature: existingLink.signature ? {
        customerName: existingLink.signature.customerName,
        signedAt: existingLink.signature.signedAt
      } : null,
      smsSentAt: existingLink.smsSentAt,
      smsSentTo: existingLink.smsSentTo,
      createdAt: existingLink.createdAt
    });

  } catch (error) {
    console.error('Error getting inventory review link:', error);
    return NextResponse.json(
      { error: 'Failed to get inventory review link' },
      { status: 500 }
    );
  }
}

// POST - Generate new review link
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

    const body = await request.json();
    const { customerName, customerPhone } = body;

    if (!customerName) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      );
    }

    // Deactivate any existing active links for this project
    await InventoryReviewLink.updateMany(
      { projectId, isActive: true },
      { $set: { isActive: false } }
    );

    // Generate unique review token
    const reviewToken = crypto.randomBytes(32).toString('hex');

    // Create review link record (no expiration)
    const reviewLinkData: any = {
      projectId,
      userId,
      customerName: customerName || project.customerName || 'Customer',
      customerPhone: customerPhone || project.phone,
      reviewToken,
      isActive: true,
    };

    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      reviewLinkData.organizationId = authContext.organizationId;
    }

    const reviewLink = await InventoryReviewLink.create(reviewLinkData);

    // Create review URL
    const reviewUrl = `${getBaseUrl()}/inventory-review/${reviewToken}`;

    return NextResponse.json({
      success: true,
      reviewToken,
      reviewUrl,
      customerName: reviewLink.customerName,
      message: 'Review link created successfully'
    });

  } catch (error) {
    console.error('Error creating inventory review link:', error);
    return NextResponse.json(
      { error: 'Failed to create inventory review link' },
      { status: 500 }
    );
  }
}
