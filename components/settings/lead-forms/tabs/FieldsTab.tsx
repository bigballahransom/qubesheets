'use client';

// components/settings/lead-forms/tabs/FieldsTab.tsx
//
// Enabled / Required switches per FieldKey, plus an optional per-field
// display-name override (the customer-facing label). Renaming never changes
// the underlying FieldKey, so CRM mapping and normalization are unaffected.
// Phone is locked to required. Move Size also gets a per-form editable list
// of dropdown options below the field grid (only when Move Size is enabled).

import { useMemo, useState } from 'react';
import { ChevronDown, GripVertical, Lock, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {
  FieldKey,
  ILeadFormConfigField,
  ILeadFormCustomField,
  LeadFormCustomFieldType,
  LeadFormStep,
} from '@/models/LeadFormConfig';

const DEFAULT_MOVE_SIZE_OPTIONS = [
  'Studio',
  '1 Bedroom',
  '2 Bedroom',
  '3 Bedroom',
  '4+ Bedroom',
  'Office',
  'Storage Unit',
];

interface FieldsTabProps {
  fields: ILeadFormConfigField[];
  onChange: (next: ILeadFormConfigField[]) => void;
  customFields?: ILeadFormCustomField[];
  onCustomFieldsChange?: (next: ILeadFormCustomField[] | undefined) => void;
  moveSizeOptions?: string[];
  onMoveSizeOptionsChange?: (next: string[] | undefined) => void;
  steps?: LeadFormStep[];
  onStepsChange?: (next: LeadFormStep[] | undefined) => void;
}

const FIELD_LABELS: Record<FieldKey, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name (legacy)',
  email: 'Email',
  phone: 'Phone',
  phoneType: 'Phone type',
  moveDate: 'Move date',
  moveSize: 'Move size',
  origin: 'Origin',
  destination: 'Destination',
  companyName: 'Company name',
};

// What the customer actually sees on the embed when no override is set.
// Keep in sync with FIELD_LABEL in components/embed/LeadForm.tsx — used as
// the rename input's placeholder and the reset target.
const CUSTOMER_DEFAULT_LABELS: Record<FieldKey, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone number',
  phoneType: 'Phone type',
  moveDate: 'Move date',
  moveSize: 'Move size',
  origin: 'Origin address',
  destination: 'Destination address',
  companyName: 'Company name',
};

// `fullName` is intentionally omitted from the editor order. It remains a
// FieldKey for back-compat with the API ingest path, but new configs use
// firstName + lastName so CRM destinations get the split values.
const FIELD_ORDER: FieldKey[] = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'phoneType',
  'moveDate',
  'moveSize',
  'origin',
  'destination',
  'companyName',
];

export function FieldsTab({
  fields,
  onChange,
  customFields,
  onCustomFieldsChange,
  moveSizeOptions,
  onMoveSizeOptionsChange,
  steps,
  onStepsChange,
}: FieldsTabProps) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const [moveSizeOpen, setMoveSizeOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<FieldKey | null>(null);
  const moveSizeEnabled = !!byId.get('moveSize')?.enabled;

  const sorted = FIELD_ORDER.map((id) => {
    const existing = byId.get(id);
    if (existing) return existing;
    return { id, enabled: false, required: false } as ILeadFormConfigField;
  });

  const updateField = (
    id: FieldKey,
    patch: Partial<Pick<ILeadFormConfigField, 'enabled' | 'required' | 'label'>>
  ) => {
    const next = sorted.map((f) => {
      if (f.id !== id) return f;
      const merged = { ...f, ...patch };
      // If enabled flipped off, required must also go off.
      if (merged.enabled === false) {
        merged.required = false;
      }
      // Phone is always required when present.
      if (merged.id === 'phone') {
        merged.required = true;
      }
      return merged;
    });
    onChange(next);
  };

  // Blank or default-equal overrides are normalized back to "no override" so
  // the stored config only carries labels that actually differ.
  const finishLabelEdit = (id: FieldKey) => {
    setEditingLabel(null);
    const trimmed = byId.get(id)?.label?.trim();
    if (!trimmed || trimmed === CUSTOMER_DEFAULT_LABELS[id]) {
      updateField(id, { label: undefined });
    } else {
      updateField(id, { label: trimmed });
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
      <div className="px-6 py-4">
        <h2 className="text-base font-medium text-gray-900">Form fields</h2>
        <p className="text-sm text-gray-500 mt-1">
          Choose which fields appear on the embedded form and which ones the
          customer must fill in to submit.
        </p>
      </div>
      <div className="px-6 py-3 bg-gray-50/60 grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
        <div className="col-span-6">Field</div>
        <div className="col-span-3">Enabled</div>
        <div className="col-span-3">Required</div>
      </div>
      {sorted.map((field) => {
        const isPhone = field.id === 'phone';
        const requiredLocked = isPhone;
        const requiredDisabled = !field.enabled || requiredLocked;
        const isMoveSize = field.id === 'moveSize';
        const hasExpansion =
          isMoveSize && moveSizeEnabled && !!onMoveSizeOptionsChange;
        const expanded = isMoveSize && moveSizeOpen && hasExpansion;
        const customLabel = field.label?.trim();
        const displayName = customLabel || FIELD_LABELS[field.id];
        const isEditingLabel = editingLabel === field.id;
        return (
          <div key={field.id}>
            <div className="px-6 py-4 grid grid-cols-12 gap-4 items-center">
              <div className="col-span-6 text-sm font-medium text-gray-900 flex items-center gap-2 min-w-0">
                {isEditingLabel ? (
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1 max-w-xs">
                    <span className="text-[11px] font-normal text-gray-400">
                      {FIELD_LABELS[field.id]}
                    </span>
                    <Input
                      value={field.label ?? ''}
                      onChange={(e) =>
                        updateField(field.id, { label: e.target.value })
                      }
                      onBlur={() => finishLabelEdit(field.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') {
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder={CUSTOMER_DEFAULT_LABELS[field.id]}
                      maxLength={80}
                      autoFocus
                      className="h-8"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col min-w-0">
                      {/* When renamed, keep the built-in field name visible so
                          it's always clear what the field maps to. */}
                      {customLabel && (
                        <span className="text-[11px] font-normal text-gray-400">
                          {FIELD_LABELS[field.id]}
                        </span>
                      )}
                      {hasExpansion ? (
                        <button
                          type="button"
                          onClick={() => setMoveSizeOpen((v) => !v)}
                          className="group inline-flex items-center gap-1.5 text-left hover:text-gray-700 transition-colors"
                          aria-expanded={expanded}
                          aria-controls="move-size-options-panel"
                        >
                          <ChevronDown
                            className={
                              'h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-transform ' +
                              (expanded ? 'rotate-0' : '-rotate-90')
                            }
                          />
                          {displayName}
                          <span className="text-xs font-normal text-gray-400 ml-1">
                            ({(moveSizeOptions ?? []).length || 'default'}{' '}
                            {(moveSizeOptions ?? []).length === 1 ? 'option' : 'options'})
                          </span>
                        </button>
                      ) : (
                        <span className="truncate">{displayName}</span>
                      )}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setEditingLabel(field.id)}
                          aria-label={`Rename ${displayName}`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 shrink-0"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Rename the label customers see. Data still maps to{' '}
                        {FIELD_LABELS[field.id]} everywhere else.
                      </TooltipContent>
                    </Tooltip>
                    {customLabel && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() =>
                              updateField(field.id, { label: undefined })
                            }
                            aria-label={`Reset ${displayName} to default label`}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 shrink-0"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Reset to &ldquo;{CUSTOMER_DEFAULT_LABELS[field.id]}&rdquo;
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </>
                )}
              </div>
              <div className="col-span-3">
                <Switch
                  checked={field.enabled}
                  onCheckedChange={(checked) => {
                    updateField(field.id, { enabled: checked });
                    if (isMoveSize && !checked) setMoveSizeOpen(false);
                  }}
                />
              </div>
              <div className="col-span-3 flex items-center gap-2">
                <Switch
                  checked={field.required}
                  disabled={requiredDisabled}
                  onCheckedChange={(checked) =>
                    updateField(field.id, { required: checked })
                  }
                />
                {requiredLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Lock className="h-3.5 w-3.5 text-gray-400" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      Phone is always required so we can follow up with the lead.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
            {expanded && (
              <div
                id="move-size-options-panel"
                className="border-t border-gray-100"
              >
                <MoveSizeOptionsSection
                  value={moveSizeOptions}
                  onChange={onMoveSizeOptionsChange!}
                />
              </div>
            )}
          </div>
        );
      })}
      {onCustomFieldsChange && (
        <CustomFieldsSection
          customFields={customFields}
          onChange={onCustomFieldsChange}
        />
      )}
      {onStepsChange && (
        <FormLayoutSection
          fields={fields}
          steps={steps}
          onStepsChange={onStepsChange}
        />
      )}
    </div>
  );
}

// --- Custom fields ---------------------------------------------------------
//
// Admin-defined extra inputs. Each gets a stable random id minted here; the
// id is the capture key on submissions, so editing the label later never
// orphans old answers. Custom fields always render at the end of the form
// (after the built-ins; on the last step when multi-step) and are captured
// by Qube Sheets only — they are not sent to CRMs.

const CUSTOM_FIELD_TYPE_OPTIONS: Array<{
  value: LeadFormCustomFieldType;
  label: string;
}> = [
  { value: 'text', label: 'Short answer' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'select', label: 'Dropdown' },
];

function mintCustomFieldId(): string {
  return `cf_${Math.random().toString(36).slice(2, 10)}`;
}

interface CustomFieldsSectionProps {
  customFields: ILeadFormCustomField[] | undefined;
  onChange: (next: ILeadFormCustomField[] | undefined) => void;
}

function CustomFieldsSection({ customFields, onChange }: CustomFieldsSectionProps) {
  const list = customFields ?? [];

  const update = (next: ILeadFormCustomField[]) => {
    onChange(next.length > 0 ? next : undefined);
  };

  const updateAt = (idx: number, patch: Partial<ILeadFormCustomField>) => {
    update(
      list.map((cf, i) => {
        if (i !== idx) return cf;
        const merged = { ...cf, ...patch };
        // Options only make sense on dropdowns; drop them on type change so
        // the server validator doesn't reject the config.
        if (merged.type !== 'select') delete merged.options;
        if (merged.type === 'select' && !merged.options) merged.options = [''];
        return merged;
      }),
    );
  };

  const removeAt = (idx: number) => {
    update(list.filter((_, i) => i !== idx));
  };

  const addField = () => {
    update([
      ...list,
      { id: mintCustomFieldId(), label: '', type: 'text', required: false },
    ]);
  };

  return (
    <div className="px-6 py-5 bg-gray-50/40">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-900">Custom fields</h3>
          <p className="text-sm text-gray-500 mt-1">
            Extra questions shown at the end of the form. Answers are captured
            in Qube Sheets and shown on the Submissions tab — they are not
            sent to CRMs.
          </p>
        </div>
      </div>

      {list.length > 0 && (
        <div className="mt-4 space-y-3">
          {list.map((cf, idx) => (
            <div
              key={cf.id}
              className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
            >
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[12rem] space-y-1.5">
                  <label
                    htmlFor={`cf-label-${cf.id}`}
                    className="text-xs font-medium text-gray-500"
                  >
                    Question / label
                  </label>
                  <Input
                    id={`cf-label-${cf.id}`}
                    value={cf.label}
                    onChange={(e) => updateAt(idx, { label: e.target.value })}
                    placeholder="e.g., How did you hear about us?"
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor={`cf-type-${cf.id}`}
                    className="text-xs font-medium text-gray-500"
                  >
                    Type
                  </label>
                  <select
                    id={`cf-type-${cf.id}`}
                    value={cf.type}
                    onChange={(e) =>
                      updateAt(idx, {
                        type: e.target.value as LeadFormCustomFieldType,
                      })
                    }
                    className="h-9 rounded-md border border-gray-200 bg-white px-2 text-sm"
                  >
                    {CUSTOM_FIELD_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 h-9">
                  <Switch
                    checked={cf.required}
                    onCheckedChange={(checked) =>
                      updateAt(idx, { required: checked })
                    }
                  />
                  <span className="text-xs text-gray-600">Required</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAt(idx)}
                  title="Remove custom field"
                  className="text-gray-400 hover:text-red-600 shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {cf.type === 'select' && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-gray-500">
                    Dropdown options
                  </div>
                  <ul className="space-y-2">
                    {(cf.options ?? []).map((opt, optIdx) => (
                      <li key={optIdx} className="flex items-center gap-2">
                        <GripVertical
                          className="h-4 w-4 text-gray-300 shrink-0"
                          aria-hidden
                        />
                        <Input
                          value={opt}
                          onChange={(e) => {
                            const options = [...(cf.options ?? [])];
                            options[optIdx] = e.target.value;
                            updateAt(idx, { options });
                          }}
                          placeholder="Option"
                          className="flex-1"
                          maxLength={200}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            const options = (cf.options ?? []).filter(
                              (_, i) => i !== optIdx,
                            );
                            updateAt(idx, { options });
                          }}
                          className="text-gray-400 hover:text-red-600 shrink-0"
                          title="Remove option"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateAt(idx, { options: [...(cf.options ?? []), ''] })
                    }
                    className="text-xs"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add option
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addField}
        disabled={list.length >= 20}
        className="mt-4"
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add custom field
      </Button>
    </div>
  );
}

// --- Form layout (single page vs multi-step) ------------------------------
//
// Lives at the bottom of the Fields tab because step composition is just a
// layout decision on top of the field list above. Default: single page
// (steps is undefined). When the admin flips multi-step on, we seed with
// one step containing every enabled field, then they can split fields
// across more steps.
//
// Constraints enforced here (the server-side validator also re-enforces):
//   - A field can live on at most one step
//   - Fields not assigned to any step show up in an "Unassigned" bucket
//     with a "Move to step N" affordance, so toggling fields on/off in
//     the grid above can't silently drop them out of the wizard.

interface FormLayoutSectionProps {
  fields: ILeadFormConfigField[];
  steps: LeadFormStep[] | undefined;
  onStepsChange: (next: LeadFormStep[] | undefined) => void;
}

function FormLayoutSection({
  fields,
  steps,
  onStepsChange,
}: FormLayoutSectionProps) {
  const multiStepOn = Array.isArray(steps) && steps.length > 0;

  const enabledFields = useMemo(
    () => fields.filter((f) => f.enabled).map((f) => f.id),
    [fields],
  );

  const fieldToStep = useMemo(() => {
    const m = new Map<string, number>();
    if (steps) {
      steps.forEach((s, idx) => {
        for (const f of s.fields) m.set(f, idx);
      });
    }
    return m;
  }, [steps]);

  const unassigned = enabledFields.filter((f) => !fieldToStep.has(f));

  const enableMultiStep = () => {
    onStepsChange([
      {
        heading: '',
        fields: enabledFields as FieldKey[],
      },
    ]);
  };

  const disableMultiStep = () => {
    onStepsChange(undefined);
  };

  const addStep = () => {
    onStepsChange([...(steps ?? []), { heading: '', fields: [] }]);
  };

  const updateStep = (idx: number, patch: Partial<LeadFormStep>) => {
    if (!steps) return;
    const next = steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onStepsChange(next);
  };

  const removeStep = (idx: number) => {
    if (!steps) return;
    // Push the removed step's fields back to "unassigned" — drop them out
    // of the list entirely. Re-adding to a step is one click in the picker.
    const next = steps.filter((_, i) => i !== idx);
    onStepsChange(next.length > 0 ? next : undefined);
  };

  const moveStep = (idx: number, delta: -1 | 1) => {
    if (!steps) return;
    const j = idx + delta;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[idx], next[j]] = [next[j], next[idx]];
    onStepsChange(next);
  };

  const assignFieldToStep = (field: FieldKey, targetIdx: number) => {
    if (!steps) return;
    const next = steps.map((s, i) => {
      const without = s.fields.filter((f) => f !== field);
      if (i === targetIdx) return { ...s, fields: [...without, field] };
      return { ...s, fields: without };
    });
    onStepsChange(next);
  };

  const removeFieldFromStep = (field: FieldKey) => {
    if (!steps) return;
    const next = steps.map((s) => ({
      ...s,
      fields: s.fields.filter((f) => f !== field),
    }));
    onStepsChange(next);
  };

  const fieldLabel = (id: string): string =>
    fields.find((f) => f.id === id)?.label?.trim() ||
    (FIELD_LABELS[id as FieldKey] ?? id);

  return (
    <div className="px-6 py-5 border-t border-gray-100 bg-gray-50/40">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-900">Form layout</h3>
          <p className="text-sm text-gray-500 mt-1">
            By default the form shows every enabled field on a single screen.
            Turn on multi-step to split fields across multiple screens — the
            customer sees a Continue button between each step.
          </p>
        </div>
        <Switch
          checked={multiStepOn}
          onCheckedChange={(checked) =>
            checked ? enableMultiStep() : disableMultiStep()
          }
        />
      </div>

      {multiStepOn && steps && (
        <div className="mt-5 space-y-4">
          {steps.map((step, idx) => {
            const stepFieldSet = new Set(step.fields);
            return (
              <div
                key={idx}
                className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold shrink-0">
                    {idx + 1}
                  </span>
                  <Input
                    value={step.heading ?? ''}
                    placeholder={`Step ${idx + 1} heading (optional)`}
                    onChange={(e) =>
                      updateStep(idx, { heading: e.target.value })
                    }
                    className="flex-1"
                    maxLength={200}
                  />
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => moveStep(idx, -1)}
                      disabled={idx === 0}
                      title="Move up"
                      className="text-gray-400 hover:text-gray-700"
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => moveStep(idx, 1)}
                      disabled={idx === steps.length - 1}
                      title="Move down"
                      className="text-gray-400 hover:text-gray-700"
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeStep(idx)}
                      title="Remove step"
                      className="text-gray-400 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-gray-500">
                    Fields on this step
                  </div>
                  {step.fields.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">
                      No fields yet — assign from the &ldquo;Unassigned&rdquo;
                      list below.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {step.fields
                        .filter((f) => enabledFields.includes(f))
                        .map((f) => (
                          <li
                            key={f}
                            className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2.5 pr-1 text-xs text-gray-800"
                          >
                            {fieldLabel(f)}
                            <button
                              type="button"
                              onClick={() =>
                                removeFieldFromStep(f as FieldKey)
                              }
                              aria-label={`Remove ${fieldLabel(f)} from step ${idx + 1}`}
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                  {/* Show any stale field references (in the step list but no longer enabled) */}
                  {step.fields.filter((f) => !enabledFields.includes(f)).length >
                    0 && (
                    <p className="text-[11px] text-amber-700">
                      {step.fields.filter((f) => !enabledFields.includes(f)).length}{' '}
                      field
                      {step.fields.filter((f) => !enabledFields.includes(f))
                        .length === 1
                        ? ''
                        : 's'}{' '}
                      on this step {step.fields.filter((f) => !enabledFields.includes(f))
                        .length === 1
                        ? 'is'
                        : 'are'}{' '}
                      no longer enabled — re-enable above to surface
                      {step.fields.filter((f) => !enabledFields.includes(f))
                        .length === 1
                        ? ' it'
                        : ' them'}
                      .
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addStep}
            disabled={steps.length >= 10}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add step
          </Button>

          {unassigned.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-medium text-amber-900 mb-1.5">
                Unassigned fields
              </div>
              <p className="text-[11px] text-amber-800 mb-2">
                These enabled fields aren&apos;t on any step yet. Pick a step
                to put them on.
              </p>
              <ul className="space-y-1.5">
                {unassigned.map((f) => (
                  <li
                    key={f}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span className="flex-1 min-w-0 truncate text-gray-800">
                      {fieldLabel(f)}
                    </span>
                    <select
                      value=""
                      onChange={(e) => {
                        const idx = parseInt(e.target.value, 10);
                        if (Number.isFinite(idx))
                          assignFieldToStep(f as FieldKey, idx);
                      }}
                      className="text-xs border border-amber-300 rounded px-2 py-1 bg-white"
                    >
                      <option value="">Assign to…</option>
                      {steps.map((s, idx) => (
                        <option key={idx} value={idx}>
                          Step {idx + 1}
                          {s.heading ? ` — ${s.heading}` : ''}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface MoveSizeOptionsSectionProps {
  value?: string[];
  onChange: (next: string[] | undefined) => void;
}

function MoveSizeOptionsSection({ value, onChange }: MoveSizeOptionsSectionProps) {
  const isCustomized = Array.isArray(value);
  const options = isCustomized ? value! : DEFAULT_MOVE_SIZE_OPTIONS;

  const update = (next: string[]) => {
    // Always treat the user as having customized once they touch the
    // editor — even an array identical to defaults is persisted, so a
    // future change to defaults doesn't silently shift this form's
    // dropdown for in-flight customers.
    onChange(next);
  };

  const updateAt = (idx: number, val: string) => {
    const next = [...options];
    next[idx] = val;
    update(next);
  };
  const removeAt = (idx: number) => {
    const next = options.filter((_, i) => i !== idx);
    update(next);
  };
  const addRow = () => {
    update([...options, '']);
  };
  const reset = () => {
    onChange(undefined);
  };

  return (
    <div className="px-6 py-5 bg-gray-50/40 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-gray-900">Move size options</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            The dropdown options the customer picks from. Order shown matches
            order saved. Leave it untouched to keep the defaults.
          </p>
        </div>
        {isCustomized && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            className="text-xs text-gray-500 hover:text-gray-900"
            title="Restore default options"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      <ul className="space-y-2">
        {options.map((opt, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <GripVertical
              className="h-4 w-4 text-gray-300 shrink-0"
              aria-hidden
            />
            <Input
              value={opt}
              onChange={(e) => updateAt(idx, e.target.value)}
              placeholder="e.g., 5+ Bedroom"
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeAt(idx)}
              className="text-gray-400 hover:text-red-600 shrink-0"
              title="Remove"
            >
              <X className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        className="text-xs"
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add option
      </Button>
    </div>
  );
}
