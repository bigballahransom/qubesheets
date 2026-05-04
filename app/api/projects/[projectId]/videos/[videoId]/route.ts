// app/api/projects/[projectId]/videos/[videoId]/route.ts - Serve individual video files
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import CallAnalysisSegment from '@/models/CallAnalysisSegment';
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
        // Get counts for pagination (Video + self-serve VideoRecording)
        const selfServeFilter = {
          projectId: projectId,
          source: 'self_serve',
          status: 'completed',
          ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
        };

        const [videoCount, selfServeCount] = await Promise.all([
          Video.countDocuments(filter),
          VideoRecording.countDocuments(selfServeFilter)
        ]);
        const totalCount = videoCount + selfServeCount;

        // Get both Video documents and self-serve VideoRecordings
        const [videos, selfServeRecordings] = await Promise.all([
          Promise.race([
            Video.find(filter)
              .select('name originalName mimeType size duration description source metadata analysisResult s3RawFile createdAt updatedAt cloudinaryPublicId cloudinaryUrl cloudinarySecureUrl')
              .sort({ createdAt: -1 })
              .maxTimeMS(10000),
            new Promise<any>((_, reject) =>
              setTimeout(() => reject(new Error('Video query timeout')), 12000)
            )
          ]),
          Promise.race([
            VideoRecording.find(selfServeFilter)
              .select('roomId fileSize duration analysisResult source selfServeSessionId participants s3Key s3Url createdAt updatedAt')
              .sort({ createdAt: -1 })
              .maxTimeMS(10000),
            new Promise<any>((_, reject) =>
              setTimeout(() => reject(new Error('Self-serve query timeout')), 12000)
            )
          ])
        ]);

        // Get mergedS3Key from SelfServeRecordingSession for each self-serve recording
        const sessionIds = selfServeRecordings
          .map((r: any) => r.selfServeSessionId)
          .filter(Boolean);

        const sessions = sessionIds.length > 0
          ? await SelfServeRecordingSession.find({ sessionId: { $in: sessionIds } })
              .select('sessionId mergedS3Key')
              .lean()
          : [];

        const sessionMap = new Map(sessions.map((s: any) => [s.sessionId, s.mergedS3Key]));

        // Map self-serve VideoRecordings to Video-like structure
        const mappedSelfServe = selfServeRecordings.map((rec: any) => {
          // Get S3 key from session or recording
          const s3Key = rec.selfServeSessionId
            ? (sessionMap.get(rec.selfServeSessionId) || rec.s3Key)
            : rec.s3Key;

          // Generate display name from participants or roomId
          const customerParticipant = rec.participants?.find((p: any) => p.type === 'customer');
          const displayName = customerParticipant?.name || `Self-Serve Recording`;

          return {
            _id: rec._id,
            _type: 'self_serve_recording', // Discriminator for streaming endpoint
            name: `self-serve-${rec._id}`,
            originalName: `${displayName}.mp4`,
            mimeType: 'video/mp4',
            size: rec.fileSize || 0,
            duration: rec.duration || 0,
            source: 'self_serve',
            s3RawFile: {
              key: s3Key,
              bucket: process.env.AWS_S3_BUCKET_NAME,
              url: rec.s3Url
            },
            analysisResult: rec.analysisResult || { status: 'pending' },
            createdAt: rec.createdAt,
            updatedAt: rec.updatedAt,
            // Additional metadata for reference
            selfServeSessionId: rec.selfServeSessionId,
            participants: rec.participants
          };
        });

        // Combine and sort by createdAt descending
        const allVideos = [...videos.map((v: any) => v.toObject()), ...mappedSelfServe]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Apply pagination to combined results
        const paginatedVideos = allVideos.slice(skip, skip + limit);

        const queryTime = Date.now() - startTime;
        console.log(`🎬 Found ${videos.length} videos + ${selfServeRecordings.length} self-serve recordings (${totalCount} total) for project ${projectId} in ${queryTime}ms`);

        return NextResponse.json({
          videos: paginatedVideos,
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

        // Also delete self-serve VideoRecordings
        const selfServeFilter = {
          projectId: projectId,
          source: 'self_serve',
          ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
        };

        // Find self-serve recordings to get their IDs for related cleanup
        const selfServeRecordings = await VideoRecording.find(selfServeFilter).select('_id selfServeSessionId').maxTimeMS(15000);
        const selfServeIds = selfServeRecordings.map((r: any) => r._id.toString());
        const sessionIds = selfServeRecordings.map((r: any) => r.selfServeSessionId).filter(Boolean);

        let selfServeInventoryDeleted = 0;
        let selfServeSegmentsDeleted = 0;
        let selfServeRecordingsDeleted = 0;
        let selfServeSessionsDeleted = 0;

        if (selfServeIds.length > 0) {
          // Delete inventory items linked to self-serve recordings
          const selfServeInventoryResult = await InventoryItem.deleteMany({
            sourceVideoRecordingId: { $in: selfServeIds },
            projectId: projectId,
            ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
          }).maxTimeMS(30000);
          selfServeInventoryDeleted = selfServeInventoryResult.deletedCount;
          console.log(`🗑️ Deleted ${selfServeInventoryDeleted} inventory items for self-serve recordings`);

          // Delete analysis segments for self-serve recordings
          const segmentsResult = await CallAnalysisSegment.deleteMany({
            videoRecordingId: { $in: selfServeIds }
          }).maxTimeMS(30000);
          selfServeSegmentsDeleted = segmentsResult.deletedCount;
          console.log(`🗑️ Deleted ${selfServeSegmentsDeleted} analysis segments for self-serve recordings`);

          // Delete the VideoRecording documents
          const recordingsResult = await VideoRecording.deleteMany(selfServeFilter).maxTimeMS(30000);
          selfServeRecordingsDeleted = recordingsResult.deletedCount;
          console.log(`🗑️ Deleted ${selfServeRecordingsDeleted} self-serve VideoRecordings`);
        }

        // Delete associated SelfServeRecordingSessions
        if (sessionIds.length > 0) {
          const sessionsResult = await SelfServeRecordingSession.deleteMany({
            sessionId: { $in: sessionIds }
          }).maxTimeMS(30000);
          selfServeSessionsDeleted = sessionsResult.deletedCount;
          console.log(`🗑️ Deleted ${selfServeSessionsDeleted} SelfServeRecordingSessions`);
        }

        return NextResponse.json({
          success: true,
          message: `Successfully deleted ${videoDeleteResult.deletedCount} videos and ${selfServeRecordingsDeleted} self-serve recordings`,
          deletedVideos: videoDeleteResult.deletedCount,
          deletedInventoryItems: inventoryDeleteResult.deletedCount + selfServeInventoryDeleted,
          deletedSelfServeRecordings: selfServeRecordingsDeleted,
          deletedAnalysisSegments: selfServeSegmentsDeleted,
          deletedSessions: selfServeSessionsDeleted
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
    
    // Check if this is a self-serve recording request (via query param)
    const url = new URL(request.url);
    const recordingType = url.searchParams.get('type');

    // Handle individual video deletion
    const video = await Video.findOne({
      _id: videoId,
      projectId: projectId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
    });

    // If video not found and it might be a self-serve recording, handle that
    if (!video) {
      // Check if it's a self-serve VideoRecording
      const selfServeRecording = await VideoRecording.findOne({
        _id: videoId,
        projectId: projectId,
        source: 'self_serve',
        ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
      });

      if (!selfServeRecording) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }

      console.log(`🗑️ Deleting self-serve recording: ${videoId}`, {
        selfServeSessionId: selfServeRecording.selfServeSessionId,
        status: selfServeRecording.status,
        analysisStatus: selfServeRecording.analysisResult?.status,
        createdAt: selfServeRecording.createdAt
      });

      // Delete associated inventory items (using sourceVideoRecordingId)
      const inventoryDeleteResult = await InventoryItem.deleteMany({
        sourceVideoRecordingId: videoId,
        projectId: projectId,
        ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
      }).maxTimeMS(15000);
      console.log(`🗑️ Deleted ${inventoryDeleteResult.deletedCount} inventory items for self-serve recording`);

      // Delete associated CallAnalysisSegments
      const segmentDeleteResult = await CallAnalysisSegment.deleteMany({
        videoRecordingId: videoId
      }).maxTimeMS(15000);
      console.log(`🗑️ Deleted ${segmentDeleteResult.deletedCount} analysis segments for self-serve recording`);

      // Delete the SelfServeRecordingSession if it exists
      if (selfServeRecording.selfServeSessionId) {
        await SelfServeRecordingSession.deleteOne({
          sessionId: selfServeRecording.selfServeSessionId
        });
        console.log(`🗑️ Deleted SelfServeRecordingSession: ${selfServeRecording.selfServeSessionId}`);
      }

      // Delete the VideoRecording
      await VideoRecording.deleteOne({ _id: videoId });
      console.log(`✅ Self-serve recording deleted: ${videoId}`);

      return NextResponse.json({
        success: true,
        message: 'Self-serve recording deleted successfully',
        deletedInventoryItems: inventoryDeleteResult.deletedCount,
        deletedSegments: segmentDeleteResult.deletedCount
      });
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