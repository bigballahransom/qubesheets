import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import CallPresence from '@/models/CallPresence';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';
import Project from '@/models/Project';
import { sendSmsWithRetry } from '@/lib/twilio';

const NUDGE_COOLDOWN_MS = 30 * 1000;

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
    return NextResponse.json({ error: 'No active lobby for this room' }, { status: 404 });
  }
  if (presence.agentUserId && presence.agentUserId !== userId) {
    return NextResponse.json({ error: 'Another agent owns this call' }, { status: 403 });
  }

  const lastNudgedAt = (presence as any).lastNudgedAt as Date | undefined;
  if (lastNudgedAt && Date.now() - new Date(lastNudgedAt).getTime() < NUDGE_COOLDOWN_MS) {
    const waitSec = Math.ceil(
      (NUDGE_COOLDOWN_MS - (Date.now() - new Date(lastNudgedAt).getTime())) / 1000
    );
    return NextResponse.json(
      { error: `Please wait ${waitSec}s before sending another reminder` },
      { status: 429 }
    );
  }

  const projectId = presence.projectId;
  if (!projectId) {
    return NextResponse.json({ error: 'Lobby missing projectId' }, { status: 500 });
  }

  const [project, scheduled] = await Promise.all([
    Project.findById(projectId).lean(),
    ScheduledVideoCall.findOne({ roomId }).lean(),
  ]);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const p = project as any;
  const s = scheduled as any;

  const customerPhone = s?.customerPhone || p.phone;
  const customerName = s?.customerName || p.customerName || p.name || 'there';

  if (!customerPhone) {
    return NextResponse.json(
      { error: 'No phone number on file for this customer' },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const videoUrl = `${appUrl}/video-call/${roomId}?projectId=${projectId}&name=${encodeURIComponent(customerName)}`;

  const firstName = customerName.split(/[\s,]+/)[0] || 'there';
  const message = `Hi ${firstName}, your moving consultant is ready and waiting for you. Tap to join the call: ${videoUrl}`;

  const result = await sendSmsWithRetry(message, customerPhone);
  if (!result.success) {
    console.error('Nudge SMS failed:', result);
    return NextResponse.json(
      { error: 'Could not send reminder. Please double-check the phone number.' },
      { status: 502 }
    );
  }

  (presence as any).lastNudgedAt = new Date();
  await presence.save();

  return NextResponse.json({ success: true, sentTo: customerPhone });
}
