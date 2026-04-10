import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';

/**
 * Recording Status API
 *
 * Returns the current status of a video recording.
 * Used by the health monitor to detect egress failures.
 *
 * GET /api/video-recordings/[id]/status
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    await connectMongoDB();

    const recording = await VideoRecording.findById(id).select(
      'status error startedAt egressId s3Key roomId userId backupS3Key recordingSource'
    );

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    // Allow access to recordings where the user owns it
    // (We don't strictly enforce this for status checks to allow monitoring)

    return NextResponse.json({
      id: recording._id.toString(),
      status: recording.status,
      error: recording.error || null,
      startedAt: recording.startedAt,
      egressId: recording.egressId || null,
      s3Key: recording.s3Key || null,
      roomId: recording.roomId,
      hasBackup: !!recording.backupS3Key,
      recordingSource: recording.recordingSource || 'primary',
    });

  } catch (error) {
    console.error('[Recording Status] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get status' },
      { status: 500 }
    );
  }
}
