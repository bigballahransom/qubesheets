// app/api/customer-upload/[token]/upload/route.ts - Updated with queue system

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Image from '@/models/Image';
import Project from '@/models/Project';
import { backgroundQueue } from '@/lib/backgroundQueue';
import sharp from 'sharp';

// Helper function to detect HEIC files server-side
function isHeicFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  return (
    fileName.endsWith('.heic') || 
    fileName.endsWith('.heif') ||
    mimeType === 'image/heic' ||
    mimeType === 'image/heif'
  );
}

// Server-side HEIC conversion with multiple fallbacks
async function convertHeicToJpeg(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string; originalName: string; convertedName: string }> {
  console.log('🔧 Attempting server-side HEIC conversion...');
  
  // Try heic-convert first (more reliable for HEIC)
  try {
    console.log('📦 Attempting conversion with heic-convert...');
    const convert = require('heic-convert');
    
    const convertedBuffer = await convert({
      buffer: buffer,
      format: 'JPEG',
      quality: 0.8
    });
    
    console.log('✅ Server-side heic-convert conversion successful');
    return {
      buffer: Buffer.from(convertedBuffer),
      mimeType: 'image/jpeg',
      originalName: 'original.heic',
      convertedName: 'converted.jpg'
    };
    
  } catch (heicConvertError) {
    console.log('⚠️ heic-convert failed, trying Sharp...', heicConvertError);
    
    // Fallback to Sharp (may work if libheif is compiled)
    try {
      const convertedBuffer = await sharp(buffer)
        .jpeg({ quality: 80 })
        .toBuffer();
      
      console.log('✅ Server-side Sharp HEIC conversion successful');
      return {
        buffer: convertedBuffer,
        mimeType: 'image/jpeg',
        originalName: 'original.heic',
        convertedName: 'converted.jpg'
      };
      
    } catch (sharpError) {
      console.log('❌ Both heic-convert and Sharp failed:', { heicConvertError, sharpError });
      
      // If both fail, provide comprehensive guidance
      const errorDetails: string[] = [];
      if (heicConvertError && typeof heicConvertError === 'object' && 'message' in heicConvertError && heicConvertError.message) {
        errorDetails.push(`heic-convert: ${heicConvertError.message}`);
      }
      if (sharpError && typeof sharpError === 'object' && 'message' in sharpError && sharpError.message) {
        errorDetails.push(`sharp: ${sharpError.message}`);
      }
      
      throw new Error(`Server-side HEIC conversion failed with multiple methods. ${errorDetails.join('; ')}. Please try: 1) Using Safari browser (better HEIC support), 2) Converting to JPEG using your phone's camera app, or 3) Changing iPhone settings to save photos as JPEG (Settings → Camera → Formats → Most Compatible).`);
    }
  }
}

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

    // Validate file type (accept regular images and HEIC)
    const isRegularImage = image.type.startsWith('image/');
    const isHeic = isHeicFile(image);
    
    if (!isRegularImage && !isHeic) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an image (JPEG, PNG, GIF, HEIC, or HEIF).' },
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

    // Process image (handle HEIC if needed)
    const bytes = await image.arrayBuffer();
    let buffer = Buffer.from(bytes);
    let mimeType = image.type;

    // For HEIC files, attempt server-side handling as fallback
    if (isHeic) {
      try {
        const converted = await convertHeicToJpeg(buffer);
        buffer = Buffer.from(converted.buffer);
        mimeType = converted.mimeType;
        console.log('✅ Server-side HEIC conversion successful');
      } catch (conversionError) {
        console.error('❌ Server HEIC conversion failed:', conversionError);
        
        // Extract meaningful error message
        const errorMsg = conversionError instanceof Error ? conversionError.message : 'Unknown conversion error';
        
        return NextResponse.json(
          { error: `HEIC processing failed: ${errorMsg}` },
          { status: 400 }
        );
      }
    }

    const processedImage = {
      name: image.name,
      type: mimeType,
      size: buffer.length
    };

    // Generate unique name
    const timestamp = Date.now();
    const cleanCustomerName = customerUpload.customerName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `customer-${cleanCustomerName}-${timestamp}-${processedImage.name}`;

    console.log('💾 Creating image document...');

    // Create the image document
    const imageDoc = await Image.create({
      name,
      originalName: image.name, // Keep original name for reference
      mimeType: processedImage.type,
      size: processedImage.size,
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