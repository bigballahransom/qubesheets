// app/api/projects/[projectId]/stranded-walkthroughs/route.ts
//
// GET: on-site walkthrough recordings stranded on the recording device.
//
// A local-capture session that started recording but never finalized stays
// 'initialized' forever — the footage is still in the recording phone's
// browser storage, recoverable by reopening the upload link on that phone
// (the recorder shows a finish-upload banner). Six walkthroughs were lost
// this way in Sept 2026 before the project header surfaced them.
//
// ON-SITE ONLY by explicit product decision: customer self-serve links are
// never surfaced here — the org can't walk a customer's phone through
// recovery from this screen, and we never auto-contact end customers.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import CustomerUpload from '@/models/CustomerUpload';
import VideoRecording from '@/models/VideoRecording';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// Younger than this and the recording/upload may still be live on the phone
// — showing a recovery button mid-recording would be a false alarm.
const MIN_AGE_MS = 15 * 60 * 1000;
// Older than this and the on-device footage has likely been evicted
// (iOS clears site storage after ~7 days without a visit).
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    const { projectId } = await params;

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const now = Date.now();
    const sessions = await SelfServeRecordingSession.find({
      projectId,
      status: 'initialized',
      createdAt: {
        $gte: new Date(now - MAX_AGE_MS),
        $lte: new Date(now - MIN_AGE_MS)
      }
    })
      .select('sessionId uploadToken customerUploadId createdAt')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    if (sessions.length === 0) {
      return NextResponse.json({ strandedWalkthroughs: [] });
    }

    // On-site provenance lives only on CustomerUpload (isWalkthrough flag,
    // with the magic customerName fallback for stale-schema docs).
    const uploads = await CustomerUpload.find({
      _id: { $in: sessions.map((s: any) => s.customerUploadId).filter(Boolean) }
    })
      .select('isWalkthrough customerName')
      .lean();
    const walkthroughUploadIds = new Set(
      uploads
        .filter((u: any) => u.isWalkthrough || u.customerName === 'On-site walkthrough')
        .map((u: any) => u._id.toString())
    );

    // A session with a VideoRecording finalized after all (restore script,
    // finalize race) — it isn't stranded, its video is in the gallery.
    const finalized = await VideoRecording.find({
      selfServeSessionId: { $in: sessions.map((s: any) => s.sessionId) }
    })
      .select('selfServeSessionId')
      .lean();
    const finalizedSessionIds = new Set(finalized.map((r: any) => r.selfServeSessionId));

    const strandedWalkthroughs = sessions
      .filter((s: any) =>
        s.customerUploadId &&
        walkthroughUploadIds.has(s.customerUploadId.toString()) &&
        !finalizedSessionIds.has(s.sessionId)
      )
      .map((s: any) => ({
        sessionId: s.sessionId,
        recordedAt: s.createdAt,
        // ?start=recording skips the record/upload chooser and lands on the
        // recorder's instructions screen — where the "Unfinished upload"
        // banner with the Finish-upload button is. Without it the estimator
        // has to tap "Record a video" to reach the banner, which reads like
        // "record it again" mid-recovery.
        // &recover=1 additionally arms the recorder's wrong-device notice:
        // if this browser holds no resumable footage, it says so instead of
        // showing a plain record screen.
        resumeUrl: `/customer-upload/${s.uploadToken}?start=recording&recover=1`
      }));

    return NextResponse.json({ strandedWalkthroughs });
  } catch (error) {
    console.error('stranded-walkthroughs failed:', error);
    return NextResponse.json({ error: 'Failed to check for stranded walkthroughs' }, { status: 500 });
  }
}
