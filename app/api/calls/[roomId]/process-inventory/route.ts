// Mid-call "Stop & Process Inventory".
//
// Stops the walkthrough (auto-egress) recording and sends it down the normal
// analysis pipeline while the call stays live. The rest of the call keeps
// recording on a fresh continuation egress that is concatenated onto the main
// video at call end (never analyzed) — so the full call is always on tape.
//
// Reliability ordering (video loss is unacceptable):
//   1. Start the continuation egress FIRST. If it fails, abort — nothing changed.
//   2. Persist continuation ids + midCallProcessedAt on the recording doc.
//   3. Only then stop the main egress. A ~1-2s overlap between the two egresses
//      means a few duplicated frames at the splice point, never a gap.
//
// If the button is never clicked, none of this code runs and the call behaves
// exactly as today.
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import CallPresence from '@/models/CallPresence';
import VideoRecording from '@/models/VideoRecording';
import { startContinuationEgress, stopEgressById } from '@/lib/livekitEgress';

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
  if (presence.callStatus !== 'live') {
    return NextResponse.json({ error: 'Call is not live' }, { status: 409 });
  }

  const recording = await VideoRecording.findOne({
    roomId,
    status: { $in: ['starting', 'recording'] },
    egressId: { $exists: true, $ne: null }
  });

  if (!recording?.egressId) {
    return NextResponse.json(
      { error: 'No active recording found for this call' },
      { status: 404 }
    );
  }
  if (recording.midCallProcessedAt) {
    return NextResponse.json(
      { error: 'Inventory processing was already started for this call', recordingId: recording._id.toString() },
      { status: 409 }
    );
  }

  const mainEgressId = recording.egressId;

  // 1. Continuation egress first — abort untouched on failure.
  let continuation: { egressId: string; s3Key: string };
  try {
    continuation = await startContinuationEgress(roomId);
  } catch (err: any) {
    console.error('❌ process-inventory: continuation egress failed to start:', err);
    return NextResponse.json(
      { error: 'Could not start the continued recording — the call is still being recorded. Try again, or process after the call.' },
      { status: 502 }
    );
  }

  // 2. Persist before stopping the main egress, so the webhook can route both
  //    egress_ended events correctly no matter when they arrive.
  try {
    await VideoRecording.findByIdAndUpdate(recording._id, {
      midCallProcessedAt: new Date(),
      continuationEgressId: continuation.egressId,
      continuationS3Key: continuation.s3Key,
      continuationStatus: 'starting'
    });
  } catch (err: any) {
    console.error('❌ process-inventory: failed to persist continuation fields, stopping orphan egress:', err);
    try {
      await stopEgressById(continuation.egressId);
    } catch (stopErr) {
      console.error('❌ process-inventory: failed to stop orphan continuation egress:', stopErr);
    }
    return NextResponse.json(
      { error: 'Could not start processing — the call is still being recorded normally.' },
      { status: 500 }
    );
  }

  // 3. Stop the main egress → its egress_ended webhook marks the recording
  //    completed and queues analysis (ScheduledVideoCall stays 'started'
  //    because midCallProcessedAt is set). Retry once; if it still fails,
  //    both egresses keep running until room death — degraded (analysis
  //    starts late, splice overlaps), but never lossy.
  let stopWarning: string | undefined;
  try {
    await stopEgressById(mainEgressId);
  } catch (firstErr) {
    console.warn('⚠️ process-inventory: stopEgress failed, retrying once:', firstErr);
    try {
      await stopEgressById(mainEgressId);
    } catch (secondErr) {
      console.error('❌ process-inventory: stopEgress failed twice — both egresses left running:', secondErr);
      stopWarning = 'The walkthrough recording could not be stopped yet; analysis will start when the call ends.';
    }
  }

  console.log(`✅ process-inventory: room ${roomId} — main egress ${mainEgressId} stopping, continuation ${continuation.egressId} recording`);

  return NextResponse.json({
    ok: true,
    recordingId: recording._id.toString(),
    projectId: recording.projectId,
    ...(stopWarning ? { warning: stopWarning } : {})
  });
}
