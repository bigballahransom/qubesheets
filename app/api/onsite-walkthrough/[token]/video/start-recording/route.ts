// app/api/onsite-walkthrough/[token]/video/start-recording/route.ts
//
// Start a LiveKit server-side egress that records the single-participant
// onsite walkthrough room directly to S3. Patterned after the self-serve
// equivalent (app/api/self-serve/[token]/video/start-recording/route.ts):
// atomic status lock, orphan-egress reaping, S3 output configured up-front.
import { NextRequest, NextResponse } from 'next/server';
import { EncodedFileOutput, S3Upload, EncodedFileType } from '@livekit/protocol';
import connectMongoDB from '@/lib/mongodb';
import OnsiteWalkthroughSession from '@/models/OnsiteWalkthroughSession';
import { egressClient } from '@/lib/selfServeEgress';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    if (!token) {
      return NextResponse.json({ error: 'No token provided' }, { status: 400 });
    }

    // Atomic transition: only one concurrent request can flip
    // initialized -> starting_egress.
    const session = await OnsiteWalkthroughSession.findOneAndUpdate(
      {
        uploadToken: token,
        isActive: true,
        status: { $in: ['initialized', 'created'] },
      },
      { $set: { status: 'starting_egress' } },
      { new: true }
    );

    if (!session) {
      // Either not found, or another request already advanced the status.
      const existing = await OnsiteWalkthroughSession.findOne({ uploadToken: token });
      if (!existing) {
        return NextResponse.json(
          { error: 'Onsite walkthrough session not found' },
          { status: 404 }
        );
      }

      if (existing.status === 'recording' && existing.egressId) {
        console.log(
          `[onsite-walkthrough/start] already recording, returning egressId=${existing.egressId}`
        );
        return NextResponse.json({
          success: true,
          egressId: existing.egressId,
          message: 'Recording already in progress',
        });
      }

      if (existing.status === 'starting_egress') {
        return NextResponse.json(
          { error: 'Recording is being started by another request, please wait' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: `Cannot start recording in '${existing.status}' state` },
        { status: 400 }
      );
    }

    const roomName = session.liveKitRoomName;
    console.log(
      `[onsite-walkthrough/start] starting egress session=${session._id} room=${roomName}`
    );

    // Defense: reap any orphan egresses on this room before starting our own.
    // LiveKit Cloud project-level auto-recording can fire its own egress as
    // soon as a track publishes; we want exactly one egress writing to our
    // S3 location.
    try {
      const preexisting = await egressClient.listEgress({ roomName, active: true });
      if (preexisting.length > 0) {
        console.warn(
          `[onsite-walkthrough/start] ORPHAN EGRESS DETECTED: ${preexisting.length} active on ${roomName}`
        );
        for (const eg of preexisting) {
          try {
            await egressClient.stopEgress(eg.egressId);
            console.warn(`  ✓ Stopped orphan ${eg.egressId}`);
          } catch (stopErr: unknown) {
            const m = stopErr instanceof Error ? stopErr.message : String(stopErr);
            console.error(`  ✗ Failed to stop orphan ${eg.egressId}:`, m);
          }
        }
      }
    } catch (listErr) {
      console.error('[onsite-walkthrough/start] listEgress failed (non-fatal):', listErr);
    }

    // Build the egress output to S3.
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = `onsite-walkthrough/${session.projectId}/${session._id}/recording-${timestamp}.mp4`;
    const bucketName =
      process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME!;

    const s3Upload = new S3Upload({
      accessKey: process.env.AWS_ACCESS_KEY_ID!,
      secret: process.env.AWS_SECRET_ACCESS_KEY!,
      region: process.env.AWS_REGION!,
      bucket: bucketName,
      forcePathStyle: false,
    });

    const fileOutput = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: s3Key,
      output: { case: 's3', value: s3Upload },
    });

    const egress = await egressClient.startRoomCompositeEgress(roomName, fileOutput, {
      layout: 'single-speaker',
      audioOnly: false,
      videoOnly: false,
    });

    console.log(`[onsite-walkthrough/start] egress started: ${egress.egressId}`);

    await OnsiteWalkthroughSession.findByIdAndUpdate(session._id, {
      egressId: egress.egressId,
      status: 'recording',
      videoS3Key: s3Key,
      videoS3Bucket: bucketName,
      recordingStartedAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      egressId: egress.egressId,
      s3Key,
      message: 'Recording started',
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[onsite-walkthrough/start] error:', error);

    if (msg.includes('no participants')) {
      return NextResponse.json(
        {
          error:
            'Cannot start recording — no video is being published. Make sure the camera is active.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to start recording' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
