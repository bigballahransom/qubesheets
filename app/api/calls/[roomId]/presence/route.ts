import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import CallPresence from '@/models/CallPresence';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';

const PRESENCE_WINDOW_MS = 10 * 1000;

function isFresh(lastSeen: Date | undefined): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < PRESENCE_WINDOW_MS;
}

async function resolveAgentDisplayName(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const firstName = user.firstName || '';
    const lastName = user.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const email = user.emailAddresses[0]?.emailAddress || '';
    return fullName || email || 'Agent';
  } catch {
    return 'Agent';
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  let body: { side?: 'agent' | 'customer'; displayName?: string; projectId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const side = body.side;
  if (side !== 'agent' && side !== 'customer') {
    return NextResponse.json({ error: 'side must be "agent" or "customer"' }, { status: 400 });
  }

  await connectMongoDB();

  const now = new Date();
  const update: Record<string, any> = { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
  const setOnInsert: Record<string, any> = { roomId, callStatus: 'lobby' };

  if (body.projectId) setOnInsert.projectId = body.projectId;

  if (side === 'agent') {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Agents must be authenticated' }, { status: 401 });
    }
    const displayName = body.displayName?.trim() || (await resolveAgentDisplayName(userId));
    update.agentLastSeen = now;
    update.agentDisplayName = displayName;
    update.agentUserId = userId;
  } else {
    update.customerLastSeen = now;
    if (body.displayName?.trim()) {
      update.customerDisplayName = body.displayName.trim();
    }
  }

  const scheduled = await ScheduledVideoCall.findOne({ roomId }).select('_id').lean();
  if (scheduled) {
    setOnInsert.scheduledVideoCallId = (scheduled as any)._id;
  }

  const presence = await CallPresence.findOneAndUpdate(
    { roomId },
    { $set: update, $setOnInsert: setOnInsert },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return NextResponse.json({
    callStatus: presence.callStatus,
    agentPresent: isFresh(presence.agentLastSeen),
    customerPresent: isFresh(presence.customerLastSeen),
    agentDisplayName: presence.agentDisplayName || null,
    customerDisplayName: presence.customerDisplayName || null,
    startedAt: presence.startedAt || null,
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  await connectMongoDB();

  const [presence, scheduled] = await Promise.all([
    CallPresence.findOne({ roomId }).lean(),
    ScheduledVideoCall.findOne({ roomId }).select('scheduledFor status').lean(),
  ]);

  const p = presence as any;
  const s = scheduled as any;

  return NextResponse.json({
    callStatus: p?.callStatus || 'lobby',
    agentPresent: isFresh(p?.agentLastSeen),
    customerPresent: isFresh(p?.customerLastSeen),
    agentDisplayName: p?.agentDisplayName || null,
    customerDisplayName: p?.customerDisplayName || null,
    startedAt: p?.startedAt || null,
    isScheduled: !!s,
    scheduledFor: s?.scheduledFor || null,
    scheduledStatus: s?.status || null,
  });
}
