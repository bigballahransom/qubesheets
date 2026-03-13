// app/api/projects/[projectId]/crew-review-link/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import CrewReviewLink from '@/models/CrewReviewLink';
import { logCrewLinkShared } from '@/lib/activity-logger';
import crypto from 'crypto';

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

// GET - Get existing active crew review link for project
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

    // Find existing active crew review link
    const existingLink = await CrewReviewLink.findOne({
      projectId,
      isActive: true
    });

    if (!existingLink) {
      return NextResponse.json({
        exists: false,
        message: 'No active crew review link found'
      });
    }

    const reviewUrl = `${getBaseUrl()}/crew-review/${existingLink.reviewToken}`;

    return NextResponse.json({
      exists: true,
      reviewToken: existingLink.reviewToken,
      reviewUrl,
      customerPhone: existingLink.customerPhone || null,
      accessCount: existingLink.accessCount,
      lastAccessedAt: existingLink.lastAccessedAt,
      createdAt: existingLink.createdAt
    });

  } catch (error) {
    console.error('Error getting crew review link:', error);
    return NextResponse.json(
      { error: 'Failed to get crew review link' },
      { status: 500 }
    );
  }
}

// POST - Generate new crew review link
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

    const body = await request.json().catch(() => ({}));
    const { customerPhone } = body;

    // Deactivate any existing active links for this project
    await CrewReviewLink.updateMany(
      { projectId, isActive: true },
      { $set: { isActive: false } }
    );

    // Generate unique review token
    const reviewToken = crypto.randomBytes(32).toString('hex');

    // Create review link record (no expiration)
    const reviewLinkData: any = {
      projectId,
      userId,
      reviewToken,
      isActive: true,
      accessCount: 0,
    };

    // Only add customerPhone if provided
    if (customerPhone) {
      reviewLinkData.customerPhone = customerPhone;
    }

    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      reviewLinkData.organizationId = authContext.organizationId;
    }

    const reviewLink = await CrewReviewLink.create(reviewLinkData);

    // Create review URL
    const reviewUrl = `${getBaseUrl()}/crew-review/${reviewToken}`;

    // Log the activity
    await logCrewLinkShared(
      projectId,
      reviewToken,
      reviewUrl,
      customerPhone
    );

    return NextResponse.json({
      success: true,
      reviewToken,
      reviewUrl,
      message: 'Crew review link created successfully'
    });

  } catch (error) {
    console.error('Error creating crew review link:', error);
    return NextResponse.json(
      { error: 'Failed to create crew review link' },
      { status: 500 }
    );
  }
}
