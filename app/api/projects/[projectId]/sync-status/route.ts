// app/api/projects/[projectId]/sync-status/route.ts - For real-time updates
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import Image from '@/models/Image';
import Video from '@/models/Video';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Verify project ownership
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get the last update time from URL params for efficient polling
    const url = new URL(request.url);
    const lastUpdate = url.searchParams.get('lastUpdate');
    const lastUpdateDate = lastUpdate ? new Date(lastUpdate) : new Date(0);

    // Check for recent inventory items (added after lastUpdate)
    const recentItems = await InventoryItem.find({
      projectId,
      userId,
      createdAt: { $gt: lastUpdateDate }
    }).sort({ createdAt: -1 });

    // Check for recent images with analysis results (include customer uploads)
    const recentImages = await Image.find({
      projectId,
      $or: [
        { userId: userId }, // Regular project uploads
        { source: 'customer_upload' }, // Customer uploads (any userId)
        { userId: null } // Anonymous uploads
      ],
      updatedAt: { $gt: lastUpdateDate },
      'analysisResult.itemsCount': { $gt: 0 }
    }).select('_id name analysisResult updatedAt source').sort({ updatedAt: -1 });

    // Check for recent videos with analysis results (include customer uploads)
    const recentVideos = await Video.find({
      projectId,
      $or: [
        { userId: userId }, // Regular project uploads
        { source: 'customer_upload' }, // Customer uploads (any userId)
        { userId: null } // Anonymous uploads
      ],
      updatedAt: { $gt: lastUpdateDate },
      'analysisResult.itemsCount': { $gt: 0 }
    }).select('_id originalName analysisResult updatedAt source').sort({ updatedAt: -1 });

    // Check for images currently being processed (include customer uploads)
    const processingImages = await Image.find({
      projectId,
      $and: [
        {
          $or: [
            { userId: userId }, // Regular project uploads
            { source: 'customer_upload' }, // Customer uploads (any userId)
            { userId: null } // Anonymous uploads
          ]
        },
        {
          $or: [
            { 'analysisResult.status': 'processing' },
            { 'analysisResult.status': 'pending' },
            { 'analysisResult.summary': 'Analysis pending...' },
            { 'analysisResult.summary': /processing|analyzing/i },
            { 'analysisResult.summary': 'AI analysis in progress...' }
          ]
        }
      ]
    }).select('_id name analysisResult source').sort({ createdAt: -1 });

    // Check for videos currently being processed
    const processingVideos = await Video.find({
      projectId,
      $and: [
        {
          $or: [
            { userId: userId }, // Regular project uploads
            { source: 'customer_upload' }, // Customer uploads (any userId)
            { userId: null } // Anonymous uploads
          ]
        },
        {
          $or: [
            { 'analysisResult.status': 'processing' },
            { 'analysisResult.status': 'pending' },
            { 'analysisResult.summary': 'Analysis pending...' },
            { 'analysisResult.summary': /processing|analyzing/i },
            { 'analysisResult.summary': 'AI video analysis in progress...' }
          ]
        }
      ]
    }).select('_id originalName analysisResult source').sort({ createdAt: -1 });

    // Calculate totals (include customer uploads)
    const totalItems = await InventoryItem.countDocuments({ projectId, userId });
    const totalImages = await Image.countDocuments({
      projectId,
      $or: [
        { userId: userId }, // Regular project uploads
        { source: 'customer_upload' }, // Customer uploads
        { userId: null } // Anonymous uploads
      ]
    });
    const totalVideos = await Video.countDocuments({
      projectId,
      $or: [
        { userId: userId }, // Regular project uploads
        { source: 'customer_upload' }, // Customer uploads
        { userId: null } // Anonymous uploads
      ]
    });

    return NextResponse.json({
      hasUpdates: recentItems.length > 0 || recentImages.length > 0 || recentVideos.length > 0,
      recentItems: recentItems.length,
      recentImages: recentImages.length,
      recentVideos: recentVideos.length,
      processingImages: processingImages.length,
      processingVideos: processingVideos.length,
      totals: {
        items: totalItems,
        images: totalImages,
        videos: totalVideos
      },
      lastChecked: new Date().toISOString(),
      processingStatus: [
        ...processingImages.map(img => ({
          id: img._id,
          name: img.name,
          status: img.analysisResult?.summary || 'Processing...',
          source: img.source || 'project_upload',
          type: 'image',
          isCustomerUpload: img.source === 'customer_upload'
        })),
        ...processingVideos.map(video => ({
          id: video._id,
          name: video.originalName,
          status: video.analysisResult?.summary || 'Processing video...',
          source: video.source || 'project_upload',
          type: 'video',
          isCustomerUpload: video.source === 'customer_upload'
        }))
      ]
    });

  } catch (error) {
    console.error('Error checking sync status:', error);
    return NextResponse.json(
      { error: 'Failed to check sync status' },
      { status: 500 }
    );
  }
}