// lib/inventory-stats.ts
//
// Single source of truth for inventory TOPLINE stats on server-rendered
// surfaces (crew review link, customer/inventory review link, PDFs, CRM
// summaries). Mirrors the project page's reducers in
// components/InventoryManager.jsx (totalItems / totalBoxes /
// totalCubicFeet / totalWeight) EXACTLY, so a customer or crew member
// looking at a share link sees the same numbers as the agent looking at
// the project page:
//
//  - Going quantity trusts `goingQuantity` FIRST (clamped to [0, qty]),
//    falling back to the `going` string only when goingQuantity is null —
//    same as convertItemsToRows → the stats reducers. (The routes used to
//    trust the `going` string first, which diverged whenever the two
//    fields were out of sync, e.g. goingQuantity=3 with a stale
//    going='going'.)
//  - Box classification uses itemType AND the legacy name fallback
//    (name contains "box"), same as the project page. itemType-only
//    checks counted legacy box items as regular items.
//  - Volume and weight INCLUDE recommended boxes (boxes_needed), matching
//    the project page's headline Volume/Weight cards. *WithoutRecommended
//    variants are returned for subtext use.
//  - totalBoxes counts recommended boxes at FULL quantity and existing
//    boxes at going quantity — identical to the project page's
//    "Total w/ rec" figure. totalBoxesWithoutRecommended matches the
//    headline Boxes card.
//  - Weight follows the resolved weight config (custom mode: per-unit
//    cuft × multiplier; actual mode: the item's AI weight) via
//    resolveItemWeight — same as the sheet's col5.
//
// item.cuft and item.weight are PER-UNIT values (see
// InventoryManager#convertItemsToRows and the analyzer prompts); totals
// are always per-unit × going quantity.

import { WeightConfig, resolveItemWeight } from '@/lib/weight-config';

export interface InventoryStatsItem {
  name?: string | null;
  quantity?: number | null;
  goingQuantity?: number | null;
  going?: string | null;
  cuft?: number | null;
  weight?: number | null;
  itemType?: string | null;
  location?: string | null;
}

export interface InventoryStats {
  totalItems: number;
  // Includes recommended boxes at full quantity (project page "Total w/ rec").
  totalBoxes: number;
  totalBoxesWithoutRecommended: number;
  // Include recommended boxes (project page headline Volume/Weight cards).
  totalCuft: number;
  totalWeight: number;
  totalCuftWithoutRecommended: number;
  totalWeightWithoutRecommended: number;
  totalRooms: number;
  totalBedrooms: number;
}

// Clamped going quantity, goingQuantity-first — mirrors
// InventoryManager#convertItemsToRows (col6) and RoomItemsTable.
export function deriveGoingQuantity(item: InventoryStatsItem): number {
  const quantity = Math.max(1, item.quantity || 1);
  let goingQty = item.goingQuantity;
  if (goingQty === undefined || goingQty === null) {
    if (item.going === 'not going') goingQty = 0;
    else if (item.going === 'partial') goingQty = Math.floor(quantity / 2);
    else goingQty = quantity;
  }
  return Math.max(0, Math.min(quantity, goingQty));
}

// Box classification — itemType first, legacy name fallback second.
// Mirrors the project page's totalItems/totalBoxes reducers.
export function isBoxItem(item: InventoryStatsItem): boolean {
  return (
    item.itemType === 'existing_box' ||
    item.itemType === 'boxes_needed' ||
    (item.name || '').toLowerCase().includes('box')
  );
}

export function computeInventoryStats(
  items: InventoryStatsItem[],
  weightConfig: WeightConfig
): InventoryStats {
  let totalItems = 0;
  let totalBoxes = 0;
  let totalBoxesWithoutRecommended = 0;
  let totalCuft = 0;
  let totalWeight = 0;
  let totalCuftWithoutRecommended = 0;
  let totalWeightWithoutRecommended = 0;
  const rooms = new Set<string>();
  const bedrooms = new Set<string>();

  for (const item of items) {
    const quantity = Math.max(1, item.quantity || 1);
    const goingQty = deriveGoingQuantity(item);
    const perUnitCuft = item.cuft || 0;
    const perUnitWeight = resolveItemWeight(item, weightConfig);
    const isRecommended = item.itemType === 'boxes_needed';

    // Rooms (excluding empty / Unassigned) — matches the existing link routes.
    const location = item.location || '';
    if (location && location !== 'Unassigned') {
      rooms.add(location);
      const lower = location.toLowerCase();
      if (lower.includes('bedroom') || lower.includes('bed room')) {
        bedrooms.add(location);
      }
    }

    // Items vs boxes.
    if (isBoxItem(item)) {
      // Recommended boxes count at full quantity; existing boxes at going.
      totalBoxes += isRecommended ? quantity : goingQty;
      if (!isRecommended) totalBoxesWithoutRecommended += goingQty;
    } else {
      totalItems += goingQty;
    }

    // Volume / weight: every row contributes per-unit × going quantity
    // (the project page reducers apply the going ratio to display totals,
    // which is algebraically the same).
    const rowCuft = perUnitCuft * goingQty;
    const rowWeight = perUnitWeight * goingQty;
    totalCuft += rowCuft;
    totalWeight += rowWeight;
    if (!isRecommended) {
      totalCuftWithoutRecommended += rowCuft;
      totalWeightWithoutRecommended += rowWeight;
    }
  }

  return {
    totalItems: Math.round(totalItems),
    totalBoxes: Math.round(totalBoxes),
    totalBoxesWithoutRecommended: Math.round(totalBoxesWithoutRecommended),
    totalCuft: Math.round(totalCuft),
    totalWeight: Math.round(totalWeight),
    totalCuftWithoutRecommended: Math.round(totalCuftWithoutRecommended),
    totalWeightWithoutRecommended: Math.round(totalWeightWithoutRecommended),
    totalRooms: rooms.size,
    totalBedrooms: bedrooms.size,
  };
}
