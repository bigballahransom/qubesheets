// app/api/customer-upload/[token]/upload/route.ts - Enhanced with better error handling
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
    console.log('Upload route called');
    
    await connectMongoDB();
    console.log('MongoDB connected');
    
    const { token } = await params;
    console.log('Token received:', token);
    
    // Validate customer upload token
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    console.log('Customer upload found:', !!customerUpload);

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

    console.log('File received:', image?.name, 'Size:', image?.size);

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

    console.log('Creating image document...');

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

    console.log('Image document created:', imageDoc._id);

    // Update project timestamp
    await Project.findByIdAndUpdate(customerUpload.projectId, { 
      updatedAt: new Date() 
    });

    // Trigger background AI analysis (fire and forget)
    const analysisUrl = `${process.env.NEXT_PUBLIC_APP_URL || request.url.split('/api')[0]}/api/analyze-image-background`;
    
    console.log('Triggering background analysis at:', analysisUrl);
    
    fetch(analysisUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageId: imageDoc._id.toString(),
        projectId: customerUpload.projectId.toString(),
        userId: customerUpload.userId,
      }),
    }).catch(error => {
      console.error('Background analysis trigger failed:', error);
    });

    return NextResponse.json({
      success: true,
      imageId: imageDoc._id.toString(),
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

// Add OPTIONS method for CORS if needed
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