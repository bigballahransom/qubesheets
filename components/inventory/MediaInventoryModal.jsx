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
// Three layouts:
//   - `desktopLayout="stack"` (default) — DialogContent scrolls vertically;
//     mediaSlot → extrasSlot → items column → analysisSlot.
//   - `desktopLayout="side-by-side"` (legacy alias: `"panels"`) — fixed-height
//     DialogContent with a horizontal ResizablePanelGroup on ≥ lg viewports:
//     mediaSlot + extrasSlot + analysisSlot in the left panel, items column
//     in the right panel.
//   - `desktopLayout="top-bottom"` — fixed-height DialogContent with a
//     vertical ResizablePanelGroup; the top row is itself split horizontally
//     into mediaSlot (left) and extrasSlot + analysisSlot (right); the bottom
//     row hosts the items column.
//
// Both resizable layouts fall back to the stack on < lg so the modal stays
// usable on phones. When the caller opts into either resizable value, a
// small segmented control appears in the DialogHeader that lets the user
// swap between side-by-side and top-bottom; the choice is persisted in
// localStorage per media kind.
//
// Optional Tabs:
//   - When `notesSlot` is provided, the watch content is wrapped in Tabs
//     with a "Watch" and "Notes" tab. When it's null, the tabs disappear.
//
// The items column (accordion + RoomItemsTable + stock picker) is always
// the shared `MediaInventoryItemsColumn`. Any feature the caller doesn't
// pass a slot for simply doesn't render.

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, PanelsLeftRight, PanelsTopBottom } from 'lucide-react';
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
import { useLocalStoragePreference } from '@/lib/hooks/useLocalStoragePreference';
import { cn } from '@/lib/utils';

// Legacy `panels` value is kept as a synonym for `side-by-side` so existing
// callers don't need to change.
function normalizeLayout(mode) {
  return mode === 'panels' ? 'side-by-side' : mode;
}

const RESIZABLE_LAYOUTS = ['side-by-side', 'top-bottom'];

function LayoutToggle({ value, onChange }) {
  const options = [
    { key: 'side-by-side', label: 'Side by side', Icon: PanelsLeftRight },
    { key: 'top-bottom', label: 'Top and bottom', Icon: PanelsTopBottom },
  ];
  return (
    <div
      role="group"
      aria-label="Layout"
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
    >
      {options.map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md p-1.5 xl:px-2.5 transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              active
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
            )}
          >
            <Icon size={14} />
            <span className="hidden xl:inline text-xs font-medium whitespace-nowrap">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

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
 * @param {'stack'|'side-by-side'|'panels'|'top-bottom'=} p.desktopLayout
 *                                              Defaults to 'stack'. `'panels'`
 *                                              is a legacy alias for
 *                                              `'side-by-side'`. When a
 *                                              resizable value is provided,
 *                                              the modal renders a small
 *                                              layout toggle in the header so
 *                                              the user can swap between
 *                                              `side-by-side` and
 *                                              `top-bottom` on the fly.
 *                                              Selection is persisted in
 *                                              localStorage per media kind.
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
 * @param {object=} p.navigation            Project-wide media prev/next
 *                                              navigation (from
 *                                              useMediaNavigationFor):
 *                                              { index, total, hasPrev,
 *                                              hasNext, onPrev, onNext }.
 *                                              Renders ‹ › arrows + an
 *                                              "n of N" counter and wires
 *                                              ArrowLeft/ArrowRight keys.
 *                                              Omit to hide navigation.
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

  navigation = null,

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

  // ─── Prev/next media navigation (keyboard) ───────────────────────
  // ArrowLeft/ArrowRight flip through the project's media. Skipped when the
  // user is typing, interacting with a slider/select, or focused on the
  // video element (native arrow-key seeking must keep working there).
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const hasNavigation = !!navigation;
  const touchStartRef = useRef(null); // swipe-to-navigate origin (stack layout)
  useEffect(() => {
    if (!isOpen || !hasNavigation) return;
    const handler = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          tag === 'VIDEO' ||
          t.isContentEditable ||
          t.closest('[role="slider"], video')
        ) {
          return;
        }
      }
      const nav = navigationRef.current;
      if (!nav) return;
      if (e.key === 'ArrowLeft' && nav.hasPrev) {
        e.preventDefault();
        nav.onPrev();
      } else if (e.key === 'ArrowRight' && nav.hasNext) {
        e.preventDefault();
        nav.onNext();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, hasNavigation]);

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

  // ─── Layout selection ────────────────────────────────────────────
  // Callers pass a `desktopLayout` hint. If it's a resizable value
  // ('side-by-side' | 'panels' [legacy] | 'top-bottom'), the user can
  // toggle between the two resizable variants via a segmented control in
  // the header — their pick is persisted per media kind.
  const requestedLayout = normalizeLayout(desktopLayout);
  const isResizable = RESIZABLE_LAYOUTS.includes(requestedLayout);
  const kindKey = media?.kind || 'default';
  const [preferredLayout, setPreferredLayout] = useLocalStoragePreference(
    `qube-media-modal-layout:${kindKey}`,
    isResizable ? requestedLayout : 'side-by-side'
  );
  const activeLayout = isResizable && isDesktop
    ? (RESIZABLE_LAYOUTS.includes(preferredLayout) ? preferredLayout : requestedLayout)
    : 'stack';
  const useSideBySide = activeLayout === 'side-by-side';
  const useTopBottom = activeLayout === 'top-bottom';
  const useResizableLayout = useSideBySide || useTopBottom;

  // ─── Prev/next media navigation (touch swipe) ────────────────────
  // The stack layout (small screens) has no arrows — a horizontal swipe
  // flips media instead. The gesture requires clear horizontal dominance
  // (so vertical scrolling is untouched) and ignores touches that start
  // on the video (native scrubber drags), sliders, or form fields.
  const swipeEnabled = hasNavigation && !useResizableLayout;
  const handleTouchStart = (e) => {
    if (!swipeEnabled || e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      target.closest('video, input, textarea, select, [role="slider"]')
    ) {
      touchStartRef.current = null;
      return;
    }
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!swipeEnabled || !start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // 60px minimum travel, and mostly-horizontal (1.5× the vertical drift).
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const nav = navigationRef.current;
    if (!nav) return;
    if (dx < 0 && nav.hasNext) nav.onNext();
    else if (dx > 0 && nav.hasPrev) nav.onPrev();
  };

  // ─── Watch content ───────────────────────────────────────────────
  // Resizable layouts (side-by-side / top-bottom) render on desktop and
  // use ResizablePanelGroups. Below `lg`, we always fall through to the
  // vertical stack so touch surfaces stay big enough.
  //
  // Scrolling caveat: when a resizable layout was requested but we're
  // rendering the mobile stack fallback, the DialogContent still uses the
  // fixed-height shape (`h-[95vh] flex flex-col overflow-hidden`) so the
  // header and tabs sit correctly. The stack container therefore has to
  // bring its own `h-full overflow-y-auto`. When `desktopLayout` is a
  // plain `'stack'`, DialogContent uses max-h + overflow-auto and the
  // inner div renders inline so the whole dialog scrolls.
  const stackNeedsOwnScroll = isResizable && !isDesktop;

  // Panel-content wrapper: subtle `bg-background` so each panel reads as
  // its own card against the muted outer gutter. Overflow-y-auto so long
  // slots scroll inside the panel instead of overflowing the modal.
  const panelInner = 'h-full overflow-y-auto bg-background';

  const sideBySideContent = (
    <ResizablePanelGroup
      id="media-inventory-modal-watch-sbs"
      orientation="horizontal"
      className="h-full rounded-lg border bg-muted/40 overflow-hidden shadow-sm"
    >
      <ResizablePanel id="sbs-player" defaultSize="50%" minSize="30%">
        <div className={cn(panelInner, 'p-4 space-y-4')}>
          {mediaSlot}
          {extrasSlot}
          {analysisSlot}
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle onPointerDown={handleResizeStart} />
      <ResizablePanel id="sbs-items" defaultSize="50%" minSize="30%">
        <div className={cn(panelInner, 'p-3')}>
          {itemsColumn}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );

  const topBottomContent = (
    <ResizablePanelGroup
      id="media-inventory-modal-watch-tb"
      orientation="vertical"
      className="h-full rounded-lg border bg-muted/40 overflow-hidden shadow-sm"
    >
      <ResizablePanel id="tb-top" defaultSize="60%" minSize="35%">
        <ResizablePanelGroup
          id="media-inventory-modal-watch-tb-top"
          orientation="horizontal"
          className="h-full bg-muted/40"
        >
          <ResizablePanel id="tb-media" defaultSize="60%" minSize="40%">
            {/* Flex-center wrapper. The arbitrary child variants force the
                caller's media root (e.g. an aspect-video container) to
                fill the panel height and derive its width from the ratio,
                capped by the panel width. As the user drags the horizontal
                handle up or down, the video shrinks/grows to fit the row
                instead of overflowing. Only applied in the top-bottom
                layout — side-by-side keeps natural media sizing so
                chapters + analysis can flow below the video. */}
            <div className="h-full flex items-center justify-center p-4 overflow-hidden bg-background [&>*]:h-full [&>*]:max-w-full [&>*]:w-auto">
              {mediaSlot}
            </div>
          </ResizablePanel>
          {(extrasSlot || analysisSlot) && (
            <>
              <ResizableHandle withHandle onPointerDown={handleResizeStart} />
              <ResizablePanel id="tb-extras" defaultSize="40%" minSize="25%">
                <div className={cn(panelInner, 'p-4 space-y-4')}>
                  {extrasSlot}
                  {analysisSlot}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle onPointerDown={handleResizeStart} />
      <ResizablePanel id="tb-items" defaultSize="40%" minSize="20%">
        <div className={cn(panelInner, 'p-3')}>
          {itemsColumn}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );

  const stackContent = (
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

  // Crossfade between resizable layouts on desktop. Stack fallback (mobile
  // or plain stack callers) renders directly — no swap animation needed.
  const watchContent = useResizableLayout ? (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={activeLayout}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="h-full min-h-0"
      >
        {useSideBySide ? sideBySideContent : topBottomContent}
      </motion.div>
    </AnimatePresence>
  ) : (
    stackContent
  );

  // ─── DialogContent shape ─────────────────────────────────────────
  // Resizable layouts require a fixed height so ResizablePanelGroup has a
  // known container to distribute. Stack uses max-h + overflow-y-auto so
  // short content doesn't leave dead space.
  //
  // When the side nav arrows are shown (desktop resizable layouts only)
  // the dialog switches to overflow-visible: the arrows straddle its outer
  // edges and overflow-hidden would clip them. Every direct child manages
  // its own clipping (the panel groups are rounded + overflow-hidden
  // themselves), so nothing else escapes. The mobile stack fallback keeps
  // overflow-hidden — it has no side arrows (swipe instead).
  const dialogContentClass = isResizable
    ? `w-[95vw] sm:max-w-5xl md:max-w-6xl lg:max-w-7xl xl:max-w-[1600px] 2xl:max-w-[1800px] h-[95vh] flex flex-col ${
        navigation && useResizableLayout ? 'overflow-visible' : 'overflow-hidden'
      }`
    : 'w-[95vw] sm:max-w-5xl md:max-w-6xl lg:max-w-7xl xl:max-w-[1600px] 2xl:max-w-[1800px] max-h-[95vh] overflow-y-auto overflow-x-hidden';

  const showLayoutToggle = isResizable && isDesktop;
  // The toggle lives next to the tab list when tabs are shown, and in
  // the header otherwise, so it's always visible without duplicating.
  const showToggleInHeader = showLayoutToggle && !notesSlot;
  const showToggleInTabsRow = showLayoutToggle && !!notesSlot;
  const headerHasContent = headerTitle || headerSubtitle || showToggleInHeader;

  const outsideHandlers = {
    onPointerDownOutside: (e) => {
      if (preventClose || isResizingRef.current) e.preventDefault();
    },
    onInteractOutside: (e) => {
      if (preventClose || isResizingRef.current) e.preventDefault();
    },
  };

  // ─── Prev/next media navigation (UI) ─────────────────────────────
  // Desktop resizable layouts get lightbox-style arrows straddling the
  // dialog's outer edges (half outside the modal — the dialog only has a
  // ~2.5vw gutter on lg screens, so fully-outside arrows would fall off
  // the viewport) plus an "n of N" pill. The stack layout (mobile
  // fallback and plain-stack callers) renders NO navigation chrome at
  // all — flipping is purely by horizontal swipe.
  const navArrowClass =
    'flex items-center justify-center h-11 w-11 rounded-full border bg-background/95 shadow-lg ' +
    'text-foreground transition-all hover:bg-background hover:shadow-xl ' +
    'disabled:opacity-30 disabled:pointer-events-none cursor-pointer ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const sideNav = navigation && useResizableLayout ? (
    <>
      <button
        type="button"
        aria-label="Previous media"
        title="Previous media (←)"
        disabled={!navigation.hasPrev}
        onClick={navigation.onPrev}
        className={cn(navArrowClass, 'absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50')}
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        aria-label="Next media"
        title="Next media (→)"
        disabled={!navigation.hasNext}
        onClick={navigation.onNext}
        className={cn(navArrowClass, 'absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 z-50')}
      >
        <ChevronRight size={22} />
      </button>
      <div
        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none
          rounded-full border bg-background/90 shadow-sm px-3 py-1 text-xs font-medium text-muted-foreground"
      >
        {navigation.index + 1} of {navigation.total}
      </div>
    </>
  ) : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent
        className={dialogContentClass}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        {...outsideHandlers}
      >
        {headerHasContent && (
          <DialogHeader
            className={cn(
              isResizable && 'shrink-0',
              // shadcn's DialogHeader centers text on mobile
              // (text-center sm:text-left) — keep it left-aligned at
              // every size so titles read cleanly next to the X button.
              'text-left',
              // Leave clearance for the toggle (only when it lives in the
              // header) and always for the auto-injected X close button.
              showToggleInHeader ? 'pr-24 sm:pr-28' : 'pr-8 sm:pr-10'
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                {headerTitle && <DialogTitle>{headerTitle}</DialogTitle>}
                {headerSubtitle && <DialogDescription>{headerSubtitle}</DialogDescription>}
              </div>
              {showToggleInHeader && (
                <LayoutToggle value={activeLayout} onChange={setPreferredLayout} />
              )}
            </div>
          </DialogHeader>
        )}

        {sideNav}

        {notesSlot ? (
          <Tabs defaultValue="watch" className="w-full flex-1 flex flex-col min-h-0">
            <div className="flex items-center gap-2 shrink-0">
              <TabsList className="grid flex-1 grid-cols-2">
                <TabsTrigger value="watch">Watch</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>
              {showToggleInTabsRow && (
                <LayoutToggle value={activeLayout} onChange={setPreferredLayout} />
              )}
            </div>
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
