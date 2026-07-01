'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, Minus, Plus, Trash2, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const PACKED_BY_OPTIONS = ['N/A', 'PBO', 'CP', 'Crated'];

/**
 * Per-row action popover that mirrors the full spreadsheet editing surface
 * for a single InventoryItem. Renders a small chevron trigger next to the
 * going-status badge in the video modal; clicking it opens a form with name,
 * going, quantity, location, cuft/weight (per unit), packed_by, tags, and
 * delete. Every change hits PATCH (or DELETE) on the inventory-item endpoint
 * and then asks the parent to refresh via `onInventoryUpdate`.
 *
 * The popover edits the WHOLE item (not a single quantity instance), so
 * callers should render only one of these per item — typically next to the
 * first ToggleGoingBadge of a multi-quantity row.
 */
export default function InventoryItemActionsPopover({
  inventoryItem,
  projectId,
  onInventoryUpdate,
  availableRooms = [],
  triggerClassName = '',
}) {
  const itemId = inventoryItem._id;
  const apiBase = `/api/projects/${projectId || inventoryItem.projectId}/inventory/${itemId}`;

  const quantity = Math.max(1, inventoryItem.quantity || 1);
  const totalCuft = Number(inventoryItem.cuft) || 0;
  const totalWeight = Number(inventoryItem.weight) || 0;

  // Local form state (committed to API per-field). Initial values mirror the
  // inventory item; if the item changes (parent refresh), reset.
  const [name, setName] = useState(inventoryItem.name || '');
  const [goingStatus, setGoingStatus] = useState(deriveGoingStatus(inventoryItem));
  const [goingQuantity, setGoingQuantity] = useState(deriveGoingQuantity(inventoryItem));
  const [location, setLocation] = useState(inventoryItem.location || '');
  const [cuftPerUnit, setCuftPerUnit] = useState(totalCuft / quantity);
  const [weightPerUnit, setWeightPerUnit] = useState(totalWeight / quantity);
  const [packedBy, setPackedBy] = useState(inventoryItem.packed_by || 'N/A');
  const [tags, setTags] = useState(Array.isArray(inventoryItem.tags) ? inventoryItem.tags : []);
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(inventoryItem.name || '');
    setGoingStatus(deriveGoingStatus(inventoryItem));
    setGoingQuantity(deriveGoingQuantity(inventoryItem));
    setLocation(inventoryItem.location || '');
    const q = Math.max(1, inventoryItem.quantity || 1);
    setCuftPerUnit((Number(inventoryItem.cuft) || 0) / q);
    setWeightPerUnit((Number(inventoryItem.weight) || 0) / q);
    setPackedBy(inventoryItem.packed_by || 'N/A');
    setTags(Array.isArray(inventoryItem.tags) ? inventoryItem.tags : []);
    setConfirmDelete(false);
  }, [
    inventoryItem._id,
    inventoryItem.name,
    inventoryItem.quantity,
    inventoryItem.goingQuantity,
    inventoryItem.going,
    inventoryItem.location,
    inventoryItem.cuft,
    inventoryItem.weight,
    inventoryItem.packed_by,
    inventoryItem.tags,
  ]);

  // Merge roomCatalog rooms with the current item's location so it's always
  // available in the select even if the catalog wasn't fed in.
  const roomOptions = useMemo(() => {
    const set = new Set();
    for (const r of availableRooms) if (r) set.add(r);
    if (inventoryItem.location) set.add(inventoryItem.location);
    return Array.from(set).sort();
  }, [availableRooms, inventoryItem.location]);

  const patch = async (changes, successMsg) => {
    setBusy(true);
    try {
      const res = await fetch(apiBase, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!res.ok) throw new Error('Update failed');
      if (successMsg) toast.success(successMsg, { duration: 1500 });
      if (onInventoryUpdate) onInventoryUpdate(itemId);
    } catch (err) {
      console.error('Failed to update inventory item:', err);
      toast.error('Failed to save change');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(apiBase, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(`Deleted "${inventoryItem.name}"`, { duration: 1500 });
      if (onInventoryUpdate) onInventoryUpdate(itemId);
    } catch (err) {
      console.error('Failed to delete inventory item:', err);
      toast.error('Failed to delete item');
    } finally {
      setBusy(false);
    }
  };

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== inventoryItem.name) patch({ name: trimmed }, 'Renamed');
  };

  const setQuantity = (next) => {
    const clean = Math.max(1, Math.min(50000, Math.floor(next)));
    if (clean === quantity) return;
    // Keep per-unit cuft/weight stable: recompute totals from the new qty.
    patch(
      {
        quantity: clean,
        cuft: round2(cuftPerUnit * clean),
        weight: round2(weightPerUnit * clean),
        // Going-quantity shouldn't exceed new quantity
        goingQuantity: Math.min(goingQuantity, clean),
      },
      `Quantity → ${clean}`,
    );
  };

  const handleGoingChange = (next) => {
    setGoingStatus(next);
    let nextQty;
    if (next === 'going') nextQty = quantity;
    else if (next === 'not going') nextQty = 0;
    else nextQty = Math.max(1, Math.min(quantity - 1, goingQuantity || Math.floor(quantity / 2)));
    setGoingQuantity(nextQty);
    patch({ goingQuantity: nextQty }, statusLabel(next));
  };

  const handlePartialQtyChange = (next) => {
    const clean = Math.max(0, Math.min(quantity, Math.floor(Number(next) || 0)));
    setGoingQuantity(clean);
    patch({ goingQuantity: clean });
  };

  const commitCuft = () => {
    const perUnit = Math.max(0, Number(cuftPerUnit) || 0);
    const total = round2(perUnit * quantity);
    if (total !== round2(totalCuft)) patch({ cuft: total }, `Cuft updated`);
  };

  const commitWeight = () => {
    const perUnit = Math.max(0, Number(weightPerUnit) || 0);
    const total = round2(perUnit * quantity);
    if (total !== round2(totalWeight)) patch({ weight: total }, `Weight updated`);
  };

  const addTag = () => {
    const v = newTag.trim();
    if (!v) return;
    if (tags.includes(v)) {
      setNewTag('');
      return;
    }
    const next = [...tags, v];
    setTags(next);
    setNewTag('');
    patch({ tags: next }, `Added tag “${v}”`);
  };

  const removeTag = (t) => {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    patch({ tags: next }, `Removed tag “${t}”`);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Edit ${inventoryItem.name}`}
          className={`p-0.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500 ${triggerClassName}`}
          onClick={(e) => e.stopPropagation()}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b flex items-center justify-between bg-gray-50">
          <span className="text-xs font-semibold text-gray-700 truncate" title={inventoryItem.name}>
            Edit item
          </span>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
        </div>

        <div className="p-3 space-y-3 max-h-[60vh] overflow-y-auto">
          {/* Name */}
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
              className="h-8 text-sm"
            />
          </Field>

          {/* Going status */}
          <Field label="Going status">
            <RadioGroup
              value={goingStatus}
              onValueChange={handleGoingChange}
              className="flex gap-3"
            >
              {[
                { value: 'going', label: 'Going' },
                { value: 'partial', label: 'Partial' },
                { value: 'not going', label: 'Not going' },
              ].map((opt) => (
                <div key={opt.value} className="flex items-center gap-1.5">
                  <RadioGroupItem value={opt.value} id={`${itemId}-going-${opt.value}`} />
                  <Label htmlFor={`${itemId}-going-${opt.value}`} className="text-xs font-normal cursor-pointer">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {goingStatus === 'partial' && (
              <div className="flex items-center gap-2 mt-1.5">
                <Input
                  type="number"
                  min={1}
                  max={quantity - 1}
                  value={goingQuantity}
                  onChange={(e) => setGoingQuantity(Number(e.target.value))}
                  onBlur={(e) => handlePartialQtyChange(e.target.value)}
                  className="h-7 w-16 text-xs"
                />
                <span className="text-xs text-gray-500">of {quantity} going</span>
              </div>
            )}
          </Field>

          {/* Quantity */}
          <Field label="Quantity">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                onClick={() => setQuantity(quantity - 1)}
                disabled={quantity <= 1 || busy}
              >
                <Minus className="w-3.5 h-3.5" />
              </Button>
              <span className="font-mono text-sm w-10 text-center tabular-nums">{quantity}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                onClick={() => setQuantity(quantity + 1)}
                disabled={busy}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </Field>

          {/* Location */}
          <Field label="Location">
            <Select
              value={location}
              onValueChange={(v) => {
                setLocation(v);
                patch({ location: v }, `Moved to ${v}`);
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Choose a room…" />
              </SelectTrigger>
              <SelectContent>
                {roomOptions.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-gray-500">No rooms detected</div>
                )}
                {roomOptions.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* Cuft + Weight per unit */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cuft / unit">
              <Input
                type="number"
                min={0}
                step="0.1"
                value={Number.isFinite(cuftPerUnit) ? round2(cuftPerUnit) : 0}
                onChange={(e) => setCuftPerUnit(Number(e.target.value))}
                onBlur={commitCuft}
                className="h-8 text-sm"
              />
            </Field>
            <Field label="Weight / unit (lb)">
              <Input
                type="number"
                min={0}
                step="1"
                value={Number.isFinite(weightPerUnit) ? round2(weightPerUnit) : 0}
                onChange={(e) => setWeightPerUnit(Number(e.target.value))}
                onBlur={commitWeight}
                className="h-8 text-sm"
              />
            </Field>
          </div>

          {/* Packed by */}
          <Field label="Packed by">
            <RadioGroup
              value={packedBy}
              onValueChange={(v) => {
                setPackedBy(v);
                patch({ packed_by: v }, `Packed by → ${v}`);
              }}
              className="flex flex-wrap gap-x-3 gap-y-1"
            >
              {PACKED_BY_OPTIONS.map((opt) => (
                <div key={opt} className="flex items-center gap-1.5">
                  <RadioGroupItem value={opt} id={`${itemId}-pb-${opt}`} />
                  <Label htmlFor={`${itemId}-pb-${opt}`} className="text-xs font-normal cursor-pointer">
                    {opt}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </Field>

          {/* Tags */}
          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 rounded-full px-2 py-0.5 text-[11px]"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="hover:text-blue-900"
                    aria-label={`Remove tag ${t}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                }}
                onBlur={addTag}
                placeholder="Add tag…"
                className="h-6 text-xs flex-1 min-w-[6rem]"
              />
            </div>
          </Field>

          {/* Delete */}
          <div className="pt-2 border-t">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-700 flex-1">Delete this item?</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  onClick={remove}
                  disabled={busy}
                >
                  Delete
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 w-full justify-start"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Delete item
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide mb-1 block">
        {label}
      </Label>
      {children}
    </div>
  );
}

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

function deriveGoingStatus(item) {
  const q = Math.max(1, item.quantity || 1);
  const gq = deriveGoingQuantity(item);
  if (gq === 0) return 'not going';
  if (gq === q) return 'going';
  return 'partial';
}

function statusLabel(s) {
  return s === 'not going' ? 'Marked not going' : s === 'partial' ? 'Marked partial' : 'Marked going';
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
