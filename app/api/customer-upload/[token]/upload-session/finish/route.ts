// app/api/customer-upload/[token]/upload-session/finish/route.ts
//
// Finalize a customer batched-photo upload session. The customer has tapped
// "I'm Done" on CustomerPhotoSessionScreen. We send exactly one "{customer}
// finished uploading {N} photos" SMS to the project owner (gated on their
// NotificationSettings.enableInventoryUpdates flag) regardless of how many
// photos were in the session — replacing the per-photo notification noise
// the company would otherwise see.
//
// Idempotent: safe to call twice (e.g. user double-taps "I'm Done"); we
// dedupe on (token, uploadSessionId) using the customerUpload's
// completedUploadSessions array.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Project from '@/models/Project';
import Image from '@/models/Image';
import { sendInventoryUpdateNotification } from '@/lib/inventoryUpdateNotifications';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    if (!token) {
      return NextResponse.json({ error: 'No upload token provided' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const uploadSessionId = typeof body.uploadSessionId === 'string' ? body.uploadSessionId : '';
    const photoCountRaw = typeof body.photoCount === 'number' ? body.photoCount : Number(body.photoCount);
    const photoCount = Number.isFinite(photoCountRaw) && photoCountRaw > 0 ? Math.floor(photoCountRaw) : 0;

    if (!uploadSessionId) {
      return NextResponse.json(
        { error: 'Missing uploadSessionId' },
        { status: 400 }
      );
    }

    // Validate the customer-upload link.
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

    // Idempotency: if we've already sent a finish SMS for this session, no-op.
    const alreadyFinished = Array.isArray((customerUpload as any).completedUploadSessions)
      && (customerUpload as any).completedUploadSessions.some(
        (s: any) => s?.uploadSessionId === uploadSessionId
      );
    if (alreadyFinished) {
      console.log(`⏭️ upload-session/finish: session ${uploadSessionId.slice(0, 8)}… already finalized, skipping duplicate`);
      return NextResponse.json({ ok: true, alreadyFinished: true });
    }

    // Soft-verify that at least one image actually landed for this session.
    // We don't fail the request if zero — the customer's batch could have
    // had all-failed uploads but they still tapped Done; we still record the
    // session and skip the SMS in that case.
    const matchedCount = await Image.countDocuments({
      projectId: customerUpload.projectId,
      uploadSessionId
    });
    if (matchedCount === 0) {
      console.warn(`⚠️ upload-session/finish: 0 Image docs for session ${uploadSessionId.slice(0, 8)}… (token=${token.slice(0, 8)}…). Recording finalization but skipping SMS.`);
    }

    // Look up the project so we can include its name in the SMS copy.
    const project = await Project.findById(customerUpload.projectId);
    const projectName = project?.name || 'your project';

    // Compose the SMS body (the helper appends the project URL on its own
    // line). Skip sending entirely if zero images actually landed, or if
    // this CustomerUpload is an employee on-site walkthrough — the employee
    // doing the upload is the one who would receive the SMS.
    //
    // Belt-and-suspenders: also treat the magic customerName as a walkthrough
    // signal in case the dev-server schema cache dropped the isWalkthrough
    // field on insert.
    let smsSent = 0;
    let smsFailed = 0;
    let recipients = 0;
    const isWalkthrough =
      !!(customerUpload as any).isWalkthrough ||
      customerUpload.customerName === 'On-site walkthrough';
    if (matchedCount > 0 && !isWalkthrough) {
      const body = `${matchedCount} new photo${matchedCount === 1 ? '' : 's'} uploaded for ${projectName}. Inventory analysis is in progress.`;
      const r = await sendInventoryUpdateNotification({
        projectId: String(customerUpload.projectId),
        body,
        source: 'photo-session'
      });
      smsSent = r.sent;
      smsFailed = r.failed;
      recipients = r.matched;
    } else if (isWalkthrough) {
      console.log(`[walkthrough] upload-session/finish: suppressing SMS for session ${uploadSessionId.slice(0, 8)}…`);
    }

    // Record the finalization on the CustomerUpload doc so duplicate POSTs
    // are no-ops. We use $addToSet for idempotency safety.
    await CustomerUpload.updateOne(
      { _id: customerUpload._id },
      {
        $addToSet: {
          completedUploadSessions: {
            uploadSessionId,
            photoCount: matchedCount,
            finishedAt: new Date(),
            smsSent,
            smsFailed
          }
        }
      }
    );

    console.log(`✅ upload-session/finish: session=${uploadSessionId.slice(0, 8)}… photos=${matchedCount} smsSent=${smsSent} smsFailed=${smsFailed}`);

    return NextResponse.json({
      ok: true,
      photoCount: matchedCount,
      reportedPhotoCount: photoCount,
      smsSent,
      smsFailed,
      recipients
    });
  } catch (err) {
    console.error('❌ upload-session/finish error:', err);
    return NextResponse.json({ error: 'Failed to finish upload session' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
