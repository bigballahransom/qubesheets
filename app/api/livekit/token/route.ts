// app/api/livekit/token/route.ts - Updated for customer access
import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
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