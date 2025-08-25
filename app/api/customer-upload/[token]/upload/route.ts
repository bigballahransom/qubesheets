// app/api/customer-upload/[token]/upload/route.ts - Updated with queue system

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Image from '@/models/Image';
import Project from '@/models/Project';
import { backgroundQueue } from '@/lib/backgroundQueue';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    console.log('📤 Customer upload initiated');
    
    await connectMongoDB();
    console.log('🔗 MongoDB connected');
    
    const { token } = await params;
    console.log('🎫 Token received:', token);
    
    // Validate customer upload token
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    console.log('✅ Customer upload validated:', !!customerUpload);

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

    console.log('📁 File received:', image?.name, 'Size:', image?.size);

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
    const cleanCustomerName = customerUpload.customerName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `customer-${cleanCustomerName}-${timestamp}-${image.name}`;

    console.log('💾 Creating image document...');

    // Create the image document
    const imageDoc = await Image.create({
      name,
      originalName: image.name,
      mimeType: image.type,
      size: image.size,
      data: buffer,
      projectId: customerUpload.projectId,
      userId: customerUpload.userId,
      organizationId: customerUpload.organizationId,
      description: description ? `Customer upload by ${customerUpload.customerName}: ${description}` : `Image uploaded by ${customerUpload.customerName}`,
      // Initialize with pending analysis status
      analysisResult: {
        summary: 'Analysis pending...',
        itemsCount: 0,
        totalBoxes: 0
      }
    });

    console.log('✅ Image document created:', imageDoc._id);

    // Update project timestamp
    await Project.findByIdAndUpdate(customerUpload.projectId, { 
      updatedAt: new Date() 
    });

    // Queue background analysis (truly asynchronous)
    console.log('🚀 Queueing background analysis...');
    
    const jobId = backgroundQueue.enqueue('image_analysis', {
      imageId: imageDoc._id.toString(),
      projectId: customerUpload.projectId.toString(),
      userId: customerUpload.userId,
      organizationId: customerUpload.organizationId
    });

    console.log(`✅ Analysis job queued: ${jobId}`);

    // Return immediately - don't wait for analysis
    return NextResponse.json({
      success: true,
      imageId: imageDoc._id.toString(),
      jobId: jobId,
      message: 'Image uploaded successfully! AI analysis is processing in the background and items will appear in your inventory shortly.',
      customerName: customerUpload.customerName,
      analysisStatus: 'queued'
    });

  } catch (error) {
    console.error('❌ Error uploading customer image:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to upload image',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Handle OPTIONS method for CORS
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