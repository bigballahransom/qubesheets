// app/api/projects/[projectId]/duplicate/route.ts
// Duplicate a project under a new name. Copies the things that make the
// project reusable — customer/job details, locations, weight config,
// inventory items (media source refs stripped, since media is NOT copied),
// notes, and custom spreadsheet columns. Deliberately NOT copied: media
// (images/videos/recordings/vault), CRM sync metadata (a copy must never
// UPDATE the original's CRM records), upload/vault/share links, assignment,
// and archive state. Spreadsheet rows rebuild from the copied items.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import InventoryNote from '@/models/InventoryNote';
import SpreadsheetData from '@/models/SpreadsheetData';
import { logProjectCreated } from '@/lib/activity-logger';

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

    // Copy inventory items. Media source references are stripped — the copy
    // has no media, so click-to-preview targets would dangle. Cuft/weight
    // stay per-unit (totals derive × quantity downstream).
    //
    // IMPORTANT: insert through the raw collection, NOT the mongoose model.
    // Model insertMany back-fills schema defaults onto fields the source doc
    // never had (e.g. many legacy items have no `going` field; the default
    // would stamp them 'going'), which silently changes downstream stats.
    // The copy must have the exact same field shape as the source.
    const now = new Date();
    const orgId = authContext.isPersonalAccount ? undefined : authContext.organizationId;
    // Same visibility filter the inventory list route uses — legacy projects
    // can carry orphaned item docs (e.g. userId 'video_call_analysis' with no
    // organizationId) that the UI never shows; the copy must not resurrect them.
    const items = await InventoryItem.find(getProjectFilter(authContext, projectId)).lean();
    let itemsCopied = 0;
    if (items.length > 0) {
      const cloned = (items as any[]).map((item) => {
        const {
          _id, __v,
          projectId: _p,
          sourceImageId, sourceVideoId, sourceVideoRecordingId,
          sourceRecordingSessionId, sourceType, videoTimestamp,
          segmentIndex, sourceSegmentIndices, videoTimestamps,
          consolidatedFromCount, goingUpdateSource,
          ...rest
        } = item;
        return {
          ...rest,
          projectId: newProject._id,
          userId,
          ...(orgId ? { organizationId: orgId } : {}),
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

    console.log(
      `📋 Duplicated project ${projectId} → ${newProject._id} ("${name}"): ${itemsCopied} items, ${notesCopied} notes`
    );

    return NextResponse.json({
      success: true,
      projectId: newProject._id.toString(),
      name,
      itemsCopied,
      notesCopied,
    });
  } catch (error) {
    console.error('Error duplicating project:', error);
    return NextResponse.json({ error: 'Failed to duplicate project' }, { status: 500 });
  }
}
