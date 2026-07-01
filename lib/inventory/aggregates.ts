/**
 * Single source for inventory totals shown anywhere in the app.
 *
 * Every component that displays a count, cuft, weight, or "going" total must
 * import from here — no inline `.reduce`/`.filter` over inventory items in
 * UI code. If two surfaces disagree, the bug is in this file and a single
 * fix corrects everything.
 *
 * The shapes accept a loose `InventoryItemLike` so both the Mongoose-hydrated
 * doc and the plain-JSON client copy work without ceremony.
 */
export interface InventoryItemLike {
  _id?: string;
  quantity?: number;
  goingQuantity?: number | null;
  going?: 'going' | 'not going' | 'partial' | string;
  cuft?: number;
  weight?: number;
  location?: string;
  itemType?: string;
  packed_by?: string;
  tags?: string[];
}

export interface RoomTotals {
  room: string;
  itemRows: number;        // distinct line items
  totalUnits: number;      // sum of quantity (the historical "(N)" badge)
  goingUnits: number;      // sum of goingQuantity (or derived) for the room
  cuft: number;            // total cuft attributable to going units
  weight: number;          // total weight attributable to going units
}

export interface ProjectTotals {
  itemRows: number;
  totalUnits: number;      // sum of quantity
  goingUnits: number;      // sum of goingQuantity
  cuft: number;
  weight: number;
}

/**
 * How many of this row's units are "going". Falls back to the legacy `going`
 * enum when `goingQuantity` isn't set on older items.
 */
export function getGoingQuantity(item: InventoryItemLike): number {
  const q = Math.max(1, item.quantity ?? 1);
  const gq = item.goingQuantity;
  if (gq != null) return clamp(gq, 0, q);
  if (item.going === 'not going') return 0;
  if (item.going === 'partial') return Math.floor(q / 2);
  return q; // default "going"
}

/** Convenience: does ANY unit of the row count as going? */
export function isAnyGoing(item: InventoryItemLike): boolean {
  return getGoingQuantity(item) > 0;
}

/**
 * Cuft attributable to this row, scaled by the going fraction. A row at
 * `cuft=30 quantity=3 goingQuantity=2` contributes `20`.
 */
export function getRowCuft(item: InventoryItemLike): number {
  const q = Math.max(1, item.quantity ?? 1);
  const gq = getGoingQuantity(item);
  const total = Number(item.cuft) || 0;
  if (q === 0 || gq === 0) return 0;
  return (total / q) * gq;
}

/** Same scaling rule for weight. */
export function getRowWeight(item: InventoryItemLike): number {
  const q = Math.max(1, item.quantity ?? 1);
  const gq = getGoingQuantity(item);
  const total = Number(item.weight) || 0;
  if (q === 0 || gq === 0) return 0;
  return (total / q) * gq;
}

export function getProjectTotals(items: readonly InventoryItemLike[] | null | undefined): ProjectTotals {
  const totals: ProjectTotals = { itemRows: 0, totalUnits: 0, goingUnits: 0, cuft: 0, weight: 0 };
  if (!items?.length) return totals;
  for (const item of items) {
    totals.itemRows += 1;
    totals.totalUnits += Math.max(1, item.quantity ?? 1);
    totals.goingUnits += getGoingQuantity(item);
    totals.cuft += getRowCuft(item);
    totals.weight += getRowWeight(item);
  }
  return totals;
}

export function getRoomTotals(
  items: readonly InventoryItemLike[] | null | undefined,
  room: string,
): RoomTotals {
  const totals: RoomTotals = { room, itemRows: 0, totalUnits: 0, goingUnits: 0, cuft: 0, weight: 0 };
  if (!items?.length) return totals;
  for (const item of items) {
    if ((item.location || 'No Room') !== room) continue;
    totals.itemRows += 1;
    totals.totalUnits += Math.max(1, item.quantity ?? 1);
    totals.goingUnits += getGoingQuantity(item);
    totals.cuft += getRowCuft(item);
    totals.weight += getRowWeight(item);
  }
  return totals;
}

/**
 * Group items by their `location` (or 'No Room' for empty). Returns a stable
 * Map so callers can iterate in insertion order; useful for rendering rooms in
 * the order they first appear in the items array.
 */
export function groupItemsByRoom(
  items: readonly InventoryItemLike[] | null | undefined,
): Map<string, InventoryItemLike[]> {
  const map = new Map<string, InventoryItemLike[]>();
  if (!items?.length) return map;
  for (const item of items) {
    const room = item.location || 'No Room';
    const bucket = map.get(room);
    if (bucket) bucket.push(item);
    else map.set(room, [item]);
  }
  return map;
}

/**
 * Per-room totals across the whole item set, returned in the order rooms
 * first appear. Useful for sticky per-room totals rows in the spreadsheet.
 */
export function getAllRoomTotals(
  items: readonly InventoryItemLike[] | null | undefined,
): RoomTotals[] {
  const grouped = groupItemsByRoom(items);
  const out: RoomTotals[] = [];
  for (const [room, roomItems] of grouped) {
    out.push(getRoomTotals(roomItems, room));
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
