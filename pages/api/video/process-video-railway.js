// pages/api/video/process-video-railway.js - DISABLED: Video processing moved to client-side
// This endpoint is disabled because videos are now stored in Cloudinary instead of MongoDB Buffer
// Railway still processes image frames extracted from videos, but video-to-frames extraction
// is now handled client-side to avoid compatibility issues with Cloudinary storage

export default async function handler(req, res) {
  // Return early with disabled message
  return res.status(503).json({ 
    error: 'Video-to-Railway processing is disabled', 
    message: 'Video frame extraction is now handled client-side. Railway still processes individual image frames.',
    details: 'This endpoint was disabled when video storage moved from MongoDB Buffer to Cloudinary URLs.'
  });

  // COMMENTED OUT - Original Railway video processing code
  /*
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { videoId } = req.body;
    
    if (!videoId) {
      return res.status(400).json({ error: 'Video ID required' });
    }

    console.log('🚂 Sending video to Railway for processing:', videoId);

    await connectMongoDB();

    // Find the video document
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Update video status to processing
    await Video.findByIdAndUpdate(videoId, {
      $set: {
        'metadata.processingStatus': 'queued_for_railway',
        'metadata.processingStarted': new Date(),
        'metadata.railwayProcessing': true
      }
    });

    console.log('🚂 Sending video to Railway processor:', {
      videoId,
      name: video.originalName,
      size: video.size,
      mimeType: video.mimeType
    });

    // Send video to Railway service for processing
    const railwayResponse = await fetch(`${RAILWAY_VIDEO_PROCESSOR_URL}/api/process-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RAILWAY_API_KEY || 'dev-key'}`,
      },
      body: JSON.stringify({
        videoId: videoId,
        videoData: {
          name: video.name,
          originalName: video.originalName,
          mimeType: video.mimeType,
          size: video.size,
          projectId: video.projectId,
          userId: video.userId,
          organizationId: video.organizationId
        },
        // Send video data as base64 for Railway processing
        videoBuffer: video.data.toString('base64'),
        callbackUrl: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/video/railway-callback`,
        processingOptions: {
          frameRate: 1, // 1 frame per second
          maxFrames: 30,
          quality: 'medium',
          smartSelection: true // Use AI to select best frames
        }
      }),
      // Long timeout for video processing
      signal: AbortSignal.timeout(300000) // 5 minute timeout
    });

    if (!railwayResponse.ok) {
      const errorText = await railwayResponse.text();
      console.error('🚂 Railway processing failed:', errorText);
      
      // Update video status to failed
      await Video.findByIdAndUpdate(videoId, {
        $set: {
          'metadata.processingStatus': 'railway_failed',
          'metadata.processingError': `Railway error: ${errorText}`,
          'metadata.processingFinished': new Date()
        }
      });
      
      throw new Error(`Railway processing failed: ${errorText}`);
    }

    const railwayResult = await railwayResponse.json();
    console.log('🚂 Railway processing started:', railwayResult);

    // Update video with Railway job information
    await Video.findByIdAndUpdate(videoId, {
      $set: {
        'metadata.processingStatus': 'processing_on_railway',
        'metadata.railwayJobId': railwayResult.jobId,
        'metadata.estimatedCompletion': railwayResult.estimatedCompletion
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Video sent to Railway for processing',
      videoId,
      railwayJobId: railwayResult.jobId,
      estimatedCompletion: railwayResult.estimatedCompletion,
      status: 'processing_on_railway'
    });

  } catch (error) {
    console.error('🚂 Railway video processing error:', error);
    
    // Update video status to failed
    if (req.body.videoId) {
      try {
        await Video.findByIdAndUpdate(req.body.videoId, {
          $set: {
            'metadata.processingStatus': 'failed',
            'metadata.processingError': error.message,
            'metadata.processingFinished': new Date()
          }
        });
      } catch (updateError) {
        console.error('Failed to update video error status:', updateError);
      }
    }
    
    return res.status(500).json({
      error: 'Failed to process video on Railway',
      details: error.message
    });
  }
  */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '150mb', // Large limit for video data
    },
    responseLimit: false,
  },
}