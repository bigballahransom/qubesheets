// app/api/chariot/sync-inventory/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import {
  syncInventoryToChariot,
  validateChariotJob,
  type ChariotSyncOption,
} from '@/lib/chariot-inventory-sync';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// Chariot's inventory endpoint is transactional (docs: "Transaction Safety")
// and routinely takes 30-60s for 200+ item payloads. Override Vercel's 60s
// default so large syncs complete. The sync lib aborts at 85s (5s earlier)
// so we return a clean error string instead of a Vercel 504.
export const maxDuration = 90;

// Match the validate-job route. Chariot's docs show 4-5 digit IDs; 3-8 is a
// permissive-but-sane bound.
const JOB_ID_REGEX = /^\d{3,8}$/;
const SYNC_OPTIONS: ChariotSyncOption[] = [
  'items_only',
  'items_and_existing',
  'all',
];

// POST /api/chariot/sync-inventory — push project's inventory to a Chariot job
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    await connectMongoDB();

    const body = await request.json();
    const projectId: string = body?.projectId;
    const syncOptions: ChariotSyncOption =
      SYNC_OPTIONS.includes(body?.syncOptions) ? body.syncOptions : 'items_only';
    const jobId: string = String(body?.jobId ?? '').trim();
    const phoneNumber: string | undefined = body?.phoneNumber
      ? String(body.phoneNumber).trim()
      : undefined;
    // When true, also push items the customer marked "not going" so the
    // crew sees what's intentionally staying behind. Default false.
    const includeNotGoing: boolean = body?.includeNotGoing === true;

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 });
    }
    if (!JOB_ID_REGEX.test(jobId)) {
      return NextResponse.json(
        {
          error: 'invalid_job_id',
          message: 'Chariot Job ID must be a 3 to 8 digit number.',
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
      // Chariot integration is org-scoped; personal accounts can't use it.
      return NextResponse.json(
        { error: 'Chariot integration requires an organization context' },
        { status: 400 }
      );
    }

    // Use the project phone for the validate_job phone match if the caller
    // didn't provide one.
    const effectivePhone = phoneNumber || project.phone;
    const validation = await validateChariotJob(
      authContext.organizationId,
      jobId,
      effectivePhone
    );

    if (!validation.ok) {
      return NextResponse.json(
        {
          error: 'validation_failed',
          message: validation.error || 'Failed to validate Chariot job',
        },
        { status: 502 }
      );
    }

    if (!validation.jobBelongsToClient) {
      return NextResponse.json(
        {
          error: 'job_not_found',
          message: 'Chariot reports this Job ID does not belong to your client. Double-check the ID and try again.',
          jobBelongsToClient: false,
          phoneNumberMatches: validation.phoneNumberMatches,
        },
        { status: 400 }
      );
    }

    const phoneMatched = !!validation.phoneNumberMatches;

    const inventoryItems = await InventoryItem.find({ projectId });
    if (inventoryItems.length === 0) {
      return NextResponse.json(
        { error: 'No inventory items found to sync' },
        { status: 400 }
      );
    }
    // Pre-filter mirrors the sync lib's filter: drop not-going items unless
    // the caller opted in to including them. Keeps the empty-payload error
    // message accurate.
    const candidateItems = includeNotGoing
      ? inventoryItems
      : inventoryItems.filter((item) => item.going !== 'not going');
    if (candidateItems.length === 0) {
      return NextResponse.json(
        { error: 'No items marked as going to sync' },
        { status: 400 }
      );
    }

    const syncResult = await syncInventoryToChariot(
      projectId,
      candidateItems,
      syncOptions,
      jobId,
      includeNotGoing
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
      message: `Successfully synced ${syncResult.syncedCount} items to Chariot`,
      syncDetails: {
        projectId,
        jobId,
        itemsSynced: syncResult.syncedCount,
        syncedAt: syncResult.syncedAt,
        phoneMatched,
      },
    });
  } catch (error) {
    console.error('❌ [CHARIOT-SYNC-API] Sync error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error during sync',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// GET /api/chariot/sync-inventory?projectId=... — sync status for the modal
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

    const chariotSync = project.metadata?.chariotSync;
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
      jobId: chariotSync?.jobId || null,
      hasJobId: !!chariotSync?.jobId,
      isSynced: !!chariotSync?.synced,
      syncDetails: chariotSync || null,
      inventoryStats: {
        totalItems,
        goingItems,
        itemsCount,
        existingBoxesCount,
        recommendedBoxesCount,
        // Re-syncs are allowed (Chariot's review UI dedupes; we surface a
        // duplication warning in the modal). canSync only requires that there
        // ARE items to push.
        canSync: goingItems > 0,
      },
    });
  } catch (error) {
    console.error('Error getting Chariot sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    );
  }
}
