// app/api/self-serve/[token]/video/stop/route.ts
// Stop LiveKit Egress recording for a self-serve session
import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import { egressClient, safeStopOrphan } from '@/lib/selfServeEgress';

const roomServiceClient = new RoomServiceClient(
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
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing required field: sessionId' },
        { status: 400 }
      );
    }

    // Find session
    const session = await SelfServeRecordingSession.findOne({
      sessionId,
      uploadToken: token
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Recording session not found' },
        { status: 404 }
      );
    }

    // Idempotency: if /stop was already processed (e.g. user double-tapped, or
    // egress_ended fired before /stop), don't redo cleanup. Return what we know.
    if (['processing', 'analyzing', 'completed', 'failed'].includes(session.status)) {
      console.log(`⏭️ /stop called for session ${sessionId.substring(0, 12)}... already in '${session.status}' state - returning cached result`);
      return NextResponse.json({
        success: true,
        sessionId,
        status: session.status,
        duration: session.totalDuration,
        message: 'Recording already stopped'
      });
    }

    // Check if session has an egress to stop
    if (!session.egressId) {
      // No egress was started, just update status
      session.status = 'completed';
      session.stoppedAt = new Date();
      await session.save();

      return NextResponse.json({
        success: true,
        message: 'Session ended (no recording was in progress)'
      });
    }

    console.log(`📹 Stopping self-serve egress: session=${sessionId.substring(0, 12)}..., egress=${session.egressId}`);

    // Stop the egress
    try {
      await egressClient.stopEgress(session.egressId);
      console.log(`✅ Egress stop request sent: ${session.egressId}`);
    } catch (egressError: any) {
      // Egress might already be stopped or not found
      if (egressError.message?.includes('not found') || egressError.message?.includes('not active')) {
        console.log(`⚠️ Egress already stopped or not found: ${session.egressId}`);
      } else {
        console.error('Error stopping egress:', egressError);
        // Continue anyway - the egress might have ended naturally
      }
    }

    // Defense-in-depth: reap any other active egresses on this room. LiveKit
    // project-level auto-egress can re-fire after we stop one; if any survived
    // the webhook stop in handleEgressStarted, kill them here so they don't
    // keep running (and billing) after the user is done.
    if (session.livekitRoomName) {
      try {
        const others = await egressClient.listEgress({ roomName: session.livekitRoomName, active: true });
        for (const eg of others) {
          if (eg.egressId === session.egressId) continue;
          console.warn(`🔎 Reaping additional active egress on /stop: ${eg.egressId}`);
          await safeStopOrphan(eg.egressId, 'reaped on /stop');
        }
      } catch (reapErr) {
        console.error('⚠️ Reap-on-stop listEgress failed (non-fatal):', reapErr);
      }
    }

    // Update session status
    session.egressStatus = 'stopping';
    session.status = 'processing';
    session.stoppedAt = new Date();

    // Calculate duration if we have startedAt
    if (session.startedAt) {
      session.totalDuration = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 1000);
    }

    await session.save();

    // Try to delete the LiveKit room (cleanup)
    if (session.livekitRoomName) {
      try {
        await roomServiceClient.deleteRoom(session.livekitRoomName);
        console.log(`🗑️ Room deleted: ${session.livekitRoomName}`);
      } catch (roomError) {
        // Room might already be deleted, that's fine
        console.log(`⚠️ Could not delete room (may already be deleted): ${session.livekitRoomName}`);
      }
    }

    // Update CustomerUpload with reference to this session
    customerUpload.completedRecordingSessionId = session._id;
    await customerUpload.save();

    return NextResponse.json({
      success: true,
      sessionId,
      status: 'processing',
      duration: session.totalDuration,
      message: 'Recording stopped. Video is being processed.'
    });

  } catch (error) {
    console.error('Error stopping self-serve recording:', error);
    return NextResponse.json(
      { error: 'Failed to stop recording' },
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
