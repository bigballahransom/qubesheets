// app/api/customer-upload/[token]/save-video-metadata/route.ts - Save video metadata after direct upload
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Video from '@/models/Video';
import Project from '@/models/Project';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  console.log('💾 Video metadata save API called');
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
      customerName
    } = body;
    
    console.log('💾 Received video metadata:', {
      fileName,
      fileSize,
      cloudinaryPublicId: cloudinaryResult?.publicId
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
          description: 'Videos uploaded without specific project tokens',
          isDefault: true,
          createdAt: new Date()
        });
      }
      
      projectId = defaultProject._id;
    }
    
    // Generate unique name
    const timestamp = Date.now();
    const cleanCustomerName = (customerName || 'anonymous').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `customer-${cleanCustomerName}-${timestamp}-${fileName}`;
    
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
      organizationId,
      description: `Video uploaded by ${customerName || 'anonymous customer'}`,
      source: 'customer_upload',
      metadata: {
        uploadToken: token,
        processingPending: true,
        directUpload: true,
        cloudinaryInfo: {
          format: cloudinaryResult.format || 'unknown',
          bytes: cloudinaryResult.bytes || 0,
          width: cloudinaryResult.width || 0,
          height: cloudinaryResult.height || 0,
          createdAt: cloudinaryResult.createdAt || new Date().toISOString()
        }
      }
    });
    
    console.log('✅ Video metadata saved:', videoDoc._id);
    
    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json({
      success: true,
      videoId: (videoDoc._id as any).toString(),
      requiresClientProcessing: true,
      videoInfo: {
        fileName,
        size: fileSize,
        type: fileType,
        customerName: customerName || 'anonymous',
        projectId: projectId?.toString(),
        uploadToken: token,
        videoId: (videoDoc._id as any).toString(),
        cloudinaryUrl: cloudinaryResult.secureUrl
      },
      message: 'Video uploaded successfully to cloud storage - ready for processing',
      instructions: 'extract_frames_and_upload'
    });
    
  } catch (error) {
    console.error('❌ Error saving video metadata:', error);
    
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