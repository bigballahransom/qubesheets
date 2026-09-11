// app/api/customer-upload/[token]/vault-annotate/route.ts
// Lets whoever holds a VAULT capture link attach an optional title +
// description to media they just captured through that link. Auth is
// possession of an active vault-purpose token; the media must belong to the
// token's project and be vault media — so a capture link can never touch
// survey media or another project's vault.
//
// Body: { kind: 'image' | 'video' | 'session', id, label?, description? }
//   - kind 'session' targets a LiveKit recording by sessionId: annotations
//     land on SelfServeRecordingSession (the webhook copies them onto the
//     VideoRecording it creates) AND on the recording directly if the
//     webhook already ran — covers both orderings.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';
import { sanitizeVaultFormValues } from '@/lib/vaultUploadForm';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true,
      purpose: 'vault',
    });
    if (!customerUpload) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 });
    }

    const { kind, id, label, description, vaultFormValues } = await request.json();
    const cleanLabel =
      typeof label === 'string' ? label.trim().slice(0, 200) : undefined;
    const cleanDescription =
      typeof description === 'string' ? description.trim().slice(0, 1000) : undefined;
    const cleanFormValues = sanitizeVaultFormValues(vaultFormValues);
    if (cleanLabel === undefined && cleanDescription === undefined && cleanFormValues === undefined) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const projectId = customerUpload.projectId;
    const set: Record<string, unknown> = {};
    if (cleanLabel !== undefined) set.label = cleanLabel;
    if (cleanDescription !== undefined) set.mediaDescription = cleanDescription;
    if (cleanFormValues !== undefined) set.vaultFormValues = cleanFormValues;

    if (kind === 'image') {
      const updated = await Image.findOneAndUpdate(
        { _id: id, projectId, purpose: 'vault', 'metadata.uploadToken': token },
        { $set: set }
      );
      if (!updated) {
        return NextResponse.json({ error: 'Media not found' }, { status: 404 });
      }
    } else if (kind === 'video') {
      const updated = await Video.findOneAndUpdate(
        { _id: id, projectId, purpose: 'vault', 'metadata.uploadToken': token },
        { $set: set }
      );
      if (!updated) {
        return NextResponse.json({ error: 'Media not found' }, { status: 404 });
      }
    } else if (kind === 'session') {
      // LiveKit recording — annotate by sessionId. Store on the session
      // (webhook copies at recording creation) and patch the recording too
      // in case the webhook already ran.
      const sessionSet: Record<string, unknown> = {};
      if (cleanLabel !== undefined) sessionSet.vaultLabel = cleanLabel;
      if (cleanDescription !== undefined) sessionSet.vaultDescription = cleanDescription;
      if (cleanFormValues !== undefined) sessionSet.vaultFormValues = cleanFormValues;
      const session = await SelfServeRecordingSession.findOneAndUpdate(
        { sessionId: String(id), customerUploadId: customerUpload._id },
        { $set: sessionSet }
      );
      if (!session) {
        return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
      }
      await VideoRecording.updateOne(
        { selfServeSessionId: String(id), purpose: 'vault' },
        { $set: set }
      );
      // Photos snapped during this recording inherit the form answers (but
      // NOT the title/description — each snap keeps its own per-photo label,
      // e.g. "Crew photo 0:11"). Snaps always finish before the completion
      // screen where this annotate fires, so no ordering race.
      if (cleanFormValues !== undefined) {
        await Image.updateMany(
          {
            projectId,
            purpose: 'vault',
            'metadata.uploadToken': token,
            'metadata.selfServeSessionId': String(id),
          },
          { $set: { vaultFormValues: cleanFormValues } }
        );
      }
    } else {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error annotating vault media:', error);
    return NextResponse.json({ error: 'Failed to save details' }, { status: 500 });
  }
}
