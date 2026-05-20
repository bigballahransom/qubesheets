'use client';

// components/sheets/RoomTagPopover.tsx
//
// Portaled "Tag room" picker. Triggered from the room header strip in the
// inventory spreadsheet's By-Room view and applies a single tag to every
// item in the room. Layout-wise it matches TagsCell's popover so the two
// pickers feel like siblings — same width, same applied/search/list/create
// structure, just adapted for a bulk action.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, Plus, Search, Sparkles, Tags as TagsIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tagStyleFor } from '@/lib/tagColors';

const POPOVER_WIDTH = 340;
const POPOVER_MAX_HEIGHT = 460;

export type RoomTagPopoverProps = {
  anchor: HTMLElement | null;
  roomName: string;
  itemCount: number;
  // Org-library tag names (saved to OrganizationSettings.smartTags).
  orgTags: string[];
  // One-off tags applied to other rows in this project but not in the org
  // library. Surfaced under "In this project" so the user can reuse them
  // without retyping.
  projectTags: string[];
  onApply: (roomName: string, tagName: string) => void;
  onClose: () => void;
};

export default function RoomTagPopover({
  anchor,
  roomName,
  itemCount,
  orgTags,
  projectTags,
  onApply,
  onClose
}: RoomTagPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [position, setPosition] = useState<
    | { placement: 'below'; top: number; left: number }
    | { placement: 'above'; bottom: number; left: number }
    | null
  >(null);
  const [search, setSearch] = useState('');

  // Anchor the popover to the trigger. When there's no room below, flip
  // above by pinning the popover's bottom edge so it stays flush against
  // the trigger regardless of its rendered height.
  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const spaceBelow = viewportH - rect.bottom;
    const placeBelow =
      spaceBelow >= POPOVER_MAX_HEIGHT + 16 || spaceBelow >= rect.top;

    let left = rect.right - POPOVER_WIDTH; // right-align to trigger by default
    if (left < 8) left = Math.max(8, rect.left);
    if (left + POPOVER_WIDTH > viewportW - 8) {
      left = Math.max(8, viewportW - POPOVER_WIDTH - 8);
    }

    if (placeBelow) {
      setPosition({ placement: 'below', top: rect.bottom + 6, left });
    } else {
      setPosition({
        placement: 'above',
        bottom: viewportH - rect.top + 6,
        left
      });
    }
  }, [anchor]);

  // Outside-click / ESC.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      if (anchor && anchor.contains(e.target as Node)) return;
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [anchor, onClose]);

  // Autofocus the search input.
  useEffect(() => {
    if (position) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [position]);

  const filteredOrg = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgTags;
    return orgTags.filter((t) => t.toLowerCase().includes(q));
  }, [orgTags, search]);

  // Project-only tags excluding anything also in the org library (defensive
  // — Spreadsheet.jsx already dedupes, but a stale prop window could still
  // double-list a tag mid-promotion).
  const filteredProject = useMemo(() => {
    const orgSet = new Set(orgTags.map((t) => t.toLowerCase()));
    const q = search.trim().toLowerCase();
    return projectTags
      .filter((name) => !orgSet.has(name.toLowerCase()))
      .filter((name) => (q ? name.toLowerCase().includes(q) : true));
  }, [orgTags, projectTags, search]);

  const exactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const inOrg = orgTags.find((t) => t.toLowerCase() === q);
    if (inOrg) return inOrg;
    const inProject = projectTags.find((t) => t.toLowerCase() === q);
    return inProject ?? null;
  }, [orgTags, projectTags, search]);

  const apply = useCallback(
    (name: string) => {
      const trimmed = (name || '').trim();
      if (!trimmed) return;
      onApply(roomName, trimmed);
    },
    [onApply, roomName]
  );

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = search.trim();
      if (!q) return;
      apply(exactMatch ?? q);
    }
  };

  if (!position) return null;

  const style: React.CSSProperties = {
    width: POPOVER_WIDTH,
    maxHeight: POPOVER_MAX_HEIGHT,
    left: position.left,
    ...(position.placement === 'below'
      ? { top: position.top }
      : { bottom: position.bottom })
  };

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[60] rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden flex flex-col"
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <TagsIcon className="h-3.5 w-3.5 text-gray-500 shrink-0" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Tag every item in
            </span>
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-gray-900">
            {roomName}
          </div>
          <div className="text-[11px] text-gray-500">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="Search or create a tag…"
            maxLength={40}
            className="w-full rounded-md border border-gray-200 bg-gray-50 pl-7 pr-2 py-1.5 text-xs placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {/* Organization tags */}
        <div className="px-1.5 pt-1 pb-1 flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-gray-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Organization tags
          </span>
          <span className="ml-auto text-[10px] text-gray-400">
            {orgTags.length}
          </span>
        </div>

        {filteredOrg.length === 0 ? (
          <div className="px-2 py-2 text-xs text-gray-400 italic">
            {orgTags.length === 0 ? 'No saved tags yet.' : 'No matching tags.'}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filteredOrg.map((name) => (
              <TagApplyRow
                key={`org-${name.toLowerCase()}`}
                name={name}
                itemCount={itemCount}
                onApply={() => apply(name)}
              />
            ))}
          </ul>
        )}

        {/* In this project */}
        {filteredProject.length > 0 && (
          <>
            <div className="px-1.5 pt-3 pb-1 flex items-center gap-1">
              <Folder className="h-3 w-3 text-gray-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                In this project
              </span>
              <span className="ml-auto text-[10px] text-gray-400">
                {filteredProject.length}
              </span>
            </div>
            <ul className="space-y-0.5">
              {filteredProject.map((name) => (
                <TagApplyRow
                  key={`proj-${name.toLowerCase()}`}
                  name={name}
                  itemCount={itemCount}
                  hint="one-off"
                  onApply={() => apply(name)}
                />
              ))}
            </ul>
          </>
        )}

        {/* Create new */}
        {search.trim() && !exactMatch && (
          <div className="mt-1.5 mx-1 p-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              Create &amp; apply
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              <PreviewChip name={search.trim()} />
              <span className="text-[10px] text-gray-400">
                will be applied to every item
              </span>
            </div>
            <button
              type="button"
              onClick={() => apply(search)}
              className="w-full inline-flex items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 text-[11px] font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Apply &quot;{search.trim()}&quot; to {itemCount}{' '}
              {itemCount === 1 ? 'item' : 'items'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function PreviewChip({ name }: { name: string }) {
  const palette = tagStyleFor(name);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border text-[11px] font-medium px-2 py-0.5 leading-none truncate max-w-[180px]',
        palette.bg,
        palette.text,
        palette.border
      )}
    >
      {name}
    </span>
  );
}

function TagApplyRow({
  name,
  itemCount,
  hint,
  onApply
}: {
  name: string;
  itemCount: number;
  hint?: string;
  onApply: () => void;
}) {
  const palette = tagStyleFor(name);
  return (
    <li>
      <button
        type="button"
        onClick={onApply}
        className="group w-full flex items-center gap-1.5 rounded-md px-1.5 py-1 cursor-pointer hover:bg-gray-50 transition-colors text-left"
      >
        <span
          className={cn(
            'inline-flex items-center rounded-full border text-[11px] font-medium px-2 py-0.5 leading-none truncate max-w-[200px]',
            palette.bg,
            palette.text,
            palette.border
          )}
        >
          {name}
        </span>
        {hint && (
          <span className="text-[10px] text-gray-400 italic ml-1 truncate">
            {hint}
          </span>
        )}
        <span className="ml-auto text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
          Apply to {itemCount}
        </span>
      </button>
    </li>
  );
}
