import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';

/**
 * Backup Upload API
 *
 * Receives client-side backup recordings and uploads them to S3.
 * If the primary recording failed, this backup becomes the primary.
 *
 * POST /api/video-recordings/backup-upload
 * Body: FormData with:
 *   - 'video' (Blob) - the recording file
 *   - 'roomId' (string) - the room identifier
 *   - 'isComposite' (optional string 'true') - whether backup has both agent+customer feeds
 */

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const video = formData.get('video') as Blob | null;
    const roomId = formData.get('roomId') as string | null;
    const isComposite = formData.get('isComposite') === 'true';

    if (!video) {
      return NextResponse.json({ error: 'Missing video file' }, { status: 400 });
    }

    if (!roomId) {
      return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
    }

    console.log(`[Backup Upload] Received ${isComposite ? 'composite' : 'single-feed'} backup for room: ${roomId}, size: ${(video.size / 1024 / 1024).toFixed(2)} MB`);

    await connectMongoDB();

    // Find the most recent recording for this room
    const recording = await VideoRecording.findOne({
      roomId,
    }).sort({ createdAt: -1 });

    if (!recording) {
      console.error(`[Backup Upload] No recording found for room: ${roomId}`);
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    // Verify user owns this recording
    if (recording.userId && recording.userId !== userId) {
      console.error(`[Backup Upload] User ${userId} does not own recording ${recording._id}`);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Generate S3 key for backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = `recordings/${roomId}/backup-${timestamp}.webm`;
    const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME!;

    console.log(`[Backup Upload] Uploading to S3: ${s3Key}`);

    // Upload to S3
    const arrayBuffer = await video.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: 'video/webm',
      Metadata: {
        'recording-id': recording._id.toString(),
        'backup-source': isComposite ? 'client-side-canvas-composite' : 'client-side-mediarecorder',
        'upload-timestamp': new Date().toISOString(),
        'original-room-id': roomId,
        'is-composite': isComposite ? 'true' : 'false',
      },
    }));

    console.log(`[Backup Upload] Successfully uploaded to S3: ${s3Key}`);

    // Check if primary recording failed
    const primaryFailed = recording.status === 'failed' ||
      (recording.s3Key && recording.s3Key.includes('pending.mp4'));

    // Update recording with backup info
    const updateData: any = {
      backupS3Key: s3Key,
      backupUploadedAt: new Date(),
      backupFileSize: buffer.length,
      backupIsComposite: isComposite,
    };

    // If primary failed, use backup as the primary recording
    if (primaryFailed) {
      console.log(`[Backup Upload] Primary recording failed - using backup as primary`);
      updateData.s3Key = s3Key;
      updateData.recordingSource = 'backup';
      updateData.status = 'completed';
      updateData.error = 'Primary egress failed - backup recording used';
      updateData.fileSize = buffer.length;
    }

    await VideoRecording.findByIdAndUpdate(recording._id, updateData);

    console.log(`[Backup Upload] Database updated for recording: ${recording._id}`, {
      usedAsPrimary: primaryFailed,
      s3Key,
      size: buffer.length,
    });

    // If backup is used as primary, queue for Railway processing
    // This ensures the AI analysis pipeline still runs even when primary egress failed
    if (primaryFailed) {
      const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;
      if (queueUrl) {
        try {
          const AWS = (await import('aws-sdk')).default;
          const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });

          // Update analysis status to queued
          await VideoRecording.findByIdAndUpdate(recording._id, {
            'analysisResult.status': 'queued'
          });

          await sqs.sendMessage({
            QueueUrl: queueUrl,
            DelaySeconds: 0,
            MessageBody: JSON.stringify({
              type: 'customer-video',
              videoRecordingId: recording._id.toString(),
              projectId: recording.projectId,
              s3Key: s3Key,
              s3Bucket: bucket,
              roomName: recording.roomId,
              customerIdentity: 'backup-recording',
              duration: 0, // Unknown duration, service will detect
              source: 'backup-upload',
            })
          }).promise();

          console.log(`[Backup Upload] Queued backup recording for Railway AI analysis`);

          // Update to processing
          await VideoRecording.findByIdAndUpdate(recording._id, {
            'analysisResult.status': 'processing'
          });
        } catch (sqsError) {
          console.error(`[Backup Upload] Failed to queue for Railway:`, sqsError);
          // Don't fail the upload, but mark analysis as failed
          await VideoRecording.findByIdAndUpdate(recording._id, {
            'analysisResult.status': 'failed',
            'analysisResult.error': 'Failed to queue backup for analysis'
          });
        }
      } else {
        console.log(`[Backup Upload] AWS_SQS_CALL_QUEUE_URL not configured - skipping AI analysis`);
      }
    }

    return NextResponse.json({
      success: true,
      s3Key,
      size: buffer.length,
      usedAsPrimary: primaryFailed,
      isComposite,
      recordingId: recording._id.toString(),
    });

  } catch (error) {
    console.error('[Backup Upload] Error:', error);
    return NextResponse.json(
      { error: 'Upload failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Increase body size limit for video uploads (default is 4MB)
export const config = {
  api: {
    bodyParser: false,
  },
};
