// lib/goingQuantity.ts - the ONE definition of "how many units of this item
// are going", shared by every CRM sync and going-dependent query.
//
// InventoryItem carries both `goingQuantity` (number) and `going` (string
// enum). The UI renders from goingQuantity ("going (2/2)"), so goingQuantity
// is the source of truth whenever it's a number; the going string is only the
// legacy fallback for docs that predate goingQuantity. The two CAN contradict
// (a since-fixed PATCH bug skipped reconciliation on some payload shapes —
// e.g. going:'not going' left behind with goingQuantity:2), and syncs that
// filtered on the string silently dropped items the sheet showed as going —
// the "Qube Sheets and SmartMoving don't match" reports.
//
// Also fixes the widespread `goingQuantity || quantity` fallthrough: a
// partial item with goingQuantity 0 must count as 0, not its full quantity.

export interface GoingFields {
  going?: string | null;
  goingQuantity?: number | null;
  quantity?: number | null;
}

/** Units of this item that are going, exactly as the sheet displays it. */
export function effectiveGoingQuantity(item: GoingFields): number {
  if (typeof item.goingQuantity === 'number' && isFinite(item.goingQuantity)) {
    const quantity =
      typeof item.quantity === 'number' && isFinite(item.quantity)
        ? item.quantity
        : item.goingQuantity;
    return Math.max(0, Math.min(quantity, item.goingQuantity));
  }
  // Legacy docs without goingQuantity: the going string decides. The
  // 'partial' fallback mirrors lib/inventory-stats.ts and
  // lib/inventory/aggregates.ts (what the sheet and review pages render).
  const quantity = item.quantity ?? 1;
  if (item.going === 'not going') return 0;
  if (item.going === 'partial') return Math.floor(Math.max(1, quantity) / 2);
  return quantity;
}

/** True when at least one unit of the item is going. */
export function isItemGoing(item: GoingFields): boolean {
  return effectiveGoingQuantity(item) > 0;
}

/**
 * Mongo filter matching the same semantics as isItemGoing, for count/preview
 * queries. Spread into an existing filter object:
 *   { projectId, ...GOING_ITEMS_QUERY }
 */
export const GOING_ITEMS_QUERY: Record<string, unknown> = {
  $or: [
    { goingQuantity: { $gt: 0 } },
    // No usable goingQuantity → fall back to the going string
    {
      $and: [
        { $or: [{ goingQuantity: { $exists: false } }, { goingQuantity: null }] },
        { going: { $ne: 'not going' } },
      ],
    },
  ],
};
