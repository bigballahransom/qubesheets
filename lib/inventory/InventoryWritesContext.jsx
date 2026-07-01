'use client';

import { createContext, useContext } from 'react';

/**
 * Provides `markDirty(itemId)` / `markClean(itemId)` and `mergeUpdatedItem(item)`
 * down to any descendant rendering an inventory editor (spreadsheet row,
 * modal cell, badge). Children consume via `useInventoryWrites()`.
 *
 * All three are optional — components fall back to no-ops if no provider is
 * mounted, so they remain usable in isolation (tests, storybook, etc).
 */
export const InventoryWritesContext = createContext({
  markDirty: (_id) => {},
  markClean: (_id) => {},
  mergeUpdatedItem: (_item) => {},
});

export function useInventoryWrites() {
  return useContext(InventoryWritesContext);
}
