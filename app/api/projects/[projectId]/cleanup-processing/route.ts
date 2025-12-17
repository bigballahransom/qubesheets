// app/api/projects/[projectId]/cleanup-processing/route.ts
// Emergency cleanup for stale processing items

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';

// POST: Clean up old processing items
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    
    console.log(`🧹 Emergency cleanup: Fixing stale processing items for project ${projectId}`);
    
    await connectMongoDB();
    
    // Mark old items as completed (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const [imageResults, videoResults] = await Promise.all([
      Image.updateMany(
        { 
          projectId, 
          processingStatus: { $ne: 'completed' },
          createdAt: { $lt: oneHourAgo }
        },
        { $set: { processingStatus: 'completed' } }
      ),
      
      Video.updateMany(
        { 
          projectId, 
          processingStatus: { $ne: 'completed' },
          createdAt: { $lt: oneHourAgo }
        },
        { $set: { processingStatus: 'completed' } }
      )
    ]);
    
    const totalCleaned = imageResults.modifiedCount + videoResults.modifiedCount;
    
    console.log(`🧹 Cleanup completed: marked ${totalCleaned} items as completed (${imageResults.modifiedCount} images, ${videoResults.modifiedCount} videos)`);
    
    return NextResponse.json({ 
      success: true,
      cleaned: totalCleaned,
      images: imageResults.modifiedCount,
      videos: videoResults.modifiedCount,
      message: `Marked ${totalCleaned} old items as completed`
    });
    
  } catch (error) {
    console.error('❌ Emergency cleanup error:', error);
    return NextResponse.json({ 
      error: 'Cleanup failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}