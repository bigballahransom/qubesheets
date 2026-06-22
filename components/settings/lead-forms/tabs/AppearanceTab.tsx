'use client';

// components/settings/lead-forms/tabs/AppearanceTab.tsx
//
// Brand color editor for the embed form. The form card itself is always
// white; this color drives every brand-tinted accent inside it: primary
// buttons (Continue / Submit), the wizard progress dots, the focus ring on
// every input, and the success badge that surrounds the post-submit
// checkmark.
//
// Validation feedback (green check on valid fields, red error border + text)
// is deliberately NOT brand-tinted — those colors carry universal meaning
// across forms and would lose clarity if recolored to a mover's brand.

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ILeadFormConfigTheme } from '@/models/LeadFormConfig';

interface AppearanceTabProps {
  theme: ILeadFormConfigTheme;
  onChange: (next: ILeadFormConfigTheme) => void;
}

const PRESETS: Array<{ label: string; hex: string }> = [
  { label: 'Qube blue', hex: '#2563eb' },
  { label: 'Indigo', hex: '#4f46e5' },
  { label: 'Slate', hex: '#0f172a' },
  { label: 'Emerald', hex: '#10b981' },
  { label: 'Amber', hex: '#f59e0b' },
  { label: 'Rose', hex: '#e11d48' },
  { label: 'Fuchsia', hex: '#c026d3' },
  { label: 'Sky', hex: '#0284c7' },
];

// Loose hex validator — accepts #RGB or #RRGGBB. We don't bounce arbitrary
// strings (the model's comment says "do not validate"), we just guard the
// preview so an in-progress typed value doesn't render as garbage.
function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

export function AppearanceTab({ theme, onChange }: AppearanceTabProps) {
  // Local mirror of the hex string so typing partial values (e.g. "#25") doesn't
  // re-render the parent or the preview with broken color. We only push up to
  // the parent once the value parses as a valid hex.
  const [hexDraft, setHexDraft] = useState(theme.buttonColor);

  // Keep hexDraft in sync if the parent's theme changes from outside
  // (initial load, preset click round-trip).
  useEffect(() => {
    setHexDraft(theme.buttonColor);
  }, [theme.buttonColor]);

  const liveColor = isValidHex(hexDraft) ? hexDraft : theme.buttonColor;

  const commitColor = (next: string) => {
    setHexDraft(next);
    if (isValidHex(next)) {
      onChange({ ...theme, buttonColor: next });
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-base font-medium text-gray-900">Brand color</h2>
          <p className="text-sm text-gray-500 mt-1">
            One color drives every accent on your form — primary buttons, the
            progress indicator, focus rings, and the success badge. The card
            itself stays white so the form looks clean on any background.
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Picker + hex input */}
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="brand-color-picker" className="text-xs text-gray-700">
                Color
              </Label>
              {/* Native color input — universal, no dep. The visible swatch
                  beside it is intentional duplication for users who don't
                  realize the small square IS the picker. */}
              <input
                id="brand-color-picker"
                type="color"
                value={isValidHex(hexDraft) ? hexDraft : '#2563eb'}
                onChange={(e) => commitColor(e.target.value)}
                className="h-10 w-12 rounded-md border border-gray-300 bg-white p-0.5 cursor-pointer"
                aria-label="Pick brand color"
              />
            </div>

            <div className="flex-1 space-y-1.5">
              <Label htmlFor="brand-color-hex" className="text-xs text-gray-700">
                Hex
              </Label>
              <Input
                id="brand-color-hex"
                type="text"
                value={hexDraft}
                onChange={(e) => commitColor(e.target.value.trim())}
                placeholder="#2563eb"
                maxLength={30}
                className="font-mono text-sm"
              />
            </div>

            <div
              className="h-10 w-10 rounded-md border border-gray-200 shrink-0"
              style={{ backgroundColor: liveColor }}
              aria-hidden
            />
          </div>

          {/* Presets — quick jumps for movers without a brand color in hand */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Quick picks
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => {
                const selected =
                  hexDraft.toLowerCase() === p.hex.toLowerCase();
                return (
                  <button
                    key={p.hex}
                    type="button"
                    onClick={() => commitColor(p.hex)}
                    title={`${p.label} — ${p.hex}`}
                    className={
                      'relative h-8 w-8 rounded-full border-2 transition-all ' +
                      (selected
                        ? 'border-gray-900 scale-110'
                        : 'border-white shadow-sm hover:scale-105')
                    }
                    style={{ backgroundColor: p.hex }}
                    aria-label={`Use ${p.label}`}
                    aria-pressed={selected}
                  >
                    {selected && (
                      <Check
                        className="h-4 w-4 text-white absolute inset-0 m-auto"
                        strokeWidth={3}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Live preview — shows what the brand color actually drives in the
            embed form. Updates live as the picker moves so the mover can
            judge contrast against the white card before saving. */}
        <div className="px-6 py-5 border-t border-gray-100 bg-gray-50/40">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
            Live preview
          </div>
          <div className="rounded-xl bg-white border border-gray-200 p-5 space-y-4">
            {/* Progress dots */}
            <div className="flex items-center justify-center gap-1.5">
              <div
                className="h-1.5 rounded-full"
                style={{ width: 28, backgroundColor: liveColor }}
              />
              <div
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: '#e5e7eb' }}
              />
              <div
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: '#e5e7eb' }}
              />
            </div>
            {/* Sample input with focused brand-color ring */}
            <div className="relative">
              <input
                type="text"
                defaultValue="jane@example.com"
                className="peer w-full px-4 pt-5 pb-1.5 bg-white text-gray-900 rounded-xl border shadow-sm text-base focus:outline-none"
                style={{
                  borderColor: liveColor,
                  boxShadow: `0 0 0 3px ${liveColor}33`,
                }}
                readOnly
              />
              <label
                className="absolute left-4 top-1 text-[11px] font-medium select-none pointer-events-none"
                style={{ color: liveColor }}
              >
                Email
              </label>
            </div>
            {/* Primary button */}
            <button
              type="button"
              className="w-full h-12 rounded-xl text-white font-semibold text-base shadow-sm"
              style={{ backgroundColor: liveColor }}
              disabled
            >
              {theme.buttonText || 'Get a Quote'}
            </button>
            {/* Success badge */}
            <div className="flex items-center justify-center gap-3 pt-1">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: liveColor }}
              >
                <Check className="w-6 h-6 text-white" strokeWidth={3} />
              </div>
              <div className="text-sm text-gray-600">
                Confirmation screen badge
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
