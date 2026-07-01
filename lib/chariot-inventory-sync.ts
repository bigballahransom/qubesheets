// lib/chariot-inventory-sync.ts
//
// Pushes Qube Sheets inventory into a Chariot job via Chariot's documented
// `POST /api/external/inventory` endpoint.
//
// IDEMPOTENCY: Chariot's docs say "If `id` is provided, the endpoint attempts
// to update an existing inventory record; if not provided, a new record is
// created." We capture the returned `id` on the first sync and pass it back
// on subsequent syncs as `id`, so re-syncs UPDATE the same record rather than
// creating duplicates. `project.metadata.chariotSync.chariotInventoryId` is
// the storage slot.
//
// Reference: see Chariot's published "Inventory API" docs (shared in Qube
// Sheets ↔ Chariot integration thread, June 2026).
import crypto from 'crypto';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import OrganizationSettings from '@/models/OrganizationSettings';
import ChariotIntegration, { chariotApiBaseUrl } from '@/models/ChariotIntegration';
import { IInventoryItem } from '@/models/InventoryItem';
import InventoryNote from '@/models/InventoryNote';
import CrewReviewLink from '@/models/CrewReviewLink';
import { logActivity } from '@/lib/activity-logger';

// Chariot's /api/external/inventory endpoint runs the whole upsert inside a
// single DB transaction (their docs, "Transaction Safety"). Large payloads
// (200+ items) routinely take 30-60s. We abort ~5s before the route's Vercel
// function timeout (see maxDuration in app/api/chariot/sync-inventory/route.ts)
// so we return a clean error string instead of a Vercel 504.
const REQUEST_TIMEOUT_MS = 85_000;

export const CHARIOT_INVENTORY_ENDPOINT = '/inventory';

// Display names for the InventoryNote categories when we render them into
// Chariot's single notes blob. Same labels as the SmartMoving notes sync.
const NOTE_CATEGORY_DISPLAY: Record<string, string> = {
  general: 'General',
  inventory: 'Inventory',
  'video-call': 'Video Call',
  customer: 'Customer',
  'moving-day': 'Moving Day',
  'special-instructions': 'Special Instructions',
};

// Stub for v2: prefer client's catalog item names over AI-generated ones.
export const CHARIOT_USE_CLIENT_CATALOG = false;

export type ChariotSyncOption = 'items_only' | 'items_and_existing' | 'all';

interface WeightConfig {
  weightMode: 'actual' | 'custom';
  customWeightMultiplier: number;
}

// Per-item payload.
//
// The docs we have only spec `name`, `quantity`, `room`, `notes`, and
// `not_moving_quantity`. But Chariot's UI matches `name` against their
// internal item catalog and falls back to BLANK volume/weight when the name
// doesn't match — descriptive AI names like "Gray L-Shaped Sectional Sofa"
// never match their catalog, so most items end up valueless in the merge
// preview. To fix that we also send `volume`, `weight`, and `description`.
// Their naming is the singular form of the top-level `volume_override` /
// `weight_override` fields. If Chariot ignores these, no harm done; if they
// accept them (as is most common for REST APIs that mirror their override
// field naming), individual items show real numbers.
//
// TODO(chariot): confirm the per-item field names with Ian. The fallback
// path is the "get client inventory list" endpoint Ian mentioned (v2 work).
export interface ChariotInventoryItem {
  name: string;
  quantity: number;
  room?: string;
  notes?: string;
  not_moving_quantity?: number;
  description?: string;
  volume?: number;
  weight?: number;
}

export interface ChariotInventoryPayload {
  meta: {
    account_id?: string;
    auth_token: string;
  };
  job_id: number;
  // When present, Chariot updates the existing inventory record with this id
  // instead of creating a new one. See file header.
  id?: string | number;
  inventory_items: ChariotInventoryItem[];
  name?: string;
  notes?: string;
  category?: string;
  // Top-level totals. Chariot uses these to populate the merge preview's
  // header numbers. Sending them as a safety net ensures the totals are
  // correct even if Chariot ignores per-item volume/weight.
  weight_override?: number;
  volume_override?: number;
}

export interface ChariotSyncResult {
  success: boolean;
  syncedCount: number;
  syncedAt?: Date;
  chariotInventoryId?: string | number;
  error?: string;
}

export interface ChariotValidateJobResult {
  ok: boolean;
  jobBelongsToClient?: boolean;
  phoneNumberMatches?: boolean;
  error?: string;
  status?: number;
}

// Mirror the helper in lib/smartmoving-inventory-sync.ts:456 / lib/upload-link-helpers.ts.
// Duplicated rather than abstracted because the same duplication already exists
// in the codebase — extracting only this third copy isn't worth the churn.
function getBaseUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

// Mirrors lib/smartmoving-inventory-sync.ts:549. Returns the active link,
// auto-creating one if none exists. We sync flow can't rely on a Clerk auth
// context, so we source userId/organizationId off the Project.
async function getOrCreateActiveCrewReviewLink(projectId: string) {
  const existing = await CrewReviewLink.findOne({ projectId, isActive: true });
  if (existing) return existing;

  const project = await Project.findById(projectId)
    .select('userId organizationId')
    .lean<{ userId: string; organizationId?: string }>();
  if (!project) {
    throw new Error(
      `Project ${projectId} not found - cannot auto-generate crew review link`
    );
  }

  const reviewToken = crypto.randomBytes(32).toString('hex');
  const linkData: any = {
    projectId,
    userId: project.userId,
    reviewToken,
    isActive: true,
    accessCount: 0,
  };
  if (project.organizationId) {
    linkData.organizationId = project.organizationId;
  }
  return CrewReviewLink.create(linkData);
}

/**
 * Build the single blob we put in Chariot's top-level `notes` field.
 *
 * Chariot's inventory record has only one notes string (no internal/crew/
 * customer split like SmartMoving). We:
 *   1. Group InventoryNote docs by category.
 *   2. Render each group under a "--- {Display Name} Notes ---" header.
 *   3. Prepend the project's crew review URL so the crew gets a one-click
 *      link to the live inventory.
 *
 * Returns an empty string when there are no notes AND we couldn't generate a
 * crew review link — the caller should skip the `notes` field in that case.
 */
async function buildChariotNotesBlob(projectId: string): Promise<string> {
  const notes = await InventoryNote.find({ projectId }).sort({ createdAt: 1 });

  const byCategory: Record<string, Array<{ title?: string; content: string }>> = {};
  for (const note of notes) {
    const category = note.category || 'general';
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push({ title: note.title, content: note.content });
  }

  const sections: string[] = [];
  for (const [category, categoryNotes] of Object.entries(byCategory)) {
    const displayName = NOTE_CATEGORY_DISPLAY[category] || category;
    const body = categoryNotes
      .map((n) => (n.title ? `${n.title}:\n${n.content}` : n.content))
      .join('\n\n');
    sections.push(`--- ${displayName} Notes ---\n${body}`);
  }

  let crewReviewUrl = '';
  try {
    const link = await getOrCreateActiveCrewReviewLink(projectId);
    crewReviewUrl = `${getBaseUrl()}/crew-review/${link.reviewToken}`;
  } catch (err) {
    // Crew link generation failing must NOT block the sync. We'll just send
    // the notes without the link prepended.
    console.warn(
      `⚠️ [CHARIOT-SYNC] Could not generate crew review link for ${projectId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const parts: string[] = [];
  if (crewReviewUrl) parts.push(`Crew Review Link: ${crewReviewUrl}`);
  if (sections.length > 0) parts.push(sections.join('\n\n'));
  return parts.join('\n\n');
}

/**
 * Validate a Chariot Job ID against the org's Chariot integration.
 *
 * Returns `ok: false` only on transport / auth failures. A successful API call
 * always returns `ok: true` plus the boolean flags Chariot reports — caller
 * decides how to react (we block on `jobBelongsToClient: false`, warn on
 * `phoneNumberMatches: false`).
 */
export async function validateChariotJob(
  organizationId: string,
  jobId: string,
  phoneNumber?: string
): Promise<ChariotValidateJobResult> {
  try {
    await connectMongoDB();
    const integration = await ChariotIntegration.findOne({
      organizationId,
      enabled: true,
    });
    if (!integration) {
      return { ok: false, error: 'Chariot integration not configured' };
    }
    if (!integration.clientSubdomain || !integration.authToken) {
      return { ok: false, error: 'Chariot integration missing credentials' };
    }

    const url = `${chariotApiBaseUrl(integration.clientSubdomain)}/validate_job`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Auth-Token': integration.authToken,
    };
    if (integration.accountId) headers['X-Account-Id'] = integration.accountId;

    // Build body with header auth; also include `meta` so Chariot endpoints
    // that only accept in-payload auth still work.
    const meta: Record<string, string> = { auth_token: integration.authToken };
    if (integration.accountId) meta.account_id = integration.accountId;
    const body: Record<string, unknown> = {
      job_id: Number(jobId),
      meta,
    };
    if (phoneNumber) body.phone_number = phoneNumber;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Chariot validate_job ${response.status}: ${text || response.statusText}`,
      };
    }

    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, error: 'Chariot returned non-JSON response' };
    }

    return {
      ok: true,
      jobBelongsToClient: Boolean(parsed?.job_belongs_to_client),
      phoneNumberMatches: Boolean(parsed?.phone_number_matches),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown error in validateChariotJob',
    };
  }
}

/**
 * Sync a project's inventory to a Chariot job. Caller is responsible for
 * having validated the Job ID via `validateChariotJob` first.
 *
 * If the project has previously been synced and we stored a
 * `chariotInventoryId`, we pass it back as `id` and Chariot updates the
 * existing record — no duplicates.
 *
 * `includeNotGoing` (default false) controls whether items the customer
 * marked "not going" are also pushed so the crew sees what's staying behind.
 * When on, those items go to Chariot as `{quantity: 0, not_moving_quantity:
 * totalQuantity}`, leaning on Chariot's documented per-item field.
 */
export async function syncInventoryToChariot(
  projectId: string,
  inventoryItems: IInventoryItem[],
  syncOption: ChariotSyncOption,
  jobId: string,
  includeNotGoing: boolean = false
): Promise<ChariotSyncResult> {
  const startTime = Date.now();
  try {
    console.log(`🔄 [CHARIOT-SYNC] Starting sync for project ${projectId} → job ${jobId}`);
    await connectMongoDB();

    const project = await Project.findById(projectId);
    if (!project) {
      return { success: false, syncedCount: 0, error: 'Project not found' };
    }

    const integration = await ChariotIntegration.findOne({
      organizationId: project.organizationId,
      enabled: true,
    });
    if (!integration) {
      return { success: false, syncedCount: 0, error: 'No Chariot integration configured' };
    }
    if (!integration.clientSubdomain || !integration.authToken) {
      return { success: false, syncedCount: 0, error: 'Chariot integration missing credentials' };
    }

    // Weight config: project-level overrides org-level. Drives per-item
    // weight calculation (and the top-level weight_override total).
    const orgSettings = await OrganizationSettings.findOne({
      organizationId: project.organizationId,
    });
    const weightConfig: WeightConfig = (() => {
      if (project.weightMode) {
        return {
          weightMode: project.weightMode as 'actual' | 'custom',
          customWeightMultiplier: project.customWeightMultiplier || 7,
        };
      }
      if (orgSettings?.weightMode) {
        return {
          weightMode: orgSettings.weightMode as 'actual' | 'custom',
          customWeightMultiplier: orgSettings.customWeightMultiplier || 7,
        };
      }
      return { weightMode: 'actual', customWeightMultiplier: 7 };
    })();

    // Filter items by sync option. CP/PBO/Crated labels are display prefixes
    // only and must not affect filtering. The sync option filter is about
    // item TYPES (regular vs box vs recommended box); the going-state filter
    // is orthogonal and controlled by `includeNotGoing`.
    const itemsToSync = inventoryItems.filter((item) => {
      if (item.going === 'not going' && !includeNotGoing) return false;
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

    const inventory_items = itemsToSync.map((item) =>
      transformItemToChariot(item, weightConfig)
    );

    // Compute totals across what we're actually sending. Sent at top level as
    // weight_override / volume_override so Chariot's merge preview header
    // numbers reflect Qube Sheets' real numbers regardless of how Chariot
    // resolves per-item volume/weight.
    const totalVolume = inventory_items.reduce(
      (sum, ci) => sum + (ci.volume ?? 0) * ci.quantity,
      0
    );
    const totalWeight = inventory_items.reduce(
      (sum, ci) => sum + (ci.weight ?? 0) * ci.quantity,
      0
    );

    const meta: { account_id?: string; auth_token: string } = {
      auth_token: integration.authToken,
    };
    if (integration.accountId) meta.account_id = integration.accountId;

    // Existing Chariot record id (if any) — drives upsert vs create behavior.
    const existingInventoryId = project.metadata?.chariotSync?.chariotInventoryId;

    const payload: ChariotInventoryPayload = {
      meta,
      job_id: Number(jobId),
      inventory_items,
      // Human-readable label that shows up in Chariot's UI alongside the
      // pending inventory review. "Created by service XYZ" in their docs.
      name: `Qube Sheets inventory — ${project.name || projectId}`,
      category: 'Other',
    };
    if (existingInventoryId !== undefined && existingInventoryId !== null) {
      payload.id = existingInventoryId;
    }
    if (totalVolume > 0) {
      payload.volume_override = Math.round(totalVolume * 100) / 100;
    }
    if (totalWeight > 0) {
      payload.weight_override = Math.round(totalWeight * 100) / 100;
    }

    // Combine the project's InventoryNotes (+ crew review link) into Chariot's
    // single top-level notes blob. Wrapped in try/catch so a notes failure
    // never blocks the inventory push itself.
    try {
      const notesBlob = await buildChariotNotesBlob(projectId);
      if (notesBlob) payload.notes = notesBlob;
    } catch (err) {
      console.warn(
        `⚠️ [CHARIOT-SYNC] buildChariotNotesBlob failed for ${projectId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Auth-Token': integration.authToken,
    };
    if (integration.accountId) headers['X-Account-Id'] = integration.accountId;

    const url = `${chariotApiBaseUrl(integration.clientSubdomain)}${CHARIOT_INVENTORY_ENDPOINT}`;
    console.log(
      `📤 [CHARIOT-SYNC] POST ${url} with ${inventory_items.length} items ` +
        `(${existingInventoryId ? `updating id=${existingInventoryId}` : 'new record'})`
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
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
      const errMsg = `Chariot API error: ${response.status} ${response.statusText}`;
      console.error(`❌ [CHARIOT-SYNC] ${errMsg} ${responseText}`);

      // If the stored inventory id is stale (404 — record was deleted in
      // Chariot), clear it so the next sync creates a fresh record.
      if (response.status === 404 && existingInventoryId !== undefined) {
        await Project.findByIdAndUpdate(projectId, {
          $unset: { 'metadata.chariotSync.chariotInventoryId': '' },
        });
      }

      await ChariotIntegration.findByIdAndUpdate(integration._id, {
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

    if (
      responseData &&
      (responseData.error ||
        responseData.errors ||
        responseData.success === false)
    ) {
      const errMsg =
        responseData.error ||
        (responseData.errors
          ? JSON.stringify(responseData.errors)
          : 'Chariot reported failure');
      await ChariotIntegration.findByIdAndUpdate(integration._id, {
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
    const returnedInventoryId = extractInventoryId(responseData) ?? existingInventoryId;

    await Project.findByIdAndUpdate(projectId, {
      'metadata.chariotSync': {
        synced: true,
        jobId,
        syncedAt,
        itemCount: itemsToSync.length,
        syncedItemsHash: itemsHash,
        lastValidatedAt: syncedAt,
        ...(returnedInventoryId !== undefined && returnedInventoryId !== null
          ? { chariotInventoryId: returnedInventoryId }
          : {}),
      },
    });

    await ChariotIntegration.findByIdAndUpdate(integration._id, {
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
      action: 'chariot_sync',
      details: {
        itemsCount: itemsToSync.length,
      },
      metadata: { jobId, chariotInventoryId: returnedInventoryId },
    });

    const duration = Date.now() - startTime;
    console.log(
      `🎉 [CHARIOT-SYNC] Sync completed in ${duration}ms: ${itemsToSync.length} items to job ${jobId} (id=${returnedInventoryId ?? 'none'})`
    );

    return {
      success: true,
      syncedCount: itemsToSync.length,
      syncedAt,
      chariotInventoryId: returnedInventoryId,
    };
  } catch (error) {
    console.error(`❌ [CHARIOT-SYNC] Error syncing project ${projectId}:`, error);
    const isAbort =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        /aborted/i.test(error.message) ||
        (error as any).code === 'ABORT_ERR');
    const errMsg = isAbort
      ? `Chariot took longer than ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s to respond. Try again, or use a narrower sync option (e.g. "Items Only") if the project is very large.`
      : error instanceof Error
      ? error.message
      : 'Unknown error';

    // Best-effort: record the failed attempt in syncHistory so it doesn't
    // silently disappear. We can't rely on `integration` being in scope (the
    // throw may have come from before we loaded it), so re-fetch by projectId.
    try {
      const project = await Project.findById(projectId).select('organizationId');
      if (project?.organizationId) {
        await ChariotIntegration.findOneAndUpdate(
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
        `⚠️ [CHARIOT-SYNC] Could not record failed sync in syncHistory: ${
          logErr instanceof Error ? logErr.message : String(logErr)
        }`
      );
    }

    return {
      success: false,
      syncedCount: 0,
      error: errMsg,
    };
  }
}

function transformItemToChariot(
  item: IInventoryItem,
  weightConfig: WeightConfig
): ChariotInventoryItem {
  // quantity carries the going count. When the customer is keeping a portion
  // of the item, we surface the difference in not_moving_quantity so Chariot's
  // UI shows the full picture.
  const total = item.quantity || 1;
  const isNotGoing = item.going === 'not going';
  // For not-going items we send quantity:0 + not_moving_quantity:total so
  // Chariot's preview shows the line with everything marked as staying. For
  // partials we ship the going count and the remainder as not_moving_quantity.
  // For fully-going items we just ship the count.
  const going = isNotGoing ? 0 : item.goingQuantity ?? total;
  const notMoving = Math.max(0, total - going);
  const quantity = going;

  // Per-unit volume/weight. Chariot's UI shows these multiplied by quantity
  // in the merge preview; we send the per-unit values so Chariot's math
  // matches what we display in Qube Sheets.
  const unitVolume = item.cuft || 0;
  const unitWeight =
    weightConfig.weightMode === 'custom'
      ? unitVolume * weightConfig.customWeightMultiplier
      : item.weight || 0;

  // Name prefixing: Crated applies to any item; CP/PBO apply to boxes
  // (PBO is the default for boxes when packed_by is missing or N/A).
  const itemType = item.itemType || '';
  const isBox = ['packed_box', 'existing_box', 'boxes_needed'].includes(itemType);
  let displayName = item.name;
  if (item.packed_by === 'Crated') {
    displayName = `Crated - ${item.name}`;
  } else if (isBox) {
    if (item.packed_by === 'CP') {
      displayName = `CP - ${item.name}`;
    } else if (
      item.packed_by === 'PBO' ||
      !item.packed_by ||
      item.packed_by === 'N/A'
    ) {
      displayName = `PBO - ${item.name}`;
    }
  }

  const out: ChariotInventoryItem = {
    name: displayName,
    quantity,
  };
  if (item.location) out.room = item.location;
  if (item.description) out.description = item.description;
  if (item.special_handling) out.notes = item.special_handling;
  if (notMoving > 0) out.not_moving_quantity = notMoving;
  if (unitVolume > 0) out.volume = Math.round(unitVolume * 100) / 100;
  if (unitWeight > 0) out.weight = Math.round(unitWeight * 100) / 100;
  return out;
}

// Chariot's docs don't formally pin the response shape for inventory POST,
// but the API is REST-y; try the common spots. Tolerate strings or numbers.
function extractInventoryId(parsed: any): string | number | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const candidates = [
    parsed.id,
    parsed.inventory_id,
    parsed.inventoryId,
    parsed.inventory?.id,
    parsed.data?.id,
    parsed.record?.id,
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null) {
      // Normalize numeric strings to numbers, leave UUIDs as strings.
      if (typeof c === 'number') return c;
      if (typeof c === 'string') {
        const trimmed = c.trim();
        if (!trimmed) continue;
        return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
      }
    }
  }
  return undefined;
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
