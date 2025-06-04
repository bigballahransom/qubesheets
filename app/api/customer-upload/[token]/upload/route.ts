// app/api/customer-upload/[token]/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Image from '@/models/Image';
import Project from '@/models/Project';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    
    const { token } = await params;
    
    // Validate customer upload token
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!customerUpload) {
      return NextResponse.json(
        { error: 'Invalid or expired upload link' },
        { status: 404 }
      );
    }

    // Parse the form data
    const formData = await request.formData();
    const image = formData.get('image') as File;
    const description = formData.get('description') as string || '';

    if (!image) {
      return NextResponse.json(
        { error: 'No image file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!image.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an image.' },
        { status: 400 }
      );
    }

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024;
    if (image.size > maxSize) {
      return NextResponse.json(
        { error: 'File size too large. Please upload an image smaller than 10MB.' },
        { status: 400 }
      );
    }

    // Convert image to buffer
    const bytes = await image.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate unique name
    const timestamp = Date.now();
    const name = `customer-${timestamp}-${image.name}`;

    // Create the image document
    const imageDoc = await Image.create({
      name,
      originalName: image.name,
      mimeType: image.type,
      size: image.size,
      data: buffer,
      projectId: customerUpload.projectId,
      userId: customerUpload.userId,
      description: description ? `Customer upload: ${description}` : 'Customer uploaded image',
      // Don't include analysisResult yet - will be added by background job
    });

    // Trigger background AI analysis (fire and forget)
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/analyze-image-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageId: imageDoc._id,
        projectId: customerUpload.projectId,
        userId: customerUpload.userId,
      }),
    }).catch(error => {
      console.error('Background analysis trigger failed:', error);
    });

    return NextResponse.json({
      success: true,
      imageId: imageDoc._id,
      message: 'Image uploaded successfully. Analysis in progress.',
    });

  } catch (error) {
    console.error('Error uploading customer image:', error);
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}