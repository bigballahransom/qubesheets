// app/api/customer/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerSession from '@/models/CustomerSession';
import Image from '@/models/Image';

export async function POST(request: NextRequest) {
  try {
    await connectMongoDB();
    
    const formData = await request.formData();
    const image = formData.get('image') as File;
    const sessionToken = formData.get('sessionToken') as string;

    if (!image || !sessionToken) {
      return NextResponse.json(
        { error: 'Image and session token are required' },
        { status: 400 }
      );
    }

    // Validate session
    const session = await CustomerSession.findOne({
      sessionToken,
      expiresAt: { $gt: new Date() },
      isActive: true
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 404 }
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
    const maxSize = 10 * 1024 * 1024; // 10MB
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
      projectId: session.projectId,
      userId: session.userId,
      description: `Customer upload from ${session.customerName}`,
      customerSession: session._id,
      analysisStatus: 'pending'
    });

    // Update session photo count
    await CustomerSession.findByIdAndUpdate(session._id, {
      $inc: { photosUploaded: 1 },
      lastActivity: new Date()
    });

    // Trigger background analysis
    // Note: In production, you'd want to use a queue system like Bull or AWS SQS
    analyzeImageInBackground(imageDoc._id.toString(), session.projectId.toString());

    // Return image info without binary data
    const responseData = {
      _id: imageDoc._id,
      name: imageDoc.name,
      originalName: imageDoc.originalName,
      mimeType: imageDoc.mimeType,
      size: imageDoc.size,
      description: imageDoc.description,
      analysisStatus: 'pending',
      createdAt: imageDoc.createdAt,
      updatedAt: imageDoc.updatedAt
    };

    return NextResponse.json(responseData, { status: 201 });
  } catch (error) {
    console.error('Error uploading image:', error);
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}

// Background analysis function
async function analyzeImageInBackground(imageId: string, projectId: string) {
  try {
    // Update status to processing
    await Image.findByIdAndUpdate(imageId, {
      analysisStatus: 'processing'
    });

    // Call the existing analyze-image API
    const formData = new FormData();
    
    // Get the image data
    const image = await Image.findById(imageId);
    if (!image) return;

    // Create a blob from the image data
    const blob = new Blob([image.data], { type: image.mimeType });
    formData.append('image', blob, image.originalName);
    formData.append('projectId', projectId);

    // Make internal API call
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/analyze-image`, {
      method: 'POST',
      body: formData,
    });

    if (response.ok) {
      const result = await response.json();
      
      // Update image with analysis results
      await Image.findByIdAndUpdate(imageId, {
        analysisStatus: 'completed',
        analysisResult: {
          summary: result.summary,
          itemsCount: result.items?.length || 0,
          totalBoxes: result.total_boxes ? 
            Object.values(result.total_boxes).reduce((a: number, b: unknown) => 
              a + (typeof b === 'number' ? b : 0), 0) : 0
        }
      });
    } else {
      await Image.findByIdAndUpdate(imageId, {
        analysisStatus: 'failed'
      });
    }
  } catch (error) {
    console.error('Background analysis failed:', error);
    await Image.findByIdAndUpdate(imageId, {
      analysisStatus: 'failed'
    });
  }
}
