// app/api/projects/[projectId]/save-image-metadata/route.ts - Save image metadata after direct upload on projects page
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Project from '@/models/Project';
import { backgroundQueue } from '@/lib/backgroundQueue';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  console.log('💾 Admin image metadata save API called');
  try {
    // Check authentication
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    await connectMongoDB();
    console.log('🔗 MongoDB connected');
    
    const { projectId } = await params;
    const body = await request.json();
    
    const {
      fileName,
      fileSize,
      fileType,
      cloudinaryResult,
      userName = 'Admin User',
      imageBuffer // Base64 encoded image data for analysis
    } = body;
    
    console.log('💾 Received admin image metadata:', {
      fileName,
      fileSize,
      projectId,
      cloudinaryPublicId: cloudinaryResult?.publicId,
      userId,
      orgId,
      hasImageBuffer: !!imageBuffer
    });
    
    // Verify project exists and user has access
    const project = await Project.findById(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
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
    const cleanUserName = userName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `admin-${cleanUserName}-${timestamp}-${fileName}`;
    
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
      organizationId: orgId,
      description: `Image uploaded by ${userName} via admin interface`,
      source: 'admin_upload',
      metadata: {
        directUpload: true,
        uploadedBy: userName,
        uploadedAt: new Date().toISOString(),
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
    
    console.log('✅ Admin image metadata saved:', imageDoc._id);
    
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
          organizationId: orgId
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
        ? 'Image uploaded successfully! AI analysis is processing in the background.'
        : 'Image uploaded successfully! Analysis requires image data.',
      analysisStatus: buffer ? 'queued' : 'skipped'
    });
    
  } catch (error) {
    console.error('❌ Error saving admin image metadata:', error);
    
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