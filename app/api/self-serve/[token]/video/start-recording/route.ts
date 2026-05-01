// app/api/self-serve/[token]/video/start-recording/route.ts
// Start LiveKit Egress recording for a self-serve session
import { NextRequest, NextResponse } from 'next/server';
import { EgressClient } from 'livekit-server-sdk';
import { EncodedFileOutput, S3Upload, EncodedFileType } from '@livekit/protocol';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';

const egressClient = new EgressClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    if (!token) {
      return NextResponse.json(
        { error: 'No upload token provided' },
        { status: 400 }
      );
    }

    // Validate upload link
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true
    });

    if (!customerUpload) {
      return NextResponse.json(
        { error: 'Invalid or expired upload link' },
        { status: 404 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { sessionId, roomName } = body;

    if (!sessionId || !roomName) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, roomName' },
        { status: 400 }
      );
    }

    // ATOMIC: Find session AND transition status in one operation
    // This prevents race conditions where two concurrent requests both start egress
    const session = await SelfServeRecordingSession.findOneAndUpdate(
      {
        sessionId,
        uploadToken: token,
        status: { $in: ['initialized', 'connecting'] }
      },
      {
        $set: { status: 'starting_egress' }  // Transitional state - only one request will succeed
      },
      { new: true }
    );

    if (!session) {
      // Either not found, or already started - check which case
      const existingSession = await SelfServeRecordingSession.findOne({
        sessionId,
        uploadToken: token
      });

      if (!existingSession) {
        return NextResponse.json(
          { error: 'Recording session not found' },
          { status: 404 }
        );
      }

      // If already recording or starting, return success with existing egress ID
      if (['recording', 'starting_egress'].includes(existingSession.status) && existingSession.egressId) {
        console.log(`⚠️ Session already recording, returning existing egress: ${existingSession.egressId}`);
        return NextResponse.json({
          success: true,
          egressId: existingSession.egressId,
          message: 'Recording already in progress'
        });
      }

      // If starting_egress but no egressId yet, another request is in progress - tell client to wait
      if (existingSession.status === 'starting_egress') {
        console.log(`⚠️ Another request is starting egress for session: ${sessionId.substring(0, 12)}...`);
        return NextResponse.json(
          { error: 'Recording is being started by another request, please wait' },
          { status: 409 }  // Conflict
        );
      }

      return NextResponse.json(
        { error: `Cannot start recording in ${existingSession.status} state` },
        { status: 400 }
      );
    }

    console.log(`📹 Starting self-serve egress: session=${sessionId.substring(0, 12)}..., room=${roomName}`);

    // DIAGNOSTIC + DEFENSIVE: Detect any pre-existing egresses on this room.
    // We just acquired the session lock, so no other code path of ours could
    // have started one. If anything is found, it was started outside the app
    // (LiveKit Cloud project setting, an external listener, etc). We log full
    // detail to identify the source, then stop them so we end up with exactly
    // one egress writing to our S3 location.
    let preexistingEgresses: any[] = [];
    try {
      preexistingEgresses = await egressClient.listEgress({ roomName, active: true });
    } catch (listErr) {
      console.error('⚠️ listEgress failed (non-fatal):', listErr);
    }

    if (preexistingEgresses.length > 0) {
      console.warn(
        `🔎 ORPHAN EGRESS DETECTED: ${preexistingEgresses.length} active egress(es) on ${roomName} BEFORE /start-recording started its own. Investigate the source via these details:`
      );
      for (const eg of preexistingEgresses) {
        const startedIso = eg.startedAt
          ? new Date(Number(eg.startedAt) / 1_000_000).toISOString()
          : 'pending';
        console.warn('  ─ orphan egress', {
          egressId: eg.egressId,
          status: eg.status, // 0=starting 1=active 2=ending 3=complete 4=failed 5=aborted
          requestType: eg.request?.case, // roomComposite | web | participant | trackComposite | track
          startedAt: startedIso,
          fileOutputs: (eg.fileResults || []).map((fr: any) => ({
            filename: fr.filename,
            location: fr.location,
            size: fr.size?.toString()
          })),
          streamOutputs: (eg.streamResults || []).map((sr: any) => sr.url),
          segmentOutputs: (eg.segmentResults || []).map((sg: any) => sg.playlistName)
        });
        try {
          await egressClient.stopEgress(eg.egressId);
          console.warn(`  ✓ Stopped orphan ${eg.egressId}`);
        } catch (stopErr: any) {
          console.error(`  ✗ Failed to stop orphan ${eg.egressId}:`, stopErr?.message || stopErr);
        }
      }
    }

    // Generate S3 key for the recording
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = `self-serve/${customerUpload.projectId}/${sessionId}/recording-${timestamp}.mp4`;
    const bucketName = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME!;

    // Create S3 upload configuration
    const s3Upload = new S3Upload({
      accessKey: process.env.AWS_ACCESS_KEY_ID!,
      secret: process.env.AWS_SECRET_ACCESS_KEY!,
      region: process.env.AWS_REGION!,
      bucket: bucketName,
      forcePathStyle: false,
    });

    // Create file output configuration for MP4
    const fileOutput = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: s3Key,
      output: {
        case: 's3',
        value: s3Upload
      }
    });

    // Start room composite egress
    // For self-serve, we only have one participant (the customer)
    // Room composite captures everything in the room
    const egress = await egressClient.startRoomCompositeEgress(
      roomName,
      fileOutput,
      {
        layout: 'single-speaker', // Best for single participant
        audioOnly: false,
        videoOnly: false
      }
    );

    console.log(`✅ Egress started: ${egress.egressId}`);

    // Update session with egress info (use findByIdAndUpdate for atomicity)
    await SelfServeRecordingSession.findByIdAndUpdate(session._id, {
      egressId: egress.egressId,
      egressStatus: 'starting',
      status: 'recording',
      s3Key: s3Key,
      s3Bucket: bucketName,
      startedAt: new Date()
    });

    return NextResponse.json({
      success: true,
      egressId: egress.egressId,
      s3Key,
      message: 'Recording started'
    });

  } catch (error: any) {
    console.error('Error starting self-serve recording:', error);

    // Check for specific LiveKit errors
    if (error.message?.includes('no participants')) {
      return NextResponse.json(
        { error: 'Cannot start recording - no video is being published. Please ensure your camera is active.' },
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
