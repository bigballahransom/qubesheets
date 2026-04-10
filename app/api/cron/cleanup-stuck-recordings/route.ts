import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import { RoomServiceClient } from 'livekit-server-sdk';

/**
 * Stuck Recording Cleanup Cron
 *
 * Finds and cleans up recordings that got stuck in intermediate states.
 * This handles edge cases where webhooks were missed or egress failed silently.
 *
 * Run this every 15 minutes via Vercel Cron.
 * Configure in vercel.json with schedule: every 15 minutes
 *
 * GET /api/cron/cleanup-stuck-recordings
 * Authorization: Bearer CRON_SECRET
 */

const roomServiceClient = new RoomServiceClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Allow without secret in development for testing
  if (process.env.NODE_ENV === 'production' && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.log('[Cleanup Cron] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  console.log('[Cleanup Cron] Starting stuck recording cleanup...');

  try {
    await connectMongoDB();

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Find stuck recordings
    const stuckRecordings = await VideoRecording.find({
      $or: [
        // Stuck in 'waiting' for > 5 minutes (agent never joined)
        { status: 'waiting', createdAt: { $lt: fiveMinutesAgo } },
        // Stuck in 'starting' for > 2 minutes (egress never started)
        { status: 'starting', createdAt: { $lt: twoMinutesAgo } },
        // Stuck in 'recording' with no updates for > 10 minutes (might be orphaned)
        { status: 'recording', updatedAt: { $lt: tenMinutesAgo } },
        // Stuck in 'processing' for > 30 minutes (webhook never arrived)
        { status: 'processing', endedAt: { $lt: thirtyMinutesAgo } },
        // 'partial' recordings older than 1 hour without continuation
        {
          status: 'partial',
          updatedAt: { $lt: oneHourAgo },
          continuedInRecordingId: { $exists: false }
        },
      ],
    }).limit(50); // Process in batches

    console.log(`[Cleanup Cron] Found ${stuckRecordings.length} stuck recordings`);

    const results = {
      found: stuckRecordings.length,
      cleaned: 0,
      stillActive: 0,
      errors: 0,
      details: [] as Array<{ id: string; roomId: string; oldStatus: string; newStatus: string; reason: string }>,
    };

    for (const recording of stuckRecordings) {
      try {
        // Check if room still has active participants
        let roomActive = false;
        let activeParticipants: string[] = [];

        try {
          const participants = await roomServiceClient.listParticipants(recording.roomId);
          // Filter out egress participants
          activeParticipants = participants
            .filter(p => !p.identity.startsWith('EG_'))
            .map(p => p.identity);
          roomActive = activeParticipants.length > 0;
        } catch (e: any) {
          // Room doesn't exist = not active
          if (e.message?.includes('not found') || e.code === 'NOT_FOUND') {
            roomActive = false;
          } else {
            // Unknown error - skip this recording to be safe
            console.error(`[Cleanup Cron] Error checking room ${recording.roomId}:`, e);
            results.errors++;
            continue;
          }
        }

        if (roomActive) {
          results.stillActive++;
          console.log(`[Cleanup Cron] Skipping ${recording._id} - room still active with: ${activeParticipants.join(', ')}`);
          continue;
        }

        // Room is gone or empty, clean up the recording
        const hasPrimaryFile = recording.s3Key &&
          !recording.s3Key.includes('pending.mp4') &&
          !recording.s3Key.endsWith('/');
        const hasBackupFile = !!recording.backupS3Key;

        let newStatus: string;
        let errorMessage: string;

        if (hasPrimaryFile || hasBackupFile) {
          // We have a video file, mark as completed
          newStatus = 'completed';
          errorMessage = `Auto-cleaned: stuck in '${recording.status}' but video file exists`;

          // If only backup exists, use it as primary
          if (!hasPrimaryFile && hasBackupFile) {
            await VideoRecording.findByIdAndUpdate(recording._id, {
              s3Key: recording.backupS3Key,
              recordingSource: 'recovered',
            });
          }
        } else {
          // No video file found
          newStatus = 'failed';
          errorMessage = `Auto-cleaned: stuck in '${recording.status}', no video file found`;
        }

        await VideoRecording.findByIdAndUpdate(recording._id, {
          status: newStatus,
          error: errorMessage,
          endedAt: recording.endedAt || new Date(),
        });

        results.cleaned++;
        results.details.push({
          id: recording._id.toString(),
          roomId: recording.roomId,
          oldStatus: recording.status,
          newStatus,
          reason: errorMessage,
        });

        console.log(`[Cleanup Cron] Cleaned ${recording._id}: ${recording.status} -> ${newStatus}`);

      } catch (error) {
        results.errors++;
        console.error(`[Cleanup Cron] Error processing ${recording._id}:`, error);
      }
    }

    console.log(`[Cleanup Cron] Complete:`, {
      found: results.found,
      cleaned: results.cleaned,
      stillActive: results.stillActive,
      errors: results.errors,
    });

    return NextResponse.json({
      success: true,
      ...results,
      timestamp: now.toISOString(),
    });

  } catch (error) {
    console.error('[Cleanup Cron] Fatal error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
