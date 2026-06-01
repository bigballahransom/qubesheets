import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import connectMongoDB from '@/lib/mongodb';
import CallPresence from '@/models/CallPresence';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';

const roomServiceClient = new RoomServiceClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Agents must be authenticated' }, { status: 401 });
  }

  await connectMongoDB();

  const presence = await CallPresence.findOne({ roomId });
  if (!presence) {
    return NextResponse.json({ error: 'No active call for this room' }, { status: 404 });
  }
  if (presence.agentUserId && presence.agentUserId !== userId) {
    return NextResponse.json({ error: 'Another agent owns this call' }, { status: 403 });
  }
  if (presence.callStatus === 'ended') {
    return NextResponse.json({ callStatus: 'ended', endedAt: presence.endedAt });
  }

  // Deleting the room kicks all participants out, ends the active egress
  // (Auto Egress finalizes the file to S3), and fires egress_ended which
  // queues the recording for analysis. This is the single canonical
  // "end the call now" path for agents.
  try {
    await roomServiceClient.deleteRoom(roomId);
  } catch (err: any) {
    // If the room is already gone (e.g., timed out before agent clicked End),
    // treat as success — we still want to flip our state.
    const msg = (err?.message || '').toLowerCase();
    if (!msg.includes('not found') && err?.code !== 'NOT_FOUND') {
      console.error('❌ deleteRoom failed:', err);
      return NextResponse.json({ error: 'Could not end the meeting cleanly' }, { status: 502 });
    }
    console.warn(`⚠️ deleteRoom: room ${roomId} already gone, continuing`);
  }

  presence.callStatus = 'ended';
  presence.endedAt = new Date();
  await presence.save();

  await ScheduledVideoCall.findOneAndUpdate(
    { roomId, status: { $in: ['scheduled', 'started'] } },
    { status: 'completed', completedAt: new Date() }
  );

  return NextResponse.json({ callStatus: 'ended', endedAt: presence.endedAt });
}
