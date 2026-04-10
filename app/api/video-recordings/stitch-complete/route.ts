import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import AWS from 'aws-sdk';

/**
 * Video Stitch Completion Webhook
 *
 * POST /api/video-recordings/stitch-complete
 *
 * Called by the Railway video-stitcher service when stitching is complete.
 * Updates the primary recording with the stitched video and marks others as superseded.
 * Optionally queues the stitched video to Railway for AI analysis.
 */

const sqs = new AWS.SQS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  region: process.env.AWS_REGION || 'us-east-1',
});

export async function POST(request: NextRequest) {
  try {
    // Verify webhook source
    const webhookSource = request.headers.get('x-webhook-source');
    if (webhookSource !== 'railway-video-stitcher') {
      console.warn('[StitchComplete] Invalid webhook source:', webhookSource);
      // Allow for testing but log warning
    }

    const body = await request.json();
    const {
      roomId,
      primaryRecordingId,
      recordingIds,
      projectId,
      success,
      outputKey,
      duration,
      fileSize,
      partsStitched,
      error: stitchError,
    } = body;

    console.log('[StitchComplete] Received webhook:', {
      roomId,
      primaryRecordingId,
      success,
      partsStitched,
      duration,
    });

    if (!primaryRecordingId) {
      return NextResponse.json({ error: 'primaryRecordingId required' }, { status: 400 });
    }

    await connectMongoDB();

    // Handle failure
    if (!success) {
      console.error(`[StitchComplete] Stitch failed for room ${roomId}:`, stitchError);

      await VideoRecording.findByIdAndUpdate(primaryRecordingId, {
        status: 'failed',
        error: `Stitching failed: ${stitchError || 'Unknown error'}`,
      });

      return NextResponse.json({
        success: false,
        message: 'Recorded stitch failure',
        error: stitchError,
      });
    }

    // Update primary recording with stitched video
    console.log(`[StitchComplete] Updating primary recording ${primaryRecordingId}`);

    const primaryRecording = await VideoRecording.findByIdAndUpdate(
      primaryRecordingId,
      {
        s3Key: outputKey,
        duration: duration,
        fileSize: fileSize,
        status: 'completed',
        isStitched: true,
        stitchedFrom: recordingIds,
        stitchedAt: new Date(),
        recordingSource: 'stitched',
        error: null, // Clear any previous error
      },
      { new: true }
    );

    if (!primaryRecording) {
      console.error(`[StitchComplete] Primary recording not found: ${primaryRecordingId}`);
      return NextResponse.json({ error: 'Primary recording not found' }, { status: 404 });
    }

    // Mark other recordings as superseded
    if (recordingIds && recordingIds.length > 1) {
      const otherRecordingIds = recordingIds.filter((id: string) => id !== primaryRecordingId);

      for (const recordingId of otherRecordingIds) {
        await VideoRecording.findByIdAndUpdate(recordingId, {
          status: 'superseded',
          supersededBy: primaryRecordingId,
        });
        console.log(`[StitchComplete] Marked ${recordingId} as superseded`);
      }
    }

    // Queue the stitched video to Railway for AI analysis
    const callQueueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;
    if (callQueueUrl && primaryRecording.customerVideoS3Key) {
      // Only queue if there's a customer video to analyze
      console.log(`[StitchComplete] Queuing stitched video to Railway for analysis`);

      try {
        await sqs.sendMessage({
          QueueUrl: callQueueUrl,
          MessageBody: JSON.stringify({
            type: 'customer-video',
            videoRecordingId: primaryRecordingId,
            projectId: projectId || primaryRecording.projectId,
            s3Key: primaryRecording.customerVideoS3Key,
            s3Bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME,
            roomName: roomId,
            duration: duration || 0,
            isStitched: true,
          }),
        }).promise();

        console.log(`[StitchComplete] Queued to Railway: ${primaryRecordingId}`);
      } catch (queueError) {
        console.error('[StitchComplete] Failed to queue to Railway:', queueError);
        // Don't fail the webhook - stitching succeeded
      }
    }

    console.log(`[StitchComplete] Successfully processed stitch completion for room ${roomId}`);

    return NextResponse.json({
      success: true,
      recordingId: primaryRecordingId,
      message: `Successfully stitched ${partsStitched} recordings`,
      outputKey,
      duration,
    });

  } catch (error) {
    console.error('[StitchComplete] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process stitch completion', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/video-recordings/stitch-complete?recordingId=xxx
 *
 * Check stitch status for a recording
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const recordingId = searchParams.get('recordingId');

    if (!recordingId) {
      return NextResponse.json({ error: 'recordingId required' }, { status: 400 });
    }

    await connectMongoDB();

    const recording = await VideoRecording.findById(recordingId);

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    return NextResponse.json({
      recordingId: recording._id,
      status: recording.status,
      isStitched: recording.isStitched || false,
      stitchedFrom: recording.stitchedFrom || [],
      stitchedAt: recording.stitchedAt,
      s3Key: recording.s3Key,
      duration: recording.duration,
      error: recording.error,
    });

  } catch (error) {
    console.error('[StitchComplete] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to check stitch status' },
      { status: 500 }
    );
  }
}
