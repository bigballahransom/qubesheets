// lib/smartmoving/diffSync.ts
//
// Diff-based inventory sync: converge a SmartMoving estimate to exactly
// mirror the desired QubeSheets inventory with the minimum number of API
// calls. Replaces wipe-and-replace (which burned ~1 call per existing item
// and tripped SmartMoving's 120 req/min throttle + monthly quota).
//
// Per sync: 1 GET of the live estimate, then only the deltas — batch POST
// for new items (max 100/batch, SmartMoving's documented limit), PUT for
// changed items, DELETE for removed ones. Item identity is tracked in
// SmartMovingSyncMap (QBS item _id → SM item id); estimates synced before
// the map existed are adopted by field-matching against the live estimate,
// so no migration or first-run wipe is needed.
import connectMongoDB from '@/lib/mongodb';
import SmartMovingSyncMap from '@/models/SmartMovingSyncMap';
import { smFetch } from '@/lib/smartmoving/smFetch';

const BASE_URL = 'https://api-public.smartmoving.com/v1/api';
const CREATE_BATCH_SIZE = 100;
const FALLBACK_ROOM_TYPE_ID = '11111111-1111-1111-1111-111111111111';

export interface DesiredItemPayload {
  name: string;
  description: string;
  notes: string;
  volume: number;
  weight: number;
  quantity: number;
  quantityNotGoing: number;
  saveToMaster: boolean;
}

export interface DesiredItem {
  qbsId: string;
  roomName: string;
  payload: DesiredItemPayload;
}

export interface DiffSyncResult {
  success: boolean;
  /** Desired items now present on SmartMoving (kept + adopted + updated + created) */
  syncedCount: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedCount: number;
  adoptedCount: number;
  /** Desired items that could not be brought over */
  failedCount: number;
  /** First room id touched (legacy return-shape compatibility) */
  firstRoomId?: string;
  error?: string;
}

interface SmRoom {
  id: string;
  name: string;
  items: SmItem[];
}

interface SmItem {
  id: string;
  name: string;
  description?: string;
  notes?: string;
  quantity: number;
  volume: number;
  weight: number;
}

function authHeaders(apiKey: string, clientId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'Ocp-Apim-Subscription-Key': clientId,
  };
}

/**
 * Field-level equality between what we want and what SmartMoving has.
 * `description` is deliberately NOT compared: SmartMoving's item PUT drops it
 * (verified live 2026-08-31 — the value never persists), so comparing it
 * would trigger a redundant PUT on every sync for any described item.
 */
function itemMatches(payload: DesiredItemPayload, sm: SmItem): boolean {
  return (
    payload.name === sm.name &&
    payload.quantity === (sm.quantity ?? 1) &&
    Math.abs(payload.volume - (sm.volume ?? 0)) < 0.005 &&
    Math.abs(payload.weight - (sm.weight ?? 0)) < 0.005 &&
    (payload.notes || '') === (sm.notes || '')
  );
}

async function fetchLiveInventory(
  opportunityId: string,
  apiKey: string,
  clientId: string
): Promise<{ success: boolean; rooms: SmRoom[]; error?: string }> {
  const response = await smFetch(
    `${BASE_URL}/premium/opportunities/${opportunityId}/inventory`,
    { headers: authHeaders(apiKey, clientId) }
  );
  if (!response.ok) {
    // A brand-new estimate can 404 here; treat as empty rather than failing.
    if (response.status === 404) return { success: true, rooms: [] };
    const text = await response.text().catch(() => '');
    return { success: false, rooms: [], error: `Could not read SmartMoving inventory: ${response.status} ${text.slice(0, 200)}` };
  }
  const data = await response.json().catch(() => null);
  const rooms = data?.rooms || (Array.isArray(data) ? data : []);
  return {
    success: true,
    rooms: rooms.map((r: any) => ({ id: r.id, name: r.name, items: r.items || [] })),
  };
}

async function getDefaultRoomTypeId(apiKey: string, clientId: string): Promise<string> {
  try {
    const response = await smFetch(`${BASE_URL}/premium/room-types`, {
      headers: authHeaders(apiKey, clientId),
    });
    if (!response.ok) return FALLBACK_ROOM_TYPE_ID;
    const data = await response.json();
    const types = data.pageResults || data;
    if (Array.isArray(types) && types.length > 0) {
      const preferred = types.find(
        (t: any) => t.name?.toLowerCase().includes('bedroom') || t.name?.toLowerCase().includes('misc')
      );
      return (preferred || types[0]).id || FALLBACK_ROOM_TYPE_ID;
    }
  } catch {
    // fall through to fallback
  }
  return FALLBACK_ROOM_TYPE_ID;
}

/** Create all missing rooms in a single bulk POST (verified supported). */
async function ensureRooms(
  opportunityId: string,
  apiKey: string,
  clientId: string,
  existingRooms: SmRoom[],
  neededRoomNames: string[]
): Promise<{ roomIdByName: Map<string, string>; error?: string }> {
  const roomIdByName = new Map<string, string>();
  for (const room of existingRooms) roomIdByName.set(room.name, room.id);

  const missing = neededRoomNames.filter(name => !roomIdByName.has(name));
  if (missing.length === 0) return { roomIdByName };

  const roomTypeId = await getDefaultRoomTypeId(apiKey, clientId);
  const response = await smFetch(`${BASE_URL}/premium/opportunities/${opportunityId}/rooms`, {
    method: 'POST',
    headers: authHeaders(apiKey, clientId),
    body: JSON.stringify(missing.map(name => ({ name, roomTypeId }))),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { roomIdByName, error: `Room creation failed: ${response.status} ${text.slice(0, 200)}` };
  }
  const created = await response.json().catch(() => []);
  if (Array.isArray(created)) {
    for (const room of created) {
      if (room?.name && room?.id) roomIdByName.set(room.name, room.id);
    }
  }
  // Any still-missing name means SmartMoving returned an unexpected shape
  const stillMissing = missing.filter(name => !roomIdByName.has(name));
  if (stillMissing.length > 0) {
    return { roomIdByName, error: `Rooms not returned by SmartMoving: ${stillMissing.join(', ')}` };
  }
  return { roomIdByName };
}

/**
 * Converge the SmartMoving estimate to exactly the `desired` inventory.
 * Mirror semantics: desired items are created/updated, everything else on the
 * estimate is deleted (same end state as the old wipe-and-replace, at a
 * fraction of the API calls).
 */
export async function diffSyncInventory(
  projectId: string,
  opportunityId: string,
  apiKey: string,
  clientId: string,
  desired: DesiredItem[]
): Promise<DiffSyncResult> {
  const result: DiffSyncResult = {
    success: false,
    syncedCount: 0,
    createdCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    unchangedCount: 0,
    adoptedCount: 0,
    failedCount: 0,
  };

  await connectMongoDB();

  // 1. Live SmartMoving state (1 call)
  const live = await fetchLiveInventory(opportunityId, apiKey, clientId);
  if (!live.success) {
    result.error = live.error;
    result.failedCount = desired.length;
    return result;
  }

  // 2. Stored id mapping (adopted/created entries get written back at the end)
  const mapDoc = await SmartMovingSyncMap.findOne({ projectId });
  const oldMap: Record<string, string> = mapDoc?.itemMap || {};
  const newMap: Record<string, string> = {};

  // 3. Index live state
  const smById = new Map<string, { item: SmItem; room: SmRoom }>();
  for (const room of live.rooms) {
    for (const item of room.items) {
      smById.set(item.id, { item, room });
    }
  }
  const claimed = new Set<string>(); // SM item ids accounted for by desired items

  // 4. Plan operations
  const toCreate: DesiredItem[] = [];
  const toUpdate: Array<{ desired: DesiredItem; smId: string; roomId: string }> = [];

  for (const want of desired) {
    const mappedId = oldMap[want.qbsId];
    const mapped = mappedId ? smById.get(mappedId) : undefined;

    if (mapped && !claimed.has(mapped.item.id) && mapped.room.name === want.roomName) {
      claimed.add(mapped.item.id);
      newMap[want.qbsId] = mapped.item.id;
      if (itemMatches(want.payload, mapped.item)) {
        result.unchangedCount++;
      } else {
        toUpdate.push({ desired: want, smId: mapped.item.id, roomId: mapped.room.id });
      }
      continue;
    }

    // No usable mapping (never synced, mapping stale, or item moved rooms).
    // Adopt an identical unclaimed SM item in the right room if one exists —
    // this is what makes pre-existing estimates converge without a wipe.
    let adopted = false;
    for (const room of live.rooms) {
      if (room.name !== want.roomName) continue;
      for (const item of room.items) {
        if (claimed.has(item.id)) continue;
        if (itemMatches(want.payload, item)) {
          claimed.add(item.id);
          newMap[want.qbsId] = item.id;
          result.adoptedCount++;
          adopted = true;
          break;
        }
      }
      if (adopted) break;
    }
    if (!adopted) toCreate.push(want);
  }

  // Everything on the estimate not claimed by a desired item gets removed
  // (deleted QBS items, room moves, manual SM edits, stale duplicates).
  const toDelete: Array<{ smId: string; roomId: string }> = [];
  for (const [smId, { room }] of smById) {
    if (!claimed.has(smId)) toDelete.push({ smId, roomId: room.id });
  }

  console.log(
    `🔀 [SMARTMOVING-DIFF] Plan for opportunity ${opportunityId}: ` +
    `${result.unchangedCount} unchanged, ${result.adoptedCount} adopted, ` +
    `${toUpdate.length} updates, ${toCreate.length} creates, ${toDelete.length} deletes`
  );

  const headers = authHeaders(apiKey, clientId);
  let lastError = '';

  // 5. Deletes first — frees identical-looking rows before creates land,
  // and matches the old clear-then-add ordering.
  for (const del of toDelete) {
    const response = await smFetch(
      `${BASE_URL}/premium/opportunities/${opportunityId}/inventory/rooms/${del.roomId}/items/${del.smId}?changeVolumeWeightCalculationMode=false&markAsNeedsReview=false`,
      { method: 'DELETE', headers }
    );
    if (response.ok || response.status === 404) {
      result.deletedCount++;
    } else {
      lastError = `Delete failed: ${response.status}`;
      // Not counted against failedCount (desired items are unaffected), but
      // surfaced via error so the sync is not reported as fully clean.
    }
    await response.text().catch(() => undefined);
  }
  const deleteFailures = toDelete.length - result.deletedCount;

  // 6. Updates
  for (const upd of toUpdate) {
    const response = await smFetch(
      `${BASE_URL}/premium/opportunities/${opportunityId}/inventory/rooms/${upd.roomId}/items/${upd.smId}`,
      { method: 'PUT', headers, body: JSON.stringify(upd.desired.payload) }
    );
    if (response.ok) {
      result.updatedCount++;
    } else {
      result.failedCount++;
      lastError = `Update failed: ${response.status}`;
      delete newMap[upd.desired.qbsId]; // mapping unverified; re-resolve next sync
    }
    await response.text().catch(() => undefined);
  }

  // 7. Creates — ensure rooms exist (1 bulk call), then batch POST per room
  if (toCreate.length > 0) {
    const neededRooms = [...new Set(toCreate.map(item => item.roomName))];
    const { roomIdByName, error: roomError } = await ensureRooms(
      opportunityId, apiKey, clientId, live.rooms, neededRooms
    );
    if (roomError) lastError = roomError;

    const byRoom = new Map<string, DesiredItem[]>();
    for (const item of toCreate) {
      if (!byRoom.has(item.roomName)) byRoom.set(item.roomName, []);
      byRoom.get(item.roomName)!.push(item);
    }

    for (const [roomName, items] of byRoom) {
      const roomId = roomIdByName.get(roomName);
      if (!roomId) {
        result.failedCount += items.length;
        continue;
      }
      if (!result.firstRoomId) result.firstRoomId = roomId;

      for (let i = 0; i < items.length; i += CREATE_BATCH_SIZE) {
        const batch = items.slice(i, i + CREATE_BATCH_SIZE);
        const response = await smFetch(
          `${BASE_URL}/premium/opportunities/${opportunityId}/inventory/rooms/${roomId}`,
          { method: 'POST', headers, body: JSON.stringify({ items: batch.map(b => b.payload) }) }
        );
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          result.failedCount += batch.length;
          lastError = `Create batch failed: ${response.status} ${text.slice(0, 200)}`;
          continue;
        }
        const created = await response.json().catch(() => null);
        result.createdCount += batch.length;
        // Response returns created items in request order (verified live);
        // capture ids so the next sync can PUT instead of delete+create.
        if (Array.isArray(created) && created.length === batch.length) {
          for (let j = 0; j < batch.length; j++) {
            if (created[j]?.id && created[j]?.name === batch[j].payload.name) {
              newMap[batch[j].qbsId] = created[j].id;
            }
          }
        }
      }
    }
  }

  if (!result.firstRoomId && live.rooms.length > 0) {
    result.firstRoomId = live.rooms[0].id;
  }

  // 8. Persist the mapping
  try {
    await SmartMovingSyncMap.findOneAndUpdate(
      { projectId },
      { $set: { itemMap: newMap } },
      { upsert: true }
    );
  } catch (mapError) {
    // Non-fatal: next sync rebuilds via adoption
    console.error(`⚠️ [SMARTMOVING-DIFF] Failed to persist sync map:`, mapError);
  }

  result.syncedCount = desired.length - result.failedCount;
  result.success = result.failedCount === 0 && deleteFailures === 0;
  if (!result.success && lastError) result.error = lastError;

  console.log(
    `${result.success ? '✅' : '⚠️'} [SMARTMOVING-DIFF] Done: ${result.syncedCount}/${desired.length} in sync ` +
    `(${result.createdCount} created, ${result.updatedCount} updated, ${result.deletedCount} deleted, ` +
    `${result.adoptedCount} adopted, ${result.unchangedCount} unchanged, ${result.failedCount} failed` +
    `${deleteFailures ? `, ${deleteFailures} delete failures` : ''})`
  );

  return result;
}
