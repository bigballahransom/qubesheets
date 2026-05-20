'use client';

import { useEffect, useState } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Boxes, Plus, RotateCcw, Trash2, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DEFAULT_BOX_TYPES,
  MAX_BOX_CAPACITY_CUFT,
  MAX_BOX_DESCRIPTION_LENGTH,
  MAX_BOX_NAME_LENGTH,
  MAX_BOX_TYPES_PER_ORG,
  type BoxType
} from '@/lib/defaultBoxTypes';

function newBoxId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `box-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `box-${Math.random().toString(36).slice(2, 10)}`;
}

function blankBox(): BoxType {
  return { id: newBoxId(), name: '', capacityCuft: 3.0, description: '' };
}

export default function BoxTypesSettingsPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [boxTypes, setBoxTypes] = useState<BoxType[]>(DEFAULT_BOX_TYPES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [usingDefaults, setUsingDefaults] = useState(true);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      loadSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, organization, hasUnsavedChanges]);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings/box-types');
      if (response.ok) {
        const config = await response.json();
        setBoxTypes(
          Array.isArray(config.boxTypes) && config.boxTypes.length > 0
            ? config.boxTypes
            : DEFAULT_BOX_TYPES
        );
        setUsingDefaults(!!config.usingDefaults);
      } else if (response.status === 403) {
        setLoading(false);
        return;
      } else {
        setBoxTypes(DEFAULT_BOX_TYPES);
        setUsingDefaults(true);
      }
    } catch (error) {
      console.error('Error loading box types:', error);
      setBoxTypes(DEFAULT_BOX_TYPES);
      setUsingDefaults(true);
    } finally {
      setLoading(false);
    }
  };

  const updateBox = (id: string, patch: Partial<BoxType>) => {
    setBoxTypes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setHasUnsavedChanges(true);
  };

  const removeBox = (id: string) => {
    setBoxTypes((prev) => prev.filter((b) => b.id !== id));
    setHasUnsavedChanges(true);
  };

  const addBox = () => {
    if (boxTypes.length >= MAX_BOX_TYPES_PER_ORG) {
      toast.error(`You can have at most ${MAX_BOX_TYPES_PER_ORG} box types.`);
      return;
    }
    setBoxTypes((prev) => [...prev, blankBox()]);
    setHasUnsavedChanges(true);
  };

  const resetToDefaults = () => {
    setBoxTypes(DEFAULT_BOX_TYPES.map((b) => ({ ...b })));
    setHasUnsavedChanges(true);
  };

  const validateClient = (): string | null => {
    if (boxTypes.length === 0) return 'Add at least one box type before saving.';
    const seen = new Set<string>();
    for (const b of boxTypes) {
      const name = b.name.trim();
      if (!name) return 'Every box type needs a name.';
      if (name.length > MAX_BOX_NAME_LENGTH) return `"${name}" is too long (max ${MAX_BOX_NAME_LENGTH} chars).`;
      if (/["\r\n]/.test(name)) return `"${name}" contains a quote or line break — please remove it.`;
      const key = name.toLowerCase();
      if (seen.has(key)) return `Duplicate name: "${name}". Names must be unique.`;
      seen.add(key);
      if (!Number.isFinite(b.capacityCuft) || b.capacityCuft <= 0) {
        return `"${name}" needs a capacity greater than 0.`;
      }
      if (b.capacityCuft > MAX_BOX_CAPACITY_CUFT) {
        return `"${name}" capacity must be ≤ ${MAX_BOX_CAPACITY_CUFT} cuft.`;
      }
    }
    return null;
  };

  const saveSettings = async () => {
    const err = validateClient();
    if (err) {
      toast.error(err);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/settings/box-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxTypes })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save: ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data.boxTypes)) setBoxTypes(data.boxTypes);
      setUsingDefaults(false);
      setHasUnsavedChanges(false);
      toast.success('Box types saved.');
    } catch (error) {
      console.error('Error saving box types:', error);
      toast.error(`Failed to save. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPageShell
      title="Box Types"
      subtitle="The set of boxes the AI is allowed to recommend on every estimate."
      icon={Boxes}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
      unsavedChanges={hasUnsavedChanges}
      saving={saving}
      onSave={saveSettings}
      onDiscard={() => {
        setHasUnsavedChanges(false);
        loadSettings();
      }}
    >
      {/* Status banner */}
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 mb-6 flex items-center gap-3 text-sm">
        <div className="flex-1">
          {usingDefaults ? (
            <span className="text-gray-600">You&apos;re viewing our defaults. Make any change and save to switch to your own list.</span>
          ) : (
            <span className="text-gray-600">Customized list — edits apply to every new estimate.</span>
          )}
        </div>
        {usingDefaults ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
            Using defaults
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 border border-blue-100">
            Customized
          </span>
        )}
      </div>

      {/* Box-type cards */}
      <div className="space-y-3">
        {boxTypes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
            <PackageOpen className="mx-auto h-8 w-8 text-gray-400" />
            <h3 className="mt-3 text-sm font-medium text-gray-900">No box types yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Add the boxes you stock, or restore our defaults to get started.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button type="button" onClick={addBox} size="sm">
                <Plus className="mr-1 h-4 w-4" /> Add box type
              </Button>
              <Button type="button" onClick={resetToDefaults} variant="outline" size="sm">
                <RotateCcw className="mr-1 h-4 w-4" /> Restore defaults
              </Button>
            </div>
          </div>
        ) : (
          boxTypes.map((box, idx) => {
            const trimmedName = box.name.trim();
            const nameInvalid = !trimmedName || /["\r\n]/.test(trimmedName) || trimmedName.length > MAX_BOX_NAME_LENGTH;
            const capacityInvalid = !Number.isFinite(box.capacityCuft) || box.capacityCuft <= 0 || box.capacityCuft > MAX_BOX_CAPACITY_CUFT;
            return (
              <div
                key={box.id}
                className="group rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-gray-300 transition-all"
              >
                <div className="p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold">
                      {idx + 1}
                    </div>

                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
                      <FieldShell label="Name" required>
                        <input
                          type="text"
                          value={box.name}
                          onChange={(e) => updateBox(box.id, { name: e.target.value })}
                          placeholder="e.g. Book Box"
                          maxLength={MAX_BOX_NAME_LENGTH}
                          className={cn(
                            'w-full rounded-md border bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors',
                            nameInvalid ? 'border-red-300' : 'border-gray-300'
                          )}
                        />
                      </FieldShell>

                      <FieldShell label="Capacity" required>
                        <div
                          className={cn(
                            'flex items-stretch rounded-md border bg-white overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-colors',
                            capacityInvalid ? 'border-red-300' : 'border-gray-300'
                          )}
                        >
                          <input
                            type="number"
                            value={box.capacityCuft}
                            onChange={(e) =>
                              updateBox(box.id, {
                                capacityCuft: parseFloat(e.target.value) || 0
                              })
                            }
                            min={0}
                            max={MAX_BOX_CAPACITY_CUFT}
                            step={0.1}
                            className="flex-1 min-w-0 px-3 py-2 text-sm bg-transparent focus:outline-none"
                          />
                          <span className="self-center pr-3 text-xs font-medium text-gray-400 select-none">cuft</span>
                        </div>
                      </FieldShell>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeBox(box.id)}
                      className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      aria-label={`Remove ${trimmedName || `box type ${idx + 1}`}`}
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <FieldShell label="Description" className="mt-3">
                    <input
                      type="text"
                      value={box.description}
                      onChange={(e) => updateBox(box.id, { description: e.target.value })}
                      placeholder="What goes in it — the AI uses this to decide which items get packed in this box"
                      maxLength={MAX_BOX_DESCRIPTION_LENGTH}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    />
                  </FieldShell>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add row + utility actions */}
      {boxTypes.length > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={addBox}
            disabled={boxTypes.length >= MAX_BOX_TYPES_PER_ORG}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed py-3 text-sm font-medium transition-colors',
              boxTypes.length >= MAX_BOX_TYPES_PER_ORG
                ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                : 'border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/40'
            )}
          >
            <Plus className="h-4 w-4" />
            Add box type
          </button>
          <button
            type="button"
            onClick={resetToDefaults}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            title="Replace your list with our defaults"
          >
            <RotateCcw className="h-4 w-4" />
            Restore defaults
          </button>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500 text-right">
        {boxTypes.length} of {MAX_BOX_TYPES_PER_ORG} box types
      </p>
    </SettingsPageShell>
  );
}

function FieldShell({
  label,
  required,
  className,
  children
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
