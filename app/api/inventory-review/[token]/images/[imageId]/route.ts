// app/api/inventory-review/[token]/images/[imageId]/route.ts
// Public image serving for inventory review pages
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryReviewLink from '@/models/InventoryReviewLink';
import Image from '@/models/Image';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; imageId: string }> }
) {
  try {
    await connectMongoDB();

    const { token, imageId } = await params;

    if (!token || !imageId) {
      return NextResponse.json(
        { error: 'Token and image ID are required' },
        { status: 400 }
      );
    }

    // Validate token (no expiration check - links never expire)
    const reviewLink = await InventoryReviewLink.findOne({
      reviewToken: token,
      isActive: true
    });

    if (!reviewLink) {
      return NextResponse.json(
        { error: 'Invalid or expired review link' },
        { status: 401 }
      );
    }

    // Find the image and verify it belongs to the project
    const image = await Image.findOne({
      _id: imageId,
      projectId: reviewLink.projectId
    });

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Validate image data
    if (!image.data || image.data.length === 0) {
      return NextResponse.json({ error: 'Image data missing' }, { status: 404 });
    }

    // Return the image as a blob response
    const mimeType = image.mimeType || 'image/jpeg';

    return new NextResponse(image.data, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': image.size.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Error serving public image:', error);
    return NextResponse.json(
      { error: 'Failed to serve image' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
