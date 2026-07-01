'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * Owns one inventory item's mutation lifecycle.
 *
 * Contract:
 *  - `state` is the optimistic, render-time view of the item. Callers always
 *    read fields off this — never off the `item` prop.
 *  - `set(changes)` applies changes optimistically and queues a debounced
 *    PATCH (300 ms). Subsequent `set` calls inside the window coalesce.
 *  - `flush()` sends any pending changes immediately. Use for explicit
 *    commits (dropdown change, blur, dialog Save).
 *  - `isDirty` is true while there are pending or in-flight writes — drives
 *    the parent's dirty-aware refetch merge.
 *  - On PATCH success the writer calls `onCommitted(updatedItem)` with the
 *    server response. The parent merges that one item into its
 *    `inventoryItems` array — no full refetch.
 *  - On PATCH failure the writer reverts to the last server-confirmed
 *    snapshot (NOT to the `item` prop, which may be even more stale) and
 *    surfaces a toast.
 *  - Single-flight queue: at most one PATCH in flight per item; if `set` is
 *    called during a flight, the changes wait, then auto-flush.
 *  - Prop reconciliation: when the parent passes a new `item` prop, the
 *    writer only adopts it if the writer is clean (no pending, no in-flight,
 *    no timer). This is the fix for the parent-refetch-wipes-edit class of
 *    bugs.
 *  - Unmount: flushes pending changes once (best effort).
 *
 * The hook ALSO threads `markDirty(id) / markClean(id)` so the parent can
 * mute its refetch merge for the row. Both are optional — if not provided,
 * the writer still works in isolation.
 */
export function useInventoryItemWriter({
  item,
  projectId,
  onCommitted,
  onError,
  markDirty,
  markClean,
  debounceMs = 300,
}) {
  if (!item) throw new Error('useInventoryItemWriter requires `item`');

  const itemId = item._id;
  const apiBase = `/api/projects/${projectId || item.projectId}/inventory/${itemId}`;

  const [state, setStateInternal] = useState(item);
  // Synchronous mirror of `state`. Updated immediately every time we mutate
  // state — even within the same event tick — so functional `set` callers
  // can read "the latest known optimistic state" before React re-renders.
  // Without this, rapid `+` clicks all see the render-time snapshot and
  // computed deltas collapse onto the same target value.
  const stateRef = useRef(item);
  const setState = useCallback((next) => {
    const resolved = typeof next === 'function' ? next(stateRef.current) : next;
    stateRef.current = resolved;
    setStateInternal(resolved);
  }, []);

  // Last server-confirmed snapshot. Used for revert on PATCH failure so we
  // don't fall back to the (possibly older) `item` prop.
  const lastGoodRef = useRef(item);

  // Changes accumulated while the debounce timer is pending OR while a PATCH
  // is in flight. Flushed atomically.
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const inFlightRef = useRef(false);

  // Always-current refs for callbacks/closures.
  const onCommittedRef = useRef(onCommitted);
  const onErrorRef = useRef(onError);
  const markDirtyRef = useRef(markDirty);
  const markCleanRef = useRef(markClean);
  useEffect(() => { onCommittedRef.current = onCommitted; }, [onCommitted]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { markDirtyRef.current = markDirty; }, [markDirty]);
  useEffect(() => { markCleanRef.current = markClean; }, [markClean]);

  const isDirtyNow = useCallback(() => {
    return (
      Object.keys(pendingRef.current).length > 0 ||
      timerRef.current != null ||
      inFlightRef.current
    );
  }, []);

  const announceDirty = useCallback(() => {
    if (markDirtyRef.current) markDirtyRef.current(itemId);
  }, [itemId]);

  const announceClean = useCallback(() => {
    if (markCleanRef.current) markCleanRef.current(itemId);
  }, [itemId]);

  // ── PATCH execution ──────────────────────────────────────────────────
  const sendPatch = useCallback(async (changes) => {
    inFlightRef.current = true;
    try {
      const res = await fetch(apiBase, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        let msg = 'Update failed';
        try {
          const err = await res.json();
          if (err?.error) msg = err.error;
        } catch {}
        throw new Error(msg);
      }
      // API returns the updated item document.
      let updated = null;
      try { updated = await res.json(); } catch { updated = null; }
      // Adopt the server's canonical version as the new "last good".
      if (updated && typeof updated === 'object') {
        lastGoodRef.current = updated;
        // Reconcile optimistic state — but ONLY for fields the user has not
        // re-edited since this PATCH started. While the PATCH was in flight
        // additional `set` calls landed in pendingRef; merging the server's
        // (older) view over those would jump the value backward, then the
        // auto-flush would jump it forward again. That's the "+- spam makes
        // the count bounce" bug. Skipping fields with pending edits keeps
        // the user's optimistic value stable.
        setState((prev) => {
          const next = { ...prev };
          const stillPending = pendingRef.current;
          for (const k of Object.keys(updated)) {
            if (!(k in stillPending)) next[k] = updated[k];
          }
          return next;
        });
        if (onCommittedRef.current) onCommittedRef.current(updated);
      }
      return { ok: true, updated };
    } catch (err) {
      console.error('Inventory PATCH failed', { itemId, changes, err });
      // Revert optimistic state to last confirmed snapshot.
      setState(lastGoodRef.current);
      pendingRef.current = {};
      const message = err instanceof Error ? err.message : 'Failed to save change';
      toast.error(message);
      if (onErrorRef.current) onErrorRef.current(err);
      return { ok: false, err };
    } finally {
      inFlightRef.current = false;
    }
  }, [apiBase, itemId]);

  // ── Flush queue ──────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // If a PATCH is in flight, do nothing — the in-flight handler will
    // re-flush whatever pendingRef has accumulated when it returns.
    if (inFlightRef.current) return;

    const changes = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(changes).length === 0) {
      if (!isDirtyNow()) announceClean();
      return;
    }

    await sendPatch(changes);

    // If new changes were queued during the flight, auto-flush them.
    if (Object.keys(pendingRef.current).length > 0) {
      // Defer to next tick so the previous setState commits first.
      Promise.resolve().then(flush);
    } else if (!isDirtyNow()) {
      announceClean();
    }
  }, [sendPatch, isDirtyNow, announceClean]);

  // ── Public set ───────────────────────────────────────────────────────
  //
  // `changesOrProducer` can be either:
  //   - a plain object: `{ quantity: 5 }` — applied as-is.
  //   - a function: `(prev) => ({ quantity: prev.quantity + 1, ... })` —
  //     used when the next value depends on the latest optimistic state.
  //     This avoids stale-closure bugs when the caller fires multiple
  //     sets between renders (rapid `+` clicks, etc.).
  //
  // Producer can return null/undefined to indicate "no change" — useful for
  // bounds-checked updates that decide to bail.
  const set = useCallback((changesOrProducer, options = {}) => {
    const { immediate = false } = options;
    const raw = typeof changesOrProducer === 'function'
      ? changesOrProducer(stateRef.current)
      : changesOrProducer;
    if (!raw || typeof raw !== 'object') return;

    // Synchronous state mutation (stateRef + React render scheduling).
    setState({ ...stateRef.current, ...raw });
    pendingRef.current = { ...pendingRef.current, ...raw };
    announceDirty();

    if (immediate) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Async to let the render tick happen first.
      Promise.resolve().then(flush);
      return;
    }

    // Debounced path — reset timer on every set so rapid clicks coalesce.
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, debounceMs);
  }, [debounceMs, flush, announceDirty]);

  // ── Prop reconciliation ─────────────────────────────────────────────
  // Only adopt a new `item` prop if we have no pending or in-flight
  // changes. This is the surgical fix for "parent refetch wipes my edit".
  useEffect(() => {
    if (!item) return;
    if (isDirtyNow()) return;
    setState(item);
    lastGoodRef.current = item;
  }, [item, isDirtyNow]);

  // ── Unmount: flush pending edits so closing the modal mid-edit doesn't
  //    drop the write. Best-effort: if a PATCH is already in flight we let
  //    it complete; if there are pending bits, we kick off one more PATCH.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const changes = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(changes).length === 0) return;
      // Fire-and-forget on unmount. We don't await since the component is
      // gone and there's no UI left to revert. Errors surface via toast.
      fetch(apiBase, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      }).catch((err) => {
        console.error('Inventory PATCH on unmount failed', err);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt an external state update WITHOUT queuing a PATCH. Used when
  // some other path has already persisted the change to the server (e.g.,
  // the spreadsheet's TagsCell PATCHes internally on popover close; we
  // just need the row's optimistic state to reflect the new tags).
  const replaceState = useCallback((partial) => {
    if (!partial || typeof partial !== 'object') return;
    setState({ ...stateRef.current, ...partial });
    lastGoodRef.current = { ...lastGoodRef.current, ...partial };
  }, [setState]);

  return {
    state,
    set,
    flush,
    replaceState,
    isDirty: isDirtyNow,
  };
}
