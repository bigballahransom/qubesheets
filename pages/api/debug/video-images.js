// pages/api/debug/video-images.js - Debug endpoint to check video frames in database
import connectMongoDB from '../../../lib/mongodb';
import Image from '../../../models/Image';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await connectMongoDB();
    
    const { projectId } = req.query;
    
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    // Find all images for the project
    const allImages = await Image.find({ projectId })
      .select('name originalName source metadata createdAt analysisResult')
      .sort({ createdAt: -1 });
    
    // Filter video frames
    const videoFrames = allImages.filter(img => 
      img.source === 'video_upload' || 
      img.metadata?.videoSource === true ||
      img.name?.includes('video_frame')
    );
    
    console.log('🔍 Debug query results:', {
      totalImages: allImages.length,
      videoFrames: videoFrames.length,
      projectId
    });
    
    return res.status(200).json({
      success: true,
      projectId,
      totalImages: allImages.length,
      videoFrames: videoFrames.length,
      allImages: allImages.map(img => ({
        id: img._id,
        name: img.name,
        originalName: img.originalName,
        source: img.source,
        hasVideoMetadata: !!img.metadata?.videoSource,
        createdAt: img.createdAt
      })),
      videoFramesDetails: videoFrames.map(img => ({
        id: img._id,
        name: img.name,
        source: img.source,
        metadata: img.metadata,
        createdAt: img.createdAt,
        analysisResult: img.analysisResult
      }))
    });

  } catch (error) {
    console.error('Debug endpoint error:', error);
    return res.status(500).json({ 
      error: 'Debug query failed',
      details: error.message 
    });
  }
}