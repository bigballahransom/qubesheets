// app/api/projects/[projectId]/videos/[videoId]/chapters/route.ts
// Returns chapter (room-by-room) data for an uploaded Video, or empty if none.
//
// Today's uploaded videos flow through railway-video-service which writes only
// a flat Video.analysisResult, so this endpoint returns `segments: []` for most
// uploads. It exists so the UI can request chapters unconditionally; when the
// upload pipeline migrates to railway-call-service (or a parallel writer fills
// in CallAnalysisSegment rows keyed by the Video's S3 path), this endpoint
// will start returning real chapters with no frontend change required.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import CallAnalysisSegment from '@/models/CallAnalysisSegment';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const { projectId, videoId } = await params;

    const video = await Video.findOne(
      getOrgFilter(authContext, { _id: videoId, projectId })
    ).select('s3RawFile').lean() as any;

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Forward-compat lookup by s3Key. When upload processing starts writing
    // CallAnalysisSegment rows that share the upload's S3 key, this picks them
    // up without any other change.
    const s3Key = video.s3RawFile?.key;
    const segments = s3Key
      ? await CallAnalysisSegment.find({ s3Key, status: 'completed' })
          .sort({ segmentIndex: 1 })
          .lean()
      : [];

    const segmentAnalyses = segments.map((segment: any) => {
      const rawAnalysis = segment.rawAnalysis || {};
      const items = [
        ...(rawAnalysis.furniture_items || []),
        ...(rawAnalysis.packed_boxes || []),
        ...(rawAnalysis.boxes_needed || []),
      ]
        .filter((i: any) => i?.room && i?.timestamp)
        .map((i: any) => ({ room: i.room, timestamp: i.timestamp }));

      return {
        segmentIndex: segment.segmentIndex,
        summary: rawAnalysis.summary || '',
        room: rawAnalysis.room || 'Unknown',
        itemCount:
          (rawAnalysis.furniture_items?.length || 0) +
          (rawAnalysis.packed_boxes?.length || 0) +
          (rawAnalysis.boxes_needed?.length || 0),
        items,
      };
    });

    return NextResponse.json({
      videoId,
      totalSegments: segmentAnalyses.length,
      segments: segmentAnalyses,
    });
  } catch (error) {
    console.error('Error fetching video chapters:', error);
    return NextResponse.json({ error: 'Failed to fetch chapters' }, { status: 500 });
  }
}
