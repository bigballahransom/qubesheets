// lib/moverbase-inventory-sync.ts
//
// Pushes a project's inventory to a Moverbase job.
//
// Moverbase (https://developers.moverbase.com/) exposes inventory as a
// sub-resource of a job: PUT /v1/jobs/:id with `items.lines` — an array of
// `{group, name, qty, size}`. `group` is the room label, `size` is the line's
// volume in the ACCOUNT's units (CUBIC FEET or CUBIC METER — we convert for
// metric accounts). Moverbase items have NO weight field, so the org/project
// weight config does not apply here.
//
// The PUT replaces the job's items list wholesale, so re-syncs are naturally
// idempotent — no stored inventory-record id needed (unlike Chariot).
//
// We deliberately do NOT touch job.notes: it's a single overwrite-only field
// (max 10 000 chars) that the mover may already be using; pushing our notes
// blob would clobber theirs.
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import MoverbaseIntegration, {
  MOVERBASE_API_BASE,
  moverbaseAuthHeader,
} from '@/models/MoverbaseIntegration';
import { IInventoryItem } from '@/models/InventoryItem';
import { logActivity } from '@/lib/activity-logger';

// Inventory PUTs get a long window (route maxDuration is 90s); job validation
// is interactive and gets a short one.
const REQUEST_TIMEOUT_MS = 85_000;
const VALIDATE_TIMEOUT_MS = 5_000;

const CUFT_TO_CUBIC_METERS = 0.0283168;

export type MoverbaseSyncOption = 'items_only' | 'items_and_existing' | 'all';

export interface MoverbaseItemLine {
  group: string;
  name: string;
  qty: number;
  size?: number;
}

export interface MoverbaseSyncResult {
  success: boolean;
  syncedCount: number;
  syncedAt?: Date;
  error?: string;
}

export interface MoverbaseValidateJobResult {
  ok: boolean;
  jobFound?: boolean;
  jobName?: string;
  jobDate?: string;
  jobStatus?: string;
  clientName?: string;
  error?: string;
  status?: number;
}

/**
 * Checks a Moverbase job id by fetching it. The API key is account-scoped,
 * so a 200 means the job exists AND belongs to this account; a 404 means it
 * doesn't (or belongs to someone else — indistinguishable, which is fine).
 * Returns job display details for the confirmation UI.
 */
export async function validateMoverbaseJob(
  organizationId: string,
  jobId: string
): Promise<MoverbaseValidateJobResult> {
  try {
    await connectMongoDB();
    const integration = await MoverbaseIntegration.findOne({
      organizationId,
      enabled: true,
    });
    if (!integration?.apiKey) {
      return { ok: false, error: 'No Moverbase integration configured' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${MOVERBASE_API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: { Authorization: moverbaseAuthHeader(integration.apiKey) },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 404) {
      return { ok: true, jobFound: false };
    }
    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        status: response.status,
        error: `Moverbase API error: ${response.status} ${text}`.trim(),
      };
    }

    let job: any = null;
    try {
      job = await response.json();
    } catch {
      // 200 with unparseable body — treat as found without details
    }
    return {
      ok: true,
      jobFound: true,
      jobName: job?.name || undefined,
      jobDate: job?.date || undefined,
      jobStatus: job?.status || undefined,
      clientName: job?.client?.displayName || undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error validating Moverbase job',
    };
  }
}

/**
 * Resolves the account's units system (IMPERIAL | METRIC). Uses the value
 * cached at connection-test time when available; otherwise asks the API and
 * caches it. Defaults to IMPERIAL on any failure — cuft passthrough.
 */
async function resolveUnitsSystem(integration: {
  _id: unknown;
  apiKey: string;
  testConnection?: { unitsSystem?: string };
}): Promise<'IMPERIAL' | 'METRIC'> {
  const cached = integration.testConnection?.unitsSystem;
  if (cached === 'IMPERIAL' || cached === 'METRIC') return cached;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${MOVERBASE_API_BASE}/accounts/me`, {
        method: 'GET',
        headers: { Authorization: moverbaseAuthHeader(integration.apiKey) },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (response.ok) {
      const account = await response.json();
      const units = account?.settings?.unitsSystem;
      if (units === 'IMPERIAL' || units === 'METRIC') {
        await MoverbaseIntegration.findByIdAndUpdate(integration._id, {
          'testConnection.unitsSystem': units,
        });
        return units;
      }
    }
  } catch {
    // fall through to default
  }
  return 'IMPERIAL';
}

/**
 * Syncs inventory items to a Moverbase job's items list.
 * Designed to never throw — always returns a MoverbaseSyncResult.
 */
export async function syncInventoryToMoverbase(
  projectId: string,
  inventoryItems: IInventoryItem[],
  syncOption: MoverbaseSyncOption,
  jobId: string
): Promise<MoverbaseSyncResult> {
  const startTime = Date.now();
  try {
    console.log(`🔄 [MOVERBASE-SYNC] Starting sync for project ${projectId} → job ${jobId}`);
    await connectMongoDB();

    const project = await Project.findById(projectId);
    if (!project) {
      return { success: false, syncedCount: 0, error: 'Project not found' };
    }

    const integration = await MoverbaseIntegration.findOne({
      organizationId: project.organizationId,
      enabled: true,
    });
    if (!integration) {
      return { success: false, syncedCount: 0, error: 'No Moverbase integration configured' };
    }
    if (!integration.apiKey) {
      return { success: false, syncedCount: 0, error: 'Moverbase integration missing API key' };
    }

    // Filter items by sync option. CP/PBO/Crated labels are display prefixes
    // only and must not affect filtering. Moverbase items have no not-moving
    // field, so "not going" items are always excluded.
    const itemsToSync = inventoryItems.filter((item) => {
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

    if (itemsToSync.length === 0) {
      return {
        success: false,
        syncedCount: 0,
        error: 'No items to sync (after applying the selected sync option)',
      };
    }

    const unitsSystem = await resolveUnitsSystem(integration);
    const lines = itemsToSync.map((item) => transformItemToMoverbaseLine(item, unitsSystem));

    // PUT with only `items` — Moverbase treats absent fields as unchanged
    // (their docs' update example sends a subset of fields), so this replaces
    // the inventory list without touching the rest of the job.
    const payload = { items: { lines } };

    const url = `${MOVERBASE_API_BASE}/jobs/${encodeURIComponent(jobId)}`;
    console.log(
      `📤 [MOVERBASE-SYNC] PUT ${url} with ${lines.length} items (units: ${unitsSystem})`
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: moverbaseAuthHeader(integration.apiKey),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const responseText = await response.text();
    let responseData: any = null;
    if (responseText) {
      try {
        responseData = JSON.parse(responseText);
      } catch {
        // keep as text
      }
    }

    if (!response.ok) {
      const apiMessage = responseData?.message ? ` — ${responseData.message}` : '';
      const errMsg = `Moverbase API error: ${response.status} ${response.statusText}${apiMessage}`;
      console.error(`❌ [MOVERBASE-SYNC] ${errMsg}`);
      await MoverbaseIntegration.findByIdAndUpdate(integration._id, {
        $push: {
          syncHistory: {
            projectId,
            jobId,
            syncedAt: new Date(),
            itemCount: 0,
            success: false,
            error: errMsg,
          },
        },
      });
      return { success: false, syncedCount: 0, error: errMsg };
    }

    const syncedAt = new Date();
    const itemsHash = generateItemsHash(itemsToSync);

    await Project.findByIdAndUpdate(projectId, {
      'metadata.moverbaseSync': {
        synced: true,
        jobId,
        syncedAt,
        itemCount: itemsToSync.length,
        syncedItemsHash: itemsHash,
      },
    });

    await MoverbaseIntegration.findByIdAndUpdate(integration._id, {
      $push: {
        syncHistory: {
          projectId,
          jobId,
          syncedAt,
          itemCount: itemsToSync.length,
          success: true,
        },
      },
    });

    await logActivity({
      projectId,
      organizationId: project.organizationId,
      activityType: 'inventory_update',
      action: 'moverbase_sync',
      details: {
        itemsCount: itemsToSync.length,
      },
      metadata: { jobId },
    });

    const duration = Date.now() - startTime;
    console.log(
      `🎉 [MOVERBASE-SYNC] Sync completed in ${duration}ms: ${itemsToSync.length} items to job ${jobId}`
    );

    return { success: true, syncedCount: itemsToSync.length, syncedAt };
  } catch (error) {
    console.error(`❌ [MOVERBASE-SYNC] Error syncing project ${projectId}:`, error);
    const isAbort =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        /aborted/i.test(error.message) ||
        (error as any).code === 'ABORT_ERR');
    const errMsg = isAbort
      ? `Moverbase took longer than ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s to respond. Try again, or use a narrower sync option (e.g. "Items Only") if the project is very large.`
      : error instanceof Error
      ? error.message
      : 'Unknown error';

    // Best-effort: record the failed attempt in syncHistory so it doesn't
    // silently disappear. `integration` may not be in scope (the throw may
    // have come from before we loaded it), so re-fetch by projectId.
    try {
      const project = await Project.findById(projectId).select('organizationId');
      if (project?.organizationId) {
        await MoverbaseIntegration.findOneAndUpdate(
          { organizationId: project.organizationId },
          {
            $push: {
              syncHistory: {
                projectId,
                jobId,
                syncedAt: new Date(),
                itemCount: 0,
                success: false,
                error: errMsg,
              },
            },
          }
        );
      }
    } catch (logErr) {
      console.warn(
        `⚠️ [MOVERBASE-SYNC] Could not record failed sync in syncHistory: ${
          logErr instanceof Error ? logErr.message : String(logErr)
        }`
      );
    }

    return { success: false, syncedCount: 0, error: errMsg };
  }
}

function transformItemToMoverbaseLine(
  item: IInventoryItem,
  unitsSystem: 'IMPERIAL' | 'METRIC'
): MoverbaseItemLine {
  const qty = item.goingQuantity || item.quantity || 1;

  // Database stores per-unit cuft. Moverbase's items.total is computed
  // server-side from the lines.
  // TODO(moverbase): confirm whether items.total multiplies size × qty or
  // just sums size — adjust to line totals if it's the latter.
  let unitSize = item.cuft || 0;
  if (unitsSystem === 'METRIC') {
    unitSize = unitSize * CUFT_TO_CUBIC_METERS;
  }

  // Prefix packing labels so packing responsibility shows up in Moverbase.
  // Crated applies to any item; CP/PBO apply to boxes; boxes default to PBO
  // when packed_by is missing/N/A.
  const itemType = item.itemType || '';
  const isBox = ['packed_box', 'existing_box', 'boxes_needed'].includes(itemType);
  let displayName = item.name;
  if (item.packed_by === 'Crated') {
    displayName = `Crated - ${item.name}`;
  } else if (isBox) {
    if (item.packed_by === 'CP') {
      displayName = `CP - ${item.name}`;
    } else if (item.packed_by === 'PBO' || !item.packed_by || item.packed_by === 'N/A') {
      displayName = `PBO - ${item.name}`;
    }
  }

  const line: MoverbaseItemLine = {
    group: item.location || 'Other',
    name: displayName,
    qty,
  };
  if (unitSize > 0) {
    line.size = Math.round(unitSize * 100) / 100;
  }
  return line;
}

function generateItemsHash(items: IInventoryItem[]): string {
  const itemsString = items
    .map((item) => `${item._id}-${item.goingQuantity || item.quantity}`)
    .sort()
    .join('|');

  let hash = 0;
  for (let i = 0; i < itemsString.length; i++) {
    const char = itemsString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}
