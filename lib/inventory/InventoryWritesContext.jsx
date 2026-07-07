'use client';

import { createContext, useContext } from 'react';

/**
 * Cross-surface inventory sync channel. Provided once by InventoryManager;
 * consumed by any descendant rendering an inventory editor (spreadsheet row,
 * modal cell, badge).
 *
 * - `markDirty(itemId)` / `markClean(itemId)` — mute the poll/refetch merge
 *   for a row while a writer has un-flushed edits.
 * - `mergeUpdatedItem(item)` — merge one (partial) item into the canonical
 *   `inventoryItems` array so every surface (sheet, header stats, sibling
 *   modals) re-renders from the same data.
 * - `removeItem(itemId)` — drop one item from the canonical array after a
 *   confirmed server-side DELETE. Default is `null` (not a no-op) so
 *   consumers can feature-detect and fall back to legacy refresh callbacks.
 * - `weightConfig` — the project's `{ weightMode, customWeightMultiplier }`.
 *   Editors that display weight MUST derive it the same way the spreadsheet
 *   does (custom mode: per-unit cuft × multiplier; actual: item.weight).
 *   Default `null` → treat as 'actual'.
 *
 * All fields are optional — components fall back to no-ops if no provider is
 * mounted, so they remain usable in isolation (tests, storybook, etc).
 */
export const InventoryWritesContext = createContext({
  markDirty: (_id) => {},
  markClean: (_id) => {},
  mergeUpdatedItem: (_item) => {},
  removeItem: null,
  weightConfig: null,
});

export function useInventoryWrites() {
  return useContext(InventoryWritesContext);
}
