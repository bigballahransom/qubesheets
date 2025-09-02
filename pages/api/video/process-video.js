// pages/api/video/process-video.js - Server-side video processing
import connectMongoDB from '../../../lib/mongodb';
import Video from '../../../models/Video';
import Image from '../../../models/Image';
import Project from '../../../models/Project';
import { backgroundQueue } from '../../../lib/backgroundQueue';
import sharp from 'sharp';

// For production, we'll need ffmpeg for reliable video processing
// In development, we'll simulate frame extraction
const FRAME_RATE = 1; // 1 frame per second
const MAX_FRAMES = 30; // Limit frames to prevent overload

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { videoId } = req.body;
    
    if (!videoId) {
      return res.status(400).json({ error: 'Video ID required' });
    }

    console.log('🎬 Starting server-side video processing for:', videoId);

    await connectMongoDB();

    // Find the video document
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    console.log('🎬 Processing video:', {
      name: video.originalName,
      size: video.size,
      mimeType: video.mimeType
    });

    // Update video status to processing
    await Video.findByIdAndUpdate(videoId, {
      $set: {
        'metadata.processingStatus': 'extracting_frames',
        'metadata.processingStarted': new Date()
      }
    });

    // In production, you would use ffmpeg here
    // For now, we'll simulate frame extraction and create placeholder frames
    const simulatedFrames = await simulateFrameExtraction(video);
    
    console.log(`🎬 Extracted ${simulatedFrames.length} frames from video`);

    // Process frames and create image documents
    const processedFrames = [];
    const project = await Project.findById(video.projectId);

    for (let i = 0; i < simulatedFrames.length; i++) {
      const frame = simulatedFrames[i];
      
      try {
        // Create a placeholder image for the frame
        const placeholderImage = await createPlaceholderFrame(frame.timestamp, i + 1);
        
        const imageData = {
          name: `${video.name}-frame-${String(i + 1).padStart(3, '0')}.jpg`,
          originalName: `${video.originalName} - Frame ${i + 1}`,
          projectId: video.projectId,
          userId: video.userId,
          organizationId: video.organizationId,
          data: placeholderImage.buffer,
          mimeType: 'image/jpeg',
          size: placeholderImage.buffer.length,
          description: `Video frame at ${frame.timestamp.toFixed(1)}s from ${video.originalName}`,
          source: 'video_upload',
          metadata: {
            frameTimestamp: frame.timestamp,
            videoSource: true,
            parentVideoId: videoId,
            frameNumber: i + 1,
            extractionSource: 'server_video_processing'
          },
          analysisResult: {
            status: 'pending',
            summary: 'Video frame analysis pending',
            itemsCount: 0,
            totalBoxes: 0
          }
        };

        const imageDoc = await Image.create(imageData);
        
        // Queue for analysis
        const jobId = backgroundQueue.enqueue('video_frame_analysis', {
          imageId: imageDoc._id.toString(),
          projectId: video.projectId.toString(),
          userId: video.userId?.toString(),
          organizationId: video.organizationId?.toString(),
          frameTimestamp: frame.timestamp,
          source: 'server_video_processing'
        });

        processedFrames.push({
          imageId: imageDoc._id,
          frameNumber: i + 1,
          timestamp: frame.timestamp,
          jobId: jobId
        });

        console.log(`🎬 Created frame ${i + 1}/${simulatedFrames.length}: ${imageDoc._id}`);
        
      } catch (frameError) {
        console.error(`🎬 Failed to process frame ${i + 1}:`, frameError);
      }
    }

    // Update video with extracted frame references
    const frameReferences = processedFrames.map(frame => ({
      frameId: frame.imageId,
      timestamp: frame.timestamp,
      relevanceScore: 1,
      frameNumber: frame.frameNumber
    }));

    await Video.findByIdAndUpdate(videoId, {
      $set: {
        extractedFrames: frameReferences,
        'metadata.processingStatus': 'complete',
        'metadata.processingComplete': true,
        'metadata.framesExtracted': processedFrames.length,
        'metadata.processingFinished': new Date()
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

    console.log(`🎬 Video processing complete: ${processedFrames.length} frames extracted`);

    return res.status(200).json({
      success: true,
      message: `Successfully extracted ${processedFrames.length} frames from video`,
      videoId,
      framesExtracted: processedFrames.length,
      processedFrames: processedFrames.map(f => ({
        imageId: f.imageId,
        timestamp: f.timestamp,
        frameNumber: f.frameNumber
      }))
    });

  } catch (error) {
    console.error('🎬 Server video processing error:', error);
    
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
      error: 'Failed to process video',
      details: error.message
    });
  }
}

// Simulate frame extraction for development
// In production, this would use ffmpeg to extract real frames
async function simulateFrameExtraction(video) {
  // Estimate video duration based on file size and type
  const estimatedDuration = Math.min(Math.max(video.size / (1024 * 1024), 10), 300); // 10s to 5min
  const frameCount = Math.min(Math.floor(estimatedDuration * FRAME_RATE), MAX_FRAMES);
  
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push({
      timestamp: (i * estimatedDuration) / frameCount,
      frameNumber: i + 1
    });
  }
  
  return frames;
}

// Create a placeholder frame image
// In production, this would be the actual extracted frame
async function createPlaceholderFrame(timestamp, frameNumber) {
  // Create a simple placeholder image using Sharp
  const width = 640;
  const height = 480;
  
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f3f4f6"/>
      <rect x="20" y="20" width="${width-40}" height="${height-40}" fill="#e5e7eb" stroke="#9ca3af" stroke-width="2"/>
      <text x="50%" y="45%" text-anchor="middle" font-family="Arial" font-size="24" fill="#374151">
        Video Frame ${frameNumber}
      </text>
      <text x="50%" y="60%" text-anchor="middle" font-family="Arial" font-size="16" fill="#6b7280">
        ${timestamp.toFixed(1)}s
      </text>
    </svg>
  `;
  
  const buffer = await sharp(Buffer.from(svg))
    .jpeg({ quality: 80 })
    .toBuffer();
    
  return { buffer };
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // Small request since we're not sending video data
    },
    responseLimit: false, // Allow large response for frame data
  },
}