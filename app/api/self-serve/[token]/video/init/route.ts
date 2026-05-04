// app/api/self-serve/[token]/video/init/route.ts
// Initialize a self-serve recording session with LiveKit
import { NextRequest, NextResponse } from 'next/server';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { v4 as uuidv4 } from 'uuid';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';

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

    // Check environment variables
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
      console.error('LiveKit credentials not configured');
      return NextResponse.json(
        { error: 'Video service not configured' },
        { status: 500 }
      );
    }

    // Parse request body for optional device info
    let deviceInfo = {};
    try {
      const body = await request.json();
      deviceInfo = body.deviceInfo || {};
    } catch {
      // No body or invalid JSON, continue without device info
    }

    // Generate unique session ID and room name
    const sessionId = uuidv4();
    const timestamp = Date.now();
    const roomName = `self-serve-${customerUpload.projectId}-${timestamp}`;

    console.log(`📹 Initializing self-serve recording: session=${sessionId.substring(0, 12)}..., room=${roomName}`);

    // Create LiveKit room with a long empty timeout (customer might pause)
    try {
      await roomServiceClient.createRoom({
        name: roomName,
        emptyTimeout: 600, // 10 minutes - allows for pauses
        maxParticipants: 1, // Only the customer
        metadata: JSON.stringify({
          type: 'self-serve',
          projectId: customerUpload.projectId.toString(),
          customerUploadId: customerUpload._id.toString(),
          sessionId
        })
      });
      console.log(`✅ LiveKit room created: ${roomName}`);
    } catch (roomError: any) {
      // Room might already exist, which is fine
      if (!roomError.message?.includes('already exists')) {
        console.error('Failed to create LiveKit room:', roomError);
        throw roomError;
      }
      console.log(`⚠️ Room ${roomName} already exists, continuing...`);
    }

    // Generate LiveKit token for the customer
    // Customer can publish (camera/mic) but doesn't need to subscribe to others
    const customerIdentity = `customer-${token.substring(0, 8)}-${timestamp}`;
    const at = new AccessToken(apiKey, apiSecret, {
      identity: customerIdentity,
      name: customerUpload.customerName || 'Customer',
      ttl: '4h', // 4 hour token validity
      metadata: JSON.stringify({
        type: 'self-serve-customer',
        sessionId
      })
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: false, // No one else to subscribe to
      canPublishData: true,
      canUpdateOwnMetadata: true
    });

    const livekitToken = await at.toJwt();

    // Create session record in database
    const session = new SelfServeRecordingSession({
      sessionId,
      uploadToken: token,
      projectId: customerUpload.projectId,
      customerUploadId: customerUpload._id,
      userId: customerUpload.userId,
      organizationId: customerUpload.organizationId,
      livekitRoomName: roomName,
      customerIdentity,
      status: 'initialized',
      deviceInfo
    });

    await session.save();

    console.log(`✅ Self-serve session initialized: ${sessionId}`);

    return NextResponse.json({
      success: true,
      sessionId,
      roomName,
      livekitToken,
      wsUrl,
      customerIdentity,
      maxDuration: customerUpload.maxRecordingDuration || 1200
    });

  } catch (error) {
    console.error('Error initializing self-serve recording:', error);
    return NextResponse.json(
      { error: 'Failed to initialize recording session' },
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
