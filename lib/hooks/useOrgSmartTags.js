'use client';

import { useEffect, useState } from 'react';

// Module-level cache so the first modal mount fetches and every subsequent
// hook consumer (other modals, other cells, future remounts inside the same
// page session) reads from the cache without hitting the network. The
// inflight Promise dedupes simultaneous first-time consumers.
let cache = null;
let inflight = null;

/**
 * Org-level "smart tags" the user has saved at the organization scope.
 * Shape per entry mirrors what `Spreadsheet.jsx` already consumes:
 *   `{ name: string, color?: string, ... }`.
 *
 * Returns an array. Empty array while loading or on error — callers should
 * treat the empty case the same as "no org tags yet".
 *
 * Usage:
 *   const orgSmartTags = useOrgSmartTags();
 *
 * Used by the inventory modals (`VideoRecordingModal`, `ImageGallery`,
 * `VideoGallery`) to:
 *   1) filter their local `projectTags` so org-library tags don't show up
 *      twice in the TagsCell autocomplete (parity with
 *      `Spreadsheet.jsx`'s `projectOnlyTags`).
 *   2) pass to `RoomItemsTable` → `TagsCell` so the cell skips its own
 *      `/api/settings/smart-tags` fetch and reuses the cached set.
 */
export function useOrgSmartTags() {
  const [tags, setTags] = useState(cache ?? []);

  useEffect(() => {
    let cancelled = false;
    if (cache) return;
    if (inflight) {
      inflight.then((t) => { if (!cancelled) setTags(t); });
      return () => { cancelled = true; };
    }
    inflight = fetch('/api/settings/smart-tags')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list = Array.isArray(data?.smartTags) ? data.smartTags : [];
        cache = list;
        return list;
      })
      .catch(() => []);
    inflight.then((t) => {
      if (!cancelled) setTags(t);
      inflight = null;
    });
    return () => { cancelled = true; };
  }, []);

  return tags;
}
