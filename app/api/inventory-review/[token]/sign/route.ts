// app/api/inventory-review/[token]/sign/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryReviewLink from '@/models/InventoryReviewLink';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();

    const { token } = await params;

    if (!token) {
      return NextResponse.json(
        { error: 'No review token provided' },
        { status: 400 }
      );
    }

    // Find active review link (no expiration check - links never expire)
    const reviewLink = await InventoryReviewLink.findOne({
      reviewToken: token,
      isActive: true
    });

    if (!reviewLink) {
      return NextResponse.json(
        { error: 'Invalid or expired review link' },
        { status: 404 }
      );
    }

    // Check if already signed
    if (reviewLink.signature) {
      return NextResponse.json(
        {
          error: 'This inventory has already been signed',
          existingSignature: {
            customerName: reviewLink.signature.customerName,
            signedAt: reviewLink.signature.signedAt
          }
        },
        { status: 409 }
      );
    }

    const body = await request.json();
    const { customerName, signatureDataUrl } = body;

    if (!customerName || !signatureDataUrl) {
      return NextResponse.json(
        { error: 'Customer name and signature are required' },
        { status: 400 }
      );
    }

    // Validate signature is a valid data URL
    if (!signatureDataUrl.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'Invalid signature format' },
        { status: 400 }
      );
    }

    // Get IP address and user agent for audit trail
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ipAddress = forwardedFor ? forwardedFor.split(',')[0].trim() : 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Update the review link with signature data
    reviewLink.signature = {
      customerName,
      signatureDataUrl,
      signedAt: new Date(),
      ipAddress,
      userAgent,
    };

    await reviewLink.save();

    return NextResponse.json({
      success: true,
      message: 'Inventory signed successfully',
      signature: {
        customerName: reviewLink.signature.customerName,
        signedAt: reviewLink.signature.signedAt,
      }
    });

  } catch (error) {
    console.error('Error signing inventory review:', error);
    return NextResponse.json(
      { error: 'Failed to sign inventory' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
