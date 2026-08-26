'use client';

// Settings → Inventory → Inventory Stock
//
// The org's view of the stock item library: every default item we provide,
// merged with the org's custom items. Editing a DEFAULT item saves an
// org-scoped override (the shared library is never changed); custom items are
// edited in place. Removing a default hides it for this org (restorable);
// removing a custom item deletes it. Per-row saves hit the granular
// /api/stock-inventory/[id] API — no whole-list save bar.

import { useEffect, useMemo, useState } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { Archive, Plus, RotateCcw, Trash2, Pencil, X, Check, Search, Loader2, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface StockItem {
  _id: string;
  name: string;
  parent_class?: string;
  cubic_feet?: number;
  weight?: number;
  isCustom?: boolean;
  isOverridden?: boolean;
  hidden?: boolean;
  defaults?: { name: string; parent_class?: string; cubic_feet?: number; weight?: number };
}

interface Draft {
  name: string;
  parent_class: string;
  cubic_feet: string;
  weight: string;
}

const MAX_NAME_LEN = 120;

function toDraft(item: StockItem): Draft {
  return {
    name: item.name || '',
    parent_class: item.parent_class || '',
    cubic_feet: String(item.cubic_feet ?? 0),
    weight: String(item.weight ?? 0)
  };
}

export default function InventoryStockSettingsPage() {
  const { organization } = useOrganization();

  const [items, setItems] = useState<StockItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'default' | 'customized' | 'custom' | 'hidden'>('all');
  const [resetting, setResetting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>({ name: '', parent_class: 'Custom', cubic_feet: '3', weight: '20' });
  const [useStandards, setUseStandards] = useState(false);
  const [savingStandards, setSavingStandards] = useState(false);

  useEffect(() => {
    loadItems();
    loadStandardsSetting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.id]);

  const loadStandardsSetting = async () => {
    try {
      const res = await fetch('/api/settings/inventory-stock');
      if (res.ok) {
        const data = await res.json();
        setUseStandards(!!data.stockCuftWeightStandards);
      }
    } catch (e) {
      console.error('Error loading inventory stock settings:', e);
    }
  };

  const toggleStandards = async (next: boolean) => {
    setUseStandards(next);
    setSavingStandards(true);
    try {
      const res = await fetch('/api/settings/inventory-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockCuftWeightStandards: next })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Save failed');
      }
      toast.success(
        next
          ? 'AI will now use your library cuft & weight as quoting standards.'
          : 'AI will treat library cuft & weight as reference points only.'
      );
    } catch (e) {
      setUseStandards(!next);
      toast.error(e instanceof Error ? e.message : 'Failed to save setting.');
    } finally {
      setSavingStandards(false);
    }
  };

  const loadItems = async () => {
    try {
      const res = await fetch('/api/stock-inventory?limit=1000&includeHidden=1');
      if (!res.ok) {
        if (res.status !== 403) toast.error('Failed to load the stock library.');
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
      setCategories(Array.isArray(data.parentClasses) ? data.parentClasses : []);
    } catch (e) {
      console.error('Error loading stock library:', e);
      toast.error('Failed to load the stock library.');
    } finally {
      setLoading(false);
    }
  };

  const counts = useMemo(() => ({
    all: items.filter((i) => !i.hidden).length,
    default: items.filter((i) => !i.isCustom && !i.isOverridden && !i.hidden).length,
    customized: items.filter((i) => i.isOverridden && !i.hidden).length,
    custom: items.filter((i) => i.isCustom).length,
    hidden: items.filter((i) => i.hidden).length
  }), [items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (statusFilter === 'hidden') {
        if (!i.hidden) return false;
      } else {
        if (i.hidden) return false;
        if (statusFilter === 'default' && (i.isCustom || i.isOverridden)) return false;
        if (statusFilter === 'customized' && !i.isOverridden) return false;
        if (statusFilter === 'custom' && !i.isCustom) return false;
      }
      if (category !== 'all' && (i.parent_class || '') !== category) return false;
      if (q && !(i.name || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, category, statusFilter]);

  const overrideCount = counts.customized + counts.hidden;

  const resetAllToDefaults = async () => {
    const ok = window.confirm(
      `Reset all ${overrideCount} customization${overrideCount === 1 ? '' : 's'} to our defaults? ` +
      'This removes every edit and restores every hidden default item. Your custom items are not affected.'
    );
    if (!ok) return;
    setResetting(true);
    try {
      const res = await fetch('/api/stock-inventory', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Reset failed');
      }
      const data = await res.json();
      toast.success(`Reset ${data.removed} customization${data.removed === 1 ? '' : 's'} to defaults.`);
      setStatusFilter('all');
      await loadItems();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reset.');
    } finally {
      setResetting(false);
    }
  };

  const validateDraft = (d: Draft): string | null => {
    const name = d.name.trim();
    if (!name) return 'Name is required.';
    if (name.length > MAX_NAME_LEN) return `Name must be under ${MAX_NAME_LEN} characters.`;
    if (/["\r\n]/.test(name)) return 'Name cannot contain quotes or line breaks.';
    const cuft = Number(d.cubic_feet);
    const weight = Number(d.weight);
    if (!Number.isFinite(cuft) || cuft < 0) return 'Cubic feet must be 0 or more.';
    if (!Number.isFinite(weight) || weight < 0) return 'Weight must be 0 or more.';
    return null;
  };

  const startEdit = (item: StockItem) => {
    setEditingId(item._id);
    setDraft(toDraft(item));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (item: StockItem) => {
    if (!draft) return;
    const err = validateDraft(draft);
    if (err) {
      toast.error(err);
      return;
    }
    setBusyId(item._id);
    try {
      const res = await fetch(`/api/stock-inventory/${item._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          parent_class: draft.parent_class.trim(),
          cubic_feet: Number(draft.cubic_feet),
          weight: Number(draft.weight)
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      const data = await res.json();
      toast.success(
        data.kind === 'override' ? 'Saved for your organization.'
        : data.kind === 'reverted' ? 'Matches our default again — override removed.'
        : 'Saved.'
      );
      cancelEdit();
      await loadItems();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setBusyId(null);
    }
  };

  const revertItem = async (item: StockItem) => {
    setBusyId(item._id);
    try {
      const res = await fetch(`/api/stock-inventory/${item._id}?revert=1`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Revert failed');
      toast.success(item.hidden ? 'Item restored.' : 'Reverted to our default.');
      await loadItems();
    } catch {
      toast.error('Failed to revert.');
    } finally {
      setBusyId(null);
    }
  };

  const removeItem = async (item: StockItem) => {
    setBusyId(item._id);
    try {
      const res = await fetch(`/api/stock-inventory/${item._id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Remove failed');
      }
      const data = await res.json();
      toast.success(data.kind === 'hidden' ? 'Hidden from your library (restorable).' : 'Custom item deleted.');
      await loadItems();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove.');
    } finally {
      setBusyId(null);
    }
  };

  const addCustomItem = async () => {
    const err = validateDraft(addDraft);
    if (err) {
      toast.error(err);
      return;
    }
    setBusyId('new');
    try {
      const res = await fetch('/api/stock-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addDraft.name.trim(),
          parent_class: addDraft.parent_class.trim() || 'Custom',
          cubic_feet: Number(addDraft.cubic_feet),
          weight: Number(addDraft.weight)
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Add failed');
      }
      toast.success('Custom item added to your library.');
      setAdding(false);
      setAddDraft({ name: '', parent_class: 'Custom', cubic_feet: '3', weight: '20' });
      await loadItems();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add item.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsPageShell
      title="Inventory Stock"
      subtitle="The item library behind the stock picker and the AI's size and weight estimates. Edits apply only to your organization."
      icon={Archive}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
    >
      {/* Toolbar — sticky under the fixed 4rem app header so search, filters
          and actions stay reachable while scrolling ~400 items. The wrapper
          carries the page background so rows don't peek around the card. */}
      <div className="sticky top-16 z-20 -mx-2 bg-gray-50 px-2 pb-3">
      <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search 390+ items…"
              className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm placeholder:text-gray-400 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 w-40 shrink-0 truncate rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
            {([
              ['all', 'All', counts.all],
              ['default', 'Default', counts.default],
              ['customized', 'Customized', counts.customized],
              ['custom', 'Custom', counts.custom],
              ['hidden', 'Hidden', counts.hidden]
            ] as const).map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={cn(
                  'inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors',
                  statusFilter === key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                )}
              >
                {label}
                <span className={cn('text-[10px]', statusFilter === key ? 'text-gray-500' : 'text-gray-400')}>
                  {n}
                </span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9"
              onClick={resetAllToDefaults}
              disabled={resetting || overrideCount === 0}
              title={overrideCount === 0 ? 'No customizations to reset' : `Remove all ${overrideCount} customizations`}
            >
              {resetting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
              Reset all to defaults
            </Button>
            <Button type="button" size="sm" className="h-9" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add custom item
            </Button>
          </div>
        </div>
      </div>
      </div>

      {/* Quoting-standards toggle */}
      <div className="mb-2 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
          <Ruler className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
            Use library cuft &amp; weight as quoting standards
            {savingStandards && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
            On: matched items take your library&apos;s exact cuft and weight — you quote off these standards. Off: library values are soft reference points and the AI estimates from what it sees.
          </p>
        </div>
        <Switch checked={useStandards} onCheckedChange={toggleStandards} disabled={savingStandards} />
      </div>

      <p className="mb-3 px-1 text-xs leading-relaxed text-gray-500">
        Edits apply going forward — items already added to projects keep their values. Need help importing a list or CSV?{' '}
        <button
          type="button"
          onClick={() => {
            const ic = (window as any).Intercom;
            if (typeof ic === 'function') ic('show');
          }}
          className="font-medium text-blue-600 underline-offset-2 hover:underline"
        >
          Contact support
        </button>
        {' '}and we&apos;ll set it up for you.
      </p>

      {/* Add-custom editor */}
      {adding && (
        <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <RowEditor
            draft={addDraft}
            setDraft={setAddDraft}
            categories={categories}
            busy={busyId === 'new'}
            onSave={addCustomItem}
            onCancel={() => setAdding(false)}
            saveLabel="Add item"
          />
        </div>
      )}

      {/* Item rows */}
      <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
        <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_7.5rem_4rem_4rem_6.5rem] items-center gap-x-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <span>Item</span>
          <span>Category</span>
          <span className="text-right">Cuft</span>
          <span className="text-right">Lbs</span>
          <span />
        </div>
        {visibleItems.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">No items match.</div>
        ) : (
          visibleItems.map((item) => {
            const isEditing = editingId === item._id;
            const busy = busyId === item._id;
            return (
              <div key={item._id} className={cn('px-4 py-2.5 transition-colors hover:bg-gray-50/60', item.hidden && 'bg-gray-50 opacity-70')}>
                {isEditing && draft ? (
                  <RowEditor
                    draft={draft}
                    setDraft={setDraft}
                    categories={categories}
                    busy={busy}
                    onSave={() => saveEdit(item)}
                    onCancel={cancelEdit}
                    saveLabel="Save"
                  />
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_7.5rem_4rem_4rem_6.5rem] items-center gap-x-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-900">{item.name}</span>
                        {item.isCustom ? (
                          <Badge tone="purple">Custom</Badge>
                        ) : item.hidden ? (
                          <Badge tone="gray">Hidden</Badge>
                        ) : item.isOverridden ? (
                          <Badge tone="blue">Customized</Badge>
                        ) : null}
                      </div>
                      {item.isOverridden && !item.hidden && item.defaults && (
                        <div className="mt-0.5 text-[11px] text-gray-400">
                          default: {item.defaults.cubic_feet ?? 0} cuft · {item.defaults.weight ?? 0} lbs
                        </div>
                      )}
                      <div className="mt-0.5 text-xs text-gray-500 sm:hidden">
                        {item.parent_class || 'Uncategorized'} · {item.cubic_feet ?? 0} cuft · {item.weight ?? 0} lbs
                      </div>
                    </div>
                    <span className="hidden truncate text-xs text-gray-500 sm:block">{item.parent_class || '—'}</span>
                    <span className="hidden text-right text-sm tabular-nums text-gray-700 sm:block">{item.cubic_feet ?? 0}</span>
                    <span className="hidden text-right text-sm tabular-nums text-gray-700 sm:block">{item.weight ?? 0}</span>

                    <div className="flex items-center justify-end gap-1 shrink-0">
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      ) : item.hidden ? (
                        <IconBtn title="Restore to your library" onClick={() => revertItem(item)}>
                          <RotateCcw className="h-4 w-4" />
                        </IconBtn>
                      ) : (
                        <>
                          <IconBtn title="Edit for your organization" onClick={() => startEdit(item)}>
                            <Pencil className="h-4 w-4" />
                          </IconBtn>
                          {item.isOverridden && (
                            <IconBtn title="Revert to our default" onClick={() => revertItem(item)}>
                              <RotateCcw className="h-4 w-4" />
                            </IconBtn>
                          )}
                          <IconBtn
                            title={item.isCustom ? 'Delete custom item' : 'Remove from your library (restorable)'}
                            danger
                            onClick={() => removeItem(item)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconBtn>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="mt-3 text-xs text-gray-500 text-right">
        {visibleItems.length} of {items.length} items{counts.hidden > 0 && statusFilter !== 'hidden' ? ` · ${counts.hidden} hidden` : ''}
      </p>
    </SettingsPageShell>
  );
}

function RowEditor({
  draft,
  setDraft,
  categories,
  busy,
  onSave,
  onCancel,
  saveLabel
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  categories: string[];
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-2">
      <Field label="Name" className="flex-[2]">
        <input
          type="text"
          value={draft.name}
          autoFocus
          maxLength={MAX_NAME_LEN}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Field>
      <Field label="Category" className="flex-1">
        <input
          type="text"
          list="stock-categories"
          value={draft.parent_class}
          onChange={(e) => setDraft({ ...draft, parent_class: e.target.value })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <datalist id="stock-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Cuft" className="w-full sm:w-24">
        <input
          type="number"
          min={0}
          step={0.5}
          value={draft.cubic_feet}
          onChange={(e) => setDraft({ ...draft, cubic_feet: e.target.value })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Field>
      <Field label="Lbs" className="w-full sm:w-24">
        <input
          type="number"
          min={0}
          step={1}
          value={draft.weight}
          onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </Field>
      <div className="flex items-center gap-1 pb-0.5">
        <Button type="button" size="sm" onClick={onSave} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 sm:mr-1" />}
          <span className="hidden sm:inline">{saveLabel}</span>
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'gray' | 'blue' | 'purple'; children: React.ReactNode }) {
  const cls =
    tone === 'blue' ? 'bg-blue-50 text-blue-700 border-blue-100'
    : tone === 'purple' ? 'bg-purple-50 text-purple-700 border-purple-100'
    : 'bg-gray-100 text-gray-600 border-gray-200';
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', cls)}>
      {children}
    </span>
  );
}

function IconBtn({
  title,
  danger,
  onClick,
  children
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        danger ? 'text-gray-400 hover:text-red-600 hover:bg-red-50' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
      )}
    >
      {children}
    </button>
  );
}
