'use client';

// components/inventory/ProjectMediaNavigation.jsx
//
// Project-wide prev/next navigation across ALL media (images, uploaded
// videos, self-serve recordings, virtual-call recordings).
//
// Why a central navigator: each gallery (ImageGallery, VideoGallery,
// VideoRecordingsTab, Spreadsheet's preview) mounts its own media modal and
// unmounts with its tab, so no single host can flip across kinds. Instead:
//
//   - `MediaNavigationProvider` (mounted once in InventoryManager) fetches a
//     light ordered index from /api/projects/:id/media-index and renders a
//     centrally-mounted viewer that can display any media kind.
//   - Hosts call `useMediaNavigationFor(mediaId, closeSelf)` and pass the
//     result to their modal's `navigation` prop. The arrows/keyboard UI
//     itself lives in MediaInventoryModal.
//   - Pressing an arrow closes the host's modal (`closeSelf`) and opens the
//     target media in the central viewer; further flips swap the viewer's
//     content in place.
//
// The sequence order matches the tab order: Images → Videos (incl.
// self-serve) → Virtual Calls, each newest-first.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Camera, FileImage, Loader2, Video as VideoIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import MediaInventoryModal from '@/components/inventory/MediaInventoryModal';
import VideoRecordingModal from '@/components/VideoRecordingModal';
import VideoChapters, { hasVideoChapters } from '@/components/video/VideoChapters';
import { useVideoChapters } from '@/lib/hooks/useVideoChapters';

const MediaNavigationContext = createContext(null);

const INDEX_STALE_MS = 10000;

export function useMediaNavigation() {
  return useContext(MediaNavigationContext);
}

/**
 * Host-side hook. Pass the currently-open media's id (or null when the
 * modal is closed) and a stable-ish callback that closes the host's modal.
 * Returns the `navigation` prop for MediaInventoryModal /
 * VideoRecordingModal, or null when navigation isn't available (no
 * provider, index not loaded yet, or media not in the index).
 */
export function useMediaNavigationFor(mediaId, closeSelf) {
  const nav = useMediaNavigation();
  const closeRef = useRef(closeSelf);
  closeRef.current = closeSelf;

  useEffect(() => {
    if (mediaId && nav) nav.ensureIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId]);

  if (!nav || !mediaId) return null;
  return nav.buildNavigation(mediaId, () => closeRef.current?.());
}

export function MediaNavigationProvider({
  projectId,
  inventoryItems,
  onInventoryUpdate,
  onAddStockItem,
  children,
}) {
  const [index, setIndex] = useState([]);
  const [viewerEntry, setViewerEntry] = useState(null);
  const lastFetchRef = useRef(0);
  const fetchingRef = useRef(false);

  const refreshIndex = useCallback(async (force = false) => {
    if (!projectId) return;
    if (fetchingRef.current) return;
    if (!force && Date.now() - lastFetchRef.current < INDEX_STALE_MS) return;
    fetchingRef.current = true;
    try {
      const res = await fetch(`/api/projects/${projectId}/media-index`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setIndex(data.items);
        lastFetchRef.current = Date.now();
      }
    } catch (err) {
      console.error('Error fetching media index:', err);
    } finally {
      fetchingRef.current = false;
    }
  }, [projectId]);

  // Prefetch once on mount so arrows render immediately the first time a
  // modal opens; ensureIndex() keeps it fresh (10s staleness) after that.
  useEffect(() => {
    refreshIndex(true);
  }, [refreshIndex]);

  const indexRef = useRef(index);
  indexRef.current = index;

  const openAt = useCallback((pos) => {
    const entry = indexRef.current[pos];
    if (entry) setViewerEntry(entry);
  }, []);

  const buildNavigation = useCallback(
    (mediaId, closeSelf) => {
      const pos = index.findIndex((e) => e.id === mediaId);
      if (pos === -1) return null;
      return {
        index: pos,
        total: index.length,
        hasPrev: pos > 0,
        hasNext: pos < index.length - 1,
        onPrev: () => {
          if (pos <= 0) return;
          closeSelf?.();
          openAt(pos - 1);
        },
        onNext: () => {
          if (pos >= index.length - 1) return;
          closeSelf?.();
          openAt(pos + 1);
        },
      };
    },
    [index, openAt]
  );

  const ensureIndex = useCallback(() => {
    refreshIndex(false);
  }, [refreshIndex]);

  const value = useMemo(
    () => ({ buildNavigation, ensureIndex, refreshIndex }),
    [buildNavigation, ensureIndex, refreshIndex]
  );

  return (
    <MediaNavigationContext.Provider value={value}>
      {children}
      <ProjectMediaViewer
        projectId={projectId}
        entry={viewerEntry}
        onClose={() => setViewerEntry(null)}
        buildNavigation={buildNavigation}
        inventoryItems={inventoryItems}
        onInventoryUpdate={onInventoryUpdate}
        onAddStockItem={onAddStockItem}
      />
    </MediaNavigationContext.Provider>
  );
}

// ─── Central viewer ──────────────────────────────────────────────────
// Renders whichever media the navigator landed on. Images and uploaded
// videos use the MediaInventoryModal shell directly (same fetch pattern as
// Spreadsheet's media preview: thumbnail endpoint for images, metadata +
// stream endpoints for videos). Recordings — self-serve and virtual-call —
// hand the raw VideoRecording doc to VideoRecordingModal, which fetches its
// own stream/analysis by id.

function ProjectMediaViewer({
  projectId,
  entry,
  onClose,
  buildNavigation,
  inventoryItems,
  onInventoryUpdate,
  onAddStockItem,
}) {
  const [detail, setDetail] = useState(null); // { key, loading, error, data }
  const cacheRef = useRef(new Map());
  const videoRef = useRef(null);
  const [videoTime, setVideoTime] = useState(0);

  const entryKey = entry ? `${entry.kind}:${entry.id}` : null;
  const isRecording =
    entry?.kind === 'self_serve_recording' || entry?.kind === 'call_recording';
  const isVideoKind = entry?.kind === 'video';

  useEffect(() => {
    if (!entryKey || !entry) {
      setDetail(null);
      return;
    }
    const cached = cacheRef.current.get(entryKey);
    if (cached) {
      setDetail({ key: entryKey, loading: false, error: null, data: cached });
      return;
    }

    let cancelled = false;
    setDetail({ key: entryKey, loading: true, error: null, data: null });

    const load = async () => {
      try {
        let data;
        if (entry.kind === 'image') {
          const res = await fetch(
            `/api/projects/${projectId}/images/${entry.id}/thumbnail?width=800&height=600&quality=85`,
            { signal: AbortSignal.timeout(30000) }
          );
          if (!res.ok) throw new Error(`Failed to load image (${res.status})`);
          const blob = await res.blob();
          data = { dataUrl: URL.createObjectURL(blob) };
        } else if (entry.kind === 'video') {
          const metaRes = await fetch(
            `/api/projects/${projectId}/videos/${entry.id}/metadata`,
            { signal: AbortSignal.timeout(30000) }
          );
          if (!metaRes.ok) throw new Error(`Failed to load video (${metaRes.status})`);
          const meta = await metaRes.json();
          let streamUrl = null;
          try {
            const streamRes = await fetch(
              `/api/projects/${projectId}/videos/${entry.id}/stream`,
              { signal: AbortSignal.timeout(8000) }
            );
            if (streamRes.ok) {
              streamUrl = (await streamRes.json()).streamUrl;
            }
          } catch {
            // fall through to direct endpoint below
          }
          data = {
            ...(meta.video || {}),
            streamUrl: streamUrl || `/api/projects/${projectId}/videos/${entry.id}`,
          };
        } else {
          // Recordings: raw VideoRecording doc; VideoRecordingModal fetches
          // its own stream + analysis by _id.
          const res = await fetch(
            `/api/projects/${projectId}/video-recordings/${entry.id}`,
            { signal: AbortSignal.timeout(30000) }
          );
          if (!res.ok) throw new Error(`Failed to load recording (${res.status})`);
          data = await res.json();
        }
        if (cancelled) return;
        cacheRef.current.set(entryKey, data);
        setDetail({ key: entryKey, loading: false, error: null, data });
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading media for viewer:', err);
        setDetail({
          key: entryKey,
          loading: false,
          error: err?.message || 'Failed to load media',
          data: null,
        });
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryKey, projectId]);

  // Reset playhead tracking when the viewed media changes.
  useEffect(() => {
    setVideoTime(0);
  }, [entryKey]);

  const { chapters, activeChapter } = useVideoChapters({
    projectId,
    videoId: isVideoKind ? entry?.id : null,
    currentTime: videoTime,
    enabled: !!entry && isVideoKind,
  });

  const seekTo = (timeSec) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = timeSec;
    setVideoTime(timeSec);
  };

  // The viewer navigates in place: closeSelf is a no-op because openAt()
  // simply swaps the entry.
  const navigation = entry ? buildNavigation(entry.id, null) : null;

  if (!entry) return null;

  // The media area keeps the SAME fixed height in loading, error, and
  // loaded states (h-96 to match the galleries' media boxes) so the modal
  // never resizes while flipping — while waiting we show a skeleton in
  // that box instead of a spinner that would collapse the layout.
  const detailReady = detail?.key === entryKey && !detail.loading && !detail.error;
  const mediaBoxClass =
    'relative rounded-lg overflow-hidden h-96 flex items-center justify-center';
  // Same look as the project page's loading state: pulsing skeleton box
  // with the centered blue spinner + label on top.
  const loadingSlot = (
    <div className={`${mediaBoxClass} bg-gray-100`}>
      <Skeleton className="absolute inset-0 rounded-none" />
      <div className="relative z-10 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-600">Loading media...</p>
      </div>
    </div>
  );
  const errorSlot = (
    <div className={`${mediaBoxClass} bg-gray-100`}>
      <div className="text-center px-6">
        <p className="text-lg font-medium text-gray-900">Unable to load media</p>
        <p className="text-sm text-gray-500 mt-1">{detail?.error}</p>
      </div>
    </div>
  );

  if (isRecording) {
    // VideoRecordingModal needs the recording doc before it can mount.
    // The placeholder uses the SAME desktopLayout ('panels') so the dialog
    // keeps identical dimensions when the real modal takes over.
    if (!detailReady) {
      return (
        <MediaInventoryModal
          isOpen
          onClose={onClose}
          projectId={projectId}
          inventoryItems={inventoryItems}
          onInventoryUpdate={onInventoryUpdate}
          desktopLayout="panels"
          media={{ kind: 'video-recording', id: entry.id, filter: () => false, sourceKey: 'sourceVideoRecordingId' }}
          headerTitle={entry.name}
          mediaSlot={detail?.error ? errorSlot : loadingSlot}
          navigation={navigation}
        />
      );
    }
    return (
      <VideoRecordingModal
        recording={detail.data}
        projectId={projectId}
        isOpen
        onClose={onClose}
        inventoryItems={inventoryItems}
        onInventoryUpdate={onInventoryUpdate}
        onAddStockItem={onAddStockItem}
        navigation={navigation}
      />
    );
  }

  const isImage = entry.kind === 'image';
  const media = isImage
    ? {
        kind: 'image',
        id: entry.id,
        filter: (item) => {
          const imageId = item.sourceImageId?._id || item.sourceImageId;
          return imageId === entry.id;
        },
        sourceKey: 'sourceImageId',
      }
    : {
        kind: 'video',
        id: entry.id,
        filter: (item) => {
          const videoId = item.sourceVideoId?._id || item.sourceVideoId;
          return videoId === entry.id;
        },
        sourceKey: 'sourceVideoId',
        chapters,
        videoRef,
        streamUrl: detailReady ? detail.data.streamUrl : null,
        onSeek: seekTo,
      };

  let mediaSlot;
  if (!detailReady) {
    mediaSlot = detail?.error ? errorSlot : loadingSlot;
  } else if (isImage) {
    mediaSlot = (
      <div className={`${mediaBoxClass} bg-gray-100`}>
        <img
          src={detail.data.dataUrl}
          alt={entry.name}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    );
  } else {
    mediaSlot = (
      <div className={`${mediaBoxClass} bg-black`}>
        <video
          ref={videoRef}
          src={detail.data.streamUrl}
          controls
          preload="metadata"
          className="w-full h-full bg-black object-contain"
          onTimeUpdate={(e) => setVideoTime(e.target.currentTime)}
        />
      </div>
    );
  }

  return (
    <MediaInventoryModal
      isOpen
      onClose={onClose}
      projectId={projectId}
      inventoryItems={inventoryItems}
      onInventoryUpdate={onInventoryUpdate}
      onAddStockItem={onAddStockItem}
      desktopLayout={isImage ? 'panels' : 'side-by-side'}
      media={media}
      headerTitle={
        <span className="flex items-center gap-2">
          {isImage ? (
            <FileImage size={20} className="text-blue-500" />
          ) : (
            <VideoIcon size={20} className="text-purple-500" />
          )}
          {entry.name}
        </span>
      }
      headerSubtitle={
        entry.createdAt
          ? `Uploaded on ${new Date(entry.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}`
          : undefined
      }
      mediaSlot={mediaSlot}
      extrasSlot={
        !isImage && detailReady && hasVideoChapters(chapters) ? (
          <VideoChapters
            chapters={chapters}
            activeChapter={activeChapter}
            onSeek={seekTo}
          />
        ) : null
      }
      analysisSlot={
        entry.description ? (
          <div className="mb-4">
            <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
              <Camera size={16} />
              Description
            </h4>
            <p className="text-sm text-gray-600">{entry.description}</p>
          </div>
        ) : null
      }
      navigation={navigation}
    />
  );
}
