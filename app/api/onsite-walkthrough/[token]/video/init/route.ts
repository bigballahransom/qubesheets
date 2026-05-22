// app/api/onsite-walkthrough/[token]/video/init/route.ts
//
// Initialize a LiveKit room for the onsite walkthrough mobile recorder.
// Issues an access token, ensures the room exists, and advances the session
// from 'created' -> 'initialized'. Patterned after the self-serve flow
// (app/api/self-serve/[token]/video/init/route.ts) but scoped to
// OnsiteWalkthroughSession and the onsite-walkthrough room-name prefix.
import { NextRequest, NextResponse } from 'next/server';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import connectMongoDB from '@/lib/mongodb';
import OnsiteWalkthroughSession from '@/models/OnsiteWalkthroughSession';

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
        { error: 'Invalid or inactive onsite walkthrough session.' },
        { status: 404 }
      );
    }

    // Loud-fail on missing LiveKit env vars (same as self-serve init).
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!apiKey || !apiSecret || !wsUrl) {
      console.error('[onsite-walkthrough/init] LiveKit env vars missing');
      return NextResponse.json(
        { error: 'Video service not configured' },
        { status: 500 }
      );
    }

    const roomName = session.liveKitRoomName;
    const timestamp = Date.now();
    const moverIdentity = `mover-${token.substring(0, 8)}-${timestamp}`;

    // Ensure the LiveKit room exists. Tolerate "already exists".
    try {
      await roomServiceClient.createRoom({
        name: roomName,
        emptyTimeout: 600, // 10 min — allows pauses between mover walking rooms
        maxParticipants: 1,
        metadata: JSON.stringify({
          type: 'onsite-walkthrough',
          projectId: session.projectId.toString(),
          sessionId: session._id.toString(),
        }),
      });
      console.log(`[onsite-walkthrough/init] room created: ${roomName}`);
    } catch (roomError: unknown) {
      const msg = roomError instanceof Error ? roomError.message : String(roomError);
      if (!msg.includes('already exists')) {
        console.error('[onsite-walkthrough/init] room create failed:', roomError);
        throw roomError;
      }
      console.log(`[onsite-walkthrough/init] room already exists: ${roomName}`);
    }

    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: moverIdentity,
      name: 'Mover',
      ttl: '4h',
      metadata: JSON.stringify({
        type: 'onsite-walkthrough-mover',
        sessionId: session._id.toString(),
      }),
    });
    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: false,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    });
    const livekitToken = await accessToken.toJwt();

    // Advance status: created -> initialized (idempotent — multiple /init calls fine).
    if (session.status === 'created') {
      session.status = 'initialized';
    }
    session.livekitParticipantIdentity = moverIdentity;
    await session.save();

    return NextResponse.json({
      success: true,
      sessionId: session._id.toString(),
      roomName,
      livekitToken,
      wsUrl,
      participantIdentity: moverIdentity,
      maxDuration: session.maxRecordingDuration,
    });
  } catch (error) {
    console.error('[onsite-walkthrough/init] error:', error);
    return NextResponse.json(
      { error: 'Failed to initialize onsite walkthrough recorder' },
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
