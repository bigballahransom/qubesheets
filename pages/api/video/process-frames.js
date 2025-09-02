// pages/api/video/process-frames.js - Process video frames separately from regular photos
import connectMongoDB from '../../../lib/mongodb';
import { backgroundQueue } from '../../../lib/backgroundQueue';
import Image from '../../../models/Image';
import Video from '../../../models/Video';
import Project from '../../../models/Project';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🎬 Video process-frames API called');
    console.log('🎬 Request body keys:', Object.keys(req.body));
    
    const { frames, projectId, uploadLinkId, source = 'video_upload', videoId } = req.body;
    
    console.log('🎬 Extracted params:', {
      framesCount: frames?.length,
      projectId,
      uploadLinkId,
      source,
      videoId
    });

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      console.error('🎬 No frames provided:', frames);
      return res.status(400).json({ error: 'No frames provided' });
    }

    if (!projectId) {
      console.error('🎬 No project ID provided');
      return res.status(400).json({ error: 'Project ID required' });
    }

    console.log(`🎬 Processing ${frames.length} video frames for project ${projectId}`);

    // Connect to MongoDB using Mongoose
    await connectMongoDB();

    // Verify project exists using Mongoose
    const project = await Project.findById(projectId);
    if (!project) {
      console.error('🎬 Project not found:', projectId);
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log('🎬 Project found:', project.name);

    // If upload link provided, we'd update the video upload link count here
    // For now, we'll skip this since we're focusing on the main functionality

    const processedFrames = [];
    const queuedJobs = [];

    console.log('🎬 Starting to process frames...');

    for (const frame of frames) {
      try {
        console.log(`🎬 Processing frame at ${frame.timestamp}s`);
        
        // Convert base64 to buffer
        const imageBuffer = Buffer.from(frame.base64, 'base64');
        
        // Create image document for video frame with same structure as regular photos
        const imageData = {
          name: `video_frame_${frame.timestamp.toFixed(1)}s.jpg`,
          originalName: `video_frame_${frame.timestamp.toFixed(1)}s.jpg`,
          projectId: projectId, // Mongoose will convert string to ObjectId automatically
          userId: project.userId,
          data: imageBuffer,
          mimeType: 'image/jpeg',
          size: imageBuffer.length,
          description: `Video frame at ${frame.timestamp.toFixed(1)}s (${source})`,
          source: source, // 'video_upload' vs 'photo_upload'
          metadata: {
            frameTimestamp: frame.timestamp,
            videoSource: true,
            relevanceScore: frame.relevanceScore || 0,
            extractionSource: source,
            parentVideoId: videoId || null
          },
          analysisResult: {
            status: 'pending',
            summary: 'Video frame analysis pending',
            itemsCount: 0,
            totalBoxes: 0,
            createdAt: new Date()
          }
        };
        
        // Only add organizationId if the project has one
        if (project.organizationId) {
          imageData.organizationId = project.organizationId;
        }
        
        console.log('🎬 Creating image with data:', {
          name: imageData.name,
          projectId: imageData.projectId,
          userId: imageData.userId,
          organizationId: imageData.organizationId,
          size: imageData.size
        });
        
        const imageDoc = await Image.create(imageData);

        console.log(`🎬 Created image document: ${imageDoc._id}`);

        // Queue for background analysis (separate type for video frames)
        const queueId = backgroundQueue.enqueue(
          'video_frame_analysis', // Different type from regular 'image_analysis'
          {
            imageId: imageDoc._id.toString(),
            projectId,
            userId: project.userId.toString(),
            organizationId: project.organizationId?.toString(),
            frameTimestamp: frame.timestamp,
            source: 'video_upload'
          },
          0, // No delay
          imageBuffer.length
        );

        processedFrames.push({
          frameTimestamp: frame.timestamp,
          imageId: imageDoc._id.toString(),
          queueId,
          size: imageBuffer.length
        });

        queuedJobs.push(queueId);

        console.log(`✅ Processed video frame ${frame.timestamp}s -> imageId: ${imageDoc._id}, queueId: ${queueId}`);

      } catch (frameError) {
        console.error(`❌ Failed to process frame at ${frame.timestamp}s:`, frameError);
      }
    }

    // Update the original video document with extracted frame references
    if (videoId && processedFrames.length > 0) {
      try {
        const frameReferences = processedFrames.map(frame => ({
          frameId: frame.imageId,
          timestamp: frame.frameTimestamp,
          relevanceScore: frame.relevanceScore || 1
        }));
        
        await Video.findByIdAndUpdate(videoId, {
          $set: {
            extractedFrames: frameReferences,
            'metadata.processingComplete': true,
            'metadata.framesExtracted': processedFrames.length
          }
        });
        
        console.log(`🎬 Updated video ${videoId} with ${processedFrames.length} frame references`);
      } catch (videoUpdateError) {
        console.error('🎬 Failed to update video document:', videoUpdateError);
        // Don't fail the entire request if video update fails
      }
    }
    
    // Update project with video processing metadata using Mongoose
    await Project.findByIdAndUpdate(projectId, {
      $set: {
        lastVideoUpload: new Date(),
        hasVideoFrames: true
      },
      $inc: {
        videoFrameCount: processedFrames.length
      }
    });

    console.log(`🎬 Successfully processed ${processedFrames.length}/${frames.length} video frames`);

    return res.status(200).json({
      success: true,
      message: `Processed ${processedFrames.length} video frames`,
      processedFrames: processedFrames.length,
      totalFrames: frames.length,
      queuedJobs,
      processedFrameDetails: processedFrames,
      projectId
    });

  } catch (error) {
    console.error('🎬 Video frame processing error:', error);
    console.error('🎬 Error stack:', error.stack);
    return res.status(500).json({ 
      error: 'Failed to process video frames',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Increase body size limit for video frames
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb', // Allow for multiple video frames
    },
  },
}