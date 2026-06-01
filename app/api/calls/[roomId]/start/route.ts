import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import {
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  RoomCompositeEgressRequest,
  RoomEgress,
} from '@livekit/protocol';
import connectMongoDB from '@/lib/mongodb';
import CallPresence from '@/models/CallPresence';
import VideoRecording from '@/models/VideoRecording';
import Project from '@/models/Project';
import ScheduledVideoCall from '@/models/ScheduledVideoCall';

const PRESENCE_WINDOW_MS = 10 * 1000;
const EMPTY_TIMEOUT_S = 180;
const DEPARTURE_TIMEOUT_S = 180;

const roomServiceClient = new RoomServiceClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

function buildAutoEgressConfig(roomId: string): { egress: RoomEgress; s3Key: string } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const s3Key = `recordings/${roomId}/${timestamp}.mp4`;

  const s3Upload = new S3Upload({
    accessKey: process.env.AWS_ACCESS_KEY_ID!,
    secret: process.env.AWS_SECRET_ACCESS_KEY!,
    region: process.env.AWS_REGION!,
    bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME!,
    forcePathStyle: false,
  });

  const fileOutput = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: s3Key,
    output: { case: 's3', value: s3Upload },
  });

  const compositeRequest = new RoomCompositeEgressRequest({
    roomName: roomId,
    layout: 'grid',
    audioOnly: false,
    videoOnly: false,
    fileOutputs: [fileOutput],
  });

  const egress = new RoomEgress({ room: compositeRequest });

  return { egress, s3Key };
}

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
    return NextResponse.json({ error: 'Another agent is handling this call' }, { status: 403 });
  }
  if (presence.callStatus === 'live') {
    return NextResponse.json({ callStatus: 'live', startedAt: presence.startedAt });
  }
  if (presence.callStatus === 'ended') {
    return NextResponse.json({ error: 'Call has already ended' }, { status: 409 });
  }

  const customerFresh =
    presence.customerLastSeen &&
    Date.now() - new Date(presence.customerLastSeen).getTime() < PRESENCE_WINDOW_MS;
  if (!customerFresh) {
    return NextResponse.json({ error: 'Customer is not currently in the waiting room' }, { status: 409 });
  }

  const projectId = presence.projectId;
  if (!projectId) {
    return NextResponse.json({ error: 'Lobby is missing projectId' }, { status: 500 });
  }
  const project = await Project.findById(projectId).lean();
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Pre-create the recording so participant_joined webhooks attach to it instead of
  // racing to create their own. This is the canonical recording for this call.
  const { egress, s3Key } = buildAutoEgressConfig(roomId);

  const recording = await VideoRecording.create({
    projectId,
    userId: (project as any).userId,
    organizationId: (project as any).organizationId,
    roomId,
    status: 'starting',
    s3Key,
    startedAt: new Date(),
    participants: [],
    activeParticipants: [],
  });

  // Create the LiveKit room with the auto-egress attached. The egress recorder will
  // join as a hidden participant the moment the room exists, so it's already capturing
  // before the agent or customer connect — eliminating the first-connect race.
  try {
    await roomServiceClient.createRoom({
      name: roomId,
      emptyTimeout: EMPTY_TIMEOUT_S,
      departureTimeout: DEPARTURE_TIMEOUT_S,
      egress,
    });
  } catch (err: any) {
    await VideoRecording.findByIdAndUpdate(recording._id, {
      status: 'failed',
      error: `Failed to create room with auto-egress: ${err?.message || 'unknown error'}`,
    });
    console.error('❌ CreateRoom with auto-egress failed:', err);
    return NextResponse.json(
      { error: 'Could not start the meeting. Please try again.' },
      { status: 502 }
    );
  }

  presence.callStatus = 'live';
  presence.startedAt = new Date();
  await presence.save();

  await ScheduledVideoCall.findOneAndUpdate(
    { roomId, status: 'scheduled' },
    { status: 'started', startedAt: new Date() }
  );

  return NextResponse.json({ callStatus: 'live', startedAt: presence.startedAt });
}
