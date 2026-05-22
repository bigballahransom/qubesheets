// app/api/onsite-walkthrough/[token]/video/stop/route.ts
//
// Stop the LiveKit egress for this onsite walkthrough session, reap any
// surviving orphans, delete the room, mark the session 'finished'.
// Patterned after app/api/self-serve/[token]/video/stop/route.ts.
import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import connectMongoDB from '@/lib/mongodb';
import OnsiteWalkthroughSession from '@/models/OnsiteWalkthroughSession';
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
      return NextResponse.json({ error: 'No token provided' }, { status: 400 });
    }

    const session = await OnsiteWalkthroughSession.findOne({
      uploadToken: token,
      isActive: true,
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Onsite walkthrough session not found' },
        { status: 404 }
      );
    }

    // Idempotency: if /stop was already processed (or egress_ended beat us
    // to it), return the cached result.
    if (['finished', 'processed', 'failed'].includes(session.status)) {
      console.log(
        `[onsite-walkthrough/stop] session=${session._id} already in '${session.status}' — returning cached`
      );
      return NextResponse.json({
        success: true,
        sessionId: session._id.toString(),
        status: session.status,
        durationMs: session.recordingDurationMs,
        message: 'Recording already stopped',
      });
    }

    // No egress was ever started (mover joined but never hit Start)?
    if (!session.egressId) {
      session.status = 'finished';
      session.recordingEndedAt = new Date();
      await session.save();
      return NextResponse.json({
        success: true,
        message: 'Session ended (no recording was in progress)',
      });
    }

    // Mark as stopping (transient).
    session.status = 'stopping';
    await session.save();

    console.log(
      `[onsite-walkthrough/stop] stopping egress=${session.egressId} room=${session.liveKitRoomName}`
    );

    try {
      await egressClient.stopEgress(session.egressId);
      console.log(`[onsite-walkthrough/stop] egress stop sent`);
    } catch (egressError: unknown) {
      const m = egressError instanceof Error ? egressError.message : String(egressError);
      if (m.includes('not found') || m.includes('not active')) {
        console.log(`[onsite-walkthrough/stop] egress already gone: ${session.egressId}`);
      } else {
        console.error('[onsite-walkthrough/stop] egress stop error:', egressError);
        // Continue — egress may have ended naturally
      }
    }

    // Reap any other active egresses on the room (defense against
    // LiveKit-Cloud auto-egress re-firing).
    if (session.liveKitRoomName) {
      try {
        const others = await egressClient.listEgress({
          roomName: session.liveKitRoomName,
          active: true,
        });
        for (const eg of others) {
          if (eg.egressId === session.egressId) continue;
          console.warn(
            `[onsite-walkthrough/stop] reaping additional egress: ${eg.egressId}`
          );
          await safeStopOrphan(eg.egressId, 'reaped on onsite /stop');
        }
      } catch (reapErr) {
        console.error('[onsite-walkthrough/stop] reap listEgress failed:', reapErr);
      }
    }

    // Compute duration and finalize.
    const now = new Date();
    let durationMs: number | undefined;
    if (session.recordingStartedAt) {
      durationMs = now.getTime() - new Date(session.recordingStartedAt).getTime();
    }

    session.status = 'finished';
    session.recordingEndedAt = now;
    if (durationMs !== undefined) {
      session.recordingDurationMs = durationMs;
    }
    await session.save();

    // Clean up the LiveKit room (tolerate already-deleted).
    if (session.liveKitRoomName) {
      try {
        await roomServiceClient.deleteRoom(session.liveKitRoomName);
        console.log(`[onsite-walkthrough/stop] room deleted: ${session.liveKitRoomName}`);
      } catch {
        console.log(
          `[onsite-walkthrough/stop] room delete skipped (already gone): ${session.liveKitRoomName}`
        );
      }
    }

    return NextResponse.json({
      success: true,
      sessionId: session._id.toString(),
      status: 'finished',
      durationMs,
      message: 'Recording stopped. Video processing will be triggered by the egress webhook (P1b-2).',
    });
  } catch (error) {
    console.error('[onsite-walkthrough/stop] error:', error);
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
