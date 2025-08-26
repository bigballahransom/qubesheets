// app/api/projects/[projectId]/sync-status/route.ts - For real-time updates
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import Image from '@/models/Image';

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

    // Check for recent images with analysis results
    const recentImages = await Image.find({
      projectId,
      userId,
      updatedAt: { $gt: lastUpdateDate },
      'analysisResult.itemsCount': { $gt: 0 }
    }).select('_id name analysisResult updatedAt').sort({ updatedAt: -1 });

    // Check for images currently being processed
    const processingImages = await Image.find({
      projectId,
      userId,
      $or: [
        { 'analysisResult.status': 'processing' },
        { 'analysisResult.status': 'pending' },
        { 'analysisResult.summary': 'Analysis pending...' },
        { 'analysisResult.summary': /processing|analyzing/i },
        { 'analysisResult.summary': 'AI analysis in progress...' }
      ]
    }).select('_id name analysisResult').sort({ createdAt: -1 });

    // Calculate totals
    const totalItems = await InventoryItem.countDocuments({ projectId, userId });
    const totalImages = await Image.countDocuments({ projectId, userId });

    return NextResponse.json({
      hasUpdates: recentItems.length > 0 || recentImages.length > 0,
      recentItems: recentItems.length,
      recentImages: recentImages.length,
      processingImages: processingImages.length,
      totals: {
        items: totalItems,
        images: totalImages
      },
      lastChecked: new Date().toISOString(),
      processingStatus: processingImages.map(img => ({
        id: img._id,
        name: img.name,
        status: img.analysisResult?.summary || 'Processing...'
      }))
    });

  } catch (error) {
    console.error('Error checking sync status:', error);
    return NextResponse.json(
      { error: 'Failed to check sync status' },
      { status: 500 }
    );
  }
}