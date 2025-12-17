// app/api/projects/[projectId]/processing-status/route.ts
// Database-only processing status - single source of truth

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';

// GET: Get all currently processing items from database
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    
    console.log(`📊 Database query: Getting processing status for project ${projectId}`);
    
    await connectMongoDB();
    
    // Query database for all items that are currently processing
    // Check analysisResult.status as this is what railway services actually update
    const [processingImages, processingVideos] = await Promise.all([
      Image.find({ 
        projectId, 
        'analysisResult.status': { $ne: 'completed' } 
      }).select('_id name originalName processingStatus analysisResult createdAt').lean(),
      
      Video.find({ 
        projectId, 
        'analysisResult.status': { $ne: 'completed' } 
      }).select('_id name originalName processingStatus analysisResult createdAt source').lean()
    ]);
    
    // Format for consistent response
    const processingItems = [
      ...processingImages.map((img: any) => ({
        id: img._id.toString(),
        name: img.originalName || img.name,
        type: 'image' as const,
        status: img.analysisResult?.status || img.processingStatus || 'processing',
        startTime: new Date(img.createdAt).getTime(),
        source: 'image_upload'
      })),
      ...processingVideos.map((vid: any) => ({
        id: vid._id.toString(),
        name: vid.originalName || vid.name,
        type: 'video' as const,
        status: vid.analysisResult?.status || vid.processingStatus || 'processing',
        startTime: new Date(vid.createdAt).getTime(),
        source: vid.source || 'video_upload'
      }))
    ];
    
    console.log(`📊 Database result: ${processingItems.length} items processing (${processingImages.length} images, ${processingVideos.length} videos)`);
    
    return NextResponse.json({ 
      success: true,
      items: processingItems,
      count: processingItems.length
    });
    
  } catch (error) {
    console.error('❌ Error querying processing status:', error);
    return NextResponse.json({ 
      error: 'Failed to get processing status',
      success: false,
      items: [],
      count: 0 
    }, { status: 500 });
  }
}