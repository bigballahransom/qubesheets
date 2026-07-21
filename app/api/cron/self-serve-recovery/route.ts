// app/api/cron/self-serve-recovery/route.ts
//
// Recovery loop for failed self-serve recording attempts. Today ~46% of
// customers whose recording silently failed never re-record — they believe
// they submitted a walkthrough, the org believes the customer flaked, and
// the lead is lost. This cron closes that loop:
//
//   failed self-serve recording, 30min–48h old, customer never completed a
//   later recording on the project, not yet notified
//     → SMS the customer their upload link to try again (once, ever)
//     → notify the org's recipients that the attempt failed
//
// Called by Vercel Cron (see vercel.json). One-shot per recording via
// `recoveryNotifiedAt` — a customer is never texted twice for the same
// failed attempt, and walkthrough (employee-recorded) sessions are skipped.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import CustomerUpload from '@/models/CustomerUpload';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import { sendSmsWithRetry } from '@/lib/twilio';
import { sendInventoryUpdateNotification } from '@/lib/inventoryUpdateNotifications';

const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
};

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

    const results = { checked: candidates.length, smsSent: 0, orgNotified: 0, skipped: 0 };

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

        // Resolve the customer's upload link + phone via the session → CustomerUpload.
        const session = rec.selfServeSessionId
          ? await SelfServeRecordingSession.findOne({ sessionId: rec.selfServeSessionId }).lean()
          : null;
        const customerUpload = (session as any)?.customerUploadId
          ? await CustomerUpload.findById((session as any).customerUploadId).lean()
          : null;

        // Employee on-site walkthroughs would SMS the employee — skip.
        const isWalkthrough =
          !!(customerUpload as any)?.isWalkthrough ||
          (customerUpload as any)?.customerName === 'On-site walkthrough';

        const [project, branding] = await Promise.all([
          Project.findById(rec.projectId).select('name').lean(),
          rec.organizationId
            ? Branding.findOne({ organizationId: rec.organizationId }).select('companyName').lean()
            : null,
        ]);
        const companyName = (branding as any)?.companyName || 'your moving company';
        const projectName = (project as any)?.name || 'your project';

        let smsSent = false;
        const customerPhone = (customerUpload as any)?.customerPhone;
        const uploadToken = (customerUpload as any)?.uploadToken;
        if (!isWalkthrough && customerPhone && uploadToken) {
          const link = `${getBaseUrl()}/customer-upload/${uploadToken}`;
          const smsResult = await sendSmsWithRetry(
            `It looks like your video walkthrough for ${companyName} didn't record successfully. ` +
              `No worries — you can try again here: ${link}`,
            customerPhone
          );
          smsSent = smsResult.success;
          if (smsSent) results.smsSent++;
        }

        // Tell the org too — a silently failed attempt looks like a customer
        // who never tried; this makes it look like what it is.
        try {
          await sendInventoryUpdateNotification({
            projectId: String(rec.projectId),
            body:
              `A customer's video walkthrough for ${projectName} failed to record (no video was captured).` +
              (smsSent ? ' We texted them a link to try again.' : ''),
            source: 'self-serve-recovery',
          });
          results.orgNotified++;
        } catch (orgErr) {
          console.error(`self-serve-recovery: org notification failed for ${rec._id} (non-fatal):`, orgErr);
        }

        // One-shot: mark handled even if SMS couldn't be sent (no phone on
        // file, walkthrough, or Twilio failure) — never risk repeat texts.
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
