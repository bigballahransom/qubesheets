'use client';

// components/settings/lead-forms/tabs/FieldsTab.tsx
//
// Enabled / Required switches per FieldKey. Phone is locked to required.
// Move Size also gets a per-form editable list of dropdown options
// below the field grid (only when Move Size is enabled).

import { useState } from 'react';
import { ChevronDown, GripVertical, Lock, Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { FieldKey, ILeadFormConfigField } from '@/models/LeadFormConfig';

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
  moveSizeOptions?: string[];
  onMoveSizeOptionsChange?: (next: string[] | undefined) => void;
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
  moveSizeOptions,
  onMoveSizeOptionsChange,
}: FieldsTabProps) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const [moveSizeOpen, setMoveSizeOpen] = useState(false);
  const moveSizeEnabled = !!byId.get('moveSize')?.enabled;

  const sorted = FIELD_ORDER.map((id) => {
    const existing = byId.get(id);
    if (existing) return existing;
    return { id, enabled: false, required: false } as ILeadFormConfigField;
  });

  const updateField = (
    id: FieldKey,
    patch: Partial<Pick<ILeadFormConfigField, 'enabled' | 'required'>>
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
        return (
          <div key={field.id}>
            <div className="px-6 py-4 grid grid-cols-12 gap-4 items-center">
              <div className="col-span-6 text-sm font-medium text-gray-900 flex items-center gap-2">
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
                    {FIELD_LABELS[field.id]}
                    <span className="text-xs font-normal text-gray-400 ml-1">
                      ({(moveSizeOptions ?? []).length || 'default'}{' '}
                      {(moveSizeOptions ?? []).length === 1 ? 'option' : 'options'})
                    </span>
                  </button>
                ) : (
                  FIELD_LABELS[field.id]
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
