'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Auto-seek a video to `initialItem`'s timestamp when the modal opens.
 *
 * Ports the logic that used to live inside `VideoRecordingModal` (formerly
 * `VideoRecordingModal.jsx:232-323`) so any video-timeline media modal —
 * recordings, uploads, future kinds — can reuse it. Works only when the
 * modal is video-shaped; images/other kinds should simply not call this
 * hook (or pass `initialItem=null`).
 *
 * Key behaviors:
 *   - Fires exactly ONCE per (open × item) session. Subsequent
 *     `inventoryItems` refreshes (writer commits, polls, SSE) do NOT
 *     re-toast because the seek-key ref is only cleared on close.
 *   - Waits for `canplay` when the video isn't ready yet. Handles cleanup
 *     correctly so a re-render mid-wait doesn't strand the seek.
 *   - Reads a FRESH copy of the item from `inventoryItems` if available;
 *     the caller's `initialItem` may have been a stale spreadsheet-row
 *     snapshot missing `videoTimestamp`.
 *   - Absolute time = `computeOffsetSeconds()` + segment start (from
 *     `segmentIndex` × `segmentDurationSeconds`) + item's `videoTimestamp`
 *     parsed as "MM:SS". The `computeOffsetSeconds` callback covers the
 *     recording-specific offset for legacy customer-egress recordings; for
 *     video uploads it defaults to `() => 0`.
 *
 * @param {object} p
 * @param {boolean} p.isOpen                 Whether the host modal is open.
 * @param {any}     p.initialItem            Item to seek to. Passed from a
 *                                           spreadsheet row click. Null =
 *                                           no seek.
 * @param {any[]}   p.inventoryItems         Canonical items list — used to
 *                                           resolve `initialItem` against
 *                                           the freshest copy.
 * @param {string=} p.streamUrl              Media URL. Seek is deferred
 *                                           until this is truthy (the video
 *                                           element needs `src` first).
 * @param {object}  p.videoRef               `useRef` to the <video> element.
 * @param {function=} p.computeOffsetSeconds `(item) => number`. Defaults
 *                                           to `() => 0`. Recording modal
 *                                           passes the customer-egress
 *                                           offset helper here.
 * @param {number=} p.segmentDurationSeconds Default 300 (5 min segments
 *                                           the Gemini pipeline emits).
 * @param {string=} p.mediaKindLabel         For log/toast attribution.
 *                                           Optional.
 */
export function useAutoSeekOnInitialItem({
  isOpen,
  initialItem,
  inventoryItems,
  streamUrl,
  videoRef,
  computeOffsetSeconds = () => 0,
  segmentDurationSeconds = 300,
}) {
  const autoSeekKeyRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      autoSeekKeyRef.current = null;
      return;
    }

    // Resolve the item against fresh inventory data — the caller's
    // `initialItem` may have been built from a stale spreadsheet-row prop
    // that hasn't got `videoTimestamp` yet.
    let itemToSeek = initialItem;
    if (initialItem && Array.isArray(inventoryItems) && inventoryItems.length > 0) {
      const matchedItem = inventoryItems.find((item) =>
        (item._id === initialItem._id) ||
        (item._id?.toString() === initialItem._id?.toString()) ||
        (item._id === initialItem.inventoryItemId) ||
        (item._id?.toString() === initialItem.inventoryItemId?.toString())
      ) || inventoryItems.find((item) =>
        item.name && item.name === initialItem.name
      );
      if (matchedItem?.videoTimestamp) itemToSeek = matchedItem;
    }

    if (!itemToSeek?.videoTimestamp || !streamUrl) return;

    const seekKey = String(
      initialItem?._id || initialItem?.inventoryItemId || initialItem?.name || ''
    );
    if (autoSeekKeyRef.current === seekKey) return;

    const video = videoRef?.current;
    if (!video) return;

    const doSeek = () => {
      const [min, sec] = itemToSeek.videoTimestamp.split(':').map(Number);
      const timestampSeconds = (min || 0) * 60 + (sec || 0);
      const segmentStart = (itemToSeek.segmentIndex || 0) * segmentDurationSeconds;
      const offsetSeconds = computeOffsetSeconds(itemToSeek) || 0;
      const absoluteTime = offsetSeconds + segmentStart + timestampSeconds;

      video.currentTime = absoluteTime;

      // Only mark AFTER the actual seek — a re-render mid-`canplay`-wait
      // that cleans up the listener needs to be able to retry.
      autoSeekKeyRef.current = seekKey;
      toast.success(
        `Jumped to ${itemToSeek.name} at ${Math.floor(absoluteTime / 60)}:${String(
          Math.floor(absoluteTime % 60)
        ).padStart(2, '0')}`
      );
    };

    // readyState >= 3 → HAVE_FUTURE_DATA. Safe to seek immediately.
    if (video.readyState >= 3) {
      doSeek();
      return;
    }

    const handleCanPlay = () => {
      doSeek();
      video.removeEventListener('canplay', handleCanPlay);
    };
    video.addEventListener('canplay', handleCanPlay);
    return () => {
      video.removeEventListener('canplay', handleCanPlay);
    };
  }, [
    isOpen,
    initialItem,
    inventoryItems,
    streamUrl,
    videoRef,
    computeOffsetSeconds,
    segmentDurationSeconds,
  ]);
}
