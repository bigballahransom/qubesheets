// app/api/projects/[projectId]/videos/[videoId]/metadata/route.ts - Get video metadata without streaming
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/videos/:videoId/metadata - Get video metadata only
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  try {
    console.log('🎬 Video metadata request received');
    
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    
    const { projectId, videoId } = await params;
    console.log(`🔍 Looking for video metadata: ${videoId} in project: ${projectId}`);
    
    // Find the video and verify permissions
    const video = await Video.findOne(getOrgFilter(authContext, { 
      _id: videoId,
      projectId: projectId 
    })).select('name originalName mimeType size duration description analysisResult source metadata createdAt updatedAt s3RawFile');
    
    if (!video) {
      console.log('❌ Video not found');
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    console.log('✅ Video metadata found:', {
      videoId: video._id,
      videoName: video.originalName,
      hasS3File: !!video.s3RawFile?.key,
      hasS3Url: !!video.s3RawFile?.url,
      s3FileKeys: video.s3RawFile ? Object.keys(video.s3RawFile) : [],
      hasCloudinaryUrl: !!(video.cloudinarySecureUrl || video.cloudinaryUrl),
      hasData: !!video.data,
      dataSize: video.data?.length || 0,
      duration: video.duration,
      size: video.size,
      mimeType: video.mimeType
    });

    // Return video metadata without streaming URL
    const videoMetadata = {
      _id: video._id,
      name: video.name,
      originalName: video.originalName,
      mimeType: video.mimeType,
      size: video.size,
      duration: video.duration,
      description: video.description,
      analysisResult: video.analysisResult,
      source: video.source,
      metadata: video.metadata,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
      hasS3File: !!video.s3RawFile?.key,
      type: 'video'
    };

    return NextResponse.json({
      success: true,
      video: videoMetadata
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300', // 5 minutes cache for metadata
        'X-Content-Type': 'video-metadata'
      }
    });

  } catch (error) {
    console.error('❌ Error fetching video metadata:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video metadata' },
      { status: 500 }
    );
  }
}