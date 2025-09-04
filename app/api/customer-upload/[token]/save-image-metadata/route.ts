// app/api/customer-upload/[token]/save-image-metadata/route.ts - Save image metadata after direct upload
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
  console.log('💾 Customer image metadata save API called');
  try {
    await connectMongoDB();
    console.log('🔗 MongoDB connected');
    
    const { token } = await params;
    const body = await request.json();
    
    const {
      fileName,
      fileSize,
      fileType,
      cloudinaryResult,
      customerName,
      imageBuffer // Base64 encoded image data for analysis
    } = body;
    
    console.log('💾 Received customer image metadata:', {
      fileName,
      fileSize,
      cloudinaryPublicId: cloudinaryResult?.publicId,
      hasImageBuffer: !!imageBuffer
    });
    
    // Find customer upload for project association
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true
    });

    let projectId = null;
    let userId = null;
    let organizationId = null;
    
    if (customerUpload) {
      projectId = customerUpload.projectId;
      userId = customerUpload.userId;
      organizationId = customerUpload.organizationId;
    } else {
      // Fallback: Create/use a default project
      let defaultProject = await Project.findOne({ 
        name: 'Anonymous Customer Uploads',
        isDefault: true 
      });
      
      if (!defaultProject) {
        defaultProject = await Project.create({
          name: 'Anonymous Customer Uploads',
          description: 'Images uploaded without specific project tokens',
          isDefault: true,
          createdAt: new Date()
        });
      }
      
      projectId = defaultProject._id;
    }
    
    // Convert base64 to buffer for database storage
    let buffer = null;
    if (imageBuffer) {
      try {
        // Remove data URL prefix if present
        const base64Data = imageBuffer.replace(/^data:image\/[a-z]+;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
        console.log('📊 Converted image buffer size:', buffer.length, 'bytes');
      } catch (bufferError) {
        console.error('❌ Failed to convert image buffer:', bufferError);
        return NextResponse.json(
          { error: 'Invalid image data provided' },
          { status: 400 }
        );
      }
    }
    
    // Generate unique name
    const timestamp = Date.now();
    const cleanCustomerName = (customerName || 'anonymous').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `customer-${cleanCustomerName}-${timestamp}-${fileName}`;
    
    // Save image metadata to database
    const imageDoc = await Image.create({
      name,
      originalName: fileName,
      mimeType: fileType,
      size: fileSize,
      data: buffer, // Store image data for analysis
      cloudinaryPublicId: cloudinaryResult?.publicId,
      cloudinaryUrl: cloudinaryResult?.url,
      cloudinarySecureUrl: cloudinaryResult?.secureUrl,
      projectId,
      userId,
      organizationId,
      description: `Image uploaded by ${customerName || 'anonymous customer'}`,
      source: 'customer_upload',
      metadata: {
        uploadToken: token,
        directUpload: true,
        cloudinaryInfo: cloudinaryResult ? {
          format: cloudinaryResult.format || 'unknown',
          bytes: cloudinaryResult.bytes || 0,
          width: cloudinaryResult.width || 0,
          height: cloudinaryResult.height || 0,
          createdAt: cloudinaryResult.createdAt || new Date().toISOString()
        } : null
      },
      // Initialize with pending analysis status
      analysisResult: {
        summary: 'Analysis pending...',
        itemsCount: 0,
        totalBoxes: 0
      }
    });
    
    console.log('✅ Customer image metadata saved:', imageDoc._id);
    
    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    // Queue image for analysis if we have image data
    let jobId = 'no-analysis-data';
    if (buffer) {
      try {
        jobId = backgroundQueue.enqueue('image_analysis', {
          imageId: imageDoc._id.toString(),
          projectId: projectId.toString(),
          userId,
          organizationId
        });
        console.log(`✅ Analysis job queued: ${jobId}`);
      } catch (queueError) {
        console.warn('⚠️ Background queue failed, but image was saved:', queueError);
        jobId = 'queue-failed-manual-required';
      }
    }
    
    return NextResponse.json({
      success: true,
      imageId: imageDoc._id.toString(),
      jobId: jobId,
      message: buffer 
        ? 'Image uploaded successfully! AI analysis is processing in the background and items will appear in your inventory shortly.'
        : 'Image uploaded successfully! Analysis requires image data.',
      customerName: customerName || 'anonymous',
      analysisStatus: buffer ? 'queued' : 'skipped'
    });
    
  } catch (error) {
    console.error('❌ Error saving customer image metadata:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to save image metadata',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
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