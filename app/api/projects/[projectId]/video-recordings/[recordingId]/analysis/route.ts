import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import CallAnalysisSegment from '@/models/CallAnalysisSegment';

// GET /api/projects/:projectId/video-recordings/:recordingId/analysis
// Returns the AI analysis data (summary, packing notes, transcript highlights) for a recording
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; recordingId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();

    const { projectId, recordingId } = await params;

    // Find the VideoRecording
    const recording = await VideoRecording.findOne({
      _id: recordingId,
      projectId: projectId
    }).lean();

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    // Fetch all completed segments for this recording
    const segments = await CallAnalysisSegment.find({
      videoRecordingId: recordingId,
      status: 'completed'
    }).sort({ segmentIndex: 1 }).lean();

    // Extract analysis data from segments
    const segmentAnalyses = segments.map((segment: any) => {
      const rawAnalysis = segment.rawAnalysis || {};
      return {
        segmentIndex: segment.segmentIndex,
        summary: rawAnalysis.summary || '',
        room: rawAnalysis.room || 'Unknown',
        packing_notes: rawAnalysis.packing_notes || '',
        transcript_highlights: rawAnalysis.transcript_highlights || [],
        itemCount: (rawAnalysis.furniture_items?.length || 0) +
                   (rawAnalysis.packed_boxes?.length || 0) +
                   (rawAnalysis.boxes_needed?.length || 0)
      };
    });

    // Combine all transcript highlights across segments
    const allTranscriptHighlights = segmentAnalyses.flatMap((seg: any, idx: number) =>
      (seg.transcript_highlights || []).map((highlight: any) => ({
        ...highlight,
        segmentIndex: seg.segmentIndex
      }))
    );

    // Combine all packing notes (deduplicate similar ones)
    const allPackingNotes = segmentAnalyses
      .filter((seg: any) => seg.packing_notes)
      .map((seg: any) => ({
        room: seg.room,
        notes: seg.packing_notes,
        segmentIndex: seg.segmentIndex
      }));

    // Build consolidated response
    const analysisData = {
      recordingId,
      status: (recording as any).status,
      processingPipeline: (recording as any).processingPipeline,
      consolidationResult: (recording as any).consolidationResult,
      totalSegments: segments.length,
      segments: segmentAnalyses,
      // Combined data across all segments
      transcriptHighlights: allTranscriptHighlights,
      packingNotes: allPackingNotes,
      // Overall summary (from first segment or consolidation)
      overallSummary: segmentAnalyses[0]?.summary || (recording as any).consolidationResult?.summary || ''
    };

    return NextResponse.json(analysisData);

  } catch (error) {
    console.error('Error fetching video recording analysis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video recording analysis' },
      { status: 500 }
    );
  }
}
