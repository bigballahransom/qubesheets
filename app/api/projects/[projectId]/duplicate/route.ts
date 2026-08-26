// app/api/projects/[projectId]/duplicate/route.ts
// Duplicate a project under a new name. Copies the things that make the
// project reusable — customer/job details, locations, weight config,
// inventory items, notes, custom spreadsheet columns — and DEEP-COPIES media:
// images, videos, and completed call/self-serve recordings get new documents
// AND new S3 objects (copyS3Object), so the two projects never share files.
// Item media source refs are remapped to the copied docs; refs to media that
// couldn't be copied are stripped so previews never dangle.
// Deliberately NOT copied: CRM sync metadata (a copy must never UPDATE the
// original's CRM records), upload/vault/share links, assignment, archive
// state, in-flight recordings, call transcripts / per-segment analysis docs
// (pipeline staging — playback and inventory don't need them), and media
// comments. Spreadsheet rows rebuild from the copied items.
import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import InventoryNote from '@/models/InventoryNote';
import SpreadsheetData from '@/models/SpreadsheetData';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';
import { copyS3Object } from '@/lib/s3Upload';
import { logProjectCreated } from '@/lib/activity-logger';

// S3 copies are server-side (no bytes through this function) but a
// video-heavy project still needs headroom beyond the routing default.
export const maxDuration = 300;

const S3_COPY_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    const { projectId } = await params;

    const source = await Project.findOne(getOrgFilter(authContext, { _id: projectId })).lean();
    if (!source) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 200);
    if (!name) {
      return NextResponse.json({ error: 'A name for the new project is required' }, { status: 400 });
    }

    const src = source as any;

    const newProject = await Project.create({
      name,
      customerName: src.customerName,
      customerEmail: src.customerEmail,
      customerCompanyName: src.customerCompanyName,
      phone: src.phone,
      customerId: src.customerId,
      description: src.description,
      jobDate: src.jobDate,
      arrivalWindowStart: src.arrivalWindowStart,
      arrivalWindowEnd: src.arrivalWindowEnd,
      opportunityType: src.opportunityType,
      jobType: src.jobType,
      origin: src.origin,
      destination: src.destination,
      stops: src.stops,
      weightMode: src.weightMode,
      customWeightMultiplier: src.customWeightMultiplier,
      userId,
      organizationId: authContext.isPersonalAccount ? undefined : authContext.organizationId,
      metadata: {
        source: 'duplicate',
        duplicatedFromProjectId: String(src._id),
      },
    });

    const now = new Date();
    const orgId = authContext.isPersonalAccount ? undefined : authContext.organizationId;
    const orgStamp = orgId ? { organizationId: orgId } : {};

    // ── Media deep copy ──────────────────────────────────────────────────
    // Old→new doc id maps drive the item source-ref remapping below. Media
    // whose S3 copy fails is skipped entirely (no doc pointing at a missing
    // file) and counted in mediaFailed.
    const imageIdMap = new Map<string, string>();
    const videoIdMap = new Map<string, string>();
    const recordingIdMap = new Map<string, string>();
    let mediaFailed = 0;

    // Images — inventory AND vault (getProjectFilter matches the visibility
    // scoping every media list route uses). Inline `data` buffers copy by
    // insertion; s3RawFile objects get a fresh S3 copy. Legacy
    // Cloudinary-only images carry their fields as-is: deletes are doc-only
    // in this app, so the shared CDN asset can't be destroyed via the copy.
    const images = await Image.find(getProjectFilter(authContext, projectId)).lean();
    const clonedImages = (
      await mapWithConcurrency(images as any[], S3_COPY_CONCURRENCY, async (img) => {
        const { _id, __v, projectId: _p, uploadSessionId, ...rest } = img;
        let s3RawFile = rest.s3RawFile;
        if (s3RawFile?.key) {
          try {
            const copied = await copyS3Object(s3RawFile.key, { bucket: s3RawFile.bucket });
            s3RawFile = { ...s3RawFile, key: copied.key, bucket: copied.bucket, url: copied.url, uploadedAt: now };
          } catch (err) {
            console.warn(`⚠️ Duplicate: S3 copy failed for image ${_id} (${s3RawFile.key}):`, err instanceof Error ? err.message : err);
            mediaFailed++;
            return null;
          }
        }
        const newId = new mongoose.Types.ObjectId();
        imageIdMap.set(String(_id), String(newId));
        return {
          ...rest,
          ...(s3RawFile ? { s3RawFile } : {}),
          _id: newId,
          projectId: newProject._id,
          userId,
          ...orgStamp,
          createdAt: now,
          updatedAt: now,
        };
      })
    ).filter(Boolean) as any[];
    if (clonedImages.length > 0) {
      await Image.collection.insertMany(clonedImages);
    }

    // Videos — same treatment. recordingSessionId is stripped: it ties
    // capture chunks to a live-call session lookup that must never resolve
    // to another project's chunks.
    const videos = await Video.find(getProjectFilter(authContext, projectId)).lean();
    const clonedVideos = (
      await mapWithConcurrency(videos as any[], S3_COPY_CONCURRENCY, async (video) => {
        const { _id, __v, projectId: _p, recordingSessionId, ...rest } = video;
        let s3RawFile = rest.s3RawFile;
        if (s3RawFile?.key) {
          try {
            const copied = await copyS3Object(s3RawFile.key, { bucket: s3RawFile.bucket });
            s3RawFile = { ...s3RawFile, key: copied.key, bucket: copied.bucket, url: copied.url };
          } catch (err) {
            console.warn(`⚠️ Duplicate: S3 copy failed for video ${_id} (${s3RawFile.key}):`, err instanceof Error ? err.message : err);
            mediaFailed++;
            return null;
          }
        }
        const newId = new mongoose.Types.ObjectId();
        videoIdMap.set(String(_id), String(newId));
        return {
          ...rest,
          ...(s3RawFile ? { s3RawFile } : {}),
          _id: newId,
          projectId: newProject._id,
          userId,
          ...orgStamp,
          createdAt: now,
          updatedAt: now,
        };
      })
    ).filter(Boolean) as any[];
    if (clonedVideos.length > 0) {
      await Video.collection.insertMany(clonedVideos);
    }

    // Call / self-serve recordings — only settled ones (completed/partial)
    // have a playable file; in-flight recordings stay behind, which also
    // keeps the unique active-recording-per-room index unchallenged. The
    // list route queries by bare string projectId, so no org filter here.
    // Egress/session/pipeline linkage fields are stripped: egress ids are
    // webhook-lookup keys and continuation/session ids point at documents
    // and machinery that stay with the original.
    const recordings = await VideoRecording.find({
      projectId,
      status: { $in: ['completed', 'partial'] },
    }).lean();
    const clonedRecordings = (
      await mapWithConcurrency(recordings as any[], 2, async (rec) => {
        const {
          _id, __v,
          projectId: _p,
          egressId, continuationEgressId, continuationS3Key, continuationStatus,
          customerEgressId, customerEgressStatus, customerSegmentPrefix,
          selfServeSessionId, previousRecordingId, continuedInRecordingId,
          activeParticipants, preConcatS3Key, midCallProcessedAt,
          ...rest
        } = rec;
        try {
          const copied = await copyS3Object(rest.s3Key);
          rest.s3Key = copied.key;
          rest.s3Url = copied.url;
        } catch (err) {
          console.warn(`⚠️ Duplicate: S3 copy failed for recording ${_id} (${rest.s3Key}):`, err instanceof Error ? err.message : err);
          mediaFailed++;
          return null;
        }
        // Customer-only MP4 backs "Process inventory" reruns — copy it too,
        // but a failure only drops the field, not the recording.
        if (rest.customerVideoS3Key) {
          try {
            const copied = await copyS3Object(rest.customerVideoS3Key);
            rest.customerVideoS3Key = copied.key;
          } catch {
            delete rest.customerVideoS3Key;
          }
        }
        const newId = new mongoose.Types.ObjectId();
        recordingIdMap.set(String(_id), String(newId));
        return {
          ...rest,
          _id: newId,
          projectId: String(newProject._id),
          userId,
          ...orgStamp,
          createdAt: now,
          updatedAt: now,
        };
      })
    ).filter(Boolean) as any[];
    if (clonedRecordings.length > 0) {
      await VideoRecording.collection.insertMany(clonedRecordings);
    }

    // ── Inventory items ──────────────────────────────────────────────────
    // Media source refs are kept and remapped to the copied media docs;
    // refs to media that wasn't copied (failed S3 copy, in-flight
    // recording, orphaned id) are stripped so click-to-preview never
    // dangles. Cuft/weight stay per-unit (totals derive × quantity
    // downstream).
    //
    // IMPORTANT: insert through the raw collection, NOT the mongoose model.
    // Model insertMany back-fills schema defaults onto fields the source doc
    // never had (e.g. many legacy items have no `going` field; the default
    // would stamp them 'going'), which silently changes downstream stats.
    // The copy must have the exact same field shape as the source.
    //
    // Same visibility filter the inventory list route uses — legacy projects
    // can carry orphaned item docs (e.g. userId 'video_call_analysis' with no
    // organizationId) that the UI never shows; the copy must not resurrect them.
    const items = await InventoryItem.find(getProjectFilter(authContext, projectId)).lean();
    let itemsCopied = 0;
    if (items.length > 0) {
      const remap = (map: Map<string, string>, id: unknown) => {
        const mapped = id ? map.get(String(id)) : undefined;
        return mapped ? { mapped: new mongoose.Types.ObjectId(mapped) } : null;
      };
      const cloned = (items as any[]).map((item) => {
        const {
          _id, __v,
          projectId: _p,
          sourceImageId, sourceVideoId, sourceVideoRecordingId,
          sourceRecordingSessionId,
          ...rest
        } = item;
        const image = remap(imageIdMap, sourceImageId);
        const video = remap(videoIdMap, sourceVideoId);
        const recording = remap(recordingIdMap, sourceVideoRecordingId);
        return {
          ...rest,
          ...(image ? { sourceImageId: image.mapped } : {}),
          ...(video ? { sourceVideoId: video.mapped } : {}),
          ...(recording ? { sourceVideoRecordingId: recording.mapped } : {}),
          projectId: newProject._id,
          userId,
          ...orgStamp,
          createdAt: now,
          updatedAt: now,
        };
      });
      const inserted = await InventoryItem.collection.insertMany(cloned);
      itemsCopied = inserted.insertedCount;
    }

    // Copy notes (raw insert for the same field-fidelity reason)
    const notes = await InventoryNote.find({ projectId }).lean();
    let notesCopied = 0;
    if (notes.length > 0) {
      const clonedNotes = (notes as any[]).map((note) => {
        const { _id, __v, projectId: _p, ...rest } = note;
        return { ...rest, projectId: newProject._id, createdAt: now, updatedAt: now };
      });
      const inserted = await InventoryNote.collection.insertMany(clonedNotes);
      notesCopied = inserted.insertedCount;
    }

    // Copy custom spreadsheet columns (rows rebuild from the copied items,
    // so stale row→item references are never carried over)
    const sheet = await SpreadsheetData.findOne({ projectId }).lean();
    if (sheet && Array.isArray((sheet as any).columns) && (sheet as any).columns.length > 0) {
      await SpreadsheetData.create({
        projectId: newProject._id,
        userId,
        organizationId: authContext.isPersonalAccount ? undefined : authContext.organizationId,
        columns: (sheet as any).columns,
        rows: [],
      });
    }

    try {
      await logProjectCreated(
        newProject._id.toString(),
        name,
        'duplicate',
        userId,
        authContext.isPersonalAccount ? undefined : authContext.organizationId ?? undefined,
        { duplicatedFrom: src.name, duplicatedFromProjectId: String(src._id) }
      );
    } catch (logError) {
      console.warn('Failed to log project duplication activity:', logError);
    }

    const mediaCopied = clonedImages.length + clonedVideos.length + clonedRecordings.length;
    console.log(
      `📋 Duplicated project ${projectId} → ${newProject._id} ("${name}"): ${itemsCopied} items, ${notesCopied} notes, ` +
      `${clonedImages.length} images, ${clonedVideos.length} videos, ${clonedRecordings.length} recordings` +
      (mediaFailed > 0 ? `, ${mediaFailed} media failed to copy` : '')
    );

    return NextResponse.json({
      success: true,
      projectId: newProject._id.toString(),
      name,
      itemsCopied,
      notesCopied,
      mediaCopied,
      imagesCopied: clonedImages.length,
      videosCopied: clonedVideos.length,
      recordingsCopied: clonedRecordings.length,
      mediaFailed,
    });
  } catch (error) {
    console.error('Error duplicating project:', error);
    return NextResponse.json({ error: 'Failed to duplicate project' }, { status: 500 });
  }
}
