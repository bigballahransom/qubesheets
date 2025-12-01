// app/api/projects/[projectId]/sync-status/route.ts - For real-time updates
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import mongoose from 'mongoose';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import Image from '@/models/Image';
import Video from '@/models/Video';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext; // Return 401 error response
    }

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Verify project ownership using organization-aware filter
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get the last update time from URL params for efficient polling
    const url = new URL(request.url);
    const lastUpdate = url.searchParams.get('lastUpdate');
    const lastUpdateDate = lastUpdate ? new Date(lastUpdate) : new Date(0);

    // Check for recent inventory items (added after lastUpdate)
    const recentItems = await InventoryItem.find(
      getProjectFilter(authContext, projectId, { createdAt: { $gt: lastUpdateDate } })
    ).sort({ createdAt: -1 });

    // Check for recent images with analysis results (include customer uploads)
    const baseImageFilter = getProjectFilter(authContext, projectId, {
      updatedAt: { $gt: lastUpdateDate },
      'analysisResult.itemsCount': { $gt: 0 }
    });
    
    // Add customer upload logic - for organization accounts, also include customer uploads for this project
    const imageFilter = {
      ...baseImageFilter,
      $or: [
        baseImageFilter, // Regular project uploads with org/user filter
        { 
          projectId: new mongoose.Types.ObjectId(projectId),
          source: 'customer_upload',
          updatedAt: { $gt: lastUpdateDate },
          'analysisResult.itemsCount': { $gt: 0 }
        }
      ]
    };
    
    const recentImages = await Image.find(imageFilter).select('_id name analysisResult updatedAt source').sort({ updatedAt: -1 });

    // Check for recent videos with analysis results (include customer uploads)
    const baseVideoFilter = getProjectFilter(authContext, projectId, {
      updatedAt: { $gt: lastUpdateDate },
      'analysisResult.itemsCount': { $gt: 0 }
    });
    
    // Add customer upload logic - for organization accounts, also include customer uploads for this project
    const videoFilter = {
      ...baseVideoFilter,
      $or: [
        baseVideoFilter, // Regular project uploads with org/user filter
        { 
          projectId: new mongoose.Types.ObjectId(projectId),
          source: 'customer_upload',
          updatedAt: { $gt: lastUpdateDate },
          'analysisResult.itemsCount': { $gt: 0 }
        }
      ]
    };
    
    const recentVideos = await Video.find(videoFilter).select('_id originalName analysisResult updatedAt source').sort({ updatedAt: -1 });

    // Check for images currently being processed (include customer uploads)
    const baseProcessingImageFilter = getProjectFilter(authContext, projectId, {});
    
    const processingImageFilter = {
      $and: [
        {
          $or: [
            baseProcessingImageFilter, // Regular project uploads with org/user filter
            { 
              projectId: new mongoose.Types.ObjectId(projectId),
              source: 'customer_upload'
            }
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
    };
    
    const processingImages = await Image.find(processingImageFilter).select('_id name analysisResult source').sort({ createdAt: -1 });

    // Check for videos currently being processed
    const baseProcessingVideoFilter = getProjectFilter(authContext, projectId, {});
    
    const processingVideoFilter = {
      $and: [
        {
          $or: [
            baseProcessingVideoFilter, // Regular project uploads with org/user filter
            { 
              projectId: new mongoose.Types.ObjectId(projectId),
              source: 'customer_upload'
            }
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
    };
    
    const processingVideos = await Video.find(processingVideoFilter).select('_id originalName analysisResult source').sort({ createdAt: -1 });

    // Calculate totals (include customer uploads)
    const totalItems = await InventoryItem.countDocuments(getProjectFilter(authContext, projectId));
    
    const totalImagesFilter = {
      $or: [
        getProjectFilter(authContext, projectId), // Regular project uploads with org/user filter
        { 
          projectId: new mongoose.Types.ObjectId(projectId),
          source: 'customer_upload'
        }
      ]
    };
    const totalImages = await Image.countDocuments(totalImagesFilter);
    
    const totalVideosFilter = {
      $or: [
        getProjectFilter(authContext, projectId), // Regular project uploads with org/user filter
        { 
          projectId: new mongoose.Types.ObjectId(projectId),
          source: 'customer_upload'
        }
      ]
    };
    const totalVideos = await Video.countDocuments(totalVideosFilter);

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