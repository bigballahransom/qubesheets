// app/api/cron/self-serve-recovery/route.ts
//
// Detection loop for failed self-serve recording attempts. Today ~46% of
// customers whose recording silently failed never re-record — they believe
// they submitted a walkthrough, the org believes the customer flaked, and
// the lead is lost. This cron makes the failure visible to the ORG so a
// human can follow up:
//
//   failed self-serve recording, 30min–48h old, customer never completed a
//   later recording on the project, not yet notified
//     → notify the org's recipients that the attempt failed (once per attempt)
//
// Deliberately NO automated messaging to customers — the org decides whether
// and how to reach out.
//
// Called by Vercel Cron (see vercel.json). One-shot per recording via
// `recoveryNotifiedAt`; walkthrough (employee-recorded) sessions still count —
// the org should know those failed too.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import Project from '@/models/Project';
import { sendInventoryUpdateNotification } from '@/lib/inventoryUpdateNotifications';

// Up to 25 recordings × Mongo lookups + org notifications sequentially —
// Vercel's default function duration would cut the batch off partway.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron (same pattern as video-call-reminders)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    await connectMongoDB();

    const now = Date.now();
    const windowStart = new Date(now - 48 * 60 * 60 * 1000); // don't resurrect ancient failures
    const windowEnd = new Date(now - 30 * 60 * 1000);        // give the customer 30min to self-recover

    const candidates = await VideoRecording.find({
      source: 'self_serve',
      status: 'failed',
      recoveryNotifiedAt: { $exists: false },
      createdAt: { $gte: windowStart, $lte: windowEnd },
    })
      .sort({ createdAt: 1 })
      .limit(25) // small batches; cron runs frequently
      .lean();

    const results = { checked: candidates.length, orgNotified: 0, skipped: 0 };

    for (const rec of candidates as any[]) {
      try {
        // Customer self-recovered with a later successful recording → nothing to do.
        const recovered = await VideoRecording.exists({
          projectId: rec.projectId,
          source: 'self_serve',
          status: 'completed',
          createdAt: { $gt: rec.createdAt },
        });
        if (recovered) {
          await VideoRecording.findByIdAndUpdate(rec._id, { recoveryNotifiedAt: new Date() });
          results.skipped++;
          continue;
        }

        const project = await Project.findById(rec.projectId).select('name').lean();
        const projectName = (project as any)?.name || 'a project';

        // Tell the org — a silently failed attempt looks like a customer who
        // never tried; this makes it look like what it is, and leaves the
        // decision to reach out (and how) with a human.
        try {
          await sendInventoryUpdateNotification({
            projectId: String(rec.projectId),
            body:
              `A customer's video walkthrough for ${projectName} failed to record (no video was captured), ` +
              `and they haven't successfully re-recorded. You may want to reach out and resend their upload link.`,
            source: 'self-serve-recovery',
          });
          results.orgNotified++;
        } catch (orgErr) {
          console.error(`self-serve-recovery: org notification failed for ${rec._id} (non-fatal):`, orgErr);
        }

        // One-shot: mark handled so the org is never re-notified for the
        // same failed attempt.
        await VideoRecording.findByIdAndUpdate(rec._id, { recoveryNotifiedAt: new Date() });
      } catch (recErr) {
        console.error(`self-serve-recovery: failed processing recording ${rec._id}:`, recErr);
      }
    }

    console.log('✅ self-serve-recovery run:', results);
    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error('self-serve-recovery cron failed:', error);
    return NextResponse.json({ error: 'Recovery cron failed' }, { status: 500 });
  }
}
