// app/api/projects/[projectId]/processing-status/route.ts
// Database-only processing status - single source of truth

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import CustomerUpload from '@/models/CustomerUpload';

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
    // Vault media ('skipped' status / purpose 'vault') is never processed —
    // it must not appear in the "Processing N items…" indicator.
    const [processingImages, processingVideos, processingCalls] = await Promise.all([
      Image.find({
        projectId,
        purpose: { $ne: 'vault' },
        'analysisResult.status': { $nin: ['completed', 'skipped'] }
      }).select('_id name originalName processingStatus analysisResult createdAt').lean(),

      Video.find({
        projectId,
        purpose: { $ne: 'vault' },
        'analysisResult.status': { $nin: ['completed', 'skipped'] }
      }).select('_id name originalName processingStatus analysisResult createdAt source').lean(),

      // Video call recordings being recorded OR analyzed
      VideoRecording.find({
        projectId,
        purpose: { $ne: 'vault' },
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
      }).select('_id roomId analysisResult customerEgressStatus createdAt source selfServeSessionId').lean()
    ]);

    // On-site walkthroughs share the self-serve pipeline; provenance only
    // lives on CustomerUpload, reached via the recording's session. Only pay
    // for the join when a self-serve recording is actually processing.
    const selfServeSessionIds = processingCalls
      .filter((c: any) => c.source === 'self_serve' && c.selfServeSessionId)
      .map((c: any) => c.selfServeSessionId);
    let walkthroughSessionIds = new Set<string>();
    if (selfServeSessionIds.length > 0) {
      const sessions = await SelfServeRecordingSession.find({ sessionId: { $in: selfServeSessionIds } })
        .select('sessionId customerUploadId').lean();
      const uploadIds = sessions.map((s: any) => s.customerUploadId).filter(Boolean);
      const walkthroughUploads = uploadIds.length > 0
        ? await CustomerUpload.find({
            _id: { $in: uploadIds },
            $or: [{ isWalkthrough: true }, { customerName: 'On-site walkthrough' }]
          }).select('_id').lean()
        : [];
      const walkthroughUploadIds = new Set(walkthroughUploads.map((u: any) => u._id.toString()));
      walkthroughSessionIds = new Set(
        sessions
          .filter((s: any) => s.customerUploadId && walkthroughUploadIds.has(s.customerUploadId.toString()))
          .map((s: any) => s.sessionId)
      );
    }

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
        const isWalkthrough = isSelfServe && walkthroughSessionIds.has(call.selfServeSessionId);
        return {
          id: call._id.toString(),
          name: isSelfServe
            ? (isWalkthrough ? `On-Site Walkthrough` : `Self-Serve Recording`)
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