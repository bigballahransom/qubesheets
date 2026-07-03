'use client';

// components/inventory/MediaInventoryModal.jsx
//
// One reusable modal frame for every "click media → inventory by room"
// surface in the app:
//   - Spreadsheet.jsx's media-preview
//   - ImageGallery.tsx's image-detail
//   - VideoGallery.jsx's video-detail
//   - VideoRecordingModal.jsx (video-recording playback)
//
// Two layouts:
//   - `desktopLayout="stack"` (default) — DialogContent scrolls vertically;
//     mediaSlot → extrasSlot → items column → analysisSlot.
//   - `desktopLayout="panels"` — fixed-height DialogContent with a
//     ResizablePanelGroup on ≥ lg viewports: mediaSlot + extrasSlot in the
//     left panel, items column in the right panel. Falls back to stack on
//     mobile (< lg) so the modal is still usable on phones.
//
// Optional Tabs:
//   - When `notesSlot` is provided, the watch content is wrapped in Tabs
//     with a "Watch" and "Notes" tab. When it's null, the tabs disappear.
//
// The items column (accordion + RoomItemsTable + stock picker) is always
// the shared `MediaInventoryItemsColumn`. Any feature the caller doesn't
// pass a slot for simply doesn't render.

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MediaInventoryItemsColumn from '@/components/inventory/MediaInventoryItemsColumn';
import { useAutoSeekOnInitialItem } from '@/lib/hooks/useAutoSeekOnInitialItem';

/**
 * @param {object} p
 * @param {boolean} p.isOpen
 * @param {() => void} p.onClose
 *
 * @param {string} p.projectId
 * @param {any[]}  p.inventoryItems
 * @param {function} p.onInventoryUpdate
 * @param {(function|null)=} p.onAddStockItem
 *
 * @param {object} p.media
 * @param {('video-recording'|'video'|'image')=} p.media.kind  Documentation
 *                                              hint for callers; the shell
 *                                              doesn't branch on this.
 * @param {string=} p.media.id
 * @param {(item) => boolean} p.media.filter
 * @param {'sourceImageId'|'sourceVideoId'|'sourceVideoRecordingId'} p.media.sourceKey
 * @param {any[]=}  p.media.chapters
 * @param {any=}    p.media.initialItem
 * @param {object=} p.media.videoRef
 * @param {string=} p.media.streamUrl
 * @param {function=} p.media.computeOffsetSeconds
 * @param {function=} p.media.onSeek
 *
 * @param {'stack'|'panels'=} p.desktopLayout   Defaults to 'stack'.
 * @param {boolean=} p.preventClose             When true, ignore
 *                                              pointer-down-outside and
 *                                              interact-outside — the modal
 *                                              only closes via the X or
 *                                              Escape. Recording modal uses
 *                                              this because it hosts many
 *                                              nested Radix portals (Tags,
 *                                              dropdowns) whose clicks
 *                                              would otherwise dismiss it.
 *
 * @param {string|React.ReactNode=} p.headerTitle
 * @param {string=} p.headerSubtitle
 *
 * @param {React.ReactNode=} p.mediaSlot        Media element (image /
 *                                              video / recording player).
 * @param {React.ReactNode=} p.extrasSlot       Auxiliary content next to
 *                                              the media (chapters, AI
 *                                              summary, statements). Any
 *                                              feature the caller doesn't
 *                                              have simply isn't passed.
 * @param {React.ReactNode=} p.analysisSlot     Analysis / description
 *                                              blocks (typically only the
 *                                              gallery modals).
 * @param {React.ReactNode=} p.notesSlot        Notes tab content. When
 *                                              provided, the watch content
 *                                              is wrapped in Tabs.
 *
 * @param {(room: string) => React.ReactNode=} p.renderRoomExtras
 *                                              Per-room render function
 *                                              passed through to
 *                                              MediaInventoryItemsColumn.
 *                                              VideoRecordingModal uses
 *                                              this for its Loop-segments
 *                                              button.
 * @param {string[]=} p.availableRoomsOverride  Overrides the column's
 *                                              inventoryItems-derived
 *                                              rooms list. Recording modal
 *                                              uses this to add the
 *                                              recording's roomCatalog.
 */
export default function MediaInventoryModal({
  isOpen,
  onClose,
  projectId,
  inventoryItems,
  onInventoryUpdate,
  onAddStockItem = null,

  media,

  desktopLayout = 'stack',
  preventClose = false,

  headerTitle,
  headerSubtitle,

  mediaSlot,
  extrasSlot,
  analysisSlot,
  notesSlot,

  renderRoomExtras = null,
  availableRoomsOverride = null,
}) {
  // Desktop detection — same breakpoint the old VideoRecordingModal used
  // (1024px = the shadcn / Tailwind `lg` breakpoint).
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mql.matches);
    const handler = (e) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Auto-seek only fires when the caller passes a video ref + streamUrl.
  useAutoSeekOnInitialItem({
    isOpen,
    initialItem: media?.initialItem,
    inventoryItems,
    streamUrl: media?.streamUrl,
    videoRef: media?.videoRef,
    computeOffsetSeconds: media?.computeOffsetSeconds,
  });

  // Resize-drag close prevention. The `ResizableHandle` fires
  // pointer-down events that bubble through the document body; without
  // this the shadcn Dialog would treat them as "outside interactions" and
  // close mid-drag. Only relevant for panels layout, but the ref lives at
  // the top so the DialogContent handler can always read it.
  const isResizingRef = useRef(false);
  const handleResizeStart = () => {
    isResizingRef.current = true;
    const onUp = () => {
      isResizingRef.current = false;
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointerup', onUp);
  };

  const itemsColumn = (
    <MediaInventoryItemsColumn
      projectId={projectId}
      inventoryItems={inventoryItems}
      onInventoryUpdate={onInventoryUpdate}
      onAddStockItem={onAddStockItem}
      media={media}
      renderRoomExtras={renderRoomExtras}
      availableRoomsOverride={availableRoomsOverride}
    />
  );

  // ─── Watch content ────────────────────────────────────────────────
  // Panels layout on desktop: media/extras/analysis in the left panel,
  // items column in the right panel. Stack (or mobile-fallback from
  // panels): single vertical scroll.
  //
  // Scrolling caveat: when the caller asked for `panels` but we're on
  // mobile (isDesktop=false), the DialogContent still uses the fixed-height
  // panels shape (`h-[95vh] flex flex-col overflow-hidden`) so tabs and
  // header sit correctly. That means the mobile stack MUST bring its own
  // `h-full overflow-y-auto` — without it the content is clipped and
  // the modal isn't scrollable. Same wrapper applies inside the Notes
  // tab's parent container. When `desktopLayout` is just plain 'stack'
  // there's no fixed height on DialogContent (max-h + overflow-auto), so
  // the inner div renders inline and the whole dialog scrolls.
  const usePanels = desktopLayout === 'panels' && isDesktop;
  const stackNeedsOwnScroll = desktopLayout === 'panels' && !isDesktop;

  const watchContent = usePanels ? (
    <ResizablePanelGroup
      id="media-inventory-modal-watch"
      orientation="horizontal"
      className="h-full rounded-lg border"
    >
      <ResizablePanel id="player" defaultSize="50%" minSize="30%">
        <div className="h-full overflow-y-auto p-3 space-y-4">
          {mediaSlot}
          {extrasSlot}
          {analysisSlot}
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle onPointerDown={handleResizeStart} />
      <ResizablePanel id="items" defaultSize="50%" minSize="30%">
        <div className="h-full overflow-y-auto p-3">
          {itemsColumn}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ) : (
    <div className={
      stackNeedsOwnScroll
        ? 'h-full overflow-y-auto space-y-4 min-w-0 pr-1'
        : 'space-y-4 min-w-0'
    }>
      {mediaSlot}
      {extrasSlot}
      {itemsColumn}
      {analysisSlot}
    </div>
  );

  // ─── DialogContent shape ─────────────────────────────────────────
  // Panels layout requires a fixed height so ResizablePanelGroup has a
  // known container to distribute. Stack uses max-h + overflow-y-auto so
  // short content doesn't leave dead space.
  const dialogContentClass = desktopLayout === 'panels'
    ? 'w-[95vw] sm:max-w-5xl md:max-w-6xl lg:max-w-7xl xl:max-w-[1600px] 2xl:max-w-[1800px] h-[95vh] flex flex-col overflow-hidden'
    : 'w-[95vw] sm:max-w-5xl md:max-w-6xl lg:max-w-7xl xl:max-w-[1600px] 2xl:max-w-[1800px] max-h-[95vh] overflow-y-auto overflow-x-hidden';

  const outsideHandlers = {
    onPointerDownOutside: (e) => {
      if (preventClose || isResizingRef.current) e.preventDefault();
    },
    onInteractOutside: (e) => {
      if (preventClose || isResizingRef.current) e.preventDefault();
    },
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent className={dialogContentClass} {...outsideHandlers}>
        {(headerTitle || headerSubtitle) && (
          <DialogHeader className={desktopLayout === 'panels' ? 'shrink-0' : undefined}>
            {headerTitle && <DialogTitle>{headerTitle}</DialogTitle>}
            {headerSubtitle && <DialogDescription>{headerSubtitle}</DialogDescription>}
          </DialogHeader>
        )}

        {notesSlot ? (
          <Tabs defaultValue="watch" className="w-full flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-2 shrink-0">
              <TabsTrigger value="watch">Watch</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>
            <TabsContent value="watch" className="mt-4 flex-1 min-h-0">
              {watchContent}
            </TabsContent>
            <TabsContent value="notes" className="mt-4 flex-1 min-h-0">
              {notesSlot}
            </TabsContent>
          </Tabs>
        ) : (
          watchContent
        )}
      </DialogContent>
    </Dialog>
  );
}
