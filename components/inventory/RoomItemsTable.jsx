'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Pencil, Info, ChevronDown, Tags as TagsIcon } from 'lucide-react';
import { toast } from 'sonner';
import SpreadsheetTagsCell, { stringifyTags } from '@/components/sheets/TagsCell';
import { useInventoryItemWriter } from '@/lib/inventory/useInventoryItemWriter';
import { useInventoryWrites } from '@/lib/inventory/InventoryWritesContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

const PACKED_BY_OPTIONS = ['N/A', 'PBO', 'CP', 'Crated'];

/**
 * Per-room compact table of inventory items, mirroring the main inventory
 * spreadsheet's by-room view. Each row is the same item (not per-instance),
 * with inline-editable cells for the highest-frequency edits and a trailing
 * popover for the long-tail (name, location, special handling, delete, ...).
 *
 * Columns: Item · Qty · Cuft (total) · Wt (total) · Going · Pack · Tags · ▾
 *
 * Every cell change PATCHes the InventoryItem endpoint and then calls
 * onInventoryUpdate so the parent refetches and re-renders.
 */
export default function RoomItemsTable({
  items,
  projectId,
  onInventoryUpdate,
  availableRooms = [],
  projectTags = [],
  // Optional pre-loaded org Smart Tags so each row's TagsCell skips its
  // own /api/settings/smart-tags fetch. Forwarded straight to TagsCell.
  orgTags = null,
  onSeek,
}) {
  if (!items?.length) return null;

  return (
    <div className="border border-gray-200 rounded-md overflow-x-auto bg-white">
      {/* min-w gives the table its natural width so cells don't squish when
          the right resizable panel is narrow — instead the user scrolls
          this container horizontally to reach the rightmost cells. */}
      <table className="w-full min-w-[960px] text-sm border-collapse">
        <thead>
          <tr className="bg-white text-left text-sm font-medium text-gray-700">
            {/* Headers mirror the inventory spreadsheet's header row
                (Spreadsheet.jsx ~2794-2828): same leading icon/badge per
                column type (🏢 / # / Σ / 📋 / Tags) and same label text
                (Count / Cuft / Weight / Going / PBO/CP / Tags). Width
                allocations stay modal-tight; the spreadsheet's column-
                action chevrons (Cuft/Weight display-mode toggle, PBO/CP
                bulk apply) are spreadsheet-only — they'd misrepresent
                table-local state if planted here. */}
            {/* Column widths mirror Spreadsheet.jsx:58 (`getColumnWidth`)
                exactly — numeric/select columns fixed at 120 px (the
                spreadsheet's `w-30 min-w-[120px]`), Item & Tags grow to
                fill remaining space (matches the spreadsheet's `w-60`
                default for text columns). */}
            <ColumnHeader icon="🏢">Item</ColumnHeader>
            <ColumnHeader badge="#" width="w-[120px] min-w-[120px]">Count</ColumnHeader>
            <ColumnHeader badge="Σ" width="w-[120px] min-w-[120px]">Cuft</ColumnHeader>
            <ColumnHeader badge="Σ" width="w-[120px] min-w-[120px]">Weight</ColumnHeader>
            <ColumnHeader icon="📋" width="w-[120px] min-w-[120px]">Going</ColumnHeader>
            <ColumnHeader icon="📋" width="w-[120px] min-w-[120px]">PBO/CP</ColumnHeader>
            <ColumnHeader icon={<TagsIcon className="w-3.5 h-3.5 text-gray-500" strokeWidth={2} />} width="w-60 min-w-[150px]">Tags</ColumnHeader>
            {/* Delete column header — matches Spreadsheet.jsx:2974's
                trash glyph above each row's X delete button. */}
            <th className="p-2 border-b border-gray-200 w-10 text-center">
              <span className="text-gray-400 text-sm">🗑️</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ItemRow
              key={item._id}
              item={item}
              projectId={projectId}
              onInventoryUpdate={onInventoryUpdate}
              availableRooms={availableRooms}
              projectTags={projectTags}
              orgTags={orgTags}
              onSeek={onSeek}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Header cell — mirrors `Spreadsheet.jsx`'s column-header layout: leading
// type indicator (badge for numeric columns: `#` / `Σ` / `/1`; emoji or
// Lucide icon for selects / tags / company), then the column name. `align`
// defaults to centered (matches the modal's tight inline-edit layout); the
// Item column passes `left` so the name still hugs the row's leading edge.
function ColumnHeader({ children, badge, icon, width = '' }) {
  // Default to left-aligned to mirror the inventory spreadsheet's header
  // row (Spreadsheet.jsx:2805): badge/icon + label sit at the leading edge
  // of the cell, not centered. Cell-body alignment is unchanged — that's
  // driven per <td> below.
  return (
    <th className={`p-2 border-r border-b border-gray-200 text-left ${width}`}>
      <div className="flex items-center gap-1.5 justify-start">
        {badge && (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs font-semibold">
            {badge}
          </span>
        )}
        {icon && (typeof icon === 'string'
          ? <span className="text-sm">{icon}</span>
          : icon)}
        <span>{children}</span>
      </div>
    </th>
  );
}

function ItemRow({ item: itemProp, projectId, onInventoryUpdate, availableRooms, projectTags, orgTags, onSeek }) {
  const itemId = itemProp._id;
  const apiBase = `/api/projects/${projectId || itemProp.projectId}/inventory/${itemId}`;

  // The writer hook now owns this row's optimistic state, the debounced /
  // single-flight PATCH queue, prop-reconciliation (adopt-only-when-clean),
  // error revert, and dirty-signal plumbing. Cell editors all call
  // `writer.set(...)`; render values come from `writer.state`.
  const { markDirty, markClean, mergeUpdatedItem } = useInventoryWrites();
  const writer = useInventoryItemWriter({
    item: itemProp,
    projectId,
    onCommitted: (updated) => {
      // Push the server's authoritative item back up so the parent's
      // inventoryItems is single-source-of-truth, no full refetch needed.
      // We intentionally do NOT call onInventoryUpdate here: that callback
      // is bound to handleInventoryUpdate(itemId, newGoingQuantity, newQty)
      // — which expects a NUMBER as arg 2 and would corrupt the parent's
      // inventoryItems[*].goingQuantity if we passed the updated object. The
      // mergeUpdatedItem call above already gives every surface (spreadsheet,
      // other modal rows, header counts) the canonical update.
      if (mergeUpdatedItem) mergeUpdatedItem(updated);
    },
    markDirty,
    markClean,
  });

  const item = writer.state;
  const patchNow = (changes) => writer.set(changes, { immediate: true });

  const quantity = Math.max(1, item.quantity || 1);
  const totalCuft = Number(item.cuft) || 0;
  const totalWeight = Number(item.weight) || 0;
  const goingQuantity = deriveGoingQuantity(item);
  const packedBy = item.packed_by || 'N/A';
  const tags = Array.isArray(item.tags) ? item.tags : [];

  // Cuft-edit modal state. Mirrors the inventory spreadsheet's pattern:
  // pencil icon on the Cuft cell opens a dialog where the user edits
  // PER-UNIT cuft and chooses how weight reacts.
  const [editCuftOpen, setEditCuftOpen] = useState(false);

  // Quantity inc/dec — functional `set` reads the writer's latest stateRef,
  // so rapid `+` clicks compute the next value off the fresh optimistic
  // state, not a stale render-time closure. Going-quantity rule matches the
  // spreadsheet exactly: any qty change → all going.
  // (Spreadsheet.jsx#calculateNewGoingQuantity)
  const adjustQty = (delta) => {
    writer.set((prev) => {
      const prevQty = Math.max(1, prev.quantity || 1);
      const nextQty = Math.max(1, Math.min(50000, prevQty + delta));
      if (nextQty === prevQty) return null;
      const perUnitCuft = (Number(prev.cuft) || 0) / prevQty;
      const perUnitWeight = (Number(prev.weight) || 0) / prevQty;
      return {
        quantity: nextQty,
        cuft: round2(perUnitCuft * nextQty),
        weight: round2(perUnitWeight * nextQty),
        goingQuantity: nextQty,
      };
    });
  };

  const setQtyValue = (next) => {
    writer.set((prev) => {
      const prevQty = Math.max(1, prev.quantity || 1);
      const nextQty = Math.max(1, Math.min(50000, Math.floor(next)));
      if (nextQty === prevQty) return null;
      const perUnitCuft = (Number(prev.cuft) || 0) / prevQty;
      const perUnitWeight = (Number(prev.weight) || 0) / prevQty;
      return {
        quantity: nextQty,
        cuft: round2(perUnitCuft * nextQty),
        weight: round2(perUnitWeight * nextQty),
        goingQuantity: nextQty,
      };
    }, { immediate: true });
  };

  // Item-type classification — mirrors Spreadsheet.jsx#isExistingBox /
  // #isRecommendedBoxes (database field first, name-pattern fallback for
  // legacy items).
  const isExistingBox =
    item.itemType === 'existing_box' ||
    item.itemType === 'packed_box' ||
    (item.itemType === 'regular_item' && item.name &&
      (item.name.includes('Large Box') || item.name.includes('Medium Box') ||
       item.name.includes('Small Box') || item.name.includes('Existing Box')) &&
      !item.name.includes(' - '));
  const isRecommendedBoxes =
    item.itemType === 'boxes_needed' ||
    (item.itemType === 'regular_item' && item.name &&
      item.name.includes('Box') && item.name.includes(' - '));

  // Going-state classification — drives row background tint (Spreadsheet.jsx
  // :3002-3003 + :3046-3049).
  const isFullyNotGoing = goingQuantity === 0;
  const isPartial = goingQuantity > 0 && goingQuantity < quantity;

  // Heavy / hazardous / fragile predicates — verbatim from Spreadsheet.jsx
  // :1923-1943. Triggers emoji badges in the item cell.
  const lcName = (item.name || '').toLowerCase();
  const isHeavyItem = lcName && (
    lcName.includes('piano') || lcName.includes('hot tub') || lcName.includes('safe')
  );
  const isHazardousItem = !!(lcName && lcName.includes('plant'));
  const isFragileItem = !!(lcName && (
    lcName.includes('statue') || lcName.includes('picture') ||
    lcName.includes('art') || lcName.includes('mirror') ||
    lcName.includes('tv') || lcName.includes('monitor') ||
    lcName.includes('glass')
  ));

  // Row background tint priority: recommended box → existing box → fully not
  // going → partial → default. Matches Spreadsheet.jsx:3042-3052.
  const rowTint = isRecommendedBoxes
    ? 'bg-purple-50 border-l-2 border-l-purple-300'
    : isExistingBox
    ? 'bg-orange-50 border-l-2 border-l-orange-300'
    : isFullyNotGoing
    ? 'bg-red-50 border-l-2 border-l-red-300'
    : isPartial
    ? 'bg-yellow-50 border-l-2 border-l-yellow-300'
    : 'hover:bg-gray-50';

  return (
    <>
    {/* Border is owned by the cells (each <td> has `border-b border-gray-200`),
        matching the spreadsheet's per-cell border style. Putting a second
        border-b on the <tr> doubled the row separator visually. */}
    <tr className={rowTint}>
      {/* Item: seek + name (clickable → seek) + type/heavy/hazardous/fragile/
          special-handling/stock badges. Mirrors Spreadsheet.jsx item cell. */}
      <td className="p-2 border-r border-b border-gray-200 h-10 overflow-hidden">
        <div className="flex items-center gap-1 min-w-0">
          {item.videoTimestamp && onSeek && (
            <button
              type="button"
              onClick={() => onSeek(item)}
              className="p-0.5 rounded text-blue-600 hover:bg-blue-50 hover:text-blue-800 shrink-0"
              title="Find in video"
            >
              <Search className="w-3 h-3" />
            </button>
          )}

          {/* Item name — clickable to seek (like the spreadsheet's link to
              the source media). Inline-editable name moved into the popover
              to match the spreadsheet, where the cell is non-editable when
              the item is media-attached. */}
          {item.videoTimestamp && onSeek ? (
            <button
              type="button"
              onClick={() => onSeek(item)}
              className="text-blue-600 hover:text-blue-800 underline text-left truncate flex-1 min-w-0 px-1 py-0.5 rounded"
              title="Find in video"
            >
              {item.name}
            </button>
          ) : (
            <span className="truncate flex-1 min-w-0 text-gray-900 px-1 py-0.5">
              {item.name}
            </span>
          )}

          {/* Badges, in the same order as the spreadsheet renders them. */}
          <TooltipProvider delayDuration={200}>
            {isRecommendedBoxes && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-100 w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0 cursor-help">R</span>
                </TooltipTrigger>
                <TooltipContent><p>Recommended Boxes</p></TooltipContent>
              </Tooltip>
            )}
            {isExistingBox && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] font-bold text-orange-700 bg-orange-100 w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0 cursor-help">B</span>
                </TooltipTrigger>
                <TooltipContent><p>Already Packed Boxes</p></TooltipContent>
              </Tooltip>
            )}
            {isHeavyItem && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0 cursor-help">💪</span>
                </TooltipTrigger>
                <TooltipContent><p>Heavy Item</p></TooltipContent>
              </Tooltip>
            )}
            {isHazardousItem && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0 cursor-help">☢️</span>
                </TooltipTrigger>
                <TooltipContent><p>Hazardous Item</p></TooltipContent>
              </Tooltip>
            )}
            {isFragileItem && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0 cursor-help">⚠️</span>
                </TooltipTrigger>
                <TooltipContent><p>Fragile Item</p></TooltipContent>
              </Tooltip>
            )}
            {item.special_handling && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0 cursor-help">
                    <Info size={14} className="text-blue-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-medium text-xs mb-1">Special Handling:</p>
                  <p className="text-xs">{item.special_handling}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {item.stockItemId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[10px] font-bold text-green-700 bg-green-100 w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0 cursor-help">S</span>
                </TooltipTrigger>
                <TooltipContent><p>Stock Library Item</p></TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
      </td>

      {/* Quantity — rapid-clickable, debounces PATCH so the network only
          sees the final value, not one request per click. */}
      <td className="p-2 border-r border-b border-gray-200 h-10 text-center">
        <QtyCell
          value={quantity}
          onInc={() => adjustQty(1)}
          onDec={() => adjustQty(-1)}
          onCommitNumber={setQtyValue}
        />
      </td>

      {/* Cuft — display + pencil opens dialog (matches the spreadsheet's
          col4 behavior: not inline-editable; user edits per-unit cuft +
          chooses weight adjustment). */}
      <td className="p-2 border-r border-b border-gray-200 h-10 text-center">
        <div className="group flex items-center justify-center gap-1">
          <span className="text-blue-600 tabular-nums">{round2(totalCuft).toFixed(1)}</span>
          <button
            type="button"
            onClick={() => setEditCuftOpen(true)}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-gray-200 text-gray-500 transition-opacity"
            title="Edit Cuft"
            aria-label={`Edit cuft for ${item.name}`}
          >
            <Pencil className="w-3 h-3" />
          </button>
        </div>
      </td>

      {/* Weight — display only (derived from Cuft dialog's adjustment). */}
      <td className="p-2 border-r border-b border-gray-200 h-10 text-center">
        <span className="text-gray-600 tabular-nums">{round2(totalWeight).toFixed(1)}</span>
      </td>

      {/* Going dropdown — mirrors spreadsheet "not going" / "going (X/Y)" */}
      <td className="p-2 border-r border-b border-gray-200 h-10">
        <GoingSelect
          quantity={quantity}
          goingQuantity={goingQuantity}
          onChange={(gq) => gq !== goingQuantity && patchNow({ goingQuantity: gq })}
        />
      </td>

      {/* Packed by */}
      <td className="p-2 border-r border-b border-gray-200 h-10">
        <PackedBySelect
          value={packedBy}
          onChange={(v) => v !== packedBy && patchNow({ packed_by: v })}
        />
      </td>

      {/* Tags — use the spreadsheet's TagsCell so behavior (palette,
          autocomplete, org library, "in this project" suggestions, the
          popover) is identical. It PATCHes the item internally on popover
          close; we just mirror the change into local state so the row
          reflects it immediately. */}
      <td className="p-2 border-r border-b border-gray-200 h-10">
        <SpreadsheetTagsCell
          value={stringifyTags(tags)}
          rowId={itemId}
          inventoryItemId={itemId}
          projectId={projectId}
          projectTags={projectTags}
          orgTags={orgTags}
          onTagsChange={(_rowId, nextTags) => {
            // TagsCell has already PATCHed the item internally on popover
            // close. Use `replaceState` so the writer adopts the new tags
            // visually WITHOUT queuing another PATCH (avoiding a duplicate
            // write). Local UI updates instantly; the writer's next prop
            // reconciliation will accept it as canonical.
            writer.replaceState({ tags: nextTags });
            // Push the tag change up to InventoryManager.inventoryItems so
            // the spreadsheet view, the project header counts, sibling
            // modals, and the per-room totals all see the new tags on the
            // next render tick instead of waiting for the 3–30 s poll.
            // `mergeUpdatedItem` accepts a partial item — `{_id, tags}` is
            // enough; it merges by spread.
            if (mergeUpdatedItem) {
              mergeUpdatedItem({ _id: itemId, tags: nextTags });
            }
          }}
        />
      </td>

      {/* Overflow popover (Edit-item ▾) removed: every field the popover
          edited (qty, cuft, weight, going, packed-by, tags, delete) now has
          an inline cell or the X delete button next to it. The popover was
          duplicating those affordances and adding visual noise; if the user
          needs name / location edits they go through the main spreadsheet. */}

      {/* Row-level delete X — matches Spreadsheet.jsx:3147-3157. `p-2`
          to keep cell padding consistent with the other cells in the row. */}
      <td className="p-2 border-b border-gray-200 h-10 text-center">
        <button
          type="button"
          onClick={async () => {
            try {
              const res = await fetch(apiBase, { method: 'DELETE' });
              if (!res.ok) throw new Error('Delete failed');
              toast.success(`Deleted "${item.name}"`, { duration: 1500 });
              if (onInventoryUpdate) onInventoryUpdate(itemId);
            } catch (err) {
              console.error('Failed to delete item:', err);
              toast.error('Failed to delete item');
            }
          }}
          className="p-1 rounded-full hover:bg-gray-100 hover:text-red-500 inline-flex items-center justify-center text-gray-500 cursor-pointer transition-colors"
          title="Delete item"
          aria-label={`Delete ${item.name}`}
        >
          <X className="w-3 h-3" />
        </button>
      </td>
    </tr>
    <EditCuftDialog
      open={editCuftOpen}
      onClose={() => setEditCuftOpen(false)}
      item={item}
      onSave={(changes) => patchNow(changes)}
    />
    </>
  );
}

// ── Edit Cuft Dialog ───────────────────────────────────────────────────

// Mirrors the inventory spreadsheet's cuftModal (Spreadsheet.jsx:3886-4081).
// User edits PER-UNIT cuft and chooses whether weight follows proportionally
// or stays. Preview shows totals before commit. On Save we PATCH `cuft` and
// (conditionally) `weight` as totals — same shape as the spreadsheet writes.
function EditCuftDialog({ open, onClose, item, onSave }) {
  const quantity = Math.max(1, item.quantity || 1);
  const currentPerUnitCuft = (Number(item.cuft) || 0) / quantity;
  const currentPerUnitWeight = (Number(item.weight) || 0) / quantity;

  const [cuftDraft, setCuftDraft] = useState(round2(currentPerUnitCuft).toString());
  const [adjustWeight, setAdjustWeight] = useState(true);

  // Reset state every time the dialog opens against a (possibly different) item.
  useEffect(() => {
    if (open) {
      setCuftDraft(round2(currentPerUnitCuft).toString());
      setAdjustWeight(true);
    }
  }, [open, currentPerUnitCuft]);

  const newPerUnitCuft = parseFloat(cuftDraft) || 0;
  const newPerUnitWeight = adjustWeight && currentPerUnitCuft > 0
    ? (newPerUnitCuft * currentPerUnitWeight) / currentPerUnitCuft
    : currentPerUnitWeight;
  const newTotalCuft = newPerUnitCuft * quantity;
  const newTotalWeight = newPerUnitWeight * quantity;

  const handleSave = () => {
    const changes = { cuft: round2(newTotalCuft) };
    if (adjustWeight) {
      changes.weight = round2(newTotalWeight);
    }
    onSave(changes);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="sm:max-w-md"
        // Keep clicks/keys inside the dialog from bubbling to the parent
        // VideoRecordingModal's resizable or its own outside handlers.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="truncate">{item.name || 'Item'}</DialogTitle>
          <DialogDescription>Edit cubic feet for this item</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Per-unit input */}
          <div className="space-y-2">
            <Label htmlFor="cuft-value" className="text-sm font-medium">
              Cuft per item
            </Label>
            <Input
              id="cuft-value"
              type="number"
              step="0.1"
              min={0}
              value={cuftDraft}
              onChange={(e) => setCuftDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
          </div>

          {/* Weight adjustment */}
          <div>
            <Label className="text-sm font-medium block mb-2">Weight adjustment</Label>
            <RadioGroup
              value={adjustWeight ? 'adjust' : 'keep'}
              onValueChange={(v) => setAdjustWeight(v === 'adjust')}
              className="space-y-1"
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem value="adjust" id="cuft-adjust" className="mt-0.5" />
                <Label htmlFor="cuft-adjust" className="text-sm font-medium cursor-pointer">
                  Adjust weight proportionally
                  <span className="block text-xs text-gray-500 font-normal mt-0.5">
                    {round2(currentPerUnitWeight).toFixed(1)} → {round2(
                      currentPerUnitCuft > 0
                        ? (newPerUnitCuft * currentPerUnitWeight) / currentPerUnitCuft
                        : currentPerUnitWeight
                    ).toFixed(1)} per item
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-3">
                <RadioGroupItem value="keep" id="cuft-keep" className="mt-0.5" />
                <Label htmlFor="cuft-keep" className="text-sm font-medium cursor-pointer">
                  Keep current weight
                  <span className="block text-xs text-gray-500 font-normal mt-0.5">
                    {round2(currentPerUnitWeight).toFixed(1)} per item
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Preview totals */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Quantity</span>
              <span className="font-medium tabular-nums">{quantity}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span className="text-gray-500">Total Cuft</span>
              <span className="font-medium text-blue-600 tabular-nums">{round2(newTotalCuft).toFixed(1)}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span className="text-gray-500">Weight per item</span>
              <span className="font-medium tabular-nums">{round2(newPerUnitWeight).toFixed(1)}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span className="text-gray-500">Total Weight</span>
              <span className="font-medium text-blue-600 tabular-nums">{round2(newTotalWeight).toFixed(1)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Cells ──────────────────────────────────────────────────────────────

function QtyCell({ value, onInc, onDec, onCommitNumber }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  // Render identical to the main inventory spreadsheet's CountInput
  // (Spreadsheet.jsx:143-176). Critical detail: the input MUST be type="text",
  // not type="number" — Chromium's native number-input spinner controls eat
  // ~14 px on the right of the field, which visibly shifts the centered digit
  // leftward (the "1" / "4" / "72" don't sit on the cell midline). The
  // spreadsheet uses type="text" for the same reason; we mirror it exactly.
  return (
    <div className="flex items-center justify-between w-full h-full px-1">
      <button
        type="button"
        onClick={onDec}
        disabled={value <= 1}
        className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
          value <= 1
            ? 'text-gray-200 cursor-not-allowed'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
        }`}
        aria-label="Decrease"
      >
        <span className="text-sm font-medium">−</span>
      </button>
      <input
        type="text"
        value={draft}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = Math.max(1, parseInt(draft, 10) || 1);
          setDraft(String(n));
          if (n !== value) onCommitNumber(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className="flex-1 w-12 text-center bg-gray-50 border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
      />
      <button
        type="button"
        onClick={onInc}
        className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        aria-label="Increase"
      >
        <span className="text-sm font-medium">+</span>
      </button>
    </div>
  );
}


function GoingSelect({ quantity, goingQuantity, onChange }) {
  // Match the spreadsheet's option set exactly: "not going" + per-quantity
  // going options. For qty=1, "going" is the only positive option.
  const options = ['not going'];
  if (quantity === 1) {
    options.push('going');
  } else {
    for (let i = 1; i <= quantity; i++) options.push(`going (${i}/${quantity})`);
  }
  const current =
    goingQuantity === 0
      ? 'not going'
      : quantity === 1
      ? 'going'
      : `going (${goingQuantity}/${quantity})`;

  // Borderless, full-cell select that matches the inventory spreadsheet's
  // appearance (Spreadsheet.jsx:2350-2371). Light text-color tint signals
  // going vs not-going (the surrounding row tint carries the partial cue).
  return (
    <div className="relative w-full h-full">
      <select
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          let next;
          if (v === 'not going') next = 0;
          else if (v === 'going') next = quantity;
          else {
            const m = v.match(/^going \((\d+)\/(\d+)\)$/);
            next = m ? Math.min(quantity, parseInt(m[1], 10)) : quantity;
          }
          onChange(next);
        }}
        className={`w-full h-full bg-transparent border-none outline-none appearance-none cursor-pointer pr-5 text-sm ${
          goingQuantity === 0 ? 'text-red-700' : 'text-green-800'
        }`}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
    </div>
  );
}

function PackedBySelect({ value, onChange }) {
  return (
    <div className="relative w-full h-full">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-full bg-transparent border-none outline-none appearance-none cursor-pointer pr-5 text-sm"
      >
        {PACKED_BY_OPTIONS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function deriveGoingQuantity(item) {
  const q = Math.max(1, item.quantity || 1);
  let gq = item.goingQuantity;
  if (gq === undefined || gq === null) {
    if (item.going === 'not going') gq = 0;
    else if (item.going === 'partial') gq = Math.floor(q / 2);
    else gq = q;
  }
  return Math.max(0, Math.min(q, gq));
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
