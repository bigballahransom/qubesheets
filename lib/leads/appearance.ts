// lib/leads/appearance.ts
//
// Client-safe appearance helpers shared by the embed form and the lead-form
// editor: the curated font list (with Google Fonts loading metadata), the
// default UI strings that theme.text can override, custom-CSS sanitization,
// and the stable `qs-*` selector reference the editor documents.
//
// No server-only imports — this file is bundled into the public embed.

export interface FontOption {
  /** Stored in theme.fontFamily. Empty string = system default. */
  value: string;
  label: string;
  /** Full CSS font-family stack applied to the embed root. */
  stack: string;
  /** Set for fonts fetched from Google Fonts; used to build the <link> href. */
  googleFamily?: string;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    value: '',
    label: 'System default',
    stack:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  { value: 'Inter', label: 'Inter', stack: '"Inter", ui-sans-serif, system-ui, sans-serif', googleFamily: 'Inter' },
  { value: 'Roboto', label: 'Roboto', stack: '"Roboto", ui-sans-serif, system-ui, sans-serif', googleFamily: 'Roboto' },
  { value: 'Open Sans', label: 'Open Sans', stack: '"Open Sans", ui-sans-serif, system-ui, sans-serif', googleFamily: 'Open Sans' },
  { value: 'Lato', label: 'Lato', stack: '"Lato", ui-sans-serif, system-ui, sans-serif', googleFamily: 'Lato' },
  { value: 'Montserrat', label: 'Montserrat', stack: '"Montserrat", ui-sans-serif, system-ui, sans-serif', googleFamily: 'Montserrat' },
  { value: 'Poppins', label: 'Poppins', stack: '"Poppins", ui-sans-serif, system-ui, sans-serif', googleFamily: 'Poppins' },
  { value: 'Nunito', label: 'Nunito', stack: '"Nunito", ui-sans-serif, system-ui, sans-serif', googleFamily: 'Nunito' },
  { value: 'Raleway', label: 'Raleway', stack: '"Raleway", ui-sans-serif, system-ui, sans-serif', googleFamily: 'Raleway' },
  { value: 'Playfair Display', label: 'Playfair Display', stack: '"Playfair Display", Georgia, serif', googleFamily: 'Playfair Display' },
  { value: 'Merriweather', label: 'Merriweather', stack: '"Merriweather", Georgia, serif', googleFamily: 'Merriweather' },
  { value: 'Georgia', label: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
  { value: 'Arial', label: 'Arial / Helvetica', stack: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { value: 'Courier New', label: 'Courier New', stack: '"Courier New", Courier, monospace' },
];

export function fontOptionFor(fontFamily?: string): FontOption | undefined {
  if (!fontFamily) return undefined;
  return FONT_OPTIONS.find((f) => f.value === fontFamily);
}

/** CSS font-family stack for a stored theme.fontFamily, or undefined for default. */
export function resolveFontStack(fontFamily?: string): string | undefined {
  return fontOptionFor(fontFamily)?.stack;
}

/** Google Fonts stylesheet URL when the chosen font needs loading, else null. */
export function googleFontHref(fontFamily?: string): string | null {
  const opt = fontOptionFor(fontFamily);
  if (!opt?.googleFamily) return null;
  const family = encodeURIComponent(opt.googleFamily).replace(/%20/g, '+');
  return `https://fonts.googleapis.com/css2?family=${family}:wght@400;500;600;700&display=swap`;
}

// --- Editable UI text -------------------------------------------------------

/**
 * Every static string the embed form renders, keyed for theme.text overrides.
 * The form falls back to these defaults key-by-key, so a config saved before
 * this feature (or with only some keys set) renders identically to before.
 */
export const LEAD_FORM_TEXT_DEFAULTS = {
  continueButton: 'Continue',
  backButton: 'Back',
  successTitle: 'Thank you!',
  successFallbackMessage: 'Thanks — we received your request.',
  errorTitle: 'Something went wrong',
  errorRetryButton: 'Try again',
  errorBackButton: 'Back to form',
  /** Appended after the field label: "Email is required". */
  requiredSuffix: 'is required',
  invalidEmail: 'Please enter a valid email address',

  // Self-survey chooser (shown after submit for "Push to self-survey" and
  // "Let the customer choose"). {name} is replaced with the customer's
  // first name — see formatWithName.
  chooserThanksTitle: 'Thanks, {name}!',
  chooserThanksMessage:
    "We've received your information and will get back to you shortly.",
  chooserPrompt:
    'Skip the wait and lock in an accurate quote — just walk us through your home below.',
  chooserRecordTitle: 'Record Video',
  chooserRecordDescription: 'Walk through your home and record your belongings',
  chooserPhotosTitle: 'Take or Upload Photos',
  chooserPhotosDescription: 'Snap photos in-app or pick from your photo library',
  chooserScheduleTitle: 'Schedule a virtual call',
  chooserScheduleDescription:
    'Talk live with our team to walk through your home together',
  chooserSecurityNote: 'Your media is private and secure',

  // Call scheduler (shown for "Schedule a virtual call"). {name} as above.
  scheduleTitle: 'Pick a time, {name}',
  scheduleSubtitle: "We'll text you a confirmation and a video-call link.",
  scheduleButton: 'Schedule Virtual Walk-through',
  scheduleNoSlots:
    "We don't have any open times in the next week. We'll reach out to you directly to find a time that works.",
  scheduleBookedTitle: "You're on the calendar!",
  scheduleBookedMessage: 'We scheduled your virtual call for',
  scheduleBookedSms: 'We just texted you a confirmation with the join link.',
} as const;

/**
 * Fill the {name} token in a text template. With no name available, the
 * token is removed along with a leading ", " and a trailing "!"/"." keeps
 * its place — so 'Thanks, {name}!' degrades to 'Thanks!' and
 * 'Pick a time, {name}' to 'Pick a time'.
 */
export function formatWithName(template: string, name?: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed) return template.split('{name}').join(trimmed);
  return template
    .replace(/[,\s]*\{name\}/g, '')
    .replace(/\s+([!.?,])/g, '$1')
    .trim();
}

export type LeadFormTextKey = keyof typeof LEAD_FORM_TEXT_DEFAULTS;

export type LeadFormTextOverrides = Partial<Record<LeadFormTextKey, string>>;

export function resolveText(
  overrides: LeadFormTextOverrides | undefined,
  key: LeadFormTextKey,
): string {
  const custom = overrides?.[key];
  return typeof custom === 'string' && custom.trim()
    ? custom
    : LEAD_FORM_TEXT_DEFAULTS[key];
}

// --- Live draft preview -----------------------------------------------------

/**
 * Screens the editor's live preview can display. 'form' is the interactive
 * form itself; the rest are the post-submit views rendered with mock data.
 */
export type LeadFormPreviewScreen =
  | 'form'
  | 'success'
  | 'chooser'
  | 'schedule'
  | 'error';

/** Which preview screen a theme.text key belongs to — drives the editor's
 *  auto-switching so the preview always shows the string being edited. */
export function previewScreenForTextKey(key: LeadFormTextKey): LeadFormPreviewScreen {
  if (key.startsWith('chooser')) return 'chooser';
  if (key.startsWith('schedule')) return 'schedule';
  if (key.startsWith('success')) return 'success';
  if (key.startsWith('error')) return 'error';
  return 'form';
}

// --- Custom CSS -------------------------------------------------------------

export const CUSTOM_CSS_MAX = 20000;

/**
 * Neutralize the only dangerous sequence in author CSS: a closing </style>
 * tag, which would break out of the injected <style> element and allow
 * arbitrary HTML (script) injection into the embed page. Everything else is
 * plain CSS scoped to the org's own iframe.
 */
export function sanitizeCustomCss(css: string): string {
  return css.replace(/<\s*\/\s*style/gi, '').slice(0, CUSTOM_CSS_MAX);
}

/**
 * Stable selectors exposed on the embed form for custom-CSS targeting.
 * Rendered as a reference table in the editor — keep in sync with the
 * class names in LeadForm/EmbedShell.
 */
export const CUSTOM_CSS_SELECTORS: Array<{ selector: string; description: string }> = [
  { selector: '.qs-embed-root', description: 'Outermost wrapper around every view' },
  { selector: '.qs-form-card', description: 'The white form card' },
  { selector: '.qs-logo', description: 'Your logo image' },
  { selector: '.qs-title', description: 'Form title' },
  { selector: '.qs-subtitle', description: 'Form subtitle' },
  { selector: '.qs-progress', description: 'Multi-step progress dots' },
  { selector: '.qs-step-heading', description: 'Per-step heading' },
  { selector: '.qs-field', description: 'One field block (input + label + error)' },
  { selector: '.qs-field-email', description: 'A specific field block (any field id)' },
  { selector: '.qs-input', description: 'Inputs, selects, and textareas' },
  { selector: '.qs-label', description: 'Floating field labels' },
  { selector: '.qs-field-error', description: 'Inline validation message' },
  { selector: '.qs-submit-button', description: 'Submit button' },
  { selector: '.qs-continue-button', description: 'Continue button (multi-step)' },
  { selector: '.qs-back-button', description: 'Back button (multi-step)' },
  { selector: '.qs-success-card', description: 'Thank-you card' },
  { selector: '.qs-success-title', description: 'Thank-you heading' },
  { selector: '.qs-success-message', description: 'Thank-you message' },
  { selector: '.qs-chooser-card', description: 'Self-survey chooser card' },
  { selector: '.qs-chooser-option', description: 'Chooser option buttons' },
  { selector: '.qs-schedule-card', description: 'Call scheduler card' },
  { selector: '.qs-slot-button', description: 'Scheduler time-slot buttons' },
  { selector: '.qs-schedule-button', description: 'Scheduler confirm button' },
];
