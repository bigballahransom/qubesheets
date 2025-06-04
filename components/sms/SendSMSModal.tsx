// app/api/customer/photo/[imageId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    await connectMongoDB();
    
    const { imageId } = await params;
    
    const image = await Image.findById(imageId);
    
    if (!image || !image.customerSession) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }
    
    // Return the image as a blob response with proper headers
    return new NextResponse(image.data, {
      headers: {
        'Content-Type': image.mimeType,
        'Content-Length': image.size.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    return NextResponse.json(
      { error: 'Failed to fetch image' },
      { status: 500 }
    );
  }
}