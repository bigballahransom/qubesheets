'use client';

// components/sheets/TagsCell.tsx
//
// Modern Tag picker for the inventory spreadsheet's "Tags" column.
//
// Display:
//   - Shows the row's applied tags as compact colored chips.
//   - Empty cells show a faint "+ Add tags" placeholder.
//
// Editor (popover):
//   - Header chips: currently applied tags, each removable via the × button.
//   - Search input: filters the org's saved Smart Tags by name.
//   - Org tag list: click to toggle (checkmark when applied). Hover reveals
//     inline edit (pencil) and delete (trash) — both atomic.
//   - When the search input has no exact match, shows two creation paths:
//       1) "Add to item" — one-off tag, lives only on this item.
//       2) "Save to library" — also POSTs to /api/settings/smart-tags/add
//          so the rest of the org sees it next time.
//   - Footer link to /settings/smart-tags for the full management UI.
//
// Persistence:
//   - Tag membership on the item is persisted via PATCH on the inventory
//     item (`{ tags: [...] }`).
//   - Org tag CRUD uses the atomic /add and /[tagId] endpoints so multiple
//     cells editing simultaneously don't clobber each other.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Folder,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  parseTagsCell,
  stringifyTags,
  tagStyleFor
} from '@/lib/tagColors';
import { toast } from 'sonner';

type OrgTag = { id: string; name: string; description: string };

type TagsCellProps = {
  value: string; // comma-separated tags from the spreadsheet cell
  rowId: string;
  inventoryItemId?: string | null;
  projectId?: string | null;
  // Tag names that exist on other rows in this project but aren't in the
  // org Smart Tag library yet (one-offs). Surfaced as quick-pick suggestions
  // and can be promoted to the org library inline.
  projectTags?: string[];
  onTagsChange?: (rowId: string, tags: string[]) => void;
  readOnly?: boolean;
};

const POPOVER_WIDTH = 340;
const POPOVER_MAX_HEIGHT = 460;

export default function TagsCell({
  value,
  rowId,
  inventoryItemId,
  projectId,
  projectTags = [],
  onTagsChange,
  readOnly = false
}: TagsCellProps) {
  const appliedTags = useMemo(() => parseTagsCell(value), [value]);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  return (
    <>
      <div
        ref={triggerRef}
        role="button"
        tabIndex={readOnly ? -1 : 0}
        onClick={(e) => {
          if (readOnly) return;
          e.stopPropagation();
          setIsOpen(true);
        }}
        onKeyDown={(e) => {
          if (readOnly) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
        className={cn(
          // Single-row chips with overflow clipped to keep the row at the
          // shared 40px height. The popover on click is the canonical way to
          // see/edit the full list; hovering shows the full list as a native
          // tooltip via the `title` attribute below.
          'group flex items-center gap-1 flex-nowrap h-[36px] px-1.5 py-1 -mx-2 -my-2 rounded transition-colors overflow-hidden',
          !readOnly && 'cursor-pointer hover:bg-blue-50/40'
        )}
        title={appliedTags.length > 0 ? appliedTags.join(', ') : undefined}
      >
        {appliedTags.length === 0 ? (
          <span className="text-xs text-gray-400 group-hover:text-gray-600 transition-colors">
            + Add tags
          </span>
        ) : (
          appliedTags.map((t) => (
            <span key={t} className="shrink-0">
              <TagChip name={t} />
            </span>
          ))
        )}
      </div>

      {isOpen && (
        <TagsPopover
          anchor={triggerRef.current}
          appliedTags={appliedTags}
          projectTags={projectTags}
          onClose={() => setIsOpen(false)}
          onAppliedTagsChange={(next) => {
            onTagsChange?.(rowId, next);
            persistItemTags(projectId, inventoryItemId, next);
          }}
        />
      )}
    </>
  );
}

function TagChip({
  name,
  onRemove,
  size = 'sm'
}: {
  name: string;
  onRemove?: () => void;
  size?: 'xs' | 'sm';
}) {
  const style = tagStyleFor(name);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium leading-none',
        style.bg,
        style.text,
        style.border,
        size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
      )}
    >
      <span className="truncate max-w-[140px]">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            'inline-flex items-center justify-center rounded-full -mr-0.5',
            'h-3.5 w-3.5 hover:bg-black/10 transition-colors'
          )}
          aria-label={`Remove ${name}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

function TagsPopover({
  anchor,
  appliedTags,
  projectTags,
  onClose,
  onAppliedTagsChange
}: {
  anchor: HTMLElement | null;
  appliedTags: string[];
  projectTags: string[];
  onClose: () => void;
  onAppliedTagsChange: (next: string[]) => void;
}) {
  // When placing below the trigger we pin `top`. When placing above we pin
  // `bottom` so the popover always sits flush against the trigger regardless
  // of how tall its actual content is — pinning `top` with a height
  // assumption left a big visual gap when the popover rendered shorter than
  // POPOVER_MAX_HEIGHT.
  const [position, setPosition] = useState<
    | { placement: 'below'; top: number; left: number }
    | { placement: 'above'; bottom: number; left: number }
    | null
  >(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [orgTags, setOrgTags] = useState<OrgTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<string | null>(null);

  const applied = appliedTags;
  const appliedLower = useMemo(
    () => new Set(applied.map((t) => t.toLowerCase())),
    [applied]
  );

  // Position the popover next to the trigger, flipping vertically if there's
  // no room below. When flipping above we pin the popover's bottom edge to
  // just above the trigger so it grows upward — pinning `top` instead would
  // assume the popover renders at its max height and leave a visible gap
  // when it doesn't.
  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const spaceBelow = viewportH - rect.bottom;
    const placeBelow = spaceBelow >= POPOVER_MAX_HEIGHT + 16 || spaceBelow >= rect.top;

    let left = rect.left;
    if (left + POPOVER_WIDTH > viewportW - 8) {
      left = Math.max(8, viewportW - POPOVER_WIDTH - 8);
    }

    if (placeBelow) {
      setPosition({ placement: 'below', top: rect.bottom + 6, left });
    } else {
      setPosition({ placement: 'above', bottom: viewportH - rect.top + 6, left });
    }
  }, [anchor]);

  // Close on outside click / ESC.
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

  // Load org tags + autofocus search.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/smart-tags');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setOrgTags(Array.isArray(data.smartTags) ? data.smartTags : []);
        }
      } catch (e) {
        console.error('Failed to load org tags:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (position) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [position]);

  const filteredOrgTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgTags;
    return orgTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [orgTags, search]);

  // Project-scoped one-off tags, with anything already in the org library
  // filtered out (orgTags is the freshest copy — promotions during this
  // session move tags out of "In this project" automatically).
  const visibleProjectTags = useMemo(() => {
    const orgSet = new Set(orgTags.map((t) => t.name.toLowerCase()));
    const q = search.trim().toLowerCase();
    return projectTags
      .filter((name) => !orgSet.has(name.toLowerCase()))
      .filter((name) => (q ? name.toLowerCase().includes(q) : true));
  }, [orgTags, projectTags, search]);

  const exactMatchInOrg = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return orgTags.find((t) => t.name.toLowerCase() === q) ?? null;
  }, [orgTags, search]);

  const exactMatchInProject = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return (
      visibleProjectTags.find((name) => name.toLowerCase() === q) ?? null
    );
  }, [visibleProjectTags, search]);

  const exactMatchInApplied = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    return appliedLower.has(q);
  }, [appliedLower, search]);

  const toggleApplied = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (appliedLower.has(lower)) {
        onAppliedTagsChange(applied.filter((t) => t.toLowerCase() !== lower));
      } else {
        onAppliedTagsChange([...applied, trimmed]);
      }
    },
    [applied, appliedLower, onAppliedTagsChange]
  );

  const removeApplied = useCallback(
    (name: string) => {
      const lower = name.toLowerCase();
      onAppliedTagsChange(applied.filter((t) => t.toLowerCase() !== lower));
    },
    [applied, onAppliedTagsChange]
  );

  const addOneOff = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      if (appliedLower.has(trimmed.toLowerCase())) return;
      onAppliedTagsChange([...applied, trimmed]);
      setSearch('');
    },
    [applied, appliedLower, onAppliedTagsChange]
  );

  const saveToLibrary = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setPendingSave(trimmed);
      try {
        const res = await fetch('/api/settings/smart-tags/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save tag');
        }
        const data = await res.json();
        if (Array.isArray(data.smartTags)) setOrgTags(data.smartTags);

        // Apply it to the item too.
        if (!appliedLower.has(trimmed.toLowerCase())) {
          onAppliedTagsChange([...applied, trimmed]);
        }
        setSearch('');
        toast.success(
          data.alreadyExisted
            ? `"${trimmed}" was already in your library — added to item.`
            : `Saved "${trimmed}" to your library.`
        );
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : 'Failed to save tag.');
      } finally {
        setPendingSave(null);
      }
    },
    [applied, appliedLower, onAppliedTagsChange]
  );

  const renameOrgTag = useCallback(
    async (id: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return false;
      const current = orgTags.find((t) => t.id === id);
      if (!current) return false;
      if (current.name === trimmed) {
        setEditingTagId(null);
        return true;
      }
      try {
        const res = await fetch(`/api/settings/smart-tags/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to rename tag');
        }
        const data = await res.json();
        if (Array.isArray(data.smartTags)) setOrgTags(data.smartTags);

        // If the tag was applied to this row, rename it on the row too.
        if (appliedLower.has(current.name.toLowerCase())) {
          onAppliedTagsChange(
            applied.map((t) =>
              t.toLowerCase() === current.name.toLowerCase() ? trimmed : t
            )
          );
        }
        setEditingTagId(null);
        return true;
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : 'Failed to rename.');
        return false;
      }
    },
    [orgTags, applied, appliedLower, onAppliedTagsChange]
  );

  const deleteOrgTag = useCallback(
    async (id: string) => {
      const current = orgTags.find((t) => t.id === id);
      if (!current) return;
      const confirmed = window.confirm(
        `Delete "${current.name}" from your organization's tag library? Items already tagged with it will keep the tag as a one-off.`
      );
      if (!confirmed) return;
      try {
        const res = await fetch(`/api/settings/smart-tags/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to delete tag');
        }
        const data = await res.json();
        if (Array.isArray(data.smartTags)) setOrgTags(data.smartTags);
        toast.success(`Deleted "${current.name}" from library.`);
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : 'Failed to delete.');
      }
    },
    [orgTags]
  );

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = search.trim();
      if (!q) return;
      if (exactMatchInOrg) {
        if (!appliedLower.has(exactMatchInOrg.name.toLowerCase())) {
          toggleApplied(exactMatchInOrg.name);
        }
        setSearch('');
        return;
      }
      if (exactMatchInProject) {
        if (!appliedLower.has(exactMatchInProject.toLowerCase())) {
          toggleApplied(exactMatchInProject);
        }
        setSearch('');
        return;
      }
      addOneOff(q);
    }
  };

  if (!position) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[60] rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden flex flex-col"
      style={{
        ...(position.placement === 'below'
          ? { top: position.top }
          : { bottom: position.bottom }),
        left: position.left,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_MAX_HEIGHT
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Applied tags */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Applied
          </span>
          {applied.length > 0 && (
            <button
              type="button"
              onClick={() => onAppliedTagsChange([])}
              className="text-[10px] text-gray-400 hover:text-red-600 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
        {applied.length === 0 ? (
          <div className="text-xs text-gray-400 italic">No tags yet</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {applied.map((t) => (
              <TagChip key={t} name={t} onRemove={() => removeApplied(t)} />
            ))}
          </div>
        )}
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
            onKeyDown={handleSearchKeyDown}
            placeholder="Search or create a tag…"
            maxLength={40}
            className="w-full rounded-md border border-gray-200 bg-gray-50 pl-7 pr-2 py-1.5 text-xs placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Org tag list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        <div className="px-1.5 pt-1 pb-1 flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-gray-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Organization tags
          </span>
          <span className="ml-auto text-[10px] text-gray-400">
            {orgTags.length}
          </span>
        </div>

        {loading ? (
          <div className="px-2 py-3 text-xs text-gray-400">Loading…</div>
        ) : filteredOrgTags.length === 0 ? (
          <div className="px-2 py-3 text-xs text-gray-400 italic">
            {orgTags.length === 0
              ? 'No saved tags in your library yet.'
              : 'No matching tags.'}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filteredOrgTags.map((tag) => {
              const isApplied = appliedLower.has(tag.name.toLowerCase());
              const isEditing = editingTagId === tag.id;
              return (
                <li key={tag.id}>
                  {isEditing ? (
                    <TagInlineEditor
                      initial={tag}
                      onCancel={() => setEditingTagId(null)}
                      onSave={(newName) => renameOrgTag(tag.id, newName)}
                    />
                  ) : (
                    <TagListRow
                      tag={tag}
                      applied={isApplied}
                      onToggle={() => toggleApplied(tag.name)}
                      onEdit={() => setEditingTagId(tag.id)}
                      onDelete={() => deleteOrgTag(tag.id)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* In-this-project section: one-off tags found on other rows
            (not in the org library yet). Hidden when the project has none
            that match the current search. */}
        {visibleProjectTags.length > 0 && (
          <>
            <div className="px-1.5 pt-3 pb-1 flex items-center gap-1">
              <Folder className="h-3 w-3 text-gray-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                In this project
              </span>
              <span className="ml-auto text-[10px] text-gray-400">
                {visibleProjectTags.length}
              </span>
            </div>
            <ul className="space-y-0.5">
              {visibleProjectTags.map((name) => {
                const isApplied = appliedLower.has(name.toLowerCase());
                const isPromoting = pendingSave === name;
                return (
                  <li key={`project-${name.toLowerCase()}`}>
                    <ProjectTagRow
                      name={name}
                      applied={isApplied}
                      promoting={isPromoting}
                      onToggle={() => toggleApplied(name)}
                      onPromote={() => saveToLibrary(name)}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* Create section */}
        {search.trim() &&
          !exactMatchInOrg &&
          !exactMatchInProject &&
          !exactMatchInApplied && (
          <div className="mt-1.5 mx-1 p-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              Create new
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              <TagChip name={search.trim()} />
              <span className="text-[10px] text-gray-400">preview</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => addOneOff(search)}
                className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                title="Apply to this item only — not saved to your org library"
              >
                <Plus className="h-3 w-3" /> Add to item
              </button>
              <button
                type="button"
                onClick={() => saveToLibrary(search)}
                disabled={pendingSave === search.trim()}
                className={cn(
                  'inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors',
                  pendingSave === search.trim()
                    ? 'bg-blue-400 text-white cursor-wait'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                )}
                title="Save to your org library and apply to this item"
              >
                <Sparkles className="h-3 w-3" />
                {pendingSave === search.trim() ? 'Saving…' : 'Save to library'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/60">
        <a
          href="/settings/smart-tags"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-900 transition-colors"
        >
          <Settings2 className="h-3 w-3" />
          Manage all tags
        </a>
      </div>
    </div>,
    document.body
  );
}

function TagListRow({
  tag,
  applied,
  onToggle,
  onEdit,
  onDelete
}: {
  tag: OrgTag;
  applied: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const style = tagStyleFor(tag.name);
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-md px-1.5 py-1 cursor-pointer transition-colors',
        applied ? 'bg-blue-50/60' : 'hover:bg-gray-50'
      )}
      onClick={onToggle}
      title={tag.description || undefined}
    >
      <div
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded border shrink-0 transition-colors',
          applied
            ? 'bg-blue-600 border-blue-600 text-white'
            : 'border-gray-300 bg-white text-transparent'
        )}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </div>

      <span
        className={cn(
          'inline-flex items-center rounded-full border text-[11px] font-medium px-2 py-0.5 leading-none truncate max-w-[160px]',
          style.bg,
          style.text,
          style.border
        )}
      >
        {tag.name}
      </span>

      {tag.description && (
        <span className="text-[10px] text-gray-400 truncate flex-1 ml-1">
          {tag.description}
        </span>
      )}

      <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          aria-label={`Edit ${tag.name}`}
          title="Rename"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
          aria-label={`Delete ${tag.name}`}
          title="Delete from library"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function ProjectTagRow({
  name,
  applied,
  promoting,
  onToggle,
  onPromote
}: {
  name: string;
  applied: boolean;
  promoting: boolean;
  onToggle: () => void;
  onPromote: () => void;
}) {
  const style = tagStyleFor(name);
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded-md px-1.5 py-1 cursor-pointer transition-colors',
        applied ? 'bg-blue-50/60' : 'hover:bg-gray-50'
      )}
      onClick={onToggle}
      title="Used elsewhere in this project. Click to apply, or save to your org library."
    >
      <div
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded border shrink-0 transition-colors',
          applied
            ? 'bg-blue-600 border-blue-600 text-white'
            : 'border-gray-300 bg-white text-transparent'
        )}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </div>

      <span
        className={cn(
          'inline-flex items-center rounded-full border text-[11px] font-medium px-2 py-0.5 leading-none truncate max-w-[160px]',
          style.bg,
          style.text,
          style.border
        )}
      >
        {name}
      </span>

      <span className="text-[10px] text-gray-400 italic ml-1 truncate flex-1">
        one-off in this project
      </span>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!promoting) onPromote();
        }}
        disabled={promoting}
        className={cn(
          'ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
          'opacity-0 group-hover:opacity-100 focus:opacity-100',
          promoting
            ? 'bg-blue-100 text-blue-600 cursor-wait'
            : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
        )}
        title="Save to your organization's tag library"
      >
        <Sparkles className="h-3 w-3" />
        {promoting ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function TagInlineEditor({
  initial,
  onSave,
  onCancel
}: {
  initial: OrgTag;
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await onSave(name);
    setSaving(false);
    if (!ok) {
      ref.current?.focus();
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-md px-1.5 py-1 bg-gray-50 border border-gray-200">
      <input
        ref={ref}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        maxLength={40}
        className="flex-1 min-w-0 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
      <button
        type="button"
        onClick={commit}
        disabled={saving}
        className="inline-flex h-5 px-1.5 items-center justify-center rounded bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-500 hover:bg-gray-200"
        aria-label="Cancel"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

async function persistItemTags(
  projectId: string | null | undefined,
  inventoryItemId: string | null | undefined,
  tags: string[]
) {
  if (!projectId || !inventoryItemId) return;
  try {
    const res = await fetch(
      `/api/projects/${projectId}/inventory/${inventoryItemId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags })
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Failed to persist tags:', err);
      toast.error('Failed to save tags.');
    }
  } catch (e) {
    console.error('Failed to persist tags:', e);
    toast.error('Failed to save tags.');
  }
}

// Helper re-exported for callers that need to round-trip a cell value.
export { stringifyTags };
