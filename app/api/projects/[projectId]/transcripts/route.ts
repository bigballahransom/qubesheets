// app/api/projects/[projectId]/transcripts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import TranscriptSegment from '@/models/TranscriptSegment';
import VideoRecording from '@/models/VideoRecording';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const { searchParams } = new URL(request.url);

    // Query parameters
    const roomId = searchParams.get('roomId');
    const videoRecordingId = searchParams.get('videoRecordingId');
    const since = searchParams.get('since'); // ISO timestamp for incremental sync

    if (!roomId && !videoRecordingId) {
      return NextResponse.json(
        { error: 'Either roomId or videoRecordingId is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Build query
    const query: any = { projectId };

    if (videoRecordingId) {
      // Fetch by recording ID (for playback)
      query.videoRecordingId = videoRecordingId;
    } else if (roomId) {
      // Fetch by room ID (for live calls)
      query.roomId = roomId;
    }

    // Incremental sync - only get segments created after 'since' timestamp
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        query.createdAt = { $gt: sinceDate };
      }
    }

    // Fetch segments ordered by startTime
    const segments = await TranscriptSegment.find(query)
      .sort({ startTime: 1 })
      .lean();

    // Get the latest timestamp for next incremental sync
    const lastTimestamp = segments.length > 0
      ? segments[segments.length - 1].createdAt
      : null;

    return NextResponse.json({
      segments: segments.map(seg => ({
        _id: seg._id.toString(),
        speaker: seg.speaker,
        speakerName: seg.speakerName,
        text: seg.text,
        startTime: seg.startTime,
        endTime: seg.endTime,
        segmentIndex: seg.segmentIndex,
        createdAt: seg.createdAt,
      })),
      lastTimestamp: lastTimestamp?.toISOString() || null,
      count: segments.length,
    });

  } catch (error: any) {
    console.error('Error fetching transcripts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transcripts', details: error.message },
      { status: 500 }
    );
  }
}

// Link transcript segments to a video recording after call ends
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const { roomId, videoRecordingId } = await request.json();

    if (!roomId || !videoRecordingId) {
      return NextResponse.json(
        { error: 'roomId and videoRecordingId are required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Update all transcript segments for this room to link to the recording
    const result = await TranscriptSegment.updateMany(
      { projectId, roomId, videoRecordingId: { $exists: false } },
      { $set: { videoRecordingId } }
    );

    console.log(`📝 Linked ${result.modifiedCount} transcript segments to recording ${videoRecordingId}`);

    return NextResponse.json({
      success: true,
      linkedCount: result.modifiedCount,
    });

  } catch (error: any) {
    console.error('Error linking transcripts:', error);
    return NextResponse.json(
      { error: 'Failed to link transcripts', details: error.message },
      { status: 500 }
    );
  }
}
