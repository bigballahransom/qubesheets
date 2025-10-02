// app/api/projects/[projectId]/videos/[videoId]/route.ts - Serve individual video files
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/videos/:videoId - Get specific video file or all videos
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
    
    // Handle collection request (get all videos) when videoId is "all"
    if (videoId === 'all') {
      // Parse pagination parameters from query string
      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const skip = (page - 1) * limit;
      
      const filter = {
        projectId: projectId,
        ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
      };
      
      console.log('🎬 Video gallery filter:', JSON.stringify(filter));
      console.log(`📄 Pagination: page ${page}, limit ${limit}, skip ${skip}`);
      
      const startTime = Date.now();
      
      try {
        // Get total count for pagination
        const totalCount = await Video.countDocuments(filter);
        
        // Get paginated videos
        const videos = await Promise.race([
          Video.find(filter)
            .select('name originalName mimeType size duration description source metadata analysisResult s3RawFile createdAt updatedAt cloudinaryPublicId cloudinaryUrl cloudinarySecureUrl')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .maxTimeMS(10000), // 10 second MongoDB timeout
          new Promise<any>((_, reject) => 
            setTimeout(() => reject(new Error('Database query timeout')), 12000)
          )
        ]);
        
        const queryTime = Date.now() - startTime;
        console.log(`🎬 Found ${videos.length} videos (${totalCount} total) for project ${projectId} in ${queryTime}ms`);
        
        return NextResponse.json({
          videos,
          pagination: {
            currentPage: page,
            pageSize: limit,
            totalItems: totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasNextPage: page < Math.ceil(totalCount / limit),
            hasPrevPage: page > 1
          }
        });
      } catch (queryError) {
        console.error('🎬 Video query failed:', queryError);
        
        // Fallback: return empty result with error flag
        return NextResponse.json({
          videos: [],
          pagination: {
            currentPage: page,
            pageSize: limit,
            totalItems: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false
          },
          error: 'Failed to load videos. Please try again.'
        });
      }
    }
    
    // Handle individual video request
    const video = await Video.findOne({
      _id: videoId,
      projectId: projectId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
    });
    
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    
    console.log(`🎬 Video request for: ${video.name}`, {
      videoId: video._id,
      hasS3Url: !!video.s3RawFile?.url,
      s3Url: video.s3RawFile?.url,
      hasCloudinaryUrl: !!video.cloudinarySecureUrl,
      cloudinaryUrl: video.cloudinarySecureUrl || video.cloudinaryUrl,
      hasData: !!video.data,
      dataSize: video.data?.length || 0,
      size: video.size,
      mimeType: video.mimeType
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
      console.error('🎬 Video has no S3 URL, Cloudinary URL, or data buffer', {
        videoId: video._id,
        videoName: video.name,
        hasS3File: !!video.s3RawFile,
        s3FileKeys: video.s3RawFile ? Object.keys(video.s3RawFile) : [],
        hasCloudinaryPublicId: !!video.cloudinaryPublicId,
        availableFields: Object.keys(video.toObject())
      });
      return NextResponse.json({ 
        error: 'Video data not available',
        details: 'No S3 URL, Cloudinary URL, or MongoDB data buffer found'
      }, { status: 404 });
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

// DELETE /api/projects/:projectId/videos/:videoId - Delete specific video or all videos
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
    
    // Handle bulk delete when videoId is "all"
    if (videoId === 'all') {
      console.log('🗑️ Bulk delete all videos requested for project:', projectId);
      
      const filter = {
        projectId: projectId,
        ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
      };
      
      try {
        // First, delete all associated inventory items
        const inventoryDeleteResult = await InventoryItem.deleteMany({
          sourceVideoId: { $ne: null },
          projectId: projectId,
          ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
        }).maxTimeMS(30000); // 30 second timeout for bulk delete
        
        console.log(`🗑️ Deleted ${inventoryDeleteResult.deletedCount} associated inventory items`);
        
        // Then delete all videos
        const videoDeleteResult = await Video.deleteMany(filter).maxTimeMS(30000);
        
        console.log(`🗑️ Deleted ${videoDeleteResult.deletedCount} videos from project ${projectId}`);
        
        return NextResponse.json({
          success: true,
          message: `Successfully deleted ${videoDeleteResult.deletedCount} videos`,
          deletedVideos: videoDeleteResult.deletedCount,
          deletedInventoryItems: inventoryDeleteResult.deletedCount
        });
      } catch (error) {
        console.error('❌ Bulk video delete failed:', error);
        
        if (error instanceof Error && error.message.includes('timeout')) {
          return NextResponse.json(
            { 
              error: 'Bulk delete operation timed out. Try deleting in smaller batches.',
              details: error.message 
            },
            { status: 408 }
          );
        }
        
        return NextResponse.json(
          { 
            error: 'Failed to delete all videos',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: 500 }
        );
      }
    }
    
    // Handle individual video deletion
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
      size: video.size,
      status: video.analysisResult?.status,
      processingStatus: video.processingStatus,
      createdAt: video.createdAt
    });

    // Check if video has been stuck in processing for more than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const isStuckProcessing = (
      video.analysisResult?.status === 'processing' || 
      video.processingStatus === 'processing'
    ) && video.createdAt < oneHourAgo;

    if (isStuckProcessing) {
      console.log(`⚠️ Video appears to be stuck in processing (created ${video.createdAt}), allowing force delete`);
    }
    
    // First, find and delete all associated inventory items with timeout protection
    const associatedInventoryItems = await Promise.race([
      InventoryItem.find({
        sourceVideoId: videoId,
        projectId: projectId,
        ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
      }).maxTimeMS(15000), // 15 second MongoDB timeout
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Inventory lookup timeout')), 20000)
      )
    ]) as any[];
    
    console.log(`🗑️ Found ${associatedInventoryItems.length} inventory items to delete with video`);
    
    if (associatedInventoryItems.length > 0) {
      await Promise.race([
        InventoryItem.deleteMany({
          sourceVideoId: videoId,
          projectId: projectId,
          ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
        }).maxTimeMS(15000), // 15 second MongoDB timeout
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Inventory deletion timeout')), 20000)
        )
      ]);
      console.log(`✅ Deleted ${associatedInventoryItems.length} associated inventory items`);
    }
    
    // Note: Cloudinary storage no longer used - files are stored in S3
    
    // Delete from MongoDB with timeout protection
    await Promise.race([
      Video.deleteOne({ _id: videoId }).maxTimeMS(15000), // 15 second MongoDB timeout
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Video deletion timeout')), 20000)
      )
    ]);
    console.log(`✅ Video deleted from database: ${videoId}`);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Video deleted successfully',
      deletedInventoryItems: associatedInventoryItems.length 
    });
    
  } catch (error) {
    console.error('Error deleting video:', error);
    
    // Handle timeout errors specifically
    if (error instanceof Error && error.message.includes('timeout')) {
      return NextResponse.json(
        { 
          error: 'Delete operation timed out. This usually indicates database connectivity issues.',
          details: error.message 
        },
        { status: 408 }
      );
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to delete video',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}