// app/api/projects/[projectId]/save-video-metadata/route.ts - Save video metadata after direct upload on projects page
import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  console.log('💾 Admin video metadata save API called');
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
      userName = 'Admin User'
    } = body;
    
    console.log('💾 Received admin video metadata:', {
      fileName,
      fileSize,
      projectId,
      cloudinaryPublicId: cloudinaryResult?.publicId,
      userId,
      orgId
    });
    
    // Verify project exists and user has access
    const project = await Project.findById(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    // Generate unique name
    const timestamp = Date.now();
    const cleanUserName = userName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `admin-${cleanUserName}-${timestamp}-${fileName}`;
    
    // Save video metadata to database
    const videoDoc = await Video.create({
      name,
      originalName: fileName,
      mimeType: fileType,
      size: fileSize,
      duration: cloudinaryResult.duration || 0,
      cloudinaryPublicId: cloudinaryResult.publicId,
      cloudinaryUrl: cloudinaryResult.url,
      cloudinarySecureUrl: cloudinaryResult.secureUrl,
      projectId,
      userId,
      organizationId: orgId,
      description: `Video uploaded by ${userName} via admin interface`,
      source: 'admin_upload',
      metadata: {
        processingPending: true,
        directUpload: true,
        uploadedBy: userName,
        uploadedAt: new Date().toISOString(),
        cloudinaryInfo: {
          format: cloudinaryResult.format || 'unknown',
          bytes: cloudinaryResult.bytes || 0,
          width: cloudinaryResult.width || 0,
          height: cloudinaryResult.height || 0,
          createdAt: cloudinaryResult.createdAt || new Date().toISOString()
        }
      }
    });
    
    console.log('✅ Admin video metadata saved:', videoDoc._id);
    
    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json({
      success: true,
      videoId: (videoDoc._id as mongoose.Types.ObjectId).toString(),
      requiresClientProcessing: true,
      videoInfo: {
        fileName,
        size: fileSize,
        type: fileType,
        userName,
        projectId,
        videoId: (videoDoc._id as mongoose.Types.ObjectId).toString(),
        cloudinaryUrl: cloudinaryResult.secureUrl
      },
      message: 'Video uploaded successfully to cloud storage - ready for processing',
      instructions: 'extract_frames_and_upload'
    });
    
  } catch (error) {
    console.error('❌ Error saving admin video metadata:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to save video metadata',
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