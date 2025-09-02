// pages/api/video/railway-callback.js - Handle processed frames from Railway
import connectMongoDB from '../../../lib/mongodb';
import Video from '../../../models/Video';
import Image from '../../../models/Image';
import Project from '../../../models/Project';
import { backgroundQueue } from '../../../lib/backgroundQueue';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      videoId, 
      railwayJobId, 
      status, 
      frames, 
      error: processingError,
      processingStats 
    } = req.body;

    console.log('🚂 Railway callback received:', {
      videoId,
      railwayJobId,
      status,
      framesCount: frames?.length,
      error: processingError
    });

    // Verify authorization (basic security)
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.RAILWAY_API_KEY || 'dev-key'}`) {
      console.error('🚂 Unauthorized Railway callback');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await connectMongoDB();

    // Find the video document
    const video = await Video.findById(videoId);
    if (!video) {
      console.error('🚂 Video not found for Railway callback:', videoId);
      return res.status(404).json({ error: 'Video not found' });
    }

    if (status === 'failed') {
      // Handle processing failure
      await Video.findByIdAndUpdate(videoId, {
        $set: {
          'metadata.processingStatus': 'railway_failed',
          'metadata.processingError': processingError,
          'metadata.processingFinished': new Date()
        }
      });

      console.error('🚂 Railway processing failed for video:', videoId, processingError);
      return res.status(200).json({ success: true, message: 'Failure status updated' });
    }

    if (status === 'completed' && frames && frames.length > 0) {
      console.log(`🚂 Processing ${frames.length} frames from Railway`);

      const processedFrames = [];
      const project = await Project.findById(video.projectId);

      // Create image documents for each frame
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        
        try {
          // Convert base64 frame data back to buffer
          const frameBuffer = Buffer.from(frame.base64Data, 'base64');
          
          const imageData = {
            name: `${video.name}-frame-${String(i + 1).padStart(3, '0')}.jpg`,
            originalName: `${video.originalName} - Frame ${i + 1}`,
            projectId: video.projectId,
            userId: video.userId,
            organizationId: video.organizationId,
            data: frameBuffer,
            mimeType: 'image/jpeg',
            size: frameBuffer.length,
            description: `Video frame at ${frame.timestamp.toFixed(1)}s from ${video.originalName}`,
            source: 'video_upload',
            metadata: {
              frameTimestamp: frame.timestamp,
              videoSource: true,
              parentVideoId: videoId,
              frameNumber: i + 1,
              extractionSource: 'railway_video_processing',
              railwayJobId: railwayJobId,
              relevanceScore: frame.relevanceScore || 1,
              aiSelected: frame.aiSelected || false,
              processingStats: frame.processingStats
            },
            analysisResult: {
              status: 'pending',
              summary: 'Video frame analysis pending',
              itemsCount: 0,
              totalBoxes: 0
            }
          };

          const imageDoc = await Image.create(imageData);
          
          // Queue for analysis with high priority
          const jobId = backgroundQueue.enqueue('video_frame_analysis', {
            imageId: imageDoc._id.toString(),
            projectId: video.projectId.toString(),
            userId: video.userId?.toString(),
            organizationId: video.organizationId?.toString(),
            frameTimestamp: frame.timestamp,
            source: 'railway_video_processing',
            priority: 'high' // Prioritize video frames
          });

          processedFrames.push({
            imageId: imageDoc._id,
            frameNumber: i + 1,
            timestamp: frame.timestamp,
            relevanceScore: frame.relevanceScore,
            jobId: jobId
          });

          console.log(`🚂 Created frame ${i + 1}/${frames.length}: ${imageDoc._id}`);
          
        } catch (frameError) {
          console.error(`🚂 Failed to process frame ${i + 1} from Railway:`, frameError);
        }
      }

      // Update video with extracted frame references
      const frameReferences = processedFrames.map(frame => ({
        frameId: frame.imageId,
        timestamp: frame.timestamp,
        relevanceScore: frame.relevanceScore || 1,
        frameNumber: frame.frameNumber
      }));

      await Video.findByIdAndUpdate(videoId, {
        $set: {
          extractedFrames: frameReferences,
          'metadata.processingStatus': 'completed',
          'metadata.processingComplete': true,
          'metadata.framesExtracted': processedFrames.length,
          'metadata.processingFinished': new Date(),
          'metadata.railwayStats': processingStats
        }
      });

      // Update project
      await Project.findByIdAndUpdate(video.projectId, {
        $set: {
          lastVideoUpload: new Date(),
          hasVideoFrames: true
        },
        $inc: {
          videoFrameCount: processedFrames.length
        }
      });

      console.log(`🚂 Railway callback complete: ${processedFrames.length} frames processed for video ${videoId}`);

      return res.status(200).json({
        success: true,
        message: `Successfully processed ${processedFrames.length} frames`,
        framesProcessed: processedFrames.length
      });
    }

    // Handle other status updates
    await Video.findByIdAndUpdate(videoId, {
      $set: {
        'metadata.processingStatus': status,
        'metadata.lastUpdate': new Date()
      }
    });

    return res.status(200).json({ success: true, message: 'Status updated' });

  } catch (error) {
    console.error('🚂 Railway callback error:', error);
    return res.status(500).json({
      error: 'Failed to process Railway callback',
      details: error.message
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '100mb', // Large limit for frame data from Railway
    },
  },
}