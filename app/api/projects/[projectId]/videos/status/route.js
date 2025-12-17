// app/api/projects/[projectId]/videos/status/route.js
// Polling-based video status endpoint optimized for Vercel

import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import { getAuthContext, getProjectFilter } from '@/lib/auth-helpers';
import { retryWithBackoff } from '@/lib/mongodb';

// GET /api/projects/:projectId/videos/status - Get processing status for videos
export async function GET(request, { params }) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Use retry logic for database queries
    const videos = await retryWithBackoff(async () => {
      // Get all videos for the project with minimal fields
      return await Video.find(
        getProjectFilter(authContext, projectId)
      ).select('name originalName processingStatus analysisResult metadata extractedFrames updatedAt')
        .sort({ createdAt: -1 })
        .lean(); // Use lean() for better performance
    }, 2, 500); // 2 retries with 500ms base delay

    // Process videos to determine status
    const processedVideos = videos.map(video => {
      // Determine which system this video uses
      const isNewSystem = video.processingStatus || video.analysisResult?.status;
      
      let status, progress, error;
      
      if (isNewSystem) {
        // New Railway system
        status = video.analysisResult?.status || video.processingStatus || 'unknown';
        progress = calculateProgressNew(video.processingStatus, video.analysisResult?.status);
        error = video.analysisResult?.error;
      } else {
        // Old frame-based system
        status = video.metadata?.processingStatus || 'unknown';
        progress = calculateProgress(video.metadata);
        error = video.metadata?.processingError;
      }
      
      // Only include videos that are processing or recently completed
      const isProcessing = ['queued', 'processing', 'extracting_frames', 'queued_for_railway', 'processing_on_railway', 'pending'].includes(status);
      const recentlyCompleted = status === 'completed' && 
        new Date(video.updatedAt) > new Date(Date.now() - 60000); // Last minute
      
      if (!isProcessing && !recentlyCompleted) {
        return null;
      }
      
      return {
        videoId: video._id,
        name: video.originalName || video.name,
        status,
        progress,
        framesExtracted: video.extractedFrames?.length || 0,
        error,
        lastUpdate: video.updatedAt
      };
    }).filter(Boolean); // Remove null entries

    return NextResponse.json({
      videos: processedVideos,
      hasActiveProcessing: processedVideos.some(v => v.progress < 100 && v.progress >= 0),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching video status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video status' },
      { status: 500 }
    );
  }
}

// Calculate processing progress based on status (old system)
function calculateProgress(metadata) {
  if (!metadata) return 0;
  
  const status = metadata.processingStatus;
  
  switch (status) {
    case 'queued_for_railway':
      return 10;
    case 'processing_on_railway':
    case 'extracting_frames':
      return 50;
    case 'processing':
      return 80;
    case 'completed':
      return 100;
    case 'failed':
    case 'railway_failed':
      return -1; // Indicate error
    default:
      return 0;
  }
}

// Calculate processing progress for new Railway system
function calculateProgressNew(processingStatus, analysisStatus) {
  // Prioritize analysisResult.status as it's more specific
  const status = analysisStatus || processingStatus;
  
  switch (status) {
    case 'queued':
    case 'pending':
      return 10;
    case 'processing':
      return 70;
    case 'completed':
      return 100;
    case 'failed':
      return -1; // Indicate error
    default:
      return 0;
  }
}