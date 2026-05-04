// app/api/projects/[projectId]/processing-status/route.ts
// Database-only processing status - single source of truth

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';

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
    const [processingImages, processingVideos, processingCalls] = await Promise.all([
      Image.find({
        projectId,
        'analysisResult.status': { $ne: 'completed' }
      }).select('_id name originalName processingStatus analysisResult createdAt').lean(),

      Video.find({
        projectId,
        'analysisResult.status': { $ne: 'completed' }
      }).select('_id name originalName processingStatus analysisResult createdAt source').lean(),

      // Video call recordings being recorded OR analyzed
      VideoRecording.find({
        projectId,
        $or: [
          // Customer egress is active (starting or recording)
          { customerEgressStatus: { $in: ['starting', 'recording'] } },
          // Analysis is pending or in progress
          { 'analysisResult.status': { $in: ['pending', 'processing'] } },
          // Customer egress completed but analysis not done yet (catches undefined status)
          // This matches calls where egress finished but railway hasn't marked complete/failed
          {
            customerEgressStatus: 'completed',
            'analysisResult.status': { $nin: ['completed', 'failed'] }
          }
        ]
      }).select('_id roomId analysisResult customerEgressStatus createdAt source').lean()
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
      })),
      ...processingCalls.map((call: any) => {
        // Self-serve recordings are videos, not calls. Reclassify so the UI
        // says "Processing 1 video..." instead of "Processing 1 call..." for
        // customer self-serve walkthroughs.
        const isSelfServe = call.source === 'self_serve';
        return {
          id: call._id.toString(),
          name: isSelfServe
            ? `Self-Serve Recording`
            : `Call ${call.roomId?.split('-').pop() || 'Recording'}`,
          type: (isSelfServe ? 'video' : 'call') as 'video' | 'call',
          status: 'processing',
          startTime: new Date(call.createdAt).getTime(),
          source: isSelfServe ? 'self_serve' : 'video_call'
        };
      })
    ];

    console.log(`📊 Database result: ${processingItems.length} items processing (${processingImages.length} images, ${processingVideos.length} videos, ${processingCalls.length} calls)`);
    
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