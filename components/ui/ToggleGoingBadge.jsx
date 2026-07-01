'use client';

import { useState } from 'react';
import { Badge } from './badge';
import { useInventoryItemWriter } from '@/lib/inventory/useInventoryItemWriter';
import { useInventoryWrites } from '@/lib/inventory/InventoryWritesContext';

/**
 * Going-status badge for one quantity unit of an inventory item.
 *
 * Pre-writer migration this component read `inventoryItem.quantity` from
 * props and PATCHed directly — a stale-prop read at the moment of click
 * was the primary cause of the production "count reverts on going toggle"
 * bug (a recent count edit hadn't propagated back into props yet).
 *
 * Now the component opens a writer keyed by the item. The writer:
 *   - exposes optimistic state via `writer.state` (always fresh), so the
 *     quantity used to compute the new goingQuantity reflects the user's
 *     most recent count edit even if the parent hasn't refetched.
 *   - serializes the PATCH through a single-flight queue, so a still-in-
 *     flight count PATCH and this going PATCH can't arrive out of order.
 *   - participates in the parent's dirty-aware refetch merge, so a
 *     refetch can't blow away the edit mid-flight.
 */
export function ToggleGoingBadge({
  inventoryItem,
  quantityIndex = 0,
  projectId,
  onInventoryUpdate,
  className = '',
  showItemName = true,
}) {
  const { markDirty, markClean, mergeUpdatedItem } = useInventoryWrites();
  const writer = useInventoryItemWriter({
    item: inventoryItem,
    projectId,
    onCommitted: (updated) => {
      // mergeUpdatedItem propagates the server's authoritative item into the
      // parent's inventoryItems array, which triggers the spreadsheet's
      // row-regen useEffect (InventoryManager.jsx:1690). We intentionally do
      // NOT invoke onInventoryUpdate here — that callback was the legacy
      // pre-writer path and its handler issued a second PATCH that races with
      // the writer's own PATCH (visible as the "Failed to persist inventory
      // update for item ..." console errors).
      if (mergeUpdatedItem) mergeUpdatedItem(updated);
    },
    markDirty,
    markClean,
  });

  const [isUpdating, setIsUpdating] = useState(false);

  const item = writer.state;
  const quantity = Math.max(1, item.quantity || 1);

  // Derive goingQuantity from the writer's optimistic state, which already
  // reflects any in-flight count edits.
  let goingQuantity = item.goingQuantity;
  if (goingQuantity === undefined || goingQuantity === null) {
    if (item.going === 'not going') goingQuantity = 0;
    else if (item.going === 'partial') goingQuantity = Math.floor(quantity / 2);
    else goingQuantity = quantity;
  }
  goingQuantity = Math.max(0, Math.min(quantity, goingQuantity));
  const isThisInstanceGoing = quantityIndex < goingQuantity;

  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUpdating) return;

    setIsUpdating(true);
    try {
      // Compute the new goingQuantity from the WRITER's quantity, not from
      // the prop. This is the production-bug fix: reading from writer.state
      // means the quantity reflects the user's most recent count edit even
      // if the parent's refetch hasn't propagated back into props.
      writer.set((prev) => {
        const q = Math.max(1, prev.quantity || 1);
        const currentGq = (prev.goingQuantity != null)
          ? Math.max(0, Math.min(q, prev.goingQuantity))
          : (prev.going === 'not going' ? 0
              : prev.going === 'partial' ? Math.floor(q / 2)
              : q);
        const isInstanceGoing = quantityIndex < currentGq;
        const nextGq = isInstanceGoing
          ? Math.max(0, currentGq - 1)
          : Math.min(q, currentGq + 1);
        if (nextGq === currentGq) return null;
        return { goingQuantity: nextGq };
      }, { immediate: true });
    } finally {
      // Clear the local spinner on the next paint — the writer's queue
      // will finish in the background. We don't await it because the
      // optimistic state already shows the change.
      setTimeout(() => setIsUpdating(false), 100);
    }
  };

  return (
    <Badge
      onClick={handleToggle}
      variant="default"
      className={`text-xs cursor-pointer transition-all duration-200 hover:scale-105 ${
        isThisInstanceGoing
          ? 'bg-white border border-gray-200 text-gray-900 hover:bg-gray-50'
          : 'bg-gray-100 border border-gray-300 text-gray-700 hover:bg-gray-200'
      } ${isUpdating ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      style={{ userSelect: 'none' }}
    >
      {isUpdating ? (
        <div className="flex items-center">
          <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin mr-1" />
          Updating...
        </div>
      ) : (
        <>
          <span className="mr-1">{isThisInstanceGoing ? '✅' : '🔴'}</span>
          {showItemName && item.name}
          {!showItemName && (isThisInstanceGoing ? 'Going' : 'Not Going')}
          {quantity > 1 && showItemName && (
            <span className="ml-1 text-xs opacity-75">
              ({quantityIndex + 1}/{quantity})
            </span>
          )}
        </>
      )}
    </Badge>
  );
}
