// app/api/moverbase/sync-inventory/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import {
  syncInventoryToMoverbase,
  validateMoverbaseJob,
  type MoverbaseSyncOption,
} from '@/lib/moverbase-inventory-sync';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// Large jobs can take a while; override Vercel's 60s default. The sync lib
// aborts at 85s (5s earlier) so we return a clean error string instead of a
// Vercel 504.
export const maxDuration = 90;

// Match the validate-job route. Moverbase job IDs are short alphanumeric
// strings (docs use examples like "e1aq9eaa").
const JOB_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,19}$/i;
const SYNC_OPTIONS: MoverbaseSyncOption[] = [
  'items_only',
  'items_and_existing',
  'all',
];

// POST /api/moverbase/sync-inventory — push project's inventory to a Moverbase job
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    await connectMongoDB();

    const body = await request.json();
    const projectId: string = body?.projectId;
    const syncOptions: MoverbaseSyncOption =
      SYNC_OPTIONS.includes(body?.syncOptions) ? body.syncOptions : 'items_only';
    const jobId: string = String(body?.jobId ?? '').trim();

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
    }
    if (!JOB_ID_REGEX.test(jobId)) {
      return NextResponse.json(
        {
          error: 'invalid_job_id',
          message: 'Moverbase Job ID must be letters and numbers (e.g. e1aq9eaa).',
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
      // Moverbase integration is org-scoped; personal accounts can't use it.
      return NextResponse.json(
        { error: 'Moverbase integration requires an organization context' },
        { status: 400 }
      );
    }

    const validation = await validateMoverbaseJob(authContext.organizationId, jobId);

    if (!validation.ok) {
      return NextResponse.json(
        {
          error: 'validation_failed',
          message: validation.error || 'Failed to validate Moverbase job',
        },
        { status: 502 }
      );
    }

    if (!validation.jobFound) {
      return NextResponse.json(
        {
          error: 'job_not_found',
          message:
            'Moverbase has no job with this ID on your account. Double-check the ID and try again.',
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
    // Pre-filter mirrors the sync lib's filter (Moverbase has no not-moving
    // field, so not-going items are always excluded). Keeps the empty-payload
    // error message accurate.
    const candidateItems = inventoryItems.filter((item) => item.going !== 'not going');
    if (candidateItems.length === 0) {
      return NextResponse.json(
        { error: 'No items marked as going to sync' },
        { status: 400 }
      );
    }

    const syncResult = await syncInventoryToMoverbase(
      projectId,
      candidateItems,
      syncOptions,
      jobId
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
      message: `Successfully synced ${syncResult.syncedCount} items to Moverbase`,
      syncDetails: {
        projectId,
        jobId,
        itemsSynced: syncResult.syncedCount,
        syncedAt: syncResult.syncedAt,
        jobName: validation.jobName,
        clientName: validation.clientName,
      },
    });
  } catch (error) {
    console.error('❌ [MOVERBASE-SYNC-API] Sync error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error during sync',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// GET /api/moverbase/sync-inventory?projectId=... — sync status for the modal
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

    const moverbaseSync = project.metadata?.moverbaseSync;
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
      jobId: moverbaseSync?.jobId || null,
      hasJobId: !!moverbaseSync?.jobId,
      isSynced: !!moverbaseSync?.synced,
      syncDetails: moverbaseSync || null,
      inventoryStats: {
        totalItems,
        goingItems,
        itemsCount,
        existingBoxesCount,
        recommendedBoxesCount,
        // Re-syncs are allowed (the PUT replaces the job's items list, so no
        // duplication risk). canSync only requires that there ARE items to push.
        canSync: goingItems > 0,
      },
    });
  } catch (error) {
    console.error('Error getting Moverbase sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    );
  }
}
