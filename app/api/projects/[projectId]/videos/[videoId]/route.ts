// app/api/projects/[projectId]/videos/[videoId]/route.ts - Serve individual video files
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import { deleteFile } from '@/lib/cloudinary';

// GET /api/projects/:projectId/videos/:videoId - Get specific video file
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    
    const { projectId, videoId } = await params;
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Find the video
    const video = await Video.findOne({
      _id: videoId,
      projectId: projectId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
    });
    
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    
    console.log(`🎬 Video request for: ${video.name}`, {
      hasS3Url: !!video.s3RawFile?.url,
      hasCloudinaryUrl: !!video.cloudinarySecureUrl,
      hasData: !!video.data,
      size: video.size
    });
    
    // If video has S3 URL, redirect to it
    if (video.s3RawFile?.url) {
      console.log('🎬 Redirecting to S3:', video.s3RawFile.url);
      return NextResponse.redirect(video.s3RawFile.url);
    }
    
    // If video has Cloudinary URL, redirect to it
    if (video.cloudinarySecureUrl || video.cloudinaryUrl) {
      const cloudinaryUrl = video.cloudinarySecureUrl || video.cloudinaryUrl;
      console.log('🎬 Redirecting to Cloudinary:', cloudinaryUrl);
      return NextResponse.redirect(cloudinaryUrl);
    }
    
    // Handle legacy videos stored as Buffer in MongoDB
    if (!video.data) {
      console.error('🎬 Video has no S3 URL, Cloudinary URL, or data buffer');
      return NextResponse.json({ error: 'Video data not available' }, { status: 404 });
    }
    
    console.log(`🎬 Serving video from MongoDB buffer: ${video.name} (${video.size} bytes)`);
    
    // Handle range requests for video streaming
    const range = request.headers.get('range');
    const videoBuffer = video.data;
    const videoSize = videoBuffer.length;
    
    if (range) {
      // Parse range header (e.g., "bytes=0-1023")
      const CHUNK_SIZE = 10 ** 6; // 1MB chunks
      const start = Number(range.replace(/\D/g, ""));
      const end = Math.min(start + CHUNK_SIZE, videoSize - 1);
      const contentLength = end - start + 1;
      
      const chunk = videoBuffer.slice(start, end + 1);
      
      return new NextResponse(chunk, {
        status: 206, // Partial Content
        headers: {
          'Content-Range': `bytes ${start}-${end}/${videoSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': contentLength.toString(),
          'Content-Type': video.mimeType,
          'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        },
      });
    }
    
    // Return entire video if no range specified
    return new NextResponse(videoBuffer, {
      status: 200,
      headers: {
        'Content-Type': video.mimeType,
        'Content-Length': videoSize.toString(),
        'Content-Disposition': `inline; filename="${video.originalName}"`,
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        'Accept-Ranges': 'bytes',
      },
    });
    
  } catch (error) {
    console.error('Error serving video:', error);
    return NextResponse.json(
      { error: 'Failed to serve video' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/:projectId/videos/:videoId - Update specific video
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    
    const { projectId, videoId } = await params;
    const body = await request.json();
    const { description } = body;
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Find and update the video
    const video = await Video.findOneAndUpdate(
      {
        _id: videoId,
        projectId: projectId,
        ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
      },
      { 
        description,
        updatedAt: new Date()
      },
      { 
        new: true,
        runValidators: true
      }
    );
    
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    
    console.log(`✏️ Updated video description: ${video.originalName}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Video updated successfully',
      video
    });
    
  } catch (error) {
    console.error('Error updating video:', error);
    return NextResponse.json(
      { error: 'Failed to update video' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:projectId/videos/:videoId - Delete specific video
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    
    const { projectId, videoId } = await params;
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Find the video
    const video = await Video.findOne({
      _id: videoId,
      projectId: projectId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
    });
    
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    
    console.log(`🗑️ Deleting video: ${video.originalName}`, {
      hasCloudinaryId: !!video.cloudinaryPublicId,
      size: video.size
    });
    
    // First, find and delete all associated inventory items
    const associatedInventoryItems = await InventoryItem.find({
      sourceVideoId: videoId,
      projectId: projectId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
    });
    
    console.log(`🗑️ Found ${associatedInventoryItems.length} inventory items to delete with video`);
    
    if (associatedInventoryItems.length > 0) {
      await InventoryItem.deleteMany({
        sourceVideoId: videoId,
        projectId: projectId,
        ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
      });
      console.log(`✅ Deleted ${associatedInventoryItems.length} associated inventory items`);
    }
    
    // Delete from Cloudinary if it exists there
    if (video.cloudinaryPublicId) {
      try {
        console.log(`🌩️ Deleting from Cloudinary: ${video.cloudinaryPublicId}`);
        await deleteFile(video.cloudinaryPublicId, 'video');
        console.log('✅ Cloudinary deletion successful');
      } catch (cloudinaryError) {
        console.warn('⚠️ Failed to delete from Cloudinary (continuing with DB deletion):', cloudinaryError);
        // Continue with database deletion even if Cloudinary fails
      }
    }
    
    // Delete from MongoDB
    await Video.deleteOne({ _id: videoId });
    console.log(`✅ Video deleted from database: ${videoId}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Video deleted successfully',
      deletedInventoryItems: associatedInventoryItems.length 
    });
    
  } catch (error) {
    console.error('Error deleting video:', error);
    return NextResponse.json(
      { error: 'Failed to delete video' },
      { status: 500 }
    );
  }
}