'use client';

// components/settings/lead-forms/tabs/AppearanceTab.tsx
//
// Appearance editor for the embed form: form text (title, subtitle, button
// label, and every other UI string the form renders), brand color, card
// background color, font, and a custom-CSS escape hatch targeting the
// stable qs-* class hooks.
//
// Validation feedback (green check on valid fields, red error border + text)
// is deliberately NOT brand-tinted — those colors carry universal meaning
// across forms and would lose clarity if recolored to a mover's brand.

import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CUSTOM_CSS_MAX,
  CUSTOM_CSS_SELECTORS,
  FONT_OPTIONS,
  googleFontHref,
  LEAD_FORM_TEXT_DEFAULTS,
  previewScreenForTextKey,
  resolveFontStack,
  type LeadFormPreviewScreen,
  type LeadFormTextKey,
} from '@/lib/leads/appearance';
import type { ILeadFormConfigTheme } from '@/models/LeadFormConfig';

interface AppearanceTabProps {
  theme: ILeadFormConfigTheme;
  onChange: (next: ILeadFormConfigTheme) => void;
  /** Called when the admin focuses a control, with the preview screen that
   *  control affects — the editor switches its live preview to match. */
  onPreviewScreenHint?: (screen: LeadFormPreviewScreen) => void;
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

const BG_PRESETS: Array<{ label: string; hex: string }> = [
  { label: 'White', hex: '#ffffff' },
  { label: 'Warm gray', hex: '#faf9f7' },
  { label: 'Cool gray', hex: '#f8fafc' },
  { label: 'Cream', hex: '#fdf6ec' },
  { label: 'Mint', hex: '#f0fdf6' },
  { label: 'Ice blue', hex: '#eff6ff' },
];

// The form's other-strings editor, grouped by the screen the string appears
// on. Order controls display; each entry's placeholder shows the shipped
// default so leaving a field blank keeps it.
interface TextFieldDef {
  key: LeadFormTextKey;
  label: string;
  hint?: string;
}

const TEXT_GROUPS: Array<{
  heading: string;
  note?: string;
  fields: TextFieldDef[];
}> = [
  {
    heading: 'Form navigation',
    fields: [
      { key: 'continueButton', label: 'Continue button (multi-step)' },
      { key: 'backButton', label: 'Back button (multi-step)' },
    ],
  },
  {
    heading: 'Thank-you & errors',
    fields: [
      { key: 'successTitle', label: 'Thank-you heading' },
      {
        key: 'successFallbackMessage',
        label: 'Thank-you fallback message',
        hint: 'Shown only when no thank-you message is configured on the Post-submit tab.',
      },
      { key: 'errorTitle', label: 'Error heading' },
      { key: 'errorRetryButton', label: 'Error retry button' },
      { key: 'errorBackButton', label: 'Error back button' },
    ],
  },
  {
    heading: 'Validation messages',
    fields: [
      {
        key: 'requiredSuffix',
        label: 'Required-field message',
        hint: 'Appended after the field label, e.g. "Email is required".',
      },
      { key: 'invalidEmail', label: 'Invalid email message' },
    ],
  },
  {
    heading: 'Self-survey chooser',
    note: 'Shown after submitting when the form pushes to self-survey or lets the customer choose.',
    fields: [
      {
        key: 'chooserThanksTitle',
        label: 'Heading',
        hint: '{name} is replaced with the customer’s first name.',
      },
      { key: 'chooserThanksMessage', label: 'Confirmation line' },
      { key: 'chooserPrompt', label: 'Call-to-action line' },
      { key: 'chooserRecordTitle', label: 'Record Video option — title' },
      { key: 'chooserRecordDescription', label: 'Record Video option — description' },
      { key: 'chooserPhotosTitle', label: 'Photos option — title' },
      { key: 'chooserPhotosDescription', label: 'Photos option — description' },
      { key: 'chooserScheduleTitle', label: 'Schedule option — title' },
      { key: 'chooserScheduleDescription', label: 'Schedule option — description' },
      { key: 'chooserSecurityNote', label: 'Privacy footer' },
    ],
  },
  {
    heading: 'Call scheduler',
    note: 'Shown when the customer schedules a virtual call inside the form.',
    fields: [
      {
        key: 'scheduleTitle',
        label: 'Heading',
        hint: '{name} is replaced with the customer’s first name.',
      },
      { key: 'scheduleSubtitle', label: 'Subheading' },
      { key: 'scheduleButton', label: 'Confirm button' },
      { key: 'scheduleNoSlots', label: 'No-open-times message' },
      { key: 'scheduleBookedTitle', label: 'Booked — heading' },
      { key: 'scheduleBookedMessage', label: 'Booked — lead-in line' },
      { key: 'scheduleBookedSms', label: 'Booked — SMS note' },
    ],
  },
];

// Copy-paste recipes for the developer guide under the Custom CSS editor.
// Each is valid CSS against the qs-* hooks; keep them working when the embed
// markup changes.
const CSS_RECIPES: Array<{ title: string; note?: string; css: string }> = [
  {
    title: 'Match your site’s card style',
    css: `.qs-form-card {
  border-radius: 4px;
  box-shadow: none;
  border: 1px solid #d1d5db;
}`,
  },
  {
    title: 'Restyle the buttons',
    note: 'Button and focus-ring colors are set inline by the brand color, so overriding them needs !important.',
    css: `.qs-submit-button,
.qs-continue-button {
  background-color: #0f766e !important;
  border-radius: 6px !important;
  text-transform: uppercase;
  letter-spacing: 1px;
}`,
  },
  {
    title: 'Style one specific field',
    note: 'Every field block gets qs-field-<id>: qs-field-email, qs-field-phone, qs-field-moveDate, qs-field-origin, … Custom fields use qs-field-cf-<id>.',
    css: `.qs-field-email .qs-input {
  background: #f8fafc;
}`,
  },
  {
    title: 'Hide an element',
    css: `.qs-progress {
  display: none;
}`,
  },
  {
    title: 'Typography tweaks',
    note: 'Pick the base font with the Font setting above; use CSS for size and weight.',
    css: `.qs-title {
  font-size: 28px;
  font-weight: 800;
}
.qs-input,
.qs-label {
  font-size: 15px;
}`,
  },
  {
    title: 'Focus and error states',
    css: `.qs-input:focus {
  border-color: #0f766e !important;
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.2) !important;
}
.qs-field-error {
  font-weight: 600;
}`,
  },
];

// Loose hex validator — accepts #RGB or #RRGGBB. We don't bounce arbitrary
// strings (the model's comment says "do not validate"), we just guard the
// preview so an in-progress typed value doesn't render as garbage.
function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

// Load a Google Font stylesheet into the editor page so the font dropdown
// and live preview render in the actual typeface.
function useGoogleFont(fontFamily?: string) {
  const href = googleFontHref(fontFamily);
  useEffect(() => {
    if (!href) return;
    if (document.head.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }, [href]);
}

function SectionCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-gray-100">
        <h2 className="text-base font-medium text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
      <div className="px-6 py-5 space-y-5">{children}</div>
      {footer}
    </div>
  );
}

export function AppearanceTab({ theme, onChange, onPreviewScreenHint }: AppearanceTabProps) {
  const hintForm = () => onPreviewScreenHint?.('form');
  // Local mirror of the hex strings so typing partial values (e.g. "#25")
  // doesn't re-render the parent or the preview with broken color. We only
  // push up to the parent once the value parses as a valid hex.
  const [hexDraft, setHexDraft] = useState(theme.buttonColor);
  const [bgDraft, setBgDraft] = useState(theme.backgroundColor ?? '#ffffff');
  const [showMoreText, setShowMoreText] = useState(
    () => Object.values(theme.text ?? {}).some((v) => (v ?? '').trim()),
  );
  const [showDevGuide, setShowDevGuide] = useState(false);
  const [copiedRecipe, setCopiedRecipe] = useState<number | null>(null);

  const copyRecipe = async (index: number, css: string) => {
    try {
      await navigator.clipboard.writeText(css);
      setCopiedRecipe(index);
      setTimeout(() => setCopiedRecipe((c) => (c === index ? null : c)), 2000);
    } catch {
      // Clipboard unavailable (permissions/http) — the user can still select
      // the text manually, so stay quiet.
    }
  };

  // Keep drafts in sync if the parent's theme changes from outside
  // (initial load, preset click round-trip).
  useEffect(() => {
    setHexDraft(theme.buttonColor);
  }, [theme.buttonColor]);
  useEffect(() => {
    setBgDraft(theme.backgroundColor ?? '#ffffff');
  }, [theme.backgroundColor]);

  useGoogleFont(theme.fontFamily);

  const liveColor = isValidHex(hexDraft) ? hexDraft : theme.buttonColor;
  const liveBg = isValidHex(bgDraft) ? bgDraft : (theme.backgroundColor ?? '#ffffff');
  const liveFontStack = resolveFontStack(theme.fontFamily);

  const commitColor = (next: string) => {
    setHexDraft(next);
    if (isValidHex(next)) {
      onChange({ ...theme, buttonColor: next });
    }
  };

  const commitBg = (next: string) => {
    setBgDraft(next);
    if (isValidHex(next)) {
      // Plain white is the default — store nothing so old-config behavior
      // (and future default changes) keep applying.
      onChange({
        ...theme,
        backgroundColor: next.toLowerCase() === '#ffffff' ? undefined : next,
      });
    }
  };

  const setTextOverride = (key: LeadFormTextKey, value: string) => {
    const next = { ...(theme.text ?? {}) };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    onChange({
      ...theme,
      text: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Form text"
        description="Every piece of text the form shows — the heading, button labels, thank-you and error screens, and validation messages."
      >
        <div className="space-y-1.5">
          <Label htmlFor="form-text-title" className="text-xs text-gray-700">
            Title
          </Label>
          <Input
            id="form-text-title"
            type="text"
            value={theme.title}
            onChange={(e) => onChange({ ...theme, title: e.target.value })}
            onFocus={hintForm}
            placeholder="Get a Quote"
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="form-text-subtitle" className="text-xs text-gray-700">
            Subtitle <span className="text-gray-400 font-normal">(optional)</span>
          </Label>
          <Textarea
            id="form-text-subtitle"
            value={theme.subtitle ?? ''}
            onChange={(e) =>
              onChange({ ...theme, subtitle: e.target.value || undefined })
            }
            onFocus={hintForm}
            placeholder="e.g., Tell us about your move and we'll get right back to you."
            maxLength={500}
            rows={2}
          />
          <p className="text-xs text-gray-500">
            Smaller note shown under the title. Leave blank to hide it.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="form-text-button" className="text-xs text-gray-700">
            Submit button text
          </Label>
          <Input
            id="form-text-button"
            type="text"
            value={theme.buttonText}
            onChange={(e) => onChange({ ...theme, buttonText: e.target.value })}
            onFocus={hintForm}
            placeholder="Get a Quote"
            maxLength={80}
            className="max-w-xs"
          />
        </div>

        {/* Everything-else strings, collapsed by default. Blank = keep the
            standard wording (shown as the placeholder). */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowMoreText((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            aria-expanded={showMoreText}
          >
            <ChevronDown
              className={
                'h-4 w-4 transition-transform ' + (showMoreText ? 'rotate-180' : '')
              }
            />
            All other text (buttons, messages, errors)
          </button>
          {showMoreText && (
            <div className="mt-4 space-y-6">
              {TEXT_GROUPS.map((group) => (
                <div key={group.heading} className="space-y-3">
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {group.heading}
                    </div>
                    {group.note && (
                      <p className="text-xs text-gray-500 mt-0.5">{group.note}</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                    {group.fields.map(({ key, label, hint }) => (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={`form-text-${key}`} className="text-xs text-gray-700">
                          {label}
                        </Label>
                        <Input
                          id={`form-text-${key}`}
                          type="text"
                          value={theme.text?.[key] ?? ''}
                          onChange={(e) => setTextOverride(key, e.target.value)}
                          onFocus={() =>
                            onPreviewScreenHint?.(previewScreenForTextKey(key))
                          }
                          placeholder={LEAD_FORM_TEXT_DEFAULTS[key]}
                          maxLength={300}
                        />
                        {hint && <p className="text-xs text-gray-500">{hint}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-gray-500">
                Leave a field blank to use the standard wording shown as the
                placeholder. Field labels are edited on the Fields tab; the
                thank-you message on the Post-submit tab.
              </p>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Brand color"
        description="One color drives every accent on your form — primary buttons, the progress indicator, focus rings, and the success badge."
      >
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
            onFocus={hintForm}
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
            onFocus={hintForm}
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
              const selected = hexDraft.toLowerCase() === p.hex.toLowerCase();
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
      </SectionCard>

      <SectionCard
        title="Background color"
        description="The form card's background. Keep it light — the form's text stays dark, so dark backgrounds will hurt readability."
      >
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bg-color-picker" className="text-xs text-gray-700">
              Color
            </Label>
            <input
              id="bg-color-picker"
            onFocus={hintForm}
              type="color"
              value={isValidHex(bgDraft) ? bgDraft : '#ffffff'}
              onChange={(e) => commitBg(e.target.value)}
              className="h-10 w-12 rounded-md border border-gray-300 bg-white p-0.5 cursor-pointer"
              aria-label="Pick background color"
            />
          </div>

          <div className="flex-1 space-y-1.5">
            <Label htmlFor="bg-color-hex" className="text-xs text-gray-700">
              Hex
            </Label>
            <Input
              id="bg-color-hex"
            onFocus={hintForm}
              type="text"
              value={bgDraft}
              onChange={(e) => commitBg(e.target.value.trim())}
              placeholder="#ffffff"
              maxLength={30}
              className="font-mono text-sm"
            />
          </div>

          <div
            className="h-10 w-10 rounded-md border border-gray-200 shrink-0"
            style={{ backgroundColor: liveBg }}
            aria-hidden
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Quick picks
          </div>
          <div className="flex flex-wrap gap-2">
            {BG_PRESETS.map((p) => {
              const selected = bgDraft.toLowerCase() === p.hex.toLowerCase();
              return (
                <button
                  key={p.hex}
                  type="button"
                  onClick={() => commitBg(p.hex)}
                  title={`${p.label} — ${p.hex}`}
                  className={
                    'relative h-8 w-8 rounded-full border-2 transition-all ' +
                    (selected
                      ? 'border-gray-900 scale-110'
                      : 'border-gray-200 shadow-sm hover:scale-105')
                  }
                  style={{ backgroundColor: p.hex }}
                  aria-label={`Use ${p.label}`}
                  aria-pressed={selected}
                >
                  {selected && (
                    <Check
                      className="h-4 w-4 text-gray-700 absolute inset-0 m-auto"
                      strokeWidth={3}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Font"
        description="The typeface for everything on the form. Google Fonts load automatically on your site; system fonts use what the visitor already has."
      >
        <div className="space-y-1.5 max-w-xs">
          <Label htmlFor="form-font" className="text-xs text-gray-700">
            Font family
          </Label>
          <select
            id="form-font"
            onFocus={hintForm}
            value={theme.fontFamily ?? ''}
            onChange={(e) =>
              onChange({ ...theme, fontFamily: e.target.value || undefined })
            }
            className="w-full h-10 px-3 rounded-md border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div
          className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900"
          style={liveFontStack ? { fontFamily: liveFontStack } : undefined}
        >
          <div className="text-lg font-semibold">Get a Quote</div>
          <div className="text-sm text-gray-600 mt-0.5">
            Tell us about your move and we&apos;ll get right back to you.
          </div>
        </div>
      </SectionCard>

      {/* Live preview — shows what the appearance settings actually drive in
          the embed form. Updates live so the mover can judge contrast before
          saving. */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-5 bg-gray-50/40">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
            Live preview
          </div>
          <div
            className="rounded-xl border border-gray-200 p-5 space-y-4"
            style={{
              backgroundColor: liveBg,
              ...(liveFontStack ? { fontFamily: liveFontStack } : {}),
            }}
          >
            {/* Title + subtitle, mirroring the embed's header block */}
            <div>
              <h2 className="text-center text-lg font-semibold text-gray-900">
                {theme.title || 'Get a Quote'}
              </h2>
              {theme.subtitle?.trim() && (
                <p className="text-center text-gray-500 text-sm mt-1">
                  {theme.subtitle}
                </p>
              )}
            </div>
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
                  ...(liveFontStack ? { fontFamily: liveFontStack } : {}),
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
              style={{
                backgroundColor: liveColor,
                ...(liveFontStack ? { fontFamily: liveFontStack } : {}),
              }}
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

      <SectionCard
        title="Custom CSS"
        description="Advanced: inject your own CSS into the embedded form. Target the stable qs- class names below — they won't change between releases."
      >
        <Textarea
          id="custom-css"
          value={theme.customCss ?? ''}
          onChange={(e) =>
            onChange({ ...theme, customCss: e.target.value || undefined })
          }
          onFocus={hintForm}
          placeholder={
            '.qs-form-card {\n  border-radius: 4px;\n  box-shadow: none;\n}\n\n.qs-title {\n  text-transform: uppercase;\n}'
          }
          rows={8}
          maxLength={CUSTOM_CSS_MAX}
          className="font-mono text-xs leading-relaxed"
          spellCheck={false}
        />
        <p className="text-xs text-gray-500">
          Applies only inside your embedded form&apos;s iframe — it cannot
          affect the rest of your website. {CUSTOM_CSS_MAX.toLocaleString()}{' '}
          character limit.
        </p>

        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
            Selector reference
          </div>
          <dl className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {CUSTOM_CSS_SELECTORS.map(({ selector, description }) => (
              <div key={selector} className="flex items-start gap-3 px-3 py-1.5 text-xs">
                <dt className="w-44 flex-shrink-0 font-mono text-gray-800">
                  {selector}
                </dt>
                <dd className="flex-1 text-gray-500">{description}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Developer how-to: how injection works + copy-paste recipes. */}
        <div>
          <button
            type="button"
            onClick={() => setShowDevGuide((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            aria-expanded={showDevGuide}
          >
            <ChevronDown
              className={
                'h-4 w-4 transition-transform ' + (showDevGuide ? 'rotate-180' : '')
              }
            />
            Developer guide: injecting styles
          </button>

          {showDevGuide && (
            <div className="mt-4 space-y-5 text-sm text-gray-700">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  How it works
                </h3>
                <ol className="list-decimal ml-5 space-y-1 text-sm text-gray-600">
                  <li>
                    Write standard CSS in the box above and save the form. No
                    <code className="mx-1 px-1 py-0.5 rounded bg-gray-100 font-mono text-xs">&lt;style&gt;</code>
                    tags — just rules.
                  </li>
                  <li>
                    On save, the CSS is stored with this form and injected as a
                    stylesheet inside the embed iframe, after the form&apos;s own
                    styles. Visitors get it on the next page load — no
                    re-embedding needed.
                  </li>
                  <li>
                    It is scoped to the iframe: your rules cannot leak out to
                    the host website, and the host website&apos;s CSS cannot reach
                    in. To style the page <em>around</em> the iframe, use your
                    own site&apos;s stylesheet instead.
                  </li>
                </ol>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  Targeting rules
                </h3>
                <ul className="list-disc ml-5 space-y-1 text-sm text-gray-600">
                  <li>
                    Use the <code className="px-1 py-0.5 rounded bg-gray-100 font-mono text-xs">qs-</code>{' '}
                    classes from the reference above — they are stable across
                    releases. Anything else (Tailwind utility classes, DOM
                    structure) can change without notice.
                  </li>
                  <li>
                    Plain class selectors win against the form&apos;s utility
                    classes because your stylesheet loads last. Add{' '}
                    <code className="px-1 py-0.5 rounded bg-gray-100 font-mono text-xs">!important</code>{' '}
                    only where the form sets inline styles: brand-colored
                    button backgrounds, input focus borders/rings, and progress
                    dot colors.
                  </li>
                  <li>
                    Per-field hooks:{' '}
                    <code className="px-1 py-0.5 rounded bg-gray-100 font-mono text-xs">.qs-field-email</code>,{' '}
                    <code className="px-1 py-0.5 rounded bg-gray-100 font-mono text-xs">.qs-field-phone</code>,{' '}
                    <code className="px-1 py-0.5 rounded bg-gray-100 font-mono text-xs">.qs-field-moveDate</code>{' '}
                    etc. (the field ids from the Fields tab); custom fields get{' '}
                    <code className="px-1 py-0.5 rounded bg-gray-100 font-mono text-xs">.qs-field-cf-&lt;id&gt;</code>.
                  </li>
                  <li>
                    Test with the form editor&apos;s preview (submissions are
                    simulated) before rolling out — a broken rule can&apos;t take
                    your site down, but it can make the form hard to read.
                  </li>
                </ul>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">Recipes</h3>
                {CSS_RECIPES.map((recipe, i) => (
                  <div
                    key={recipe.title}
                    className="rounded-lg border border-gray-200 overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50">
                      <div className="text-xs font-medium text-gray-700">
                        {recipe.title}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyRecipe(i, recipe.css)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-100 transition-colors"
                      >
                        {copiedRecipe === i ? (
                          <>
                            <Check className="w-3 h-3 text-green-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    {recipe.note && (
                      <p className="px-3 pt-2 text-xs text-gray-500">
                        {recipe.note}
                      </p>
                    )}
                    <pre className="px-3 py-2 text-xs font-mono text-gray-800 whitespace-pre overflow-x-auto">
                      {recipe.css}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
