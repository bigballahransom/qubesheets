import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import CallPresence from '@/models/CallPresence';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';

const PRESENCE_WINDOW_MS = 10 * 1000;
// Cross-room lookups tolerate a longer gap than the in-lobby presence pill:
// heartbeats continue every few seconds in the lobby AND (slower) in the live
// call, so 30s of silence means that side is really gone from that room.
const ACTIVE_ROOM_WINDOW_MS = 30 * 1000;
// "Your consultant stepped away" copy threshold for the current room.
const AGENT_STALE_MS = 60 * 1000;

function isFresh(lastSeen: Date | undefined): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < PRESENCE_WINDOW_MS;
}

/**
 * Cross-room reconciliation for split-room lobbies. The customer's SMS link
 * may point at an older room than the one the agent is actually waiting in
 * (every "Start Virtual Call" click mints a new roomId, and scheduled calls
 * pin one days in advance). The agent is the anchor: report the newest room
 * for this project where an agent is actively present so stale customer
 * lobbies can redirect there. Symmetrically, report a room where a customer
 * is waiting with no agent so the agent's lobby can offer a switch.
 */
async function resolveCrossRoomState(
  projectId: string | undefined,
  roomId: string
): Promise<{ activeRoomId: string | null; customerWaitingElsewhereRoomId: string | null }> {
  if (!projectId) {
    return { activeRoomId: null, customerWaitingElsewhereRoomId: null };
  }

  const activeCutoff = new Date(Date.now() - ACTIVE_ROOM_WINDOW_MS);
  const baseFilter = {
    projectId,
    roomId: { $ne: roomId },
    callStatus: { $in: ['lobby', 'live'] },
  };

  const [agentRoom, customerRoom] = await Promise.all([
    CallPresence.findOne({ ...baseFilter, agentLastSeen: { $gte: activeCutoff } })
      .sort({ agentLastSeen: -1 })
      .select('roomId')
      .lean(),
    CallPresence.findOne({
      ...baseFilter,
      customerLastSeen: { $gte: activeCutoff },
      $or: [{ agentLastSeen: { $exists: false } }, { agentLastSeen: { $lt: activeCutoff } }],
    })
      .sort({ customerLastSeen: -1 })
      .select('roomId')
      .lean(),
  ]);

  return {
    activeRoomId: (agentRoom as any)?.roomId || null,
    customerWaitingElsewhereRoomId: (customerRoom as any)?.roomId || null,
  };
}

/** Agent was in this lobby but their heartbeat went quiet — they left or crashed. */
function agentWentStale(presence: any): boolean {
  if (!presence || presence.callStatus !== 'lobby' || !presence.agentLastSeen) return false;
  return Date.now() - new Date(presence.agentLastSeen).getTime() > AGENT_STALE_MS;
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

  const crossRoom = await resolveCrossRoomState(
    presence.projectId || body.projectId,
    roomId
  );

  return NextResponse.json({
    callStatus: presence.callStatus,
    agentPresent: isFresh(presence.agentLastSeen),
    customerPresent: isFresh(presence.customerLastSeen),
    agentDisplayName: presence.agentDisplayName || null,
    customerDisplayName: presence.customerDisplayName || null,
    startedAt: presence.startedAt || null,
    activeRoomId: crossRoom.activeRoomId,
    customerWaitingElsewhereRoomId: crossRoom.customerWaitingElsewhereRoomId,
    agentWentStale: agentWentStale(presence),
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

  const crossRoom = await resolveCrossRoomState(p?.projectId, roomId);

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
    activeRoomId: crossRoom.activeRoomId,
    customerWaitingElsewhereRoomId: crossRoom.customerWaitingElsewhereRoomId,
    agentWentStale: agentWentStale(p),
  });
}
