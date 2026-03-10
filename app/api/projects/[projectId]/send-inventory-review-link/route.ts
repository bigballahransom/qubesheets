// app/api/projects/[projectId]/send-inventory-review-link/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryReviewLink from '@/models/InventoryReviewLink';
import Branding from '@/models/Branding';
import { client, twilioPhoneNumber } from '@/lib/twilio';
import crypto from 'crypto';

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

// Default SMS template for inventory review links
const DEFAULT_SMS_REVIEW_TEMPLATE = `Hi {customerName}! Greetings from {companyName}

Your moving inventory is ready for review.

Please review your items and sign off on your inventory:
{reviewUrl}

Thank you!`;

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

    const { customerName, customerPhone, reviewToken: existingToken } = await request.json();

    if (!customerName || !customerPhone) {
      return NextResponse.json(
        { error: 'Customer name and phone number are required' },
        { status: 400 }
      );
    }

    let reviewToken = existingToken;
    let reviewLink;

    // If no existing token provided, create a new review link
    if (!reviewToken) {
      // Deactivate any existing active links for this project
      await InventoryReviewLink.updateMany(
        { projectId, isActive: true },
        { $set: { isActive: false } }
      );

      // Generate unique review token
      reviewToken = crypto.randomBytes(32).toString('hex');

      // Create review link record (no expiration - links never expire)
      const reviewLinkData: any = {
        projectId,
        userId,
        customerName,
        customerPhone,
        reviewToken,
        isActive: true,
      };

      if (!authContext.isPersonalAccount) {
        reviewLinkData.organizationId = authContext.organizationId;
      }

      reviewLink = await InventoryReviewLink.create(reviewLinkData);
    } else {
      // Find existing link
      reviewLink = await InventoryReviewLink.findOne({
        reviewToken,
        projectId,
        isActive: true
      });

      if (!reviewLink) {
        return NextResponse.json(
          { error: 'Review link not found' },
          { status: 404 }
        );
      }
    }

    // Create review URL
    const reviewUrl = `${getBaseUrl()}/inventory-review/${reviewToken}`;

    // Get company name from branding
    let companyName = 'Your Moving Company';
    try {
      const brandingQuery = authContext.isPersonalAccount
        ? { userId: authContext.userId }
        : { organizationId: authContext.organizationId };

      const branding = await Branding.findOne(brandingQuery);
      if (branding?.companyName) {
        companyName = branding.companyName;
      }
    } catch (error) {
      console.warn('Error fetching branding:', error);
    }

    // Build SMS message
    const message = DEFAULT_SMS_REVIEW_TEMPLATE
      .replace(/\{customerName\}/g, customerName)
      .replace(/\{reviewUrl\}/g, reviewUrl)
      .replace(/\{companyName\}/g, companyName);

    try {
      await client.messages.create({
        body: message,
        from: twilioPhoneNumber,
        to: customerPhone,
      });

      // Update the review link with SMS tracking info
      await InventoryReviewLink.findByIdAndUpdate(reviewLink._id, {
        $set: {
          smsSentAt: new Date(),
          smsSentTo: customerPhone,
          customerName,
          customerPhone,
        }
      });

      return NextResponse.json({
        success: true,
        reviewToken,
        reviewUrl,
        expiresAt: reviewLink.expiresAt,
        message: 'SMS sent successfully'
      });
    } catch (twilioError) {
      console.error('Twilio error:', twilioError);

      // If we created a new link and SMS failed, delete it
      if (!existingToken) {
        await InventoryReviewLink.findByIdAndDelete(reviewLink._id);
      }

      return NextResponse.json(
        { error: 'Failed to send SMS. Please check the phone number.' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error sending inventory review link:', error);
    return NextResponse.json(
      { error: 'Failed to send inventory review link' },
      { status: 500 }
    );
  }
}
