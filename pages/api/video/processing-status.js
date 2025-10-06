// pages/api/video/processing-status.js - Server-Sent Events for real-time video processing updates
import connectMongoDB from '../../../lib/mongodb';
import Video from '../../../models/Video';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { projectId } = req.query;
  
  if (!projectId) {
    return res.status(400).json({ error: 'Project ID required' });
  }

  console.log('📡 SSE connection established for project:', projectId);

  // Set up Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    projectId,
    timestamp: new Date().toISOString()
  })}\n\n`);

  let intervalId;
  let isConnected = true;
  let hasProcessingVideos = false; // Track if we have processing videos
  let connectionStartTime = Date.now();

  // Function to check and send video processing updates
  const checkVideoUpdates = async () => {
    try {
      if (!isConnected) return;

      // EMERGENCY: Auto-close connection after 5 minutes
      if (Date.now() - connectionStartTime > 5 * 60 * 1000) {
        console.log('📡 SSE auto-closing after 5 minutes to prevent leaks');
        res.end();
        return;
      }

      await connectMongoDB();

      // Get all videos for the project that are currently processing
      // Check both old metadata.processingStatus and new processingStatus/analysisResult.status fields
      const processingVideos = await Video.find({
        projectId: projectId,
        $or: [
          // Old system (frame-based processing)
          {
            'metadata.processingStatus': { 
              $in: [
                'queued_for_railway', 
                'processing_on_railway', 
                'extracting_frames',
                'processing',
                'completed'
              ] 
            }
          },
          // New system (Railway video processing)
          {
            $or: [
              { processingStatus: { $in: ['queued', 'processing', 'completed'] } },
              { 'analysisResult.status': { $in: ['pending', 'processing', 'completed'] } }
            ]
          }
        ]
      }).select('name originalName metadata extractedFrames processingStatus analysisResult createdAt').sort({ createdAt: -1 });

      // EMERGENCY: Track processing state and reduce queries when nothing is processing
      const currentlyHasProcessing = processingVideos.length > 0;
      
      if (currentlyHasProcessing) {
        hasProcessingVideos = true;
        const updates = processingVideos.map(video => {
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
          
          return {
            videoId: video._id,
            name: video.originalName,
            status: status,
            progress: progress,
            framesExtracted: video.extractedFrames?.length || 0,
            estimatedCompletion: video.metadata?.estimatedCompletion,
            error: error,
            lastUpdate: video.metadata?.lastUpdate || video.updatedAt
          };
        });

        res.write(`data: ${JSON.stringify({
          type: 'video_updates',
          projectId,
          videos: updates,
          timestamp: new Date().toISOString()
        })}\n\n`);
      } else if (hasProcessingVideos) {
        // EMERGENCY: If we had processing videos but now don't, notify and reduce frequency
        hasProcessingVideos = false;
        console.log('📡 No more processing videos, reducing query frequency');
        
        res.write(`data: ${JSON.stringify({
          type: 'processing_complete',
          projectId,
          message: 'All video processing complete',
          timestamp: new Date().toISOString()
        })}\n\n`);
        
        // Increase interval to 60 seconds when nothing is processing
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = setInterval(checkVideoUpdates, 60000);
        }
      }

      // Also check for newly completed videos that might need UI refresh
      const recentlyCompleted = await Video.find({
        projectId: projectId,
        $or: [
          // Old system
          {
            'metadata.processingStatus': 'completed',
            'metadata.processingFinished': { 
              $gte: new Date(Date.now() - 30000) // Last 30 seconds
            }
          },
          // New system - check for recently updated completed videos
          {
            $or: [
              { processingStatus: 'completed' },
              { 'analysisResult.status': 'completed' }
            ],
            updatedAt: { 
              $gte: new Date(Date.now() - 30000) // Last 30 seconds
            }
          }
        ]
      }).select('name originalName extractedFrames');

      if (recentlyCompleted.length > 0) {
        res.write(`data: ${JSON.stringify({
          type: 'processing_completed',
          projectId,
          completedVideos: recentlyCompleted.map(v => ({
            videoId: v._id,
            name: v.originalName,
            framesExtracted: v.extractedFrames?.length || 0
          })),
          timestamp: new Date().toISOString()
        })}\n\n`);
      }

    } catch (error) {
      console.error('📡 SSE update error:', error);
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: 'Failed to fetch video updates',
        timestamp: new Date().toISOString()
      })}\n\n`);
    }
  };

  // Restored from emergency 30s back to 5s for responsive updates (balanced between 2s and 30s)
  intervalId = setInterval(checkVideoUpdates, 5000);

  // Send initial check
  checkVideoUpdates();

  // Handle client disconnect
  req.on('close', () => {
    console.log('📡 SSE connection closed for project:', projectId);
    isConnected = false;
    if (intervalId) {
      clearInterval(intervalId);
    }
  });

  req.on('end', () => {
    console.log('📡 SSE connection ended for project:', projectId);
    isConnected = false;
    if (intervalId) {
      clearInterval(intervalId);
    }
  });
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

export const config = {
  api: {
    bodyParser: false, // Disable body parsing for SSE
    externalResolver: true, // Let Next.js know this is a long-running connection
  },
}