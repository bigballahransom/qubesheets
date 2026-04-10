import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import AWS from 'aws-sdk';

/**
 * Video Stitching API
 *
 * POST /api/video-recordings/stitch
 * Body: { roomId: string }
 *
 * This endpoint finds all partial/completed recordings for a room,
 * queues them for stitching via SQS, and returns immediately.
 *
 * The Railway video-stitcher service polls the SQS queue and:
 * - Downloads videos from the provided presigned URLs
 * - Runs FFmpeg concat to merge them
 * - Uploads the stitched video to S3
 * - Calls the completion webhook with results
 */

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const sqs = new AWS.SQS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  region: process.env.AWS_REGION || 'us-east-1',
});

export async function POST(request: NextRequest) {
  try {
    const { roomId } = await request.json();

    if (!roomId) {
      return NextResponse.json({ error: 'roomId required' }, { status: 400 });
    }

    console.log(`[Stitch] Starting stitch process for room: ${roomId}`);

    await connectMongoDB();

    // Find all recordings for this room that are complete or partial, ordered by creation time
    const recordings = await VideoRecording.find({
      roomId,
      status: { $in: ['completed', 'partial'] },
      s3Key: { $exists: true, $ne: null },
      // Exclude already superseded recordings
      supersededBy: { $exists: false },
    }).sort({ createdAt: 1 });

    if (recordings.length === 0) {
      console.log(`[Stitch] No recordings found for room ${roomId}`);
      return NextResponse.json({ error: 'No recordings found' }, { status: 404 });
    }

    if (recordings.length === 1) {
      // Only one recording, no stitching needed
      console.log(`[Stitch] Single recording for room ${roomId} - no stitching needed`);
      return NextResponse.json({
        stitched: false,
        recordingId: recordings[0]._id.toString(),
        message: 'Single recording, no stitching needed'
      });
    }

    console.log(`[Stitch] Found ${recordings.length} recordings for room ${roomId}`);

    // Generate presigned URLs for all video files and validate they exist
    const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME!;
    const videoUrls: string[] = [];
    const validRecordings: typeof recordings = [];

    for (const rec of recordings) {
      // Skip recordings with placeholder s3Keys
      if (!rec.s3Key || rec.s3Key.includes('pending.mp4') || rec.s3Key.endsWith('/')) {
        console.log(`[Stitch] Skipping recording ${rec._id} - invalid s3Key: ${rec.s3Key}`);
        continue;
      }

      // Check if file exists in S3
      try {
        await s3Client.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: rec.s3Key,
        }));

        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: rec.s3Key,
        });
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        videoUrls.push(url);
        validRecordings.push(rec);

        console.log(`[Stitch] Valid recording: ${rec._id} - ${rec.s3Key}`);
      } catch (error) {
        console.log(`[Stitch] Skipping recording ${rec._id} - file not found in S3: ${rec.s3Key}`);
      }
    }

    if (videoUrls.length < 2) {
      console.log(`[Stitch] Not enough valid video files to stitch (${videoUrls.length} found)`);
      return NextResponse.json({
        stitched: false,
        recordingId: validRecordings[0]?._id.toString() || recordings[0]._id.toString(),
        message: 'Not enough valid video files to stitch'
      });
    }

    // Check if SQS queue is configured
    const stitchQueueUrl = process.env.AWS_SQS_STITCH_QUEUE_URL;
    if (!stitchQueueUrl) {
      console.warn('[Stitch] AWS_SQS_STITCH_QUEUE_URL not configured - marking recordings for manual review');

      // For now, just use the first recording as primary and mark others as superseded
      const primaryRecording = validRecordings[0];

      // Calculate combined duration
      const totalDuration = validRecordings.reduce((sum, rec) => sum + (rec.duration || 0), 0);

      await VideoRecording.findByIdAndUpdate(primaryRecording._id, {
        status: 'completed',
        duration: totalDuration,
        error: `Contains ${validRecordings.length} partial segments (stitching queue not configured)`,
      });

      // Mark other recordings as superseded
      for (let i = 1; i < validRecordings.length; i++) {
        await VideoRecording.findByIdAndUpdate(validRecordings[i]._id, {
          status: 'superseded',
          supersededBy: primaryRecording._id,
        });
      }

      return NextResponse.json({
        stitched: false,
        recordingId: primaryRecording._id.toString(),
        message: 'Stitching queue not configured - using first recording as primary',
        partsFound: validRecordings.length,
      });
    }

    // Generate output key for stitched video
    const timestamp = Date.now();
    const outputKey = `recordings/${roomId}/stitched-${timestamp}.mp4`;
    const primaryRecording = validRecordings[0];

    // Mark primary recording as "stitching" in progress
    await VideoRecording.findByIdAndUpdate(primaryRecording._id, {
      status: 'processing',
      error: `Stitching ${validRecordings.length} parts...`,
    });

    // Queue the stitch job to SQS
    console.log(`[Stitch] Queuing stitch job to SQS with ${videoUrls.length} videos`);

    const sqsMessage = {
      type: 'video-stitch',
      roomId,
      primaryRecordingId: primaryRecording._id.toString(),
      recordingIds: validRecordings.map(r => r._id.toString()),
      videoUrls,
      s3Keys: validRecordings.map(r => r.s3Key),
      outputKey,
      bucket,
      projectId: primaryRecording.projectId,
      timestamp: Date.now(),
    };

    await sqs.sendMessage({
      QueueUrl: stitchQueueUrl,
      MessageBody: JSON.stringify(sqsMessage),
      MessageAttributes: {
        'MessageType': {
          DataType: 'String',
          StringValue: 'video-stitch'
        }
      }
    }).promise();

    console.log(`[Stitch] Stitch job queued for room ${roomId} with ${validRecordings.length} parts`);

    return NextResponse.json({
      queued: true,
      recordingId: primaryRecording._id.toString(),
      message: `Stitch job queued for ${validRecordings.length} recordings`,
      partsFound: validRecordings.length,
      outputKey,
    });

  } catch (error) {
    console.error('[Stitch] Error:', error);
    return NextResponse.json(
      { error: 'Stitching failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/video-recordings/stitch?roomId=xxx
 *
 * Check if a room has recordings that need stitching
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');

    if (!roomId) {
      return NextResponse.json({ error: 'roomId required' }, { status: 400 });
    }

    await connectMongoDB();

    const recordings = await VideoRecording.find({
      roomId,
      status: { $in: ['completed', 'partial'] },
      s3Key: { $exists: true, $ne: null },
      supersededBy: { $exists: false },
    }).sort({ createdAt: 1 });

    return NextResponse.json({
      roomId,
      recordingsCount: recordings.length,
      needsStitching: recordings.length > 1,
      recordings: recordings.map(r => ({
        id: r._id,
        status: r.status,
        duration: r.duration,
        isPartialRecording: r.isPartialRecording,
        createdAt: r.createdAt,
      })),
    });

  } catch (error) {
    console.error('[Stitch] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to check stitching status' },
      { status: 500 }
    );
  }
}
