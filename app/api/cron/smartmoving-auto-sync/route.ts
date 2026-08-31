// app/api/cron/smartmoving-auto-sync/route.ts
//
// Debounced auto-sync: keeps SmartMoving estimates 1:1 with QubeSheets
// without anyone pressing a sync button. Every cron tick, orgs with
// autoSyncOnChange enabled get their recently-touched linked projects
// checked; a project syncs when its inventory has changed since the last
// sync (item count + latest updatedAt differ from the recorded snapshot)
// AND has been quiet for a debounce window (so we don't sync mid-edit).
//
// Cheap by construction: candidates are limited to projects whose
// Project.updatedAt moved in the last 24h (inventory routes bump it), and
// each candidate check is two indexed inventoryitems queries. The sync
// itself is the diff engine (~a handful of API calls), and the per-org
// lock in syncInventoryToSmartMoving serializes against manual syncs.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import { syncInventoryToSmartMoving } from '@/lib/smartmoving-inventory-sync';

export const maxDuration = 300;

const DEBOUNCE_MS = 60_000; // wait for a quiet minute after the last edit
const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 30 * 60 * 1000; // don't hammer a failing project
const MAX_PROJECTS_PER_ORG = 5;
const MAX_PROJECTS_PER_RUN = 15;
const TIME_BUDGET_MS = 240_000;

function filterBySyncOption(items: any[], syncOption: string): any[] {
  return items.filter((item: any) => {
    if (item.going === 'not going') return false;
    const itemType = item.itemType || 'regular_item';
    const isExistingBox = itemType === 'packed_box' || itemType === 'existing_box';
    const isRecommendedBox = itemType === 'boxes_needed';
    if (syncOption === 'items_only') {
      if (isExistingBox || isRecommendedBox) return false;
    } else if (syncOption === 'items_and_existing') {
      if (isRecommendedBox) return false;
    }
    return true;
  });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  await connectMongoDB();

  const integrations = await SmartMovingIntegration.find({
    autoSyncOnChange: { $ne: false }
  }).lean() as any[];

  const summary = {
    orgsChecked: 0,
    candidatesChecked: 0,
    synced: 0,
    failed: 0,
    skippedQuiet: 0,
    details: [] as Array<{ projectId: string; result: string }>
  };

  let totalSynced = 0;

  for (const integration of integrations) {
    if (Date.now() - startedAt > TIME_BUDGET_MS || totalSynced >= MAX_PROJECTS_PER_RUN) break;
    summary.orgsChecked++;

    // Recently-touched linked projects for this org
    const candidates = await Project.find({
      organizationId: integration.organizationId,
      'metadata.smartMovingOpportunityId': { $exists: true, $ne: null },
      updatedAt: { $gt: new Date(Date.now() - ACTIVITY_WINDOW_MS) }
    })
      .select('metadata updatedAt')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean() as any[];

    let orgSynced = 0;

    for (const project of candidates) {
      if (Date.now() - startedAt > TIME_BUDGET_MS || totalSynced >= MAX_PROJECTS_PER_RUN) break;
      if (orgSynced >= MAX_PROJECTS_PER_ORG) break;
      summary.candidatesChecked++;

      const projectId = String(project._id);
      const auto = project.metadata?.smartMovingAutoSync || {};

      // Back off projects that keep failing
      if (auto.lastError && auto.lastAttemptAt &&
          Date.now() - new Date(auto.lastAttemptAt).getTime() < FAILURE_BACKOFF_MS) {
        continue;
      }

      // Current inventory fingerprint (2 indexed queries)
      const [itemCount, latestItem] = await Promise.all([
        InventoryItem.countDocuments({ projectId: project._id }),
        InventoryItem.findOne({ projectId: project._id })
          .sort({ updatedAt: -1 }).select('updatedAt').lean() as Promise<{ updatedAt?: Date } | null>
      ]);
      const maxItemUpdatedAt = latestItem?.updatedAt ? new Date(latestItem.updatedAt).getTime() : 0;

      const snapshotCount = auto.itemCount;
      const snapshotMax = auto.maxItemUpdatedAt ? new Date(auto.maxItemUpdatedAt).getTime() : 0;

      // Never synced via this pipeline and no snapshot → only sync if there
      // has been a manual sync before (smartMovingSyncedAt) whose state may
      // have drifted, or there are items at all. A project with no snapshot
      // and no prior sync stays manual-first: the first sync (and the choice
      // to link at all) belongs to a human.
      if (snapshotCount === undefined && !project.metadata?.smartMovingSyncedAt) {
        continue;
      }

      const changed = itemCount !== snapshotCount || maxItemUpdatedAt !== snapshotMax;
      if (!changed) continue;

      // Debounce: skip while edits are still landing
      if (maxItemUpdatedAt > Date.now() - DEBOUNCE_MS) {
        summary.skippedQuiet++;
        continue;
      }

      console.log(`🔁 [SMARTMOVING-AUTO-SYNC] Project ${projectId}: ${snapshotCount ?? '∅'}→${itemCount} items, syncing`);

      try {
        const allItems = await InventoryItem.find({ projectId: project._id });
        const filtered = filterBySyncOption(allItems, integration.autoSyncOption || 'items_only');
        const result = await syncInventoryToSmartMoving(projectId, filtered);

        await Project.findByIdAndUpdate(project._id, {
          $set: {
            'metadata.smartMovingAutoSync.lastAttemptAt': new Date(),
            ...(result.success
              ? {}
              : { 'metadata.smartMovingAutoSync.lastError': result.error || 'sync failed' })
          }
        });

        if (result.success) {
          summary.synced++;
          orgSynced++;
          totalSynced++;
          summary.details.push({ projectId, result: `synced ${result.syncedCount}` });
        } else {
          summary.failed++;
          summary.details.push({ projectId, result: `failed: ${result.error?.slice(0, 120)}` });
        }
      } catch (error) {
        summary.failed++;
        const message = error instanceof Error ? error.message : 'unknown error';
        summary.details.push({ projectId, result: `error: ${message.slice(0, 120)}` });
        await Project.findByIdAndUpdate(project._id, {
          $set: {
            'metadata.smartMovingAutoSync.lastAttemptAt': new Date(),
            'metadata.smartMovingAutoSync.lastError': message
          }
        }).catch(() => undefined);
      }
    }
  }

  console.log(`🔁 [SMARTMOVING-AUTO-SYNC] Done in ${Math.round((Date.now() - startedAt) / 1000)}s:`, JSON.stringify(summary));
  return NextResponse.json({ ok: true, durationMs: Date.now() - startedAt, ...summary });
}
