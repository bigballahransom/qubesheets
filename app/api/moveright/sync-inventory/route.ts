// app/api/moveright/sync-inventory/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import {
  syncInventoryToMoveright,
  validateMoverightJob,
  type MoverightSyncOption,
} from '@/lib/moveright-inventory-sync';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// Large jobs can take a while; override Vercel's 60s default. The sync lib
// aborts at 85s (5s earlier) so we return a clean error string instead of a
// Vercel 504.
export const maxDuration = 90;

// MoveRight job ids are UUIDs (selected from the search picker, never typed),
// so accept UUID-shaped ids only.
const JOB_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNC_OPTIONS: MoverightSyncOption[] = [
  'items_only',
  'items_and_existing',
  'all',
];

// POST /api/moveright/sync-inventory — push project's inventory to a MoveRight job
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    await connectMongoDB();

    const body = await request.json();
    const projectId: string = body?.projectId;
    const syncOptions: MoverightSyncOption =
      SYNC_OPTIONS.includes(body?.syncOptions) ? body.syncOptions : 'items_only';
    const jobId: string = String(body?.jobId ?? '').trim();
    const jobCode: string | undefined = body?.jobCode
      ? String(body.jobCode).trim()
      : undefined;

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
    }
    if (!JOB_ID_REGEX.test(jobId)) {
      return NextResponse.json(
        {
          error: 'invalid_job_id',
          message: 'MoveRight job ID must be a UUID — pick a job from the search results.',
        },
        { status: 400 }
      );
    }

    const project = await Project.findOne({
      _id: projectId,
      ...getOrgFilter(authContext),
    });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!authContext.organizationId) {
      // MoveRight integration is org-scoped; personal accounts can't use it.
      return NextResponse.json(
        { error: 'MoveRight integration requires an organization context' },
        { status: 400 }
      );
    }

    // Server-side re-validation regardless of what the modal did — the job
    // must exist on this account before we overwrite its inventory.
    const validation = await validateMoverightJob(authContext.organizationId, jobId);

    if (!validation.ok) {
      return NextResponse.json(
        {
          error: 'validation_failed',
          message: validation.error || 'Failed to validate MoveRight job',
        },
        { status: 502 }
      );
    }

    if (!validation.jobFound) {
      return NextResponse.json(
        {
          error: 'job_not_found',
          message:
            'MoveRight has no job with this ID on your account. Re-run the search and pick a job again.',
          jobFound: false,
        },
        { status: 400 }
      );
    }

    const inventoryItems = await InventoryItem.find({ projectId });
    if (inventoryItems.length === 0) {
      return NextResponse.json(
        { error: 'No inventory items found to sync' },
        { status: 400 }
      );
    }
    // Pre-filter mirrors the sync lib's filter (MoveRight has no not-moving
    // field, so not-going items are always excluded). Keeps the empty-payload
    // error message accurate.
    const candidateItems = inventoryItems.filter((item) => item.going !== 'not going');
    if (candidateItems.length === 0) {
      return NextResponse.json(
        { error: 'No items marked as going to sync' },
        { status: 400 }
      );
    }

    const syncResult = await syncInventoryToMoveright(
      projectId,
      candidateItems,
      syncOptions,
      jobId,
      validation.jobCode || jobCode
    );

    if (!syncResult.success) {
      return NextResponse.json(
        {
          error: syncResult.error || 'Sync failed',
          details: syncResult,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Successfully synced ${syncResult.syncedCount} items to MoveRight`,
      syncDetails: {
        projectId,
        jobId,
        jobCode: validation.jobCode || jobCode,
        itemsSynced: syncResult.syncedCount,
        syncedAt: syncResult.syncedAt,
        stage: validation.stage,
        state: validation.state,
      },
    });
  } catch (error) {
    console.error('❌ [MOVERIGHT-SYNC-API] Sync error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error during sync',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// GET /api/moveright/sync-inventory?projectId=... — sync status for the modal.
// Also returns the project's customer details so the modal can pre-fill the
// job search.
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    await connectMongoDB();

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
    }

    const project = await Project.findOne({
      _id: projectId,
      ...getOrgFilter(authContext),
    });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const moverightSync = project.metadata?.moverightSync;
    const totalItems = await InventoryItem.countDocuments({ projectId });
    const goingItems = await InventoryItem.countDocuments({
      projectId,
      going: { $ne: 'not going' },
    });
    const itemsCount = await InventoryItem.countDocuments({
      projectId,
      going: { $ne: 'not going' },
      itemType: { $nin: ['packed_box', 'existing_box', 'boxes_needed'] },
    });
    const existingBoxesCount = await InventoryItem.countDocuments({
      projectId,
      going: { $ne: 'not going' },
      itemType: { $in: ['packed_box', 'existing_box'] },
    });
    const recommendedBoxesCount = await InventoryItem.countDocuments({
      projectId,
      going: { $ne: 'not going' },
      itemType: 'boxes_needed',
    });

    return NextResponse.json({
      projectId,
      jobId: moverightSync?.jobId || null,
      jobCode: moverightSync?.jobCode || null,
      hasJobId: !!moverightSync?.jobId,
      isSynced: !!moverightSync?.synced,
      syncDetails: moverightSync || null,
      customer: {
        name: project.customerName || project.name || '',
        email: project.customerEmail || '',
        phone: project.phone || '',
      },
      inventoryStats: {
        totalItems,
        goingItems,
        itemsCount,
        existingBoxesCount,
        recommendedBoxesCount,
        // Re-syncs are allowed (writing jobs.inventory replaces the job's
        // inventory wholesale, so no duplication risk). canSync only requires
        // that there ARE items to push.
        canSync: goingItems > 0,
      },
    });
  } catch (error) {
    console.error('Error getting MoveRight sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    );
  }
}
