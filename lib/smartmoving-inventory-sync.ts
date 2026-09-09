// lib/smartmoving-inventory-sync.ts
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import OrganizationSettings from '@/models/OrganizationSettings';
import CrewReviewLink from '@/models/CrewReviewLink';
import VaultShareLink from '@/models/VaultShareLink';
import CustomerUpload from '@/models/CustomerUpload';
import InventoryNote from '@/models/InventoryNote';
import VideoRecording from '@/models/VideoRecording';
import CallAnalysisSegment from '@/models/CallAnalysisSegment';
import { IInventoryItem } from '@/models/InventoryItem';
import { effectiveGoingQuantity } from '@/lib/goingQuantity';
import { logActivity } from '@/lib/activity-logger';
import crypto from 'crypto';

interface WeightConfig {
  weightMode: 'actual' | 'custom';
  customWeightMultiplier: number;
}

interface SmartMovingInventoryItem {
  id?: string;
  name: string;
  description?: string;
  notes?: string;
  volume: number;
  weight: number;
  quantity: number;
  quantityNotGoing: number;
  saveToMaster: boolean;
}

interface SmartMovingInventoryRequest {
  items: SmartMovingInventoryItem[];
}

interface SmartMovingInventoryResponse {
  id: string;
  name: string;
  quantity: number;
}

const SMARTMOVING_BEDROOM_ROOM_ID = 'ff6564a6-38d7-4d87-8f1a-acc601150721';
// SmartMoving's batch POST accepts up to 100 items (verified live 2026-08-31:
// explicit 400 above 100). Bigger batches = 4× fewer requests than the old 25.
const BATCH_SIZE = 100;

// ─── Rate-limit-aware transport ──────────────────────────────────────────────
// SmartMoving enforces ~120 requests/minute (measured 2026-08-31). The old
// sync fired deletes at ~6/sec, so any project past ~100 items blew the limit
// mid-wipe, the failed deletes were silently skipped, and the re-add landed on
// top of the leftovers — the "2,000 cuft in QS, 6,000 in SM" reports. Every
// inventory-mutating call now goes through smRequest: paced under the limit,
// with 429/5xx retries that honor Retry-After.
const SM_MIN_REQUEST_INTERVAL_MS = 550; // ~109/min, safely under the 120/min cap
let smLastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function smRequest(
  url: string,
  init: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const wait = smLastRequestAt + SM_MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    smLastRequestAt = Date.now();

    const response = await fetch(url, init);
    if (response.status !== 429 && response.status < 500) {
      return response;
    }
    lastResponse = response;
    if (attempt < maxRetries) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
      const backoffMs = Math.max(retryAfter * 1000, 2000 * (attempt + 1));
      console.warn(
        `⏳ [SMARTMOVING-RATE] ${response.status} on ${init.method || 'GET'} — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`
      );
      await sleep(backoffMs);
    }
  }
  return lastResponse as Response;
}

/**
 * Deletes an entire SM inventory room (and its items) in ONE request — the
 * fast path for clearing a dirty room. As of 2026-08-31 live testing this
 * endpoint 404s (SmartMoving's public API has no room delete), so the first
 * probe flips the support flag and everything falls back to paced per-item
 * deletes. Kept because it self-enables the moment SmartMoving ships it;
 * cost is one probe request per server instance.
 */
let smRoomDeleteSupported: boolean | null = null;
async function deleteInventoryRoom(
  opportunityId: string,
  roomId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; unsupported?: boolean }> {
  const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory/rooms/${roomId}`;
  const response = await smRequest(url, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey, 'Ocp-Apim-Subscription-Key': clientId },
  });
  if (response.ok) return { success: true };
  if ([400, 404, 405, 501].includes(response.status)) {
    return { success: false, unsupported: true };
  }
  const text = await response.text().catch(() => '');
  console.warn(`⚠️ [SMARTMOVING-ROOM-DELETE] ${response.status} deleting room ${roomId}: ${text.slice(0, 200)}`);
  return { success: false };
}

// Multiset fingerprint of one SM/desired item — used to decide whether a room
// already matches Qube Sheets exactly (skip it: zero API calls). SM responses
// that omit volume/weight hash to '?' and simply never match, which degrades
// to a full room replace — correct, just less efficient.
const round2 = (n: unknown) =>
  typeof n === 'number' && isFinite(n) ? Math.round(n * 100) / 100 : null;
function itemFingerprint(item: { name?: string; quantity?: number; volume?: unknown; weight?: unknown }): string {
  return [
    (item.name || '').trim(),
    item.quantity ?? '?',
    round2(item.volume) ?? '?',
    round2(item.weight) ?? '?',
  ].join('|');
}
function multisetOf(items: any[]): Map<string, number> {
  const set = new Map<string, number>();
  for (const item of items) {
    const key = itemFingerprint(item);
    set.set(key, (set.get(key) || 0) + 1);
  }
  return set;
}
function multisetsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, count] of a) {
    if (b.get(key) !== count) return false;
  }
  return true;
}

export interface SmartMovingSyncVerification {
  /** Items (lines × quantity) SmartMoving reports after the sync. */
  smItemCount: number;
  /** What Qube Sheets says SmartMoving should contain. */
  expectedItemCount: number;
  /** Σ(volume × qty) on the SM side — null when the API omits volume. */
  smVolume: number | null;
  expectedVolume: number;
  smWeight: number | null;
  expectedWeight: number;
  /** True when counts match and totals (where available) agree within 1 unit. */
  matches: boolean;
}

/**
 * Syncs inventory items from QubeSheets to SmartMoving by MIRRORING: after a
 * successful sync, SmartMoving's inventory equals Qube Sheets' exactly.
 * Per-room diffing means untouched rooms cost zero API calls; dirty rooms are
 * cleared (room-delete fast path, per-item fallback) and re-added; a
 * verification pass re-reads SmartMoving and repairs one time before
 * reporting honest match/mismatch numbers.
 * Only ever invoked from user-triggered sync routes — nothing calls this
 * automatically. Designed to never throw.
 */
export async function syncInventoryToSmartMoving(
  projectId: string,
  inventoryItems: IInventoryItem[],
  existingRoomId?: string // Optional room ID to reuse (for re-syncs)
): Promise<{
  success: boolean;
  syncedCount: number;
  removedCount?: number;
  roomId?: string;
  error?: string;
  verification?: SmartMovingSyncVerification;
}> {
  const startTime = Date.now();
  let syncedCount = 0;
  
  try {
    console.log(`🔄 [SMARTMOVING-SYNC] Starting inventory sync for project ${projectId}`);
    console.log(`📦 [SMARTMOVING-SYNC] Input: ${inventoryItems.length} inventory items to process`);
    console.log(`📦 [SMARTMOVING-SYNC] Items summary:`, inventoryItems.map(item => ({
      id: item._id,
      name: item.name,
      quantity: item.quantity,
      going: item.going,
      cuft: item.cuft,
      weight: item.weight
    })));
    
    await connectMongoDB();
    console.log(`✅ [SMARTMOVING-SYNC] MongoDB connected successfully`);

    // 1. Get project and check if it has SmartMoving integration
    console.log(`🔍 [SMARTMOVING-SYNC] Looking up project ${projectId}`);
    const project = await Project.findById(projectId);
    if (!project) {
      console.log(`❌ [SMARTMOVING-SYNC] Project ${projectId} not found in database`);
      return { success: false, syncedCount: 0, error: 'Project not found' };
    }
    
    console.log(`✅ [SMARTMOVING-SYNC] Project found: ${project.name}`);
    console.log(`🔍 [SMARTMOVING-SYNC] Project metadata:`, JSON.stringify(project.metadata, null, 2));

    // 2. Get SmartMoving integration for this organization (need this before lead conversion)
    console.log(`🔍 [SMARTMOVING-SYNC] Looking up SmartMoving integration for organization ${project.organizationId}`);
    const smartMovingIntegration = await SmartMovingIntegration.findOne({
      organizationId: project.organizationId
    });

    if (!smartMovingIntegration) {
      console.log(`❌ [SMARTMOVING-SYNC] No SmartMoving integration found for organization ${project.organizationId}`);
      console.log(`🔍 [SMARTMOVING-SYNC] Available integrations count:`, await SmartMovingIntegration.countDocuments());
      return { success: false, syncedCount: 0, error: 'No SmartMoving integration configured' };
    }

    console.log(`✅ [SMARTMOVING-SYNC] SmartMoving integration found for organization`);
    console.log(`🔍 [SMARTMOVING-SYNC] Integration details:`, {
      clientId: smartMovingIntegration.smartMovingClientId?.substring(0, 10) + '...',
      hasApiKey: !!smartMovingIntegration.smartMovingApiKey,
      apiKeyLength: smartMovingIntegration.smartMovingApiKey?.length
    });

    // 2.5. Get weight configuration (project-level overrides org-level)
    const orgSettings = await OrganizationSettings.findOne({
      organizationId: project.organizationId
    });

    const weightConfig: WeightConfig = (() => {
      // Project-level override takes precedence
      if (project.weightMode) {
        return {
          weightMode: project.weightMode as 'actual' | 'custom',
          customWeightMultiplier: project.customWeightMultiplier || 7
        };
      }
      // Fall back to org settings
      if (orgSettings?.weightMode) {
        return {
          weightMode: orgSettings.weightMode as 'actual' | 'custom',
          customWeightMultiplier: orgSettings.customWeightMultiplier || 7
        };
      }
      // Default
      return { weightMode: 'actual', customWeightMultiplier: 7 };
    })();

    console.log(`⚖️ [SMARTMOVING-SYNC] Weight config: ${weightConfig.weightMode === 'custom' ? `×${weightConfig.customWeightMultiplier}` : 'actual'}`);

    // 3. Get or create SmartMoving opportunity ID
    let smartMovingOpportunityId = project.metadata?.smartMovingOpportunityId;

    if (!smartMovingOpportunityId) {
      console.log(`⚠️ [SMARTMOVING-SYNC] Project ${projectId} has no smartMovingOpportunityId in metadata`);
      console.log(`🔍 [SMARTMOVING-SYNC] Available metadata keys:`, Object.keys(project.metadata || {}));

      // Check if we have a lead ID we can convert
      const smartMovingLeadId = project.metadata?.smartMovingLeadId;
      if (smartMovingLeadId) {
        console.log(`🔄 [SMARTMOVING-SYNC] Found lead ID: ${smartMovingLeadId}. Attempting to convert to opportunity...`);

        // Convert lead to opportunity
        const conversionResult = await convertLeadToOpportunityForSync(
          smartMovingLeadId,
          smartMovingIntegration,
          project
        );

        if (conversionResult.success && conversionResult.opportunityId) {
          // Save the new opportunity ID to project metadata
          await Project.findByIdAndUpdate(projectId, {
            'metadata.smartMovingOpportunityId': conversionResult.opportunityId
          });

          smartMovingOpportunityId = conversionResult.opportunityId;
          console.log(`✅ [SMARTMOVING-SYNC] Lead converted! New OpportunityId: ${smartMovingOpportunityId}`);
        } else {
          console.error(`❌ [SMARTMOVING-SYNC] Failed to convert lead: ${conversionResult.error}`);
          return { success: false, syncedCount: 0, error: `Lead conversion failed: ${conversionResult.error}` };
        }
      } else {
        // No opportunity ID and no lead ID
        return { success: false, syncedCount: 0, error: 'No SmartMoving opportunity ID or lead ID' };
      }
    }

    console.log(`✅ [SMARTMOVING-SYNC] Using SmartMoving opportunity ID: ${smartMovingOpportunityId}`);
    
    // 3. Filter inventory items for SmartMoving
    console.log(`🔍 [SMARTMOVING-SYNC] Filtering items for sync eligibility`);
    // Shared effective-going semantics (lib/goingQuantity.ts): goingQuantity
    // is the source of truth when present — exactly what the sheet displays.
    const itemsToSync = inventoryItems.filter(item => {
      const hasName = !!item.name;
      const hasQuantity = effectiveGoingQuantity(item) > 0;

      console.log(`🔍 [SMARTMOVING-SYNC] Item "${item.name}": hasName=${hasName}, effectiveGoingQty=${effectiveGoingQuantity(item)}, location=${item.location || 'none'}`);

      return hasName && hasQuantity;
    });

    console.log(`🔍 [SMARTMOVING-SYNC] Filtered ${itemsToSync.length} eligible items from ${inventoryItems.length} total`);

    // Notes sync (crew review link + vault links + QubeSheets notes) runs on
    // BOTH the normal path and the zero-item path: jobs that legitimately have
    // no inventory (e.g. designer accounts) still need the links posted into
    // the SmartMoving job notes.
    const runNotesSync = async () => {
      if (smartMovingIntegration.syncCrewLinkOnSync === false) return;
      try {
        const notesResult = await syncNotesToSmartMoving(
          projectId,
          smartMovingOpportunityId,
          smartMovingIntegration.smartMovingApiKey,
          smartMovingIntegration.smartMovingClientId,
          {
            includeVaultLinks: smartMovingIntegration.syncVaultLinksOnSync !== false,
            includeAiSummaries: smartMovingIntegration.syncAiSummariesOnSync !== false
          }
        );
        if (notesResult.success) {
          console.log(`✅ [SMARTMOVING-SYNC] Notes synced to opportunity (${notesResult.notesSynced} notes, ${notesResult.jobsUpdated} jobs updated)`);
        } else if (notesResult.error) {
          console.error(`❌ [SMARTMOVING-SYNC] Failed to sync notes: ${notesResult.error}`);
        }
      } catch (notesError) {
        // Don't fail the entire sync if notes sync fails
        console.error(`❌ [SMARTMOVING-SYNC] Notes sync error (non-fatal):`, notesError);
      }
    };

    if (itemsToSync.length === 0) {
      console.log(`⚠️ [SMARTMOVING-SYNC] No valid items to sync to SmartMoving for project ${projectId}`);
      console.log(`🔍 [SMARTMOVING-SYNC] Filtering results: ${inventoryItems.length} input items, 0 passed filters`);
      await runNotesSync();
      return { success: true, syncedCount: 0 };
    }

    // 4. Group items by location
    const itemsByLocation = new Map<string, typeof itemsToSync>();
    for (const item of itemsToSync) {
      const location = item.location || 'Other';
      if (!itemsByLocation.has(location)) {
        itemsByLocation.set(location, []);
      }
      itemsByLocation.get(location)!.push(item);
    }

    console.log(`🏠 [SMARTMOVING-SYNC] Grouped items into ${itemsByLocation.size} locations:`);
    for (const [loc, items] of itemsByLocation) {
      console.log(`   - ${loc}: ${items.length} items`);
    }

    // 5. Get default room type for creating new rooms
    let defaultRoomTypeId: string | null = null;
    const roomTypeResult = await getDefaultRoomType(
      smartMovingIntegration.smartMovingApiKey,
      smartMovingIntegration.smartMovingClientId
    );
    if (roomTypeResult.success && roomTypeResult.roomTypeId) {
      defaultRoomTypeId = roomTypeResult.roomTypeId;
      console.log(`✅ [SMARTMOVING-SYNC] Default room type ID: ${defaultRoomTypeId}`);
    } else {
      console.log(`⚠️ [SMARTMOVING-SYNC] Could not get default room type: ${roomTypeResult.error}`);
    }

    // 6. Room IDs by location (filled in by the mirror passes below)
    const roomIds: Record<string, string> = {};

    // Helper function to map items to SmartMoving format
    const mapItemsToSmartMovingFormat = (items: typeof itemsToSync): SmartMovingInventoryItem[] => {
      return items.map(item => {
        // Same effective-going semantics as the filter above
        const quantity = effectiveGoingQuantity(item);
        const perItemVolume = Math.round((item.cuft || 0) * 100) / 100;
        const rawWeight = weightConfig.weightMode === 'custom'
          ? (item.cuft || 0) * weightConfig.customWeightMultiplier
          : (item.weight || 0);
        const perItemWeight = Math.round(rawWeight * 100) / 100;

        // Prefix packing label to names so the packing responsibility shows up in SmartMoving.
        // Crated applies to any item; CP/PBO apply to boxes; boxes default to PBO when packed_by is N/A.
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

        return {
          name: displayName,
          description: item.description || '',
          notes: item.special_handling || '',
          volume: perItemVolume,
          weight: perItemWeight,
          quantity: quantity,
          quantityNotGoing: 0,
          saveToMaster: false
        };
      });
    };

    // ── Mirror: make SmartMoving equal Qube Sheets, exactly ─────────────
    const apiKey = smartMovingIntegration.smartMovingApiKey;
    const clientId = smartMovingIntegration.smartMovingClientId;

    // Desired state per location, in SM item format
    const desiredByLocation = new Map<string, SmartMovingInventoryItem[]>();
    for (const [location, locationItems] of itemsByLocation) {
      desiredByLocation.set(location, mapItemsToSmartMovingFormat(locationItems));
    }

    // What SmartMoving MUST total when we're done
    let expectedItemCount = 0;
    let expectedVolume = 0;
    let expectedWeight = 0;
    for (const items of desiredByLocation.values()) {
      for (const it of items) {
        expectedItemCount += it.quantity;
        expectedVolume += it.volume * it.quantity;
        expectedWeight += it.weight * it.quantity;
      }
    }
    expectedVolume = Math.round(expectedVolume * 100) / 100;
    expectedWeight = Math.round(expectedWeight * 100) / 100;

    const roomItemsOf = (room: any): any[] => room.items || room.inventoryItems || [];

    // Plan: which rooms need touching. Rooms whose contents already match
    // Qube Sheets exactly cost ZERO further API calls — a resync after a
    // one-room edit only rewrites that one room.
    interface MirrorPlan {
      replaceRooms: Array<{ room: any; location: string; desired: SmartMovingInventoryItem[] }>;
      extraneousRooms: any[]; // SM rooms with items whose location no longer exists in QS
      missingLocations: Array<{ location: string; desired: SmartMovingInventoryItem[] }>;
      cleanRooms: number;
    }
    const buildPlan = (smRooms: any[]): MirrorPlan => {
      const pending = new Map(desiredByLocation);
      const plan: MirrorPlan = { replaceRooms: [], extraneousRooms: [], missingLocations: [], cleanRooms: 0 };
      for (const room of smRooms) {
        const desired = pending.get(room.name);
        if (desired) {
          pending.delete(room.name);
          roomIds[room.name] = room.id;
          if (multisetsEqual(multisetOf(roomItemsOf(room)), multisetOf(desired))) {
            plan.cleanRooms++;
          } else {
            plan.replaceRooms.push({ room, location: room.name, desired });
          }
        } else if (roomItemsOf(room).length > 0) {
          plan.extraneousRooms.push(room);
        }
      }
      for (const [location, desired] of pending) {
        plan.missingLocations.push({ location, desired });
      }
      return plan;
    };
    const isPlanEmpty = (plan: MirrorPlan) =>
      plan.replaceRooms.length === 0 && plan.extraneousRooms.length === 0 && plan.missingLocations.length === 0;

    let totalSyncedCount = 0;
    let removedCount = 0;
    const errors: string[] = [];

    // Clear one room's items. Fast path: one room-DELETE nukes the room and
    // its contents (feature-detected once); fallback: paced per-item deletes.
    // allowRoomDelete=false forces the per-item path — used when the room must
    // survive because we have no room type to recreate it with.
    const clearRoom = async (room: any, allowRoomDelete = true): Promise<{ roomGone: boolean }> => {
      const items = roomItemsOf(room);
      if (items.length === 0) return { roomGone: false };
      if (allowRoomDelete && smRoomDeleteSupported !== false) {
        const del = await deleteInventoryRoom(smartMovingOpportunityId, room.id, apiKey, clientId);
        if (del.success) {
          smRoomDeleteSupported = true;
          removedCount += items.length;
          console.log(`🗑️ [SMARTMOVING-MIRROR] Deleted room "${room.name}" (${items.length} items, 1 request)`);
          return { roomGone: true };
        }
        if (del.unsupported) {
          smRoomDeleteSupported = false;
          console.log(`ℹ️ [SMARTMOVING-MIRROR] Room-delete endpoint unsupported — using per-item deletes`);
        }
      }
      for (const item of items) {
        const res = await deleteInventoryItem(smartMovingOpportunityId, room.id, item.id, apiKey, clientId);
        if (res.success) {
          removedCount++;
        } else {
          errors.push(`delete "${item.name || item.id}" in ${room.name}: ${res.error}`);
        }
      }
      return { roomGone: false };
    };

    // Add a location's items in batches; a failed batch retries once.
    const addItemsToRoom = async (roomId: string, location: string, mappedItems: SmartMovingInventoryItem[]) => {
      for (let i = 0; i < mappedItems.length; i += BATCH_SIZE) {
        const batch = mappedItems.slice(i, i + BATCH_SIZE);
        let batchResult = await syncToSmartMovingAPI(smartMovingOpportunityId, batch, apiKey, clientId, roomId);
        if (!batchResult.success) {
          console.warn(`🔁 [SMARTMOVING-MIRROR] Batch failed for "${location}" — retrying once: ${batchResult.error}`);
          await sleep(1500);
          batchResult = await syncToSmartMovingAPI(smartMovingOpportunityId, batch, apiKey, clientId, roomId);
        }
        if (batchResult.success) {
          totalSyncedCount += batch.length;
        } else {
          errors.push(`add batch to ${location}: ${batchResult.error}`);
        }
      }
    };

    const applyPlan = async (plan: MirrorPlan) => {
      // Rooms whose location was deleted in Qube Sheets → remove contents
      for (const room of plan.extraneousRooms) {
        console.log(`🗑️ [SMARTMOVING-MIRROR] "${room.name}" no longer exists in Qube Sheets — clearing`);
        await clearRoom(room);
      }
      // Rooms whose contents changed → clear then re-add. Room-delete is only
      // allowed when we can recreate the room afterward.
      for (const { room, location, desired } of plan.replaceRooms) {
        console.log(`🔄 [SMARTMOVING-MIRROR] Replacing "${location}" (${roomItemsOf(room).length} SM items → ${desired.length} QS lines)`);
        const { roomGone } = await clearRoom(room, !!defaultRoomTypeId);
        let roomId = room.id;
        if (roomGone) {
          if (!defaultRoomTypeId) { errors.push(`recreate ${location}: no room type available`); continue; }
          const recreated = await createRoomWithRoomType(smartMovingOpportunityId, defaultRoomTypeId, location, apiKey, clientId);
          if (!recreated.success || !recreated.roomId) { errors.push(`recreate ${location}: ${recreated.error}`); continue; }
          roomId = recreated.roomId;
          roomIds[location] = roomId;
        }
        await addItemsToRoom(roomId, location, desired);
      }
      // Locations with no SM room yet → create + add
      for (const { location, desired } of plan.missingLocations) {
        if (!defaultRoomTypeId) { errors.push(`create ${location}: no room type available`); continue; }
        console.log(`🏗️ [SMARTMOVING-MIRROR] Creating room "${location}" (${desired.length} QS lines)`);
        const created = await createRoomWithRoomType(smartMovingOpportunityId, defaultRoomTypeId, location, apiKey, clientId);
        if (!created.success || !created.roomId) { errors.push(`create ${location}: ${created.error}`); continue; }
        roomIds[location] = created.roomId;
        await addItemsToRoom(created.roomId, location, desired);
      }
    };

    // Pass 1: read, plan, apply
    let read = await getExistingRooms(smartMovingOpportunityId, apiKey, clientId);
    if (!read.success) {
      const msg = `Could not read SmartMoving inventory — sync aborted before changing anything: ${read.error}`;
      console.error(`❌ [SMARTMOVING-MIRROR] ${msg}`);
      return { success: false, syncedCount: 0, error: msg };
    }
    let plan = buildPlan(read.rooms || []);
    console.log(
      `📋 [SMARTMOVING-MIRROR] Plan: ${plan.cleanRooms} rooms already in sync, ` +
      `${plan.replaceRooms.length} to replace, ${plan.missingLocations.length} to create, ` +
      `${plan.extraneousRooms.length} to clear`
    );
    if (!isPlanEmpty(plan)) {
      await applyPlan(plan);

      // SmartMoving's reads lag writes by a few seconds (observed live
      // 2026-09-09: a verification read immediately after a batch POST saw
      // the room as empty, and the repair pass double-added its items). Let
      // the write settle before reading back.
      await sleep(3000);
      read = await getExistingRooms(smartMovingOpportunityId, apiKey, clientId);
      if (read.success) {
        plan = buildPlan(read.rooms || []);
        if (!isPlanEmpty(plan)) {
          // Apparent drift can still be read lag. CONFIRM with a second read
          // after a longer settle before mutating anything — a phantom-empty
          // room must never trigger a duplicate re-add.
          console.warn(
            `⏳ [SMARTMOVING-MIRROR] Verification read shows drift (${plan.replaceRooms.length} replace, ` +
            `${plan.missingLocations.length} missing, ${plan.extraneousRooms.length} extraneous) — confirming after settle...`
          );
          await sleep(5000);
          read = await getExistingRooms(smartMovingOpportunityId, apiKey, clientId);
          if (read.success) {
            plan = buildPlan(read.rooms || []);
            if (!isPlanEmpty(plan)) {
              console.warn(
                `🔧 [SMARTMOVING-MIRROR] Drift confirmed after settle (${plan.replaceRooms.length} replace, ` +
                `${plan.missingLocations.length} missing, ${plan.extraneousRooms.length} extraneous) — repair pass`
              );
              await applyPlan(plan);
              await sleep(3000);
              read = await getExistingRooms(smartMovingOpportunityId, apiKey, clientId);
            } else {
              console.log(`✅ [SMARTMOVING-MIRROR] Drift was read lag — state is clean`);
            }
          }
        }
      }
    }

    // ── Verification: what does SmartMoving actually show now? ──────────
    let verification: SmartMovingSyncVerification | undefined;
    if (read.success) {
      let smUnits = 0;
      let smLines = 0;
      let quantityKnown = true;
      let smVolume: number | null = 0;
      let smWeight: number | null = 0;
      for (const room of read.rooms || []) {
        for (const item of roomItemsOf(room)) {
          smLines++;
          if (typeof item.quantity !== 'number') quantityKnown = false;
          const qty = typeof item.quantity === 'number' ? item.quantity : 1;
          smUnits += qty;
          if (smVolume !== null) {
            smVolume = typeof item.volume === 'number' ? Math.round((smVolume + item.volume * qty) * 100) / 100 : null;
          }
          if (smWeight !== null) {
            smWeight = typeof item.weight === 'number' ? Math.round((smWeight + item.weight * qty) * 100) / 100 : null;
          }
        }
      }
      // If SmartMoving's GET omits per-item quantity, unit counts can't be
      // trusted — compare line counts instead so we never report a false
      // mismatch (or a false match) on missing data.
      const expectedLineCount = Array.from(desiredByLocation.values()).reduce((a, arr) => a + arr.length, 0);
      const smItemCount = quantityKnown ? smUnits : smLines;
      const expectedCountForMatch = quantityKnown ? expectedItemCount : expectedLineCount;
      verification = {
        smItemCount,
        expectedItemCount: expectedCountForMatch,
        smVolume,
        expectedVolume,
        smWeight,
        expectedWeight,
        matches:
          smItemCount === expectedCountForMatch &&
          (smVolume === null || Math.abs(smVolume - expectedVolume) <= 1) &&
          (smWeight === null || Math.abs(smWeight - expectedWeight) <= 1),
      };
      console.log(
        `🔎 [SMARTMOVING-MIRROR] Verification: SM ${smItemCount} items / ${smVolume ?? '?'} cuft / ${smWeight ?? '?'} lbs ` +
        `vs QS ${expectedItemCount} items / ${expectedVolume} cuft / ${expectedWeight} lbs → ${verification.matches ? 'MATCH ✅' : 'MISMATCH ❌'}`
      );
    }

    const succeeded = verification ? verification.matches : errors.length === 0;
    const errorSummary = errors.length > 0 ? errors.slice(0, 3).join('; ') : undefined;
    const finalError = succeeded
      ? undefined
      : verification && !verification.matches
        ? `SmartMoving shows ${verification.smItemCount} items${verification.smVolume !== null ? ` / ${verification.smVolume} cuft` : ''} but Qube Sheets expects ${verification.expectedItemCount} items / ${verification.expectedVolume} cuft. ${errorSummary || 'Re-run the sync.'}`
        : errorSummary || 'Sync incomplete';

    syncedCount = expectedItemCount;
    const firstRoomId = Object.values(roomIds)[0];

    await logActivity({
      projectId,
      userId: 'system',
      activityType: 'inventory_update',
      action: 'smartmoving_inventory_sync',
      details: { itemsCount: itemsToSync.length },
      metadata: {
        success: succeeded,
        smartMovingOpportunityId,
        duration: Date.now() - startTime,
        removedCount,
        addedCount: totalSyncedCount,
        verification,
        ...(errorSummary ? { errors: errorSummary } : {})
      }
    });

    if (succeeded) {
      console.log(`✅ [SMARTMOVING-MIRROR] Verified mirror for project ${projectId} in ${Date.now() - startTime}ms`);
      // Sync notes to SmartMoving job notes (if enabled)
      // This includes: crew review link + vault links + all QubeSheets notes
      await runNotesSync();
      return { success: true, syncedCount, removedCount, roomId: firstRoomId || undefined, verification };
    }

    console.error(`❌ [SMARTMOVING-MIRROR] Sync did not verify for project ${projectId}: ${finalError}`);
    // Notes still sync — links in job notes shouldn't be hostage to an item mismatch
    await runNotesSync();
    return { success: false, syncedCount: totalSyncedCount, removedCount, error: finalError, verification };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown sync error';
    console.error(`❌ SmartMoving inventory sync error for project ${projectId}:`, error);
    
    // Log error but don't throw - we never want to break core functionality
    try {
      await logActivity({
        projectId,
        userId: 'system',
        activityType: 'inventory_update',
        action: 'smartmoving_inventory_sync',
        details: {
          itemsCount: inventoryItems.length
        },
        metadata: {
          success: false,
          error: errorMessage,
          duration: Date.now() - startTime
        }
      });
    } catch (logError) {
      console.error('❌ [SMARTMOVING-SYNC] Failed to log sync error:', logError);
    }
    
    return { success: false, syncedCount: 0, error: errorMessage };
  }
}

/**
 * Helper to get the base URL for crew review links
 */
function getBaseUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  }
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

/**
 * Fetches opportunity details including jobs from SmartMoving
 */
async function getOpportunityJobs(
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; jobs?: Array<{ id: string; jobNumber?: string }>; error?: string }> {
  try {
    console.log(`🔍 [SMARTMOVING-JOBS] Fetching jobs for opportunity ${opportunityId}`);

    const url = `https://api-public.smartmoving.com/v1/api/opportunities/${opportunityId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-JOBS] Failed to fetch opportunity: ${response.status} - ${errorText}`);
      return { success: false, error: `Failed to fetch opportunity: ${response.status}` };
    }

    const opportunity = await response.json();
    const jobs = opportunity.jobs || [];
    console.log(`✅ [SMARTMOVING-JOBS] Found ${jobs.length} jobs for opportunity ${opportunityId}`);

    return { success: true, jobs };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-JOBS] Error fetching opportunity:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Updates the crew notes field for a job in SmartMoving
 */
async function updateJobCrewNotes(
  opportunityId: string,
  jobId: string,
  crewNotes: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`📝 [SMARTMOVING-CREW-NOTES] Updating crew notes for job ${jobId}`);

    const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/jobs/${jobId}/notes`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify({ crewNotes })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-CREW-NOTES] Failed to update job ${jobId}: ${response.status} - ${errorText}`);
      return { success: false, error: `Failed to update crew notes: ${response.status} - ${errorText}` };
    }

    console.log(`✅ [SMARTMOVING-CREW-NOTES] Successfully updated crew notes for job ${jobId}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CREW-NOTES] Error updating job ${jobId}:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Returns the active CrewReviewLink for a project, auto-creating one if none exists.
 * Sources userId/organizationId from the Project so the auto-created link satisfies
 * the schema's required userId field (the manual /api/.../crew-review-link route gets
 * userId from the auth context, which is unavailable in the sync flow).
 */
async function getOrCreateActiveCrewReviewLink(projectId: string) {
  const existing = await CrewReviewLink.findOne({ projectId, isActive: true });
  if (existing) return existing;

  const project = await Project.findById(projectId).select('userId organizationId').lean<{ userId: string; organizationId?: string }>();
  if (!project) {
    throw new Error(`Project ${projectId} not found - cannot auto-generate crew review link`);
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

async function getProjectOwner(projectId: string) {
  const project = await Project.findById(projectId).select('userId organizationId').lean<{ userId: string; organizationId?: string }>();
  if (!project) {
    throw new Error(`Project ${projectId} not found - cannot auto-generate vault link`);
  }
  return project;
}

/**
 * Returns the active vault share link (read-only /vault-review gallery) for a project,
 * auto-creating one if none exists. Idempotent like the manual
 * /api/projects/[projectId]/vault-share-link route — one permanent link per project,
 * never rotated, with userId/organizationId sourced from the Project since the sync
 * flow has no auth context.
 */
async function getOrCreateVaultShareLink(projectId: string) {
  // mediaKind $exists:false excludes single-item share links — this must
  // return the whole-gallery link only
  const existing = await VaultShareLink.findOne({ projectId, isActive: true, mediaKind: { $exists: false } });
  if (existing) return existing;

  const project = await getProjectOwner(projectId);

  const linkData: any = {
    projectId,
    userId: project.userId,
    shareToken: crypto.randomBytes(32).toString('hex'),
    isActive: true,
  };
  if (project.organizationId) {
    linkData.organizationId = project.organizationId;
  }
  return VaultShareLink.create(linkData);
}

/**
 * Returns the active vault capture link (/customer-upload with purpose 'vault') for a
 * project, auto-creating one if none exists. Mirrors the manual
 * /api/projects/[projectId]/vault-link route, including the vaultLinkTracking stamp
 * on the Project so the UI reflects the auto-created link.
 */
async function getOrCreateVaultCaptureLink(projectId: string) {
  const existing = await CustomerUpload.findOne({ projectId, purpose: 'vault', isActive: true });
  if (existing) return existing;

  const project = await getProjectOwner(projectId);

  const uploadToken = crypto.randomBytes(32).toString('hex');
  const linkData: any = {
    projectId,
    userId: project.userId,
    // Display-only; provenance is the purpose field
    customerName: 'Media Vault',
    uploadToken,
    isActive: true,
    purpose: 'vault',
    uploadMode: 'both',
  };
  if (project.organizationId) {
    linkData.organizationId = project.organizationId;
  }
  const link = await CustomerUpload.create(linkData);

  await Project.findByIdAndUpdate(projectId, {
    $set: {
      'vaultLinkTracking.uploadToken': uploadToken,
      'vaultLinkTracking.createdAt': new Date()
    }
  });

  return link;
}

/**
 * Syncs the crew review link to SmartMoving's Job Notes "Crew Notes" field
 * This updates the crewNotes field for ALL jobs in the opportunity
 *
 * @param projectId - The QubeSheets project ID
 * @param opportunityId - The SmartMoving opportunity ID
 * @param apiKey - SmartMoving API key
 * @param clientId - SmartMoving client ID
 * @returns Result indicating success/failure and number of jobs updated
 */
export async function syncCrewReviewLinkToSmartMoving(
  projectId: string,
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; jobsUpdated?: number; error?: string }> {
  console.log(`🔗 [SMARTMOVING-CREW-LINK] Starting crew review link sync for project ${projectId}`);

  try {
    await connectMongoDB();

    // Get the active crew review link for this project, or auto-generate one
    const crewReviewLink = await getOrCreateActiveCrewReviewLink(projectId);

    // Construct the crew review URL
    const crewReviewUrl = `${getBaseUrl()}/crew-review/${crewReviewLink.reviewToken}`;
    console.log(`🔗 [SMARTMOVING-CREW-LINK] Crew review URL: ${crewReviewUrl}`);

    // Fetch jobs for the opportunity
    const jobsResult = await getOpportunityJobs(opportunityId, apiKey, clientId);
    if (!jobsResult.success || !jobsResult.jobs) {
      console.error(`❌ [SMARTMOVING-CREW-LINK] Failed to fetch jobs: ${jobsResult.error}`);
      return { success: false, error: jobsResult.error };
    }

    if (jobsResult.jobs.length === 0) {
      console.log(`⚠️ [SMARTMOVING-CREW-LINK] No jobs found for opportunity ${opportunityId} - skipping sync`);
      return { success: true, jobsUpdated: 0 };
    }

    // Update crew notes for all jobs
    const crewNotesContent = `Crew Review Link: ${crewReviewUrl}`;
    let jobsUpdated = 0;
    let lastError = '';

    for (const job of jobsResult.jobs) {
      const updateResult = await updateJobCrewNotes(
        opportunityId,
        job.id,
        crewNotesContent,
        apiKey,
        clientId
      );

      if (updateResult.success) {
        jobsUpdated++;
      } else {
        lastError = updateResult.error || 'Unknown error';
        console.error(`⚠️ [SMARTMOVING-CREW-LINK] Failed to update job ${job.id}: ${lastError}`);
      }

      // Small delay between API calls to be respectful of rate limits
      if (jobsResult.jobs.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`✅ [SMARTMOVING-CREW-LINK] Updated ${jobsUpdated}/${jobsResult.jobs.length} jobs with crew review link`);

    return {
      success: jobsUpdated > 0,
      jobsUpdated,
      error: jobsUpdated === 0 ? lastError : undefined
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CREW-LINK] Error syncing crew review link:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Builds a text block of AI walkthrough analysis for all of a project's completed
 * video/virtual-call recordings: per-recording AI summary, packing notes, and
 * customer statements (transcript highlights). Vault reference media is excluded,
 * matching the recordings surfaced in the app's Notes tab. Returns '' when the
 * project has no analyzed recordings.
 */
async function buildAiSummariesContent(projectId: string): Promise<string> {
  const recordings = await VideoRecording.find({
    projectId,
    status: 'completed',
    purpose: { $ne: 'vault' }
  }).sort({ createdAt: 1 }).lean<any[]>();

  const sections: string[] = [];

  for (const rec of recordings) {
    const segments = await CallAnalysisSegment.find({
      videoRecordingId: rec._id,
      status: 'completed'
    }).sort({ segmentIndex: 1 }).select('rawAnalysis.summary rawAnalysis.packing_notes rawAnalysis.transcript_highlights').lean<any[]>();

    // Prefer the aggregated fields stamped at consolidation; fall back to combining
    // the per-segment analysis (the live pipeline), then to legacy summary fields.
    const segmentSummaries = segments.map(seg => seg.rawAnalysis?.summary).filter(Boolean).join('\n\n');
    const segmentPackingNotes = segments.map(seg => seg.rawAnalysis?.packing_notes).filter(Boolean).join('\n\n');
    const summary = rec.segmentSummaries || segmentSummaries ||
      rec.analysisResult?.summary || rec.transcriptAnalysisResult?.summary || '';
    const packingNotes = rec.packingNotes || segmentPackingNotes;
    const highlights = segments.flatMap(seg => seg.rawAnalysis?.transcript_highlights || []);

    if (!summary && !packingNotes && highlights.length === 0) continue;

    const recordedOn = rec.createdAt
      ? new Date(rec.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const parts: string[] = [`=== AI Walkthrough Summary${recordedOn ? ` (${recordedOn})` : ''} ===`];
    if (summary) parts.push(summary);
    if (packingNotes) parts.push(`Packing Notes:\n${packingNotes}`);
    if (highlights.length > 0) {
      const statements = highlights
        .map((h: any) => {
          const meta = [h.timestamp, h.related_item ? `Re: ${h.related_item}` : ''].filter(Boolean).join(' - ');
          return `- "${h.text}"${meta ? ` (${meta})` : ''}`;
        })
        .join('\n');
      parts.push(`Customer Statements:\n${statements}`);
    }
    sections.push(parts.join('\n\n'));
  }

  return sections.join('\n\n');
}

// Mapping from QubeSheets note category to SmartMoving note type
const noteCategoryMapping: Record<string, 'internal' | 'crew' | 'customer'> = {
  'general': 'internal',
  'inventory': 'internal',
  'video-call': 'internal',
  'customer': 'customer',
  'moving-day': 'crew',
  'special-instructions': 'crew'
};

// Display names for categories when building note content
const categoryDisplayNames: Record<string, string> = {
  'general': 'General',
  'inventory': 'Inventory',
  'video-call': 'Video Call',
  'customer': 'Customer',
  'moving-day': 'Moving Day',
  'special-instructions': 'Special Instructions'
};

/**
 * Updates all job notes (internal, crew, customer) in SmartMoving
 */
async function updateJobAllNotes(
  opportunityId: string,
  jobId: string,
  notes: {
    internalNotes?: string;
    crewNotes?: string;
    customerNotes?: string;
  },
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`📝 [SMARTMOVING-NOTES] Updating all notes for job ${jobId}`);

    const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/jobs/${jobId}/notes`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(notes)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-NOTES] Failed to update job ${jobId}: ${response.status} - ${errorText}`);
      return { success: false, error: `Failed to update notes: ${response.status} - ${errorText}` };
    }

    console.log(`✅ [SMARTMOVING-NOTES] Successfully updated notes for job ${jobId}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-NOTES] Error updating job ${jobId}:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Syncs QubeSheets notes to SmartMoving job notes based on category mapping:
 * - video-call, inventory, general → Internal Notes
 * - moving-day, special-instructions → Crew Notes (also includes crew review link)
 * - customer → Customer Notes
 *
 * @param projectId - The QubeSheets project ID
 * @param opportunityId - The SmartMoving opportunity ID
 * @param apiKey - SmartMoving API key
 * @param clientId - SmartMoving client ID
 * @returns Result indicating success/failure and counts
 */
export async function syncNotesToSmartMoving(
  projectId: string,
  opportunityId: string,
  apiKey: string,
  clientId: string,
  options?: { includeVaultLinks?: boolean; includeAiSummaries?: boolean }
): Promise<{ success: boolean; jobsUpdated?: number; notesSynced?: number; error?: string }> {
  console.log(`📝 [SMARTMOVING-NOTES-SYNC] Starting notes sync for project ${projectId}`);

  try {
    await connectMongoDB();

    // Fetch all notes for the project
    const notes = await InventoryNote.find({ projectId }).sort({ createdAt: 1 });
    console.log(`📝 [SMARTMOVING-NOTES-SYNC] Found ${notes.length} notes to sync`);

    // Group notes by SmartMoving note type
    const groupedNotes: {
      internal: Array<{ category: string; title?: string; content: string }>;
      crew: Array<{ category: string; title?: string; content: string }>;
      customer: Array<{ category: string; title?: string; content: string }>;
    } = {
      internal: [],
      crew: [],
      customer: []
    };

    for (const note of notes) {
      const category = note.category || 'general';
      const smNoteType = noteCategoryMapping[category] || 'internal';
      groupedNotes[smNoteType].push({
        category,
        title: note.title,
        content: note.content
      });
    }

    console.log(`📝 [SMARTMOVING-NOTES-SYNC] Grouped notes - Internal: ${groupedNotes.internal.length}, Crew: ${groupedNotes.crew.length}, Customer: ${groupedNotes.customer.length}`);

    // Build combined content for each SmartMoving note type
    const buildNotesContent = (notesList: Array<{ category: string; title?: string; content: string }>): string => {
      if (notesList.length === 0) return '';

      // Group by category
      const byCategory: Record<string, Array<{ title?: string; content: string }>> = {};
      for (const note of notesList) {
        if (!byCategory[note.category]) {
          byCategory[note.category] = [];
        }
        byCategory[note.category].push({ title: note.title, content: note.content });
      }

      // Build content
      const sections: string[] = [];
      for (const [category, categoryNotes] of Object.entries(byCategory)) {
        const displayName = categoryDisplayNames[category] || category;
        const categoryContent = categoryNotes
          .map(n => n.title ? `${n.title}:\n${n.content}` : n.content)
          .join('\n\n');
        sections.push(`--- ${displayName} Notes ---\n${categoryContent}`);
      }

      return sections.join('\n\n');
    };

    let internalNotesContent = buildNotesContent(groupedNotes.internal);
    const customerNotesContent = buildNotesContent(groupedNotes.customer);

    // Append AI walkthrough summaries to internal notes, unless disabled in the
    // integration settings. A summary-build failure must not break the
    // notes/inventory sync — omit the section and keep going.
    if (options?.includeAiSummaries !== false) {
      try {
        const aiSummariesContent = await buildAiSummariesContent(projectId);
        if (aiSummariesContent) {
          internalNotesContent = internalNotesContent
            ? `${internalNotesContent}\n\n${aiSummariesContent}`
            : aiSummariesContent;
        }
      } catch (aiError) {
        console.error(`⚠️ [SMARTMOVING-NOTES-SYNC] Failed to build AI walkthrough summaries, omitting from internal notes:`, aiError);
      }
    }

    // For crew notes, also include the crew review link
    let crewNotesContent = buildNotesContent(groupedNotes.crew);

    // Get crew review link (auto-generated if none exists)
    const crewReviewLink = await getOrCreateActiveCrewReviewLink(projectId);

    const crewReviewUrl = `${getBaseUrl()}/crew-review/${crewReviewLink.reviewToken}`;

    const linkLines = [`Crew Review Link: ${crewReviewUrl}`];

    // Media Vault links (auto-generated if none exist), unless disabled in the
    // integration settings. A vault-link failure must not break the
    // notes/inventory sync — omit the vault lines and keep going.
    if (options?.includeVaultLinks !== false) {
      try {
        const vaultShareLink = await getOrCreateVaultShareLink(projectId);
        linkLines.push(`Media Vault (view): ${getBaseUrl()}/vault-review/${vaultShareLink.shareToken}`);
        const vaultCaptureLink = await getOrCreateVaultCaptureLink(projectId);
        linkLines.push(`Media Vault (upload): ${getBaseUrl()}/customer-upload/${vaultCaptureLink.uploadToken}`);
      } catch (vaultError) {
        console.error(`⚠️ [SMARTMOVING-NOTES-SYNC] Failed to get media vault links, omitting from crew notes:`, vaultError);
      }
    }

    // Prepend crew review + media vault links to crew notes
    const linksBlock = linkLines.join('\n');
    if (crewNotesContent) {
      crewNotesContent = `${linksBlock}\n\n${crewNotesContent}`;
    } else {
      crewNotesContent = linksBlock;
    }

    // Fetch jobs for the opportunity
    const jobsResult = await getOpportunityJobs(opportunityId, apiKey, clientId);
    if (!jobsResult.success || !jobsResult.jobs) {
      console.error(`❌ [SMARTMOVING-NOTES-SYNC] Failed to fetch jobs: ${jobsResult.error}`);
      return { success: false, error: jobsResult.error };
    }

    if (jobsResult.jobs.length === 0) {
      console.log(`⚠️ [SMARTMOVING-NOTES-SYNC] No jobs found for opportunity ${opportunityId} - skipping sync`);
      return { success: true, jobsUpdated: 0, notesSynced: notes.length };
    }

    // Update notes for all jobs
    let jobsUpdated = 0;
    let lastError = '';

    for (const job of jobsResult.jobs) {
      const updateResult = await updateJobAllNotes(
        opportunityId,
        job.id,
        {
          internalNotes: internalNotesContent || undefined,
          crewNotes: crewNotesContent || undefined,
          customerNotes: customerNotesContent || undefined
        },
        apiKey,
        clientId
      );

      if (updateResult.success) {
        jobsUpdated++;
      } else {
        lastError = updateResult.error || 'Unknown error';
        console.error(`⚠️ [SMARTMOVING-NOTES-SYNC] Failed to update job ${job.id}: ${lastError}`);
      }

      // Small delay between API calls
      if (jobsResult.jobs.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`✅ [SMARTMOVING-NOTES-SYNC] Updated ${jobsUpdated}/${jobsResult.jobs.length} jobs with notes`);

    return {
      success: jobsUpdated > 0,
      jobsUpdated,
      notesSynced: notes.length,
      error: jobsUpdated === 0 ? lastError : undefined
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-NOTES-SYNC] Error syncing notes:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Gets existing rooms from SmartMoving opportunity to extract valid room types
 * Uses the premium inventory endpoint which returns rooms with items
 */
async function getExistingRooms(
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; rooms?: any[]; error?: string }> {
  try {
    console.log(`🔍 [SMARTMOVING-EXISTING-ROOMS] Getting existing rooms for opportunity ${opportunityId}`);

    // Use the premium inventory endpoint to get rooms with items
    const inventoryUrl = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory`;
    console.log(`🔍 [SMARTMOVING-EXISTING-ROOMS] Fetching from: ${inventoryUrl}`);

    const response = await smRequest(inventoryUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`⚠️ [SMARTMOVING-EXISTING-ROOMS] Could not get inventory: ${response.status} - ${errorText}`);
      return { success: false, error: `Could not get inventory: ${response.status}` };
    }

    const inventoryData = await response.json();

    // Log the structure to understand what we're getting
    console.log(`🔍 [SMARTMOVING-EXISTING-ROOMS] Inventory response keys:`, Object.keys(inventoryData));

    // The inventory endpoint may return { rooms: [...] } or just [...]
    const rooms = inventoryData.rooms || (Array.isArray(inventoryData) ? inventoryData : []);
    console.log(`🔍 [SMARTMOVING-EXISTING-ROOMS] Found ${rooms.length} existing rooms`);

    if (rooms.length > 0) {
      console.log(`🔍 [SMARTMOVING-EXISTING-ROOMS] Room details:`, rooms.map((room: any) => ({
        id: room.id,
        name: room.name,
        roomTypeId: room.roomTypeId,
        itemsCount: room.items?.length || 0,
        inventoryItemsCount: room.inventoryItems?.length || 0
      })));
      // Log full first room structure to see all properties
      console.log(`🔍 [SMARTMOVING-EXISTING-ROOMS] First room full structure:`, JSON.stringify(rooms[0], null, 2));
    }

    return { success: true, rooms };

  } catch (error) {
    console.error(`❌ [SMARTMOVING-EXISTING-ROOMS] Error getting existing rooms:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Deletes a single inventory item from SmartMoving
 */
async function deleteInventoryItem(
  opportunityId: string,
  roomId: string,
  itemId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory/rooms/${roomId}/items/${itemId}?changeVolumeWeightCalculationMode=false&markAsNeedsReview=false`;

    console.log(`🗑️ [SMARTMOVING-DELETE] Deleting item ${itemId} from room ${roomId}`);

    const response = await smRequest(url, {
      method: 'DELETE',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ [SMARTMOVING-DELETE] Failed: ${response.status} - ${errorText}`);
      return { success: false, error: `Failed to delete item: ${response.status} - ${errorText}` };
    }

    console.log(`✅ [SMARTMOVING-DELETE] Successfully deleted item ${itemId}`);
    return { success: true };
  } catch (error) {
    console.log(`❌ [SMARTMOVING-DELETE] Exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Clears all existing inventory from a SmartMoving opportunity
 * This allows for clean resyncs without duplicates
 *
 * @param targetRoomId - If provided, only clear items from this specific room
 */
export async function clearOpportunityInventory(
  opportunityId: string,
  apiKey: string,
  clientId: string,
  targetRoomId?: string
): Promise<{ success: boolean; deletedCount: number; roomIds: string[]; error?: string }> {
  console.log(`🧹 [SMARTMOVING-CLEAR] Clearing existing inventory for opportunity ${opportunityId}${targetRoomId ? ` (target room: ${targetRoomId})` : ''}`);

  try {
    // Get existing rooms with inventory
    const roomsResult = await getExistingRooms(opportunityId, apiKey, clientId);

    console.log(`🔍 [SMARTMOVING-CLEAR] getExistingRooms result:`, JSON.stringify(roomsResult, null, 2));

    if (!roomsResult.success || !roomsResult.rooms) {
      console.log(`⚠️ [SMARTMOVING-CLEAR] Could not fetch existing rooms`);
      return { success: true, deletedCount: 0, roomIds: [] }; // Not a failure, just nothing to clear
    }

    console.log(`🔍 [SMARTMOVING-CLEAR] Found ${roomsResult.rooms.length} rooms`);

    let totalDeleted = 0;
    const roomIds: string[] = [];

    // If we have a target room ID, filter to only that room
    let roomsToProcess = targetRoomId
      ? roomsResult.rooms.filter((room: any) => room.id === targetRoomId)
      : roomsResult.rooms;

    console.log(`🔍 [SMARTMOVING-CLEAR] Target room ID: ${targetRoomId || 'none (clearing all)'}`);
    console.log(`🔍 [SMARTMOVING-CLEAR] Rooms to process: ${roomsToProcess.length}`);

    if (targetRoomId && roomsToProcess.length === 0) {
      console.log(`⚠️ [SMARTMOVING-CLEAR] Target room ${targetRoomId} not found in API response, checking all rooms...`);
      // Fall back to clearing all rooms if target room not found (it might have a different name)
      roomsToProcess = [...roomsResult.rooms];
    }

    for (const room of roomsToProcess) {
      // Track all room IDs (even empty ones) for reuse during sync
      roomIds.push(room.id);

      const items = room.items || [];

      if (items.length === 0) {
        continue;
      }

      console.log(`🗑️ [SMARTMOVING-CLEAR] Deleting ${items.length} items from room "${room.name}" (${room.id})`);

      for (const item of items) {
        const deleteResult = await deleteInventoryItem(
          opportunityId,
          room.id,
          item.id,
          apiKey,
          clientId
        );

        if (deleteResult.success) {
          totalDeleted++;
        } else {
          console.log(`⚠️ [SMARTMOVING-CLEAR] Failed to delete item ${item.id}: ${deleteResult.error}`);
        }

        // Small delay to be gentle on the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`✅ [SMARTMOVING-CLEAR] Cleared ${totalDeleted} items from opportunity, room IDs: ${roomIds.join(', ')}`);
    return { success: true, deletedCount: totalDeleted, roomIds };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CLEAR] Error clearing inventory:`, error);
    return { success: false, deletedCount: 0, roomIds: [], error: errorMessage };
  }
}

/**
 * Gets the first available room type ID from SmartMoving
 */
async function getDefaultRoomType(
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; roomTypeId?: string; error?: string }> {
  try {
    console.log(`🏠 [SMARTMOVING-ROOM-TYPES] ===== GETTING ROOM TYPES =====`);
    console.log(`🏠 [SMARTMOVING-ROOM-TYPES] Getting available room types`);
    
    // Try to get room types from the premium endpoint
    const roomTypesUrl = `https://api-public.smartmoving.com/v1/api/premium/room-types`;
    console.log(`🌐 [SMARTMOVING-ROOM-TYPES] Calling room types API: ${roomTypesUrl}`);
    console.log(`🔍 [SMARTMOVING-ROOM-TYPES] Headers:`, {
      'x-api-key': `${apiKey.substring(0, 10)}...`,
      'Ocp-Apim-Subscription-Key': `${clientId.substring(0, 10)}...`
    });
    
    const response = await fetch(roomTypesUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });
    
    console.log(`📡 [SMARTMOVING-ROOM-TYPES] API response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`⚠️ [SMARTMOVING-ROOM-TYPES] Room types endpoint not available: ${response.status}`);
      console.log(`🔍 [SMARTMOVING-ROOM-TYPES] Error response:`, errorText);
      // Use a generic GUID format as fallback - this is a common "Other" room type GUID
      const fallbackGuid = "11111111-1111-1111-1111-111111111111";
      console.log(`🔄 [SMARTMOVING-ROOM-TYPES] Using fallback GUID: ${fallbackGuid}`);
      return { success: true, roomTypeId: fallbackGuid };
    }
    
    const roomTypesResponse = await response.json();
    console.log(`🔍 [SMARTMOVING-ROOM-TYPES] Room types API response:`, roomTypesResponse);
    
    // SmartMoving API returns { pageResults: [...] } format
    const roomTypes = roomTypesResponse.pageResults || roomTypesResponse;
    console.log(`🔍 [SMARTMOVING-ROOM-TYPES] Extracted room types array:`, roomTypes);
    
    if (Array.isArray(roomTypes) && roomTypes.length > 0) {
      const defaultType = roomTypes.find(type => 
        type.name?.toLowerCase().includes('bedroom') || 
        type.name?.toLowerCase().includes('misc') ||
        type.name?.toLowerCase().includes('other')
      ) || roomTypes[0];
      
      console.log(`✅ [SMARTMOVING-ROOM-TYPES] Using room type: ${defaultType.name} (${defaultType.id})`);
      return { success: true, roomTypeId: defaultType.id };
    }
    
    // Fallback to generic room type
    console.log(`⚠️ [SMARTMOVING-ROOM-TYPES] No room types found, using fallback`);
    const fallbackGuid = "11111111-1111-1111-1111-111111111111";
    return { success: true, roomTypeId: fallbackGuid };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-ROOM-TYPES] Error getting room types:`, error);
    // Fallback to generic room type
    const fallbackGuid = "11111111-1111-1111-1111-111111111111";
    return { success: true, roomTypeId: fallbackGuid };
  }
}

/**
 * Creates a default "Qube Sheets" room in the SmartMoving opportunity
 */
async function createDefaultRoom(
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; roomId?: string; error?: string }> {
  try {
    console.log(`🏗️ [SMARTMOVING-CREATE-ROOM] Creating default room for opportunity ${opportunityId}`);
    
    // First, try to get existing rooms to see what room types are already in use
    console.log(`🔍 [SMARTMOVING-CREATE-ROOM] Checking for existing rooms to get valid room type...`);
    const existingRoomsResult = await getExistingRooms(opportunityId, apiKey, clientId);
    
    let roomTypeId;
    if (existingRoomsResult.success && existingRoomsResult.rooms && existingRoomsResult.rooms.length > 0) {
      // Use the room type of the first existing room
      roomTypeId = existingRoomsResult.rooms[0].roomTypeId;
      console.log(`✅ [SMARTMOVING-CREATE-ROOM] Using existing room type: ${roomTypeId}`);
    } else {
      // Use the "Bedroom #1" room type which we know exists in your system
      roomTypeId = "ff6564a6-38d7-4d87-8f1a-acc601150721";
      console.log(`🔄 [SMARTMOVING-CREATE-ROOM] Using known Bedroom #1 room type: ${roomTypeId}`);
    }
    
    const roomData = [{
      name: "Qube Sheets Inventory",
      roomTypeId: roomTypeId
    }];
    
    console.log(`🏗️ [SMARTMOVING-CREATE-ROOM] Creating room with data:`, roomData);
    console.log(`🔍 [SMARTMOVING-CREATE-ROOM] Using room type ID: ${roomTypeId}`);
    
    const createUrl = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/rooms`;
    console.log(`🌐 [SMARTMOVING-CREATE-ROOM] Calling room creation API: ${createUrl}`);
    console.log(`🔍 [SMARTMOVING-CREATE-ROOM] Headers:`, {
      'Content-Type': 'application/json',
      'x-api-key': `${apiKey.substring(0, 10)}...`,
      'Ocp-Apim-Subscription-Key': `${clientId.substring(0, 10)}...`
    });
    
    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(roomData)
    });
    
    console.log(`📡 [SMARTMOVING-CREATE-ROOM] API response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-CREATE-ROOM] Failed to create room: ${response.status} ${response.statusText}`);
      console.error(`🔍 [SMARTMOVING-CREATE-ROOM] Error response:`, errorText);
      console.error(`🔍 [SMARTMOVING-CREATE-ROOM] Request data was:`, JSON.stringify(roomData, null, 2));
      return { success: false, error: `Failed to create room: ${response.status} - ${errorText}` };
    }
    
    const createdRooms = await response.json();
    console.log(`✅ [SMARTMOVING-CREATE-ROOM] Created rooms:`, createdRooms);
    
    if (Array.isArray(createdRooms) && createdRooms.length > 0) {
      const newRoom = createdRooms[0];
      console.log(`✅ [SMARTMOVING-CREATE-ROOM] Successfully created room: ${newRoom.name} (${newRoom.id})`);
      return { success: true, roomId: newRoom.id };
    }
    
    return { success: false, error: 'Room creation response was empty' };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-CREATE-ROOM] Error creating room:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown room creation error' };
  }
}

/**
 * Gets or creates a room for inventory items in the SmartMoving opportunity
 */
async function getOrCreateRoom(
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; roomId?: string; error?: string }> {
  try {
    console.log(`🏠 [SMARTMOVING-ROOMS] ===== STARTING ROOM DETECTION/CREATION =====`);
    console.log(`🏠 [SMARTMOVING-ROOMS] Getting rooms for opportunity ${opportunityId}`);
    
    // First, try to get existing rooms
    const roomsUrl = `https://api-public.smartmoving.com/v1/api/opportunities/${opportunityId}?IncludeInventory=true`;
    console.log(`🌐 [SMARTMOVING-ROOMS] Calling opportunity API: ${roomsUrl}`);
    console.log(`🔍 [SMARTMOVING-ROOMS] Using headers:`, {
      'x-api-key': `${apiKey.substring(0, 10)}...`,
      'Ocp-Apim-Subscription-Key': `${clientId.substring(0, 10)}...`
    });
    
    const response = await fetch(roomsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      }
    });
    
    console.log(`📡 [SMARTMOVING-ROOMS] Opportunity API response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-ROOMS] Failed to get opportunity details: ${response.status} ${response.statusText}`);
      console.error(`🔍 [SMARTMOVING-ROOMS] Error response:`, errorText);
      return { success: false, error: `Failed to get opportunity details: ${response.status} - ${errorText}` };
    }
    
    const opportunityData = await response.json();
    console.log(`🔍 [SMARTMOVING-ROOMS] Opportunity data retrieved successfully`);
    console.log(`🔍 [SMARTMOVING-ROOMS] Opportunity data structure:`, {
      hasInventory: !!opportunityData.inventory,
      inventoryKeys: opportunityData.inventory ? Object.keys(opportunityData.inventory) : [],
      hasRooms: opportunityData.inventory?.rooms ? true : false,
      roomsCount: opportunityData.inventory?.rooms?.length || 0
    });
    
    // Check if opportunity has any inventory rooms
    if (opportunityData.inventory && opportunityData.inventory.rooms && opportunityData.inventory.rooms.length > 0) {
      const firstRoom = opportunityData.inventory.rooms[0];
      console.log(`✅ [SMARTMOVING-ROOMS] Found existing room: ${firstRoom.name} (${firstRoom.id})`);
      return { success: true, roomId: firstRoom.id };
    }
    
    // If no rooms exist, create a default "Qube Sheets" room
    console.log(`🏗️ [SMARTMOVING-ROOMS] No existing rooms found, creating default room`);
    const createResult = await createDefaultRoom(opportunityId, apiKey, clientId);
    
    if (createResult.success && createResult.roomId) {
      console.log(`✅ [SMARTMOVING-ROOMS] Successfully created and will use room: ${createResult.roomId}`);
      return createResult;
    }
    
    // If room creation failed, use hardcoded fallback as last resort
    console.log(`⚠️ [SMARTMOVING-ROOMS] Room creation failed, using hardcoded fallback room ID`);
    console.log(`🔍 [SMARTMOVING-ROOMS] Fallback room ID: ${SMARTMOVING_BEDROOM_ROOM_ID}`);
    console.log(`🔍 [SMARTMOVING-ROOMS] Create error: ${createResult.error}`);
    return { success: true, roomId: SMARTMOVING_BEDROOM_ROOM_ID };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-ROOMS] Error in getOrCreateRoom:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown room error' };
  }
}

/**
 * Creates a room with a specific room type ID and name
 */
async function createRoomWithRoomType(
  opportunityId: string,
  roomTypeId: string,
  roomName: string,  // The name for the room (e.g., "Living Room", "Kitchen")
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; roomId?: string; error?: string }> {
  try {
    console.log(`🏗️ [SMARTMOVING-SIMPLE-CREATE] Creating room "${roomName}" with type: ${roomTypeId}`);

    const roomData = [{
      name: roomName,
      roomTypeId: roomTypeId
    }];
    
    const createUrl = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/rooms`;
    console.log(`🌐 [SMARTMOVING-SIMPLE-CREATE] Creating room at: ${createUrl}`);
    
    const response = await smRequest(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(roomData)
    });

    console.log(`📡 [SMARTMOVING-SIMPLE-CREATE] Room creation response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-SIMPLE-CREATE] Room creation failed: ${response.status} - ${errorText}`);
      return { success: false, error: `Room creation failed: ${response.status} - ${errorText}` };
    }
    
    const createdRooms = await response.json();
    console.log(`✅ [SMARTMOVING-SIMPLE-CREATE] Room created successfully:`, createdRooms);
    
    if (Array.isArray(createdRooms) && createdRooms.length > 0) {
      const newRoom = createdRooms[0];
      return { success: true, roomId: newRoom.id };
    }
    
    return { success: false, error: 'Room creation response was empty' };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-SIMPLE-CREATE] Room creation error:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown room creation error' };
  }
}

/**
 * Try to sync inventory directly to opportunity without specifying a room
 */
async function syncInventoryDirectlyToOpportunity(
  opportunityId: string,
  items: SmartMovingInventoryItem[],
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; syncedCount: number; error?: string }> {
  try {
    console.log(`🔄 [SMARTMOVING-DIRECT] Attempting direct inventory sync to opportunity`);
    
    const requestBody: SmartMovingInventoryRequest = { items };
    const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory`;
    
    console.log(`🌐 [SMARTMOVING-DIRECT] Direct sync URL: ${url}`);
    console.log(`📦 [SMARTMOVING-DIRECT] Syncing ${items.length} items directly to opportunity`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(requestBody)
    });
    
    console.log(`📡 [SMARTMOVING-DIRECT] Direct sync response: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-DIRECT] Direct sync failed: ${response.status} - ${errorText}`);
      return { success: false, syncedCount: 0, error: `Direct sync failed: ${response.status} - ${errorText}` };
    }
    
    const result = await response.json();
    console.log(`✅ [SMARTMOVING-DIRECT] Direct sync successful:`, result);
    
    const syncedCount = Array.isArray(result) ? result.length : items.length;
    return { success: true, syncedCount };
    
  } catch (error) {
    console.error(`❌ [SMARTMOVING-DIRECT] Direct sync error:`, error);
    return { success: false, syncedCount: 0, error: error instanceof Error ? error.message : 'Unknown direct sync error' };
  }
}

/**
 * Makes the actual API call to SmartMoving
 */
async function syncToSmartMovingAPI(
  opportunityId: string,
  items: SmartMovingInventoryItem[],
  apiKey: string,
  clientId: string,
  roomId?: string | null
): Promise<{ success: boolean; syncedCount: number; roomId?: string; error?: string }> {
  
  console.log(`🚀 [SMARTMOVING-API] ===== STARTING SMARTMOVING API SYNC =====`);
  console.log(`📦 [SMARTMOVING-API] Syncing ${items.length} items for opportunity ${opportunityId}`);
  console.log(`🏠 [SMARTMOVING-API] Using room ID: ${roomId || 'none - will try to get rooms'}`);
  
  // If no room ID was provided, try to find existing rooms or create one
  if (!roomId) {
    console.log(`🏗️ [SMARTMOVING-API] No room ID provided, getting or creating room for inventory items`);
    
    // Try to get existing rooms first
    const existingRoomsResult = await getExistingRooms(opportunityId, apiKey, clientId);
    console.log(`🔍 [SMARTMOVING-API] Existing rooms result:`, existingRoomsResult);
    
    if (existingRoomsResult.success && existingRoomsResult.rooms && existingRoomsResult.rooms.length > 0) {
      // Use the first existing room
      roomId = existingRoomsResult.rooms[0].id;
      console.log(`✅ [SMARTMOVING-API] Using existing room: ${existingRoomsResult.rooms[0].name} (${roomId})`);
    } else {
      // If no existing rooms, get valid room types first, then create a room
      console.log(`🏗️ [SMARTMOVING-API] No existing rooms found, getting valid room types...`);
      
      const roomTypeResult = await getDefaultRoomType(apiKey, clientId);
      console.log(`🔍 [SMARTMOVING-API] Room type result:`, roomTypeResult);
      
      if (!roomTypeResult.success || !roomTypeResult.roomTypeId) {
        console.error(`❌ [SMARTMOVING-API] Could not get valid room type: ${roomTypeResult.error}`);
        return { success: false, syncedCount: 0, error: `Could not get valid room type: ${roomTypeResult.error}` };
      }
      
      console.log(`✅ [SMARTMOVING-API] Using room type from API: ${roomTypeResult.roomTypeId}`);
      const roomResult = await createRoomWithRoomType(opportunityId, roomTypeResult.roomTypeId, "API-retrieved", apiKey, clientId);
      
      if (!roomResult.success || !roomResult.roomId) {
        console.error(`❌ [SMARTMOVING-API] Failed to create room: ${roomResult.error}`);
        return { success: false, syncedCount: 0, error: roomResult.error || 'Failed to create room' };
      }
      
      roomId = roomResult.roomId;
      console.log(`✅ [SMARTMOVING-API] Created and using room ID: ${roomId}`);
    }
  }
  
  const requestBody: SmartMovingInventoryRequest = { items };
  
  // Use the correct room-based inventory endpoint from SmartMoving API docs
  const url = `https://api-public.smartmoving.com/v1/api/premium/opportunities/${opportunityId}/inventory/rooms/${roomId}`;
  console.log(`🔄 [SMARTMOVING-API] Using room-based inventory endpoint: ${url}`);
  
  console.log(`🌐 [SMARTMOVING-API] Starting API call to SmartMoving`);
  console.log(`🔍 [SMARTMOVING-API] URL: ${url}`);
  console.log(`📦 [SMARTMOVING-API] Syncing ${items.length} items to room ${roomId}`);
  console.log(`🔍 [SMARTMOVING-API] Request body:`, JSON.stringify(requestBody, null, 2));
  console.log(`🔍 [SMARTMOVING-API] Headers will include:`, {
    'Content-Type': 'application/json',
    'x-api-key': `${apiKey.substring(0, 10)}...`,
    'Ocp-Apim-Subscription-Key': `${clientId.substring(0, 10)}...`
  });
  
  try {
    console.log(`🚀 [SMARTMOVING-API] Sending POST request to SmartMoving`);
    const response = await smRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId
      },
      body: JSON.stringify(requestBody)
    });
    console.log(`📡 [SMARTMOVING-API] Received response: ${response.status} ${response.statusText}`);
    console.log(`🔍 [SMARTMOVING-API] Response headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = `SmartMoving API error: ${response.status} ${response.statusText} - ${errorText}`;
      console.error(`❌ [SMARTMOVING-API] API call failed: ${errorMessage}`);
      console.error(`🔍 [SMARTMOVING-API] Error response body:`, errorText);
      return { success: false, syncedCount: 0, error: errorMessage };
    }
    
    const responseText = await response.text();
    console.log(`📄 [SMARTMOVING-API] Raw response body:`, responseText);
    
    const result: SmartMovingInventoryResponse[] = JSON.parse(responseText);
    console.log(`✅ [SMARTMOVING-API] Parsed response:`, result);
    console.log(`✅ [SMARTMOVING-API] Successfully synced items to SmartMoving`);
    
    const syncedCount = Array.isArray(result) ? result.length : items.length;
    console.log(`🔍 [SMARTMOVING-API] Final sync count: ${syncedCount}`);
    
    return {
      success: true,
      syncedCount,
      roomId: roomId || undefined
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown API error';
    console.error(`❌ [SMARTMOVING-API] API call failed with exception:`, error);
    console.error(`🔍 [SMARTMOVING-API] Error details:`, {
      name: error instanceof Error ? error.name : 'Unknown',
      message: errorMessage,
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    return { success: false, syncedCount: 0, error: errorMessage };
  }
}

/**
 * Safely syncs inventory in the background without blocking the main operation
 * This is a fire-and-forget operation that logs results but never throws
 */
export async function syncInventoryToSmartMovingBackground(
  projectId: string,
  inventoryItems: IInventoryItem[]
): Promise<void> {
  // Use setTimeout to make this truly background/async
  setTimeout(async () => {
    try {
      await syncInventoryToSmartMoving(projectId, inventoryItems);
    } catch (error) {
      // This should never happen since syncInventoryToSmartMoving doesn't throw,
      // but we'll catch it just in case
      console.error('❌ Background SmartMoving sync failed:', error);
    }
  }, 100); // Small delay to ensure main operation completes first
}

// ============ Lead Matching and Conversion Functions ============

export interface SmartMovingLead {
  id: string;
  customerId?: string; // Some leads have a linked customer
  customerName: string;
  emailAddress?: string;
  phoneNumber?: string;
  serviceDate?: number;
  salesPersonId?: string;
  moveSizeId?: string;
  branchId?: string;
  type?: number; // JobType
  originAddressFull?: string;
  destinationAddressFull?: string;
  referralSourceName?: string;
}

// ============ Customer Matching Functions ============

export interface SmartMovingCustomerOpportunity {
  id: string;
  quoteNumber?: string;
  status?: number; // 0=NewLead, 1=LeadInProgress, 3=Opportunity, 4=Booked, 10=Completed, etc.
  jobs?: Array<{
    id: string;
    jobNumber?: string;
    serviceDate?: string;
    type?: number;
  }>;
}

export interface SmartMovingCustomer {
  id: string;
  name: string;
  phoneNumber?: string;
  emailAddress?: string;
  address?: string;
  opportunities?: SmartMovingCustomerOpportunity[];
  secondaryPhoneNumbers?: Array<{
    phoneNumber: string;
    phoneType?: number;
  }>;
}

/**
 * Fetches all customers from SmartMoving (with pagination)
 */
export async function fetchSmartMovingCustomers(
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; customers: SmartMovingCustomer[]; error?: string }> {
  const allCustomers: SmartMovingCustomer[] = [];
  let currentPage = 1;
  let isLastPage = false;
  const maxPages = 50;

  console.log(`🔄 [SMARTMOVING-CUSTOMERS] Starting to fetch customers from SmartMoving`);

  try {
    while (!isLastPage && currentPage <= maxPages) {
      const url = `https://api-public.smartmoving.com/v1/api/customers?IncludeOpportunityInfo=true&Page=${currentPage}&PageSize=1000`;

      console.log(`🔍 [SMARTMOVING-CUSTOMERS] Fetching page ${currentPage}: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Ocp-Apim-Subscription-Key': clientId,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [SMARTMOVING-CUSTOMERS] API error: ${response.status} - ${errorText}`);
        return { success: false, customers: [], error: `SmartMoving API error: ${response.status}` };
      }

      const data = await response.json();

      // Handle both array and paginated responses
      if (Array.isArray(data)) {
        allCustomers.push(...data);
        isLastPage = data.length === 0;
      } else if (data.pageResults && Array.isArray(data.pageResults)) {
        allCustomers.push(...data.pageResults);
        console.log(`✅ [SMARTMOVING-CUSTOMERS] Page ${currentPage}: ${data.pageResults.length} customers`);
        isLastPage = data.lastPage === true || data.pageResults.length === 0;
      } else if (data.items && Array.isArray(data.items)) {
        allCustomers.push(...data.items);
        isLastPage = data.items.length === 0;
      } else {
        isLastPage = true;
      }

      currentPage++;
    }

    console.log(`✅ [SMARTMOVING-CUSTOMERS] Total customers fetched: ${allCustomers.length}`);
    return { success: true, customers: allCustomers };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CUSTOMERS] Error fetching customers:`, error);
    return { success: false, customers: [], error: errorMessage };
  }
}

/**
 * Finds a customer that matches the given phone number
 */
export function findCustomerByPhone(
  customers: SmartMovingCustomer[],
  projectPhone: string
): SmartMovingCustomer | null {
  const normalizedProjectPhone = normalizePhoneNumber(projectPhone);

  if (!normalizedProjectPhone) {
    console.log(`⚠️ [SMARTMOVING-CUSTOMERS] No valid phone number to match`);
    return null;
  }

  console.log(`🔍 [SMARTMOVING-CUSTOMERS] Searching for phone: ${normalizedProjectPhone}`);

  const matchedCustomer = customers.find(customer => {
    // Check primary phone
    const normalizedPrimaryPhone = normalizePhoneNumber(customer.phoneNumber);
    if (normalizedPrimaryPhone === normalizedProjectPhone) {
      return true;
    }

    // Check secondary phones
    if (customer.secondaryPhoneNumbers) {
      return customer.secondaryPhoneNumbers.some(secondary =>
        normalizePhoneNumber(secondary.phoneNumber) === normalizedProjectPhone
      );
    }

    return false;
  });

  if (matchedCustomer) {
    console.log(`✅ [SMARTMOVING-CUSTOMERS] Found matching customer: ${matchedCustomer.id} - ${matchedCustomer.name}`);
    console.log(`📊 [SMARTMOVING-CUSTOMERS] Customer opportunities: ${matchedCustomer.opportunities?.length || 0}`);
    if (matchedCustomer.opportunities && matchedCustomer.opportunities.length > 0) {
      console.log(`📊 [SMARTMOVING-CUSTOMERS] First opportunity: ${matchedCustomer.opportunities[0].id}`);
    }
  } else {
    console.log(`⚠️ [SMARTMOVING-CUSTOMERS] No matching customer found for phone: ${normalizedProjectPhone}`);
  }

  return matchedCustomer || null;
}

export interface CreateCustomerRequest {
  name: string;
  phoneNumber?: string;
  phoneType?: number; // 0=Mobile, 1=Home, 2=Office, 3=Other
  emailAddress?: string;
  address?: string;
}

/**
 * Creates a new customer in SmartMoving from lead data
 */
export async function createCustomerFromLead(
  lead: SmartMovingLead,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  const customerData: CreateCustomerRequest = {
    name: lead.customerName,
    phoneNumber: lead.phoneNumber,
    emailAddress: lead.emailAddress,
  };

  const url = 'https://api-public.smartmoving.com/v1/api/premium/customers';

  console.log(`🔄 [SMARTMOVING-CREATE-CUSTOMER] Creating customer from lead data`);
  console.log(`📦 [SMARTMOVING-CREATE-CUSTOMER] Customer data:`, JSON.stringify(customerData, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(customerData)
    });

    const responseText = await response.text();
    console.log(`📡 [SMARTMOVING-CREATE-CUSTOMER] Response status: ${response.status}`);
    console.log(`📡 [SMARTMOVING-CREATE-CUSTOMER] Response body: ${responseText}`);

    if (response.ok && responseText) {
      const result = JSON.parse(responseText);
      // Handle both: direct string ID response OR object with id/customerId
      const customerId = typeof result === 'string' ? result : (result.id || result.customerId);

      if (customerId) {
        console.log(`✅ [SMARTMOVING-CREATE-CUSTOMER] Customer created! ID: ${customerId}`);
        return { success: true, customerId };
      }
    }

    return {
      success: false,
      error: `Failed to create customer: ${response.status} - ${responseText}`
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CREATE-CUSTOMER] Error:`, error);
    return { success: false, error: errorMessage };
  }
}

export interface ConvertLeadRequest {
  customerId: string; // Required - must create customer first
  referralSourceId: string;
  tariffId: string;
  branchId?: string;
  moveDate: string; // yyyy-MM-dd format
  moveSizeId: string;
  salesPersonId: string;
  serviceTypeId: number;
  originAddress?: {
    fullAddress?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    lat?: number;
    lng?: number;
  };
  destinationAddress?: {
    fullAddress?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    lat?: number;
    lng?: number;
  };
}

/**
 * Normalizes a phone number to just the last 10 digits
 */
export function normalizePhoneNumber(phone?: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

/**
 * Fetches all leads from SmartMoving
 */
export async function fetchSmartMovingLeads(
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; leads: SmartMovingLead[]; error?: string }> {
  const allLeads: SmartMovingLead[] = [];
  let currentPage = 1;
  let isLastPage = false;
  const maxPages = 50;

  console.log(`🔄 [SMARTMOVING-LEADS] Starting to fetch leads from SmartMoving`);

  try {
    while (!isLastPage && currentPage <= maxPages) {
      const url = `https://api-public.smartmoving.com/v1/api/leads?Page=${currentPage}&PageSize=1000`;

      console.log(`🔍 [SMARTMOVING-LEADS] Fetching page ${currentPage}: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'Ocp-Apim-Subscription-Key': clientId,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ [SMARTMOVING-LEADS] API error: ${response.status} - ${errorText}`);
        return { success: false, leads: [], error: `SmartMoving API error: ${response.status}` };
      }

      const data = await response.json();

      if (data.pageResults && Array.isArray(data.pageResults)) {
        allLeads.push(...data.pageResults);
        console.log(`✅ [SMARTMOVING-LEADS] Page ${currentPage}: ${data.pageResults.length} leads`);
      }

      isLastPage = data.lastPage === true || !data.pageResults || data.pageResults.length === 0;
      currentPage++;
    }

    console.log(`✅ [SMARTMOVING-LEADS] Total leads fetched: ${allLeads.length}`);
    return { success: true, leads: allLeads };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-LEADS] Error fetching leads:`, error);
    return { success: false, leads: [], error: errorMessage };
  }
}

/**
 * Finds a lead that matches the given phone number
 */
export function findLeadByPhone(
  leads: SmartMovingLead[],
  projectPhone: string
): SmartMovingLead | null {
  const normalizedProjectPhone = normalizePhoneNumber(projectPhone);

  if (!normalizedProjectPhone) {
    console.log(`⚠️ [SMARTMOVING-LEADS] No valid phone number to match`);
    return null;
  }

  console.log(`🔍 [SMARTMOVING-LEADS] Searching for phone: ${normalizedProjectPhone}`);

  const matchedLead = leads.find(lead => {
    const normalizedLeadPhone = normalizePhoneNumber(lead.phoneNumber);
    return normalizedLeadPhone === normalizedProjectPhone;
  });

  if (matchedLead) {
    console.log(`✅ [SMARTMOVING-LEADS] Found matching lead: ${matchedLead.id} - ${matchedLead.customerName}`);
    console.log(`📊 [SMARTMOVING-LEADS] Full lead object:`, JSON.stringify(matchedLead, null, 2));
  } else {
    console.log(`⚠️ [SMARTMOVING-LEADS] No matching lead found for phone: ${normalizedProjectPhone}`);
  }

  return matchedLead || null;
}

/**
 * Fetches a SmartMoving reference list (tariffs, referral-sources, move-sizes,
 * users). Tolerant of their inconsistent list envelopes.
 */
async function fetchReferenceList(
  path: string,
  apiKey: string,
  clientId: string
): Promise<any[]> {
  try {
    const response = await fetch(`https://api-public.smartmoving.com/v1/api/${path}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    return data?.pageResults || data?.items || data?.data || [];
  } catch {
    return [];
  }
}

const extractRefId = (obj: any): string | null =>
  obj?.id || obj?.Id || obj?.guid || null;

/**
 * When a lead conversion 400s because a saved default id no longer exists in
 * the SmartMoving account (e.g. {"tariffId":["Tariff not found."]} after the
 * account's tariffs changed), re-fetch the relevant reference lists and pick
 * fresh ids. The saved defaults pass the UUID-shape check that gates
 * auto-config, so without this the sync is permanently stuck.
 */
async function healStaleConversionRefs(
  errorBody: string,
  apiKey: string,
  clientId: string
): Promise<Partial<ConvertLeadRequest>> {
  let fields: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(errorBody);
    fields = (parsed?.errors && typeof parsed.errors === 'object' ? parsed.errors : parsed) || {};
  } catch {
    return {};
  }

  const updates: Partial<ConvertLeadRequest> = {};

  if (fields.tariffId) {
    const tariffs = await fetchReferenceList('tariffs', apiKey, clientId);
    const id = extractRefId(tariffs[0]);
    if (id) updates.tariffId = id;
  }
  if (fields.referralSourceId) {
    const sources = await fetchReferenceList('referral-sources', apiKey, clientId);
    const preferred =
      sources.find((s: any) => s?.name?.toLowerCase().includes('website')) || sources[0];
    const id = extractRefId(preferred);
    if (id) updates.referralSourceId = id;
  }
  if (fields.moveSizeId) {
    const sizes = await fetchReferenceList('move-sizes', apiKey, clientId);
    const id = extractRefId(sizes[0]);
    if (id) updates.moveSizeId = id;
  }
  if (fields.salesPersonId) {
    const users = await fetchReferenceList('users', apiKey, clientId);
    const id = extractRefId(users[0]);
    if (id) updates.salesPersonId = id;
  }

  return updates;
}

// Maps healed conversion fields to their integration-default slots.
const REF_FIELD_TO_DEFAULT: Partial<Record<keyof ConvertLeadRequest, string>> = {
  tariffId: 'defaultTariffId',
  referralSourceId: 'defaultReferralSourceId',
  moveSizeId: 'defaultMoveSizeId',
  salesPersonId: 'defaultSalesPersonId',
};

/**
 * Converts a SmartMoving lead to an opportunity.
 *
 * On a 400 caused by stale reference ids, self-heals: re-fetches the
 * reference lists, retries once with fresh ids, and (when integrationId is
 * provided) persists the corrected defaults so future syncs don't repeat the
 * dance.
 */
export async function convertLeadToOpportunity(
  leadId: string,
  conversionData: ConvertLeadRequest,
  apiKey: string,
  clientId: string,
  options?: { integrationId?: string }
): Promise<{ success: boolean; opportunityId?: string; error?: string }> {
  const url = `https://api-public.smartmoving.com/v1/api/premium/lead/${leadId}/convert`;

  console.log(`🔄 [SMARTMOVING-CONVERT] Converting lead ${leadId} to opportunity`);
  console.log(`📦 [SMARTMOVING-CONVERT] Conversion data:`, JSON.stringify(conversionData, null, 2));

  const attempt = async (data: ConvertLeadRequest) => {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    const responseText = await response.text();
    console.log(`📡 [SMARTMOVING-CONVERT] Response status: ${response.status}`);
    console.log(`📡 [SMARTMOVING-CONVERT] Response body: ${responseText}`);
    return { response, responseText };
  };

  try {
    let { response, responseText } = await attempt(conversionData);

    if (response.status === 400) {
      const updates = await healStaleConversionRefs(responseText, apiKey, clientId);
      if (Object.keys(updates).length > 0) {
        console.log(`🩹 [SMARTMOVING-CONVERT] Stale reference ids detected, retrying with fresh ids:`, updates);
        ({ response, responseText } = await attempt({ ...conversionData, ...updates }));

        if (response.ok && options?.integrationId) {
          const defaults: Record<string, string> = {};
          for (const [field, slot] of Object.entries(REF_FIELD_TO_DEFAULT)) {
            const value = updates[field as keyof ConvertLeadRequest];
            if (typeof value === 'string' && value) defaults[slot] = value;
          }
          if (Object.keys(defaults).length > 0) {
            await SmartMovingIntegration.findByIdAndUpdate(options.integrationId, {
              $set: defaults,
            }).catch((err: unknown) =>
              console.warn(`⚠️ [SMARTMOVING-CONVERT] Could not persist healed defaults:`, err)
            );
            console.log(`✅ [SMARTMOVING-CONVERT] Persisted healed defaults:`, defaults);
          }
        }
      }
    }

    if (!response.ok) {
      console.error(`❌ [SMARTMOVING-CONVERT] Failed to convert lead: ${response.status}`);
      return {
        success: false,
        error: `Failed to convert lead: ${response.status} - ${responseText}`
      };
    }

    const result = responseText ? JSON.parse(responseText) : {};
    const opportunityId = result.opportunityId;

    if (!opportunityId) {
      console.error(`❌ [SMARTMOVING-CONVERT] No opportunityId in response`);
      return { success: false, error: 'No opportunityId returned from SmartMoving' };
    }

    console.log(`✅ [SMARTMOVING-CONVERT] Lead converted successfully! OpportunityId: ${opportunityId}`);
    return { success: true, opportunityId };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CONVERT] Exception during conversion:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Creates a new opportunity directly in SmartMoving (when no lead exists)
 */
export async function createOpportunity(
  opportunityData: ConvertLeadRequest,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; opportunityId?: string; error?: string }> {
  const url = `https://api-public.smartmoving.com/v1/api/premium/opportunity`;

  console.log(`🔄 [SMARTMOVING-CREATE-OPP] Creating new opportunity`);
  console.log(`📦 [SMARTMOVING-CREATE-OPP] Opportunity data:`, JSON.stringify(opportunityData, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(opportunityData)
    });

    const responseText = await response.text();
    console.log(`📡 [SMARTMOVING-CREATE-OPP] Response status: ${response.status}`);
    console.log(`📡 [SMARTMOVING-CREATE-OPP] Response body: ${responseText}`);

    if (!response.ok) {
      console.error(`❌ [SMARTMOVING-CREATE-OPP] Failed to create opportunity: ${response.status}`);
      return {
        success: false,
        error: `Failed to create opportunity: ${response.status} - ${responseText}`
      };
    }

    const result = responseText ? JSON.parse(responseText) : {};
    const opportunityId = result.opportunityId;

    if (!opportunityId) {
      console.error(`❌ [SMARTMOVING-CREATE-OPP] No opportunityId in response`);
      return { success: false, error: 'No opportunityId returned from SmartMoving' };
    }

    console.log(`✅ [SMARTMOVING-CREATE-OPP] Opportunity created successfully! OpportunityId: ${opportunityId}`);
    return { success: true, opportunityId };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-CREATE-OPP] Exception during creation:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Searches for customers by phone number using SmartMoving's premium search endpoint
 * Much faster than fetching all customers - searches server-side
 */
export async function searchCustomersByPhone(
  phone: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; customers: SmartMovingCustomer[]; error?: string }> {
  const normalizedPhone = normalizePhoneNumber(phone);

  if (!normalizedPhone) {
    console.log(`⚠️ [SMARTMOVING-SEARCH] No valid phone number to search`);
    return { success: false, customers: [], error: 'Invalid phone number' };
  }

  // Search query must be at least 3 characters
  if (normalizedPhone.length < 3) {
    console.log(`⚠️ [SMARTMOVING-SEARCH] Phone too short for search (min 3 chars)`);
    return { success: false, customers: [], error: 'Phone number too short' };
  }

  console.log(`🔍 [SMARTMOVING-SEARCH] Searching for customers with phone: ${normalizedPhone}`);

  try {
    // Use the premium search endpoint - much faster than fetching all customers
    const url = `https://api-public.smartmoving.com/v1/api/premium/customers/search?searchQuery=${encodeURIComponent(normalizedPhone)}`;

    console.log(`🌐 [SMARTMOVING-SEARCH] Calling premium search API: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-SEARCH] API error: ${response.status} - ${errorText}`);

      // If premium endpoint fails, fall back to fetching all customers
      if (response.status === 404 || response.status === 403) {
        console.log(`🔄 [SMARTMOVING-SEARCH] Falling back to fetch-all method...`);
        return searchCustomersByPhoneFallback(normalizedPhone, apiKey, clientId);
      }

      return { success: false, customers: [], error: `SmartMoving API error: ${response.status}` };
    }

    const customers: SmartMovingCustomer[] = await response.json();

    console.log(`✅ [SMARTMOVING-SEARCH] Search returned ${customers.length} customers`);

    if (customers.length > 0) {
      console.log(`📊 [SMARTMOVING-SEARCH] Results:`, customers.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phoneNumber
      })));
    }

    // Double-check phone match (search might return partial matches)
    const exactMatches = customers.filter(customer => {
      const normalizedPrimaryPhone = normalizePhoneNumber(customer.phoneNumber);
      if (normalizedPrimaryPhone === normalizedPhone) {
        return true;
      }
      if (customer.secondaryPhoneNumbers) {
        return customer.secondaryPhoneNumbers.some(secondary =>
          normalizePhoneNumber(secondary.phoneNumber) === normalizedPhone
        );
      }
      return false;
    });

    console.log(`✅ [SMARTMOVING-SEARCH] Found ${exactMatches.length} exact phone matches`);

    return { success: true, customers: exactMatches };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-SEARCH] Error searching customers:`, error);
    return { success: false, customers: [], error: errorMessage };
  }
}

/**
 * Fallback search method - fetches all customers and filters locally
 * Used when premium search endpoint is not available
 */
async function searchCustomersByPhoneFallback(
  normalizedPhone: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; customers: SmartMovingCustomer[]; error?: string }> {
  console.log(`🔍 [SMARTMOVING-SEARCH-FALLBACK] Fetching all customers...`);

  const customersResult = await fetchSmartMovingCustomers(apiKey, clientId);

  if (!customersResult.success) {
    console.error(`❌ [SMARTMOVING-SEARCH-FALLBACK] Failed to fetch customers: ${customersResult.error}`);
    return { success: false, customers: [], error: customersResult.error };
  }

  console.log(`🔍 [SMARTMOVING-SEARCH-FALLBACK] Searching through ${customersResult.customers.length} customers`);

  const matchingCustomers = customersResult.customers.filter(customer => {
    const normalizedPrimaryPhone = normalizePhoneNumber(customer.phoneNumber);
    if (normalizedPrimaryPhone === normalizedPhone) {
      console.log(`✅ [SMARTMOVING-SEARCH-FALLBACK] Match: ${customer.name} - ${customer.phoneNumber}`);
      return true;
    }
    if (customer.secondaryPhoneNumbers) {
      return customer.secondaryPhoneNumbers.some(secondary =>
        normalizePhoneNumber(secondary.phoneNumber) === normalizedPhone
      );
    }
    return false;
  });

  console.log(`✅ [SMARTMOVING-SEARCH-FALLBACK] Found ${matchingCustomers.length} matches`);

  return { success: true, customers: matchingCustomers };
}

/**
 * Fetches opportunities for a specific customer
 */
export async function getOpportunitiesByCustomerId(
  customerId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; opportunities: SmartMovingCustomerOpportunity[]; error?: string }> {
  console.log(`🔍 [SMARTMOVING-OPPS] Fetching opportunities for customer: ${customerId}`);

  try {
    const url = `https://api-public.smartmoving.com/v1/api/customers/${customerId}/opportunities`;

    console.log(`🌐 [SMARTMOVING-OPPS] Calling opportunities API: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Ocp-Apim-Subscription-Key': clientId,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [SMARTMOVING-OPPS] API error: ${response.status} - ${errorText}`);
      return { success: false, opportunities: [], error: `SmartMoving API error: ${response.status}` };
    }

    const data = await response.json();

    // Handle various response formats
    let opportunities: SmartMovingCustomerOpportunity[] = [];
    if (Array.isArray(data)) {
      opportunities = data;
    } else if (data.pageResults && Array.isArray(data.pageResults)) {
      opportunities = data.pageResults;
    } else if (data.items && Array.isArray(data.items)) {
      opportunities = data.items;
    }

    console.log(`✅ [SMARTMOVING-OPPS] Found ${opportunities.length} opportunities for customer`);

    if (opportunities.length > 0) {
      console.log(`📊 [SMARTMOVING-OPPS] Opportunities:`, opportunities.map(o => ({
        id: o.id,
        quoteNumber: o.quoteNumber,
        status: o.status
      })));
    }

    return { success: true, opportunities };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-OPPS] Error fetching opportunities:`, error);
    return { success: false, opportunities: [], error: errorMessage };
  }
}

/**
 * Selects the most recent/relevant opportunity from a list
 * Priority: Booked (4) > Opportunity (3) > LeadInProgress (1) > NewLead (0)
 * Avoids: Completed (10), Lost, Cancelled
 */
export function getMostRecentOpportunity(
  opportunities: SmartMovingCustomerOpportunity[]
): SmartMovingCustomerOpportunity | null {
  if (!opportunities || opportunities.length === 0) {
    return null;
  }

  // Status priorities (higher = better)
  // 4 = Booked, 3 = Opportunity, 1 = LeadInProgress, 0 = NewLead
  // Avoid: 10 = Completed, and other high numbers typically mean closed/lost
  const statusPriority: Record<number, number> = {
    4: 100,  // Booked - best choice
    3: 80,   // Opportunity - good choice
    1: 60,   // LeadInProgress
    0: 40,   // NewLead
  };

  // Filter out completed/lost opportunities and sort by priority
  const validOpportunities = opportunities
    .filter(opp => {
      const status = opp.status ?? 0;
      // Exclude completed (10+) opportunities
      return status < 10;
    })
    .sort((a, b) => {
      const priorityA = statusPriority[a.status ?? 0] ?? 20;
      const priorityB = statusPriority[b.status ?? 0] ?? 20;
      return priorityB - priorityA; // Higher priority first
    });

  if (validOpportunities.length === 0) {
    // If all opportunities are completed/lost, return the first one anyway
    // (user might want to sync to a completed job)
    console.log(`⚠️ [SMARTMOVING-OPPS] All opportunities are completed/lost, using first one`);
    return opportunities[0];
  }

  const selected = validOpportunities[0];
  console.log(`✅ [SMARTMOVING-OPPS] Selected opportunity: ${selected.id} (status: ${selected.status})`);

  return selected;
}

/**
 * Helper function to convert a lead to an opportunity for inventory sync.
 * Uses integration defaults for required fields.
 */
async function convertLeadToOpportunityForSync(
  leadId: string,
  integration: any,
  project: any
): Promise<{ success: boolean; opportunityId?: string; error?: string }> {
  try {
    console.log(`🔄 [SMARTMOVING-LEAD-CONVERT] Converting lead ${leadId} for inventory sync`);

    // First, we need to get the lead details to extract customer info
    const leadDetailsUrl = `https://api-public.smartmoving.com/v1/api/leads/${leadId}`;
    const leadResponse = await fetch(leadDetailsUrl, {
      method: 'GET',
      headers: {
        'x-api-key': integration.smartMovingApiKey,
        'Ocp-Apim-Subscription-Key': integration.smartMovingClientId,
        'Content-Type': 'application/json'
      }
    });

    if (!leadResponse.ok) {
      const errorText = await leadResponse.text();
      console.error(`❌ [SMARTMOVING-LEAD-CONVERT] Failed to get lead details: ${leadResponse.status} - ${errorText}`);
      return { success: false, error: `Failed to get lead details: ${leadResponse.status}` };
    }

    const lead = await leadResponse.json();
    console.log(`✅ [SMARTMOVING-LEAD-CONVERT] Lead details retrieved:`, {
      id: lead.id,
      customerName: lead.customerName,
      customerId: lead.customerId
    });

    // Check if lead already has a customer ID, or create one
    let customerId = lead.customerId;
    if (!customerId) {
      console.log(`🔄 [SMARTMOVING-LEAD-CONVERT] Lead has no customer, creating one...`);
      const customerResult = await createCustomerFromLead(lead, integration.smartMovingApiKey, integration.smartMovingClientId);
      if (customerResult.success && customerResult.customerId) {
        customerId = customerResult.customerId;
        console.log(`✅ [SMARTMOVING-LEAD-CONVERT] Customer created: ${customerId}`);
      } else {
        console.error(`❌ [SMARTMOVING-LEAD-CONVERT] Failed to create customer: ${customerResult.error}`);
        return { success: false, error: `Failed to create customer: ${customerResult.error}` };
      }
    }

    // Build conversion request with required fields from integration defaults
    const moveDate = project.jobDate
      ? new Date(project.jobDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const conversionData: ConvertLeadRequest = {
      customerId: customerId,
      referralSourceId: integration.defaultReferralSourceId || lead.referralSourceId || '',
      tariffId: integration.defaultTariffId || '',
      moveDate: moveDate,
      moveSizeId: integration.defaultMoveSizeId || lead.moveSizeId || '',
      salesPersonId: integration.defaultSalesPersonId || lead.salesPersonId || '',
      serviceTypeId: lead.type || 1, // Default to local move (1) if not specified
      originAddress: lead.originAddressFull ? { fullAddress: lead.originAddressFull } : undefined,
      destinationAddress: lead.destinationAddressFull ? { fullAddress: lead.destinationAddressFull } : undefined
    };

    console.log(`🔄 [SMARTMOVING-LEAD-CONVERT] Converting with data:`, {
      customerId: conversionData.customerId,
      moveDate: conversionData.moveDate,
      serviceTypeId: conversionData.serviceTypeId
    });

    // Convert lead to opportunity
    const result = await convertLeadToOpportunity(
      leadId,
      conversionData,
      integration.smartMovingApiKey,
      integration.smartMovingClientId,
      integration._id ? { integrationId: integration._id.toString() } : undefined
    );

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [SMARTMOVING-LEAD-CONVERT] Exception during lead conversion:`, error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Converts opportunity status number to human-readable label
 */
export function getOpportunityStatusLabel(status: number | undefined): string {
  switch (status) {
    case 0: return 'New Lead';
    case 1: return 'Lead In Progress';
    case 3: return 'Opportunity';
    case 4: return 'Booked';
    case 10: return 'Completed';
    default: return 'Unknown';
  }
}

/**
 * Finds all leads matching a phone number (not just the first one)
 */
export function findAllLeadsByPhone(
  leads: SmartMovingLead[],
  projectPhone: string
): SmartMovingLead[] {
  const normalizedProjectPhone = normalizePhoneNumber(projectPhone);

  if (!normalizedProjectPhone) {
    console.log(`⚠️ [SMARTMOVING-LEADS] No valid phone number to match`);
    return [];
  }

  console.log(`🔍 [SMARTMOVING-LEADS] Searching for all leads with phone: ${normalizedProjectPhone}`);

  const matchedLeads = leads.filter(lead => {
    const normalizedLeadPhone = normalizePhoneNumber(lead.phoneNumber);
    return normalizedLeadPhone === normalizedProjectPhone;
  });

  console.log(`✅ [SMARTMOVING-LEADS] Found ${matchedLeads.length} matching leads`);
  return matchedLeads;
}

export default {
  syncInventoryToSmartMoving,
  syncInventoryToSmartMovingBackground,
  fetchSmartMovingLeads,
  findLeadByPhone,
  findAllLeadsByPhone,
  convertLeadToOpportunity,
  createOpportunity,
  normalizePhoneNumber,
  createCustomerFromLead,
  fetchSmartMovingCustomers,
  findCustomerByPhone,
  searchCustomersByPhone,
  getOpportunitiesByCustomerId,
  getMostRecentOpportunity,
  getOpportunityStatusLabel,
  clearOpportunityInventory
};