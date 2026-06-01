// app/api/livekit/token/route.ts - Updated for customer access
import { NextRequest, NextResponse } from 'next/server';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { auth } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
  console.log('🎟️ =================================');
  console.log('🎟️ LIVEKIT TOKEN REQUEST');
  console.log('🎟️ =================================');
  
  try {
    // Get room name, participant name, and agent status from request
    const { roomName, participantName, isAgent: isAgentParam } = await request.json();
    
    console.log('🎫 Token request details:', {
      roomName,
      participantName,
      timestamp: new Date().toISOString()
    });
    
    if (!roomName || !participantName) {
      console.error('❌ Missing required fields');
      return NextResponse.json(
        { error: 'Room name and participant name are required' },
        { status: 400 }
      );
    }

    // Check if this is an agent - use explicit param if provided, fallback to name check for backwards compatibility
    const isAgent = isAgentParam === true || participantName.toLowerCase().includes('agent');
    console.log(`🏷️ Participant type detection: ${isAgent ? 'AGENT' : 'CUSTOMER'} (explicit param: ${isAgentParam})`);
    
    if (isAgent) {
      // Agents must be authenticated
      const { userId } = await auth();
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized - agents must be logged in' }, { status: 401 });
      }
    }
    // Customers don't need authentication - they can join with just the link

    // Check environment variables
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
      return NextResponse.json(
        { error: 'LiveKit credentials not configured' },
        { status: 500 }
      );
    }

    // bvls: Ensure the call room exists with a generous reconnect grace window
    // BEFORE anyone joins. LiveKit's default departureTimeout is only ~20s, so a
    // brief network drop (WiFi<->cellular handoff, dead zone, stairwell) would
    // close the room and end the recording mid-survey. We create the room
    // idempotently with a 180s departureTimeout (room stays open 3 min after the
    // last participant leaves) and a 600s emptyTimeout (room waits 10 min for the
    // first join). createRoom only applies these on first creation; an "already
    // exists" error is expected and safe. Companion to the webhook change that no
    // longer stops egress on a momentary empty room (see
    // app/api/livekit/webhook/route.ts -> handleParticipantLeft).
    try {
      const roomServiceClient = new RoomServiceClient(
        process.env.LIVEKIT_URL || wsUrl,
        apiKey,
        apiSecret
      );
      await roomServiceClient.createRoom({
        name: roomName,
        departureTimeout: 180, // 3 min grace after the last participant leaves (reconnect window)
        emptyTimeout: 600,     // 10 min for the first participant to join
      });
      console.log(`✅ bvls: ensured room ${roomName} (departureTimeout=180s, emptyTimeout=600s)`);
    } catch (roomError: any) {
      if (roomError?.message?.includes('already exists')) {
        console.log(`⚠️ bvls: room ${roomName} already exists, continuing`);
      } else {
        // Non-fatal: the room also auto-creates on join. Log and continue so token
        // issuance never fails just because room pre-creation hiccuped.
        console.error('⚠️ bvls: createRoom failed (continuing; room will auto-create on join):', roomError?.message || roomError);
      }
    }

    // Generate a unique identity for the participant
    // For agents, use their user ID; for customers, use a generated ID
    let identity: string;
    if (isAgent) {
      const { userId } = await auth();
      identity = `agent-${userId}`;
      console.log(`🆔 Agent identity generated: ${identity}`);
    } else {
      // For customers, create a unique ID based on room and timestamp
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      identity = `customer-${timestamp}-${randomSuffix}`;
      console.log(`🆔 Customer identity generated: ${identity}`);
    }

    // Create access token
    const at = new AccessToken(apiKey, apiSecret, {
      identity: identity,
      name: participantName,
      // Token expires in 4 hours (plenty of time for inventory session)
      ttl: '4h',
      // Store name in metadata as backup (some LiveKit versions don't pass name in webhook)
      metadata: JSON.stringify({ displayName: participantName }),
    });

    // Grant permissions
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      // Customers get full permissions for video calls
      canUpdateOwnMetadata: true,
    });

    // Generate token
    const token = await at.toJwt();

    console.log(`✅ Generated LiveKit token successfully`);
    console.log('🎟️ Token details:', {
      participantType: isAgent ? 'agent' : 'customer',
      participantName,
      identity,
      roomName,
      tokenLength: token.length,
      wsUrl
    });
    
    console.log('🎟️ =================================');
    console.log('🎟️ TOKEN GENERATION COMPLETE');
    console.log('🎟️ =================================');

    return NextResponse.json({
      token,
      url: wsUrl,
      roomName,
      identity,
      participantType: isAgent ? 'agent' : 'customer',
    });
  } catch (error) {
    console.error('Error generating LiveKit token:', error);
    return NextResponse.json(
      { error: 'Failed to generate token' },
      { status: 500 }
    );
  }
}