// components/embed/LeadForm.tsx
//
// Client-side lead-capture form rendered inside the iframe at /embed/:configId.
//
// Architecture: a wizard that defaults to a single-step "all fields on one
// page" view (original behavior), upgrading to multi-step when the admin
// configures `steps`. Same StepContent renderer handles both cases.
//
// Premium polish in this revision:
//   - Floating labels on every input (Airbnb / Stripe / Linear pattern)
//   - Per-field inline validation: error animates in below field, green
//     check renders on the right edge for valid required fields on blur
//   - "Verified" pill on address fields when Google Places confirms a real address
//   - Focus management — first input of a new step receives focus after the
//     spring transition lands
//   - Respects `prefers-reduced-motion` (springs flatten to instant)
//   - No state persistence across page loads — refresh deliberately resets
//     the form so a returning visitor never sees a stranger's stale data
//     and a customer submitting a second request starts clean
//   - postMessage iframe height on every animation completion + on
//     ResizeObserver continuous changes, so the host iframe resizes smoothly
//   - Container-query padding tightens at narrow widths (real iframes on
//     mobile can hit ~320 px wide)
//   - Skeleton placeholders for the dynamically-loaded action views
//   - Error recovery: a failed submit doesn't wipe the form; the customer
//     can retry without re-typing
//
// Heavy dependencies (Google Maps Places, ScheduleCallView, UploadChooser) are
// lazy-loaded with skeleton placeholders so the initial paint is fast and
// the first interaction doesn't wait on the ~150 KB Maps bundle.
//
// Server-only code (Mongoose models, DB connections) is never imported here.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  Eye,
  Loader2,
  MapPin,
} from 'lucide-react';
import { format, parse, isValid } from 'date-fns';
import { useLoadScript } from '@react-google-maps/api';
import { SuccessState, ErrorState } from '@/components/embed/EmbedShell';
import { ChooserSkeleton, ScheduleSkeleton } from '@/components/embed/ActionSkeleton';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatPhoneNumber, validatePhone } from '@/lib/phone';
import type { FieldKey } from '@/models/LeadFormConfig';
import type { NormalizedAddress } from '@/lib/leads/types';
import type { SlotsPayload } from '@/components/embed/ScheduleCallView';

// Dynamic imports — these only load when the user reaches a screen that
// needs them. The skeleton placeholders match the form shell exactly so the
// transition into the action view reads as one continuous surface.
const PlacesAutocomplete = dynamic(
  () => import('@/components/PlacesAutocomplete'),
  { ssr: false },
);
const ScheduleCallView = dynamic(
  () => import('@/components/embed/ScheduleCallView'),
  { ssr: false, loading: () => <ScheduleSkeleton /> },
);
const UploadChooser = dynamic(
  () => import('@/components/UploadChooser'),
  { ssr: false, loading: () => <ChooserSkeleton /> },
);

// Stable identity for useLoadScript's `libraries` so the loader doesn't
// re-initialize on every render.
const GOOGLE_MAPS_LIBRARIES: ('places')[] = ['places'];

const DEFAULT_MOVE_SIZE_OPTIONS = [
  'Studio',
  '1 Bedroom',
  '2 Bedroom',
  '3 Bedroom',
  '4+ Bedroom',
  'Office',
  'Storage Unit',
];

const PHONE_TYPE_OPTIONS: Array<{ value: 'mobile' | 'home' | 'work'; label: string }> = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'home', label: 'Home' },
  { value: 'work', label: 'Work' },
];

// Spring config tuned for "natural" feel — not too bouncy, not robotic.
// Used by every step transition + the morphing submit button. When
// `prefers-reduced-motion` is set, callers swap this for INSTANT_TRANSITION.
const SPRING: Transition = { type: 'spring', stiffness: 320, damping: 32, mass: 0.8 };
const INSTANT_TRANSITION: Transition = { duration: 0 };

// --- Field config & ordering ---------------------------------------------

interface FieldConfig {
  id: string;
  enabled: boolean;
  required: boolean;
  // Admin-configured display name. Falls back to FIELD_LABEL when unset.
  label?: string;
}

interface ConfigStep {
  heading?: string;
  fields: string[];
}

// Admin-defined extra inputs. Rendered at the end of the form (last step
// when multi-step) and submitted under payload.custom keyed by id.
interface CustomFieldConfig {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  required: boolean;
  options?: string[];
}

interface LeadFormProps {
  config: {
    id: string;
    name: string;
    fields: FieldConfig[];
    theme: {
      title: string;
      subtitle?: string;
      buttonText: string;
      buttonColor: string;
      logoUrl?: string;
    };
    postSubmit: { kind: 'inline-message' | 'redirect-chooser'; message?: string };
    moveSizeOptions?: string[];
    steps?: ConfigStep[];
    customFields?: CustomFieldConfig[];
  };
  configId: string;
  previewMode?: boolean;
}

const FIELD_DISPLAY_ORDER: FieldKey[] = [
  'moveDate',
  'moveSize',
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'phoneType',
  'origin',
  'destination',
  'companyName',
];

// Default user-facing labels for floating-label rendering + validation
// errors. A per-field `label` on the config overrides these at render time.
const FIELD_LABEL: Record<FieldKey, string> = {
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

interface ResolvedStep {
  heading?: string;
  fields: Set<FieldKey>;
}

function computeSteps(
  fieldsConfig: FieldConfig[],
  steps: ConfigStep[] | undefined,
): ResolvedStep[] {
  const enabledIds = new Set(
    fieldsConfig.filter((f) => f.enabled).map((f) => f.id as FieldKey),
  );
  if (steps && steps.length > 0) {
    const resolved = steps
      .map((s) => ({
        heading: s.heading,
        fields: new Set(
          s.fields.filter((f): f is FieldKey => enabledIds.has(f as FieldKey)),
        ),
      }))
      .filter((s) => s.fields.size > 0);
    if (resolved.length > 0) return resolved;
  }
  return [{ fields: enabledIds }];
}

// --- Style tokens ---------------------------------------------------------

// Floating-label inputs need extra top padding so the label has somewhere to
// float to. Bottom padding stays small so the input stays the same overall
// height. Border + shadow tokens kept consistent with the form card.
const floatingInputClass =
  'peer w-full px-4 pt-5 pb-1.5 bg-white text-gray-900 rounded-xl border border-gray-200 ' +
  'shadow-sm transition-all duration-200 focus:outline-none text-base ' +
  'placeholder:opacity-0 placeholder:text-base';

const errorInputClass = 'border-red-400';

// --- Helpers --------------------------------------------------------------

function postIframeHeight() {
  if (typeof window === 'undefined') return;
  if (window.parent === window) return;
  try {
    const height = document.documentElement.scrollHeight;
    window.parent.postMessage({ type: 'qubesheets-form-resize', height }, '*');
  } catch {
    // cross-origin parent is fine; the postMessage still goes through
  }
}

// --- Reusable Field wrapper ------------------------------------------------
//
// Provides the floating-label scaffolding and per-field validation feedback
// (error message animating in below, green check on the right for valid
// blurred required fields). Children render the actual input/select/button.

interface FieldProps {
  id: string;
  label: string;
  required: boolean;
  filled: boolean;
  focused: boolean;
  error: string | null;
  showCheck: boolean;
  accentColor: string;
  rightAdornment?: React.ReactNode;
  children: React.ReactNode;
}

function Field({
  id,
  label,
  required,
  filled,
  focused,
  error,
  showCheck,
  accentColor,
  rightAdornment,
  children,
}: FieldProps) {
  const isFloating = focused || filled;
  return (
    <div>
      <div className="relative">
        {children}
        <label
          htmlFor={id}
          className={cn(
            'absolute left-4 pointer-events-none transition-all duration-150 select-none',
            isFloating
              ? 'top-1 text-[11px] font-medium'
              : 'top-1/2 -translate-y-1/2 text-base text-gray-400',
            isFloating && !focused && 'text-gray-500',
          )}
          style={isFloating && focused ? { color: accentColor } : undefined}
        >
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {rightAdornment ? (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            {rightAdornment}
          </div>
        ) : showCheck ? (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center"
            >
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </motion.div>
          </div>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key="error"
            initial={{ opacity: 0, y: -2, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -2, height: 0 }}
            transition={{ duration: 0.15 }}
            className="text-xs text-red-500 mt-1 ml-1"
            id={`${id}-error`}
            role="alert"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Address input: defers Google Maps until reached + confirmed pill ----

interface AddressInputProps {
  id: string;
  label: string;
  required: boolean;
  accentColor: string;
  value: string;
  placeSelected: boolean;
  focused: boolean;
  error: string | null;
  onFocus: () => void;
  onBlur: () => void;
  onTextChange: (text: string) => void;
  onPlaceSelect: (place: NormalizedAddress) => void;
  onPlaceCleared: () => void;
}

function AddressInput({
  id,
  label,
  required,
  accentColor,
  value,
  placeSelected,
  focused,
  error,
  onFocus,
  onBlur,
  onTextChange,
  onPlaceSelect,
  onPlaceCleared,
}: AddressInputProps) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const handleSelect = useCallback(
    (place: google.maps.places.PlaceResult) => {
      onPlaceSelect({
        raw: place.formatted_address ?? '',
        placeId: place.place_id,
        lat: place.geometry?.location?.lat(),
        lng: place.geometry?.location?.lng(),
      });
    },
    [onPlaceSelect],
  );

  return (
    <Field
      id={id}
      label={label}
      required={required}
      filled={!!value}
      focused={focused}
      error={error}
      // Use the same green-check confirmation as every other valid field.
      // Triggered by a Places match (we treat that as the confirmation event
      // for addresses, since blur-validation can't tell a real address from
      // a typo).
      showCheck={placeSelected}
      accentColor={accentColor}
      // Map-pin only when nothing's confirmed yet — green check takes the
      // right edge once a place is selected.
      rightAdornment={
        !placeSelected ? <MapPin className="w-5 h-5 text-gray-300" /> : undefined
      }
    >
      {isLoaded && !loadError ? (
        <PlacesAutocomplete
          id={id}
          value={value}
          placeholder=" "
          className={cn(floatingInputClass, 'pl-4 pr-10', error && errorInputClass)}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(v) => {
            onTextChange(v);
            if (placeSelected && v !== value) onPlaceCleared();
          }}
          onSelect={handleSelect}
        />
      ) : (
        // Fallback while Maps loads (or if it errored). Plain input keeps
        // the field usable immediately — submit will go through as a raw
        // address string.
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => {
            onTextChange(e.target.value);
            if (placeSelected) onPlaceCleared();
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder=" "
          required={required}
          className={cn(floatingInputClass, 'pr-10', error && errorInputClass)}
        />
      )}
    </Field>
  );
}

// --- Progress dots --------------------------------------------------------

function ProgressDots({
  total,
  current,
  accentColor,
  spring,
}: {
  total: number;
  current: number;
  accentColor: string;
  spring: Transition;
}) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <motion.div
          key={i}
          className="h-1.5 rounded-full"
          initial={false}
          animate={{
            width: i === current ? 28 : 6,
            backgroundColor: i <= current ? accentColor : 'rgb(229 231 235)',
          }}
          transition={spring}
        />
      ))}
    </div>
  );
}

// --- Morphing submit button -----------------------------------------------

function MorphingSubmitButton({
  label,
  submitting,
  disabled,
  accentColor,
  spring,
  onClick,
}: {
  label: string;
  submitting: boolean;
  disabled: boolean;
  accentColor: string;
  spring: Transition;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled || submitting}
      layout
      transition={spring}
      style={{
        backgroundColor: accentColor,
        borderRadius: submitting ? 999 : 12,
        width: submitting ? 56 : '100%',
        height: 56,
      }}
      className={cn(
        'mx-auto flex items-center justify-center text-white font-semibold text-base',
        'shadow-sm transition-opacity',
        'hover:opacity-95 active:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed',
      )}
    >
      {submitting ? (
        <Loader2 className="h-6 w-6 animate-spin" />
      ) : (
        <span>{label}</span>
      )}
    </motion.button>
  );
}

// --- Premium success state -----------------------------------------------

function PremiumSuccess({
  message,
  accentColor,
  spring,
}: {
  message: string;
  accentColor: string;
  spring: Transition;
}) {
  return (
    <div className="bg-transparent p-2 sm:p-3">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring}
        className="@container max-w-md w-full mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 p-6 @sm:p-8 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ ...spring, delay: 0.05 }}
          className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4"
          style={{ backgroundColor: accentColor }}
        >
          <motion.div
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ ...spring, delay: 0.2 }}
          >
            <Check className="w-8 h-8 text-white" strokeWidth={3} />
          </motion.div>
        </motion.div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank you!</h2>
        <p className="text-gray-600 text-base leading-relaxed">{message}</p>
      </motion.div>
    </div>
  );
}

// --- Preview result view (editor-triggered simulation) --------------------

interface PreviewResult {
  capturedData: Record<string, unknown>;
  selection:
    | { kind: 'move-size-rule'; option: string; ruleKind: string }
    | { kind: 'business-hours'; branch: 'during' | 'after' }
    | { kind: 'default' };
  configuredAction: { kind: string; message?: string };
  effectiveAction: { kind: string; message?: string };
  credits: {
    consumesCredit: boolean;
    overQuota: boolean;
    hasAddOn: boolean;
    allowance: number;
    used: number;
    remaining: number;
  };
}

type ViewState =
  | { kind: 'form' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'chooser'; token: string; submissionId?: string }
  | { kind: 'schedule'; submissionId: string; prefetched?: SlotsPayload }
  | { kind: 'preview-result'; result: PreviewResult };

// --- Main component -------------------------------------------------------

export default function LeadForm({ config, configId, previewMode = false }: LeadFormProps) {
  // Field state
  const [moveDate, setMoveDate] = useState('');
  const [moveSize, setMoveSize] = useState('');
  const [fullName, setFullName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneType, setPhoneType] = useState<'mobile' | 'home' | 'work' | ''>('');
  const [companyName, setCompanyName] = useState('');
  const [originText, setOriginText] = useState('');
  const [originPlace, setOriginPlace] = useState<NormalizedAddress | null>(null);
  const [destinationText, setDestinationText] = useState('');
  const [destinationPlace, setDestinationPlace] = useState<NormalizedAddress | null>(null);

  // Admin-defined custom fields, keyed by their stable id.
  const customFields = useMemo(
    () => config.customFields ?? [],
    [config.customFields],
  );
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const setCustomValue = useCallback((id: string, value: string) => {
    setCustomValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  // Honeypot — real users never touch this. Not persisted to localStorage.
  const [honeypot, setHoneypot] = useState('');

  // Per-field focus + touched state (drives floating labels + validation
  // feedback timing).
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const markTouched = useCallback((id: string) => {
    setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const [submitting, setSubmitting] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ kind: 'form' });

  // Reduced-motion preference — affects every motion transition. Stored once
  // and applied via the SPRING/INSTANT_TRANSITION pair.
  const prefersReducedMotion = useReducedMotion();
  const spring: Transition = prefersReducedMotion ? INSTANT_TRANSITION : SPRING;

  const fieldEnabled = useCallback(
    (id: FieldKey): boolean =>
      config.fields.some((f) => f.id === id && f.enabled),
    [config.fields],
  );
  const fieldRequired = useCallback(
    (id: FieldKey): boolean =>
      config.fields.some((f) => f.id === id && f.enabled && f.required),
    [config.fields],
  );
  const labelFor = useCallback(
    (id: FieldKey): string => {
      const custom = config.fields.find((f) => f.id === id)?.label?.trim();
      return custom || FIELD_LABEL[id];
    },
    [config.fields],
  );

  // Resolve the actual step list. Default: one step containing every
  // enabled field. Admin-configured `steps` overrides.
  const enabledSteps = useMemo(
    () => computeSteps(config.fields, config.steps),
    [config.fields, config.steps],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  const currentStep = enabledSteps[stepIndex] ?? enabledSteps[0];
  const isLastStep = stepIndex >= enabledSteps.length - 1;
  const isFirstStep = stepIndex === 0;
  const isMultiStep = enabledSteps.length > 1;

  // --- Focus management: focus first input of new step after transition ---

  const stepContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Wait one frame for AnimatePresence to mount the new step's DOM, then
    // focus the first interactive element. We skip on the initial mount
    // (no transition) and during submit (don't steal focus from button).
    const handle = window.setTimeout(() => {
      const el = stepContainerRef.current?.querySelector<HTMLElement>(
        'input, select, button:not([aria-hidden]):not([data-no-autofocus])',
      );
      el?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(handle);
  }, [stepIndex]);

  // --- Iframe height sync ----------------------------------------------

  useEffect(() => {
    postIframeHeight();
    if (typeof window === 'undefined') return;
    const observer = new ResizeObserver(() => postIframeHeight());
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [stepIndex, view]);

  // --- Per-field validation --------------------------------------------

  function rawErrorFor(id: FieldKey): string | null {
    const required = fieldRequired(id);
    switch (id) {
      case 'firstName':
        if (required && !firstName.trim()) return `${labelFor(id)} is required`;
        return null;
      case 'lastName':
        if (required && !lastName.trim()) return `${labelFor(id)} is required`;
        return null;
      case 'fullName':
        if (required && !fullName.trim()) return `${labelFor(id)} is required`;
        return null;
      case 'email': {
        if (required && !email.trim()) return `${labelFor(id)} is required`;
        if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          return 'Please enter a valid email address';
        }
        return null;
      }
      case 'phone': {
        // Phone is locked to required at the editor level (10DLC).
        const err =
          validatePhone(phone) ?? (!phone ? `${labelFor('phone')} is required` : null);
        return err;
      }
      case 'phoneType':
        if (required && !phoneType) return `${labelFor(id)} is required`;
        return null;
      case 'moveDate':
        if (required && !moveDate) return `${labelFor(id)} is required`;
        return null;
      case 'moveSize':
        if (required && !moveSize) return `${labelFor(id)} is required`;
        return null;
      case 'origin':
        if (required && !(originText.trim() || originPlace))
          return `${labelFor(id)} is required`;
        return null;
      case 'destination':
        if (required && !(destinationText.trim() || destinationPlace))
          return `${labelFor(id)} is required`;
        return null;
      case 'companyName':
        if (required && !companyName.trim()) return `${labelFor(id)} is required`;
        return null;
    }
  }

  // Surfaced error: only after the user has touched the field.
  function errorFor(id: FieldKey): string | null {
    if (!touched.has(id)) return null;
    return rawErrorFor(id);
  }

  // Green check eligibility: required field, touched, currently valid, has
  // a value. Optional fields don't show a check (showing one on empty is
  // weird), and address fields use the Verified pill instead.
  function showCheckFor(id: FieldKey): boolean {
    if (id === 'origin' || id === 'destination') return false;
    if (!touched.has(id)) return false;
    if (rawErrorFor(id) !== null) return false;
    if (!fieldRequired(id)) return false;
    return hasValueFor(id);
  }

  function hasValueFor(id: FieldKey): boolean {
    switch (id) {
      case 'firstName': return !!firstName.trim();
      case 'lastName': return !!lastName.trim();
      case 'fullName': return !!fullName.trim();
      case 'email': return !!email.trim();
      case 'phone': return !!phone.trim();
      case 'phoneType': return !!phoneType;
      case 'moveDate': return !!moveDate;
      case 'moveSize': return !!moveSize;
      case 'origin': return !!(originText.trim() || originPlace);
      case 'destination': return !!(destinationText.trim() || destinationPlace);
      case 'companyName': return !!companyName.trim();
    }
  }

  // Custom-field validation. Touched keys are namespaced `cf:<id>` so they
  // can't collide with built-in FieldKeys.
  function rawCustomErrorFor(cf: CustomFieldConfig): string | null {
    if (cf.required && !(customValues[cf.id] ?? '').trim()) {
      return `${cf.label} is required`;
    }
    return null;
  }
  function customErrorFor(cf: CustomFieldConfig): string | null {
    if (!touched.has(`cf:${cf.id}`)) return null;
    return rawCustomErrorFor(cf);
  }

  // Mark all of the current step's fields as touched before submit/continue
  // so any field-level errors render. Then return the first error so the
  // step-level message can echo it (useful for screen readers).
  function validateCurrentStep(): string | null {
    const ids = Array.from(currentStep.fields);
    for (const id of ids) markTouched(id);
    for (const id of ids) {
      const err = rawErrorFor(id);
      if (err) return err;
    }
    // Custom fields live on the last step.
    if (isLastStep) {
      for (const cf of customFields) markTouched(`cf:${cf.id}`);
      for (const cf of customFields) {
        const err = rawCustomErrorFor(cf);
        if (err) return err;
      }
    }
    return null;
  }

  const goNext = () => {
    const err = validateCurrentStep();
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setDirection(1);
    setStepIndex((i) => Math.min(i + 1, enabledSteps.length - 1));
  };

  const goBack = () => {
    setStepError(null);
    setDirection(-1);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  async function handleSubmit() {
    if (submitting) return;
    const err = validateCurrentStep();
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setSubmitting(true);

    const originPayload =
      fieldEnabled('origin') && (originPlace || originText)
        ? originPlace ?? { raw: originText }
        : undefined;
    const destinationPayload =
      fieldEnabled('destination') && (destinationPlace || destinationText)
        ? destinationPlace ?? { raw: destinationText }
        : undefined;

    const payload: Record<string, unknown> = {
      _hp_company: honeypot,
    };
    if (fieldEnabled('moveDate') && moveDate) payload.moveDate = moveDate;
    if (fieldEnabled('moveSize') && moveSize) payload.moveSize = moveSize;
    if (fieldEnabled('firstName') && firstName) payload.firstName = firstName;
    if (fieldEnabled('lastName') && lastName) payload.lastName = lastName;
    if (fieldEnabled('fullName') && fullName) payload.fullName = fullName;
    if (fieldEnabled('email') && email) payload.email = email;
    if (phone) payload.phone = phone;
    if (fieldEnabled('phoneType') && phoneType) payload.phoneType = phoneType;
    if (originPayload) payload.origin = originPayload;
    if (destinationPayload) payload.destination = destinationPayload;
    if (fieldEnabled('companyName') && companyName) payload.companyName = companyName;

    const customPayload: Record<string, string> = {};
    for (const cf of customFields) {
      const value = (customValues[cf.id] ?? '').trim();
      if (value) customPayload[cf.id] = value;
    }
    if (Object.keys(customPayload).length > 0) payload.custom = customPayload;

    try {
      const endpoint = previewMode
        ? `/api/leads/from-embed/${configId}/preview`
        : `/api/leads/from-embed/${configId}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setView({
          kind: 'error',
          message:
            (data && typeof data.error === 'string' && data.error) ||
            'We could not submit your form. Please try again.',
        });
        return;
      }

      if (previewMode) {
        setView({ kind: 'preview-result', result: data as PreviewResult });
        return;
      }

      const action = data.action;
      if (action?.kind === 'redirect-chooser' && typeof action.uploadUrl === 'string') {
        const token = parseUploadToken(action.uploadUrl);
        if (token) {
          setView({ kind: 'chooser', token });
          return;
        }
        navigateTo(action.uploadUrl);
        return;
      }

      if (action?.kind === 'schedule-call' && typeof action.submissionId === 'string') {
        const submissionId = action.submissionId;
        try {
          const slotsRes = await fetch(`/api/leads/schedule-call/${submissionId}`);
          if (slotsRes.ok) {
            const prefetched = (await slotsRes.json()) as SlotsPayload;
            setView({ kind: 'schedule', submissionId, prefetched });
            return;
          }
        } catch {
          // fall through to unprefetched scheduler
        }
        setView({ kind: 'schedule', submissionId });
        return;
      }

      if (
        action?.kind === 'self-survey-or-schedule' &&
        typeof action.uploadUrl === 'string' &&
        typeof action.submissionId === 'string'
      ) {
        const token = parseUploadToken(action.uploadUrl);
        if (token) {
          setView({ kind: 'chooser', token, submissionId: action.submissionId });
        } else {
          setView({ kind: 'schedule', submissionId: action.submissionId });
        }
        return;
      }

      if (action?.kind === 'inline-message') {
        setView({
          kind: 'success',
          message:
            (typeof action.message === 'string' && action.message) ||
            'Thanks — we received your request.',
        });
        return;
      }

      setView({
        kind: 'success',
        message: 'Thanks — we received your request.',
      });
    } catch {
      setView({
        kind: 'error',
        message: 'Network error. Please check your connection and try again.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  // Honeypot must be present in every render path — declare it once.
  const honeypotField = (
    <input
      type="text"
      name="_hp_company"
      tabIndex={-1}
      autoComplete="off"
      data-no-autofocus="true"
      value={honeypot}
      onChange={(e) => setHoneypot(e.target.value)}
      aria-hidden="true"
      style={{ position: 'absolute', left: '-9999px' }}
    />
  );

  const previewBanner = previewMode ? (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2 text-sm text-amber-900">
      <Eye className="h-4 w-4 flex-shrink-0" />
      <span>
        <strong>Preview mode</strong> — submissions are simulated. Nothing is
        saved, no SMS or CRM is sent, no credits are used.
      </span>
    </div>
  ) : null;

  // --- View dispatch ----------------------------------------------------

  if (view.kind === 'preview-result') {
    return (
      <>
        {honeypotField}
        {previewBanner}
        <PreviewResultView
          result={view.result}
          onReset={() => {
            setView({ kind: 'form' });
            setStepIndex(0);
            setDirection(-1);
          }}
        />
      </>
    );
  }

  if (view.kind === 'success') {
    return (
      <>
        {honeypotField}
        {previewBanner}
        <PremiumSuccess
          message={view.message}
          accentColor={config.theme.buttonColor}
          spring={spring}
        />
      </>
    );
  }

  if (view.kind === 'error') {
    // Soft recovery: a failed submit doesn't wipe the form. Customer can
    // return to the form (data still in state) and try again.
    return (
      <>
        {honeypotField}
        {previewBanner}
        <ErrorState
          message={view.message}
          onBack={() => setView({ kind: 'form' })}
          onRetry={() => {
            setView({ kind: 'form' });
            // Defer slightly so the form view re-mounts before we fire submit
            setTimeout(() => handleSubmit(), 0);
          }}
        />
      </>
    );
  }

  if (view.kind === 'schedule') {
    return (
      <>
        {honeypotField}
        {previewBanner}
        <ScheduleCallView submissionId={view.submissionId} prefetched={view.prefetched} />
      </>
    );
  }

  if (view.kind === 'chooser') {
    const submissionIdForSchedule = view.submissionId;
    return (
      <>
        {honeypotField}
        {previewBanner}
        <UploadChooser
          token={view.token}
          embedded
          showLeadGreeting
          {...(submissionIdForSchedule
            ? {
                onSchedule: () =>
                  setView({ kind: 'schedule', submissionId: submissionIdForSchedule }),
              }
            : {})}
        />
      </>
    );
  }

  // --- Form view ---------------------------------------------------------

  const accentColor = config.theme.buttonColor;

  // Field-level handler factories. Keep these inline so the StepContent
  // remains a pure rendering function with no state of its own.
  const onFocusFactory = (id: FieldKey) => () => setFocusedField(id);
  const onBlurFactory = (id: FieldKey) => () => {
    setFocusedField((f) => (f === id ? null : f));
    markTouched(id);
  };

  return (
    <>
      {previewBanner}
      <div className="bg-transparent p-2 sm:p-3">
        {/* @container drives padding + grid behavior off the card's width,
            not the viewport. Critical for iframe embeds where viewport tells
            us nothing useful about the available width. */}
        <div className="@container max-w-md w-full mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 p-4 @xs:p-5 @sm:p-7 @md:p-8">
          {config.theme.logoUrl && (
            <img
              src={config.theme.logoUrl}
              alt=""
              className="h-10 @sm:h-12 mx-auto mb-4 object-contain"
            />
          )}

          {/* Title block gets consistent breathing room below regardless of
              whether a subtitle is present — single-page forms without a
              subtitle were previously rendering with the title visually
              touching the first input. */}
          <div className="mb-4 @sm:mb-5">
            <h2 className="text-center text-lg @sm:text-xl font-semibold text-gray-900">
              {config.theme.title}
            </h2>
            {config.theme.subtitle && (
              <p className="text-center text-gray-500 text-sm @sm:text-base mt-1">
                {config.theme.subtitle}
              </p>
            )}
          </div>

          {isMultiStep && (
            <ProgressDots
              total={enabledSteps.length}
              current={stepIndex}
              accentColor={accentColor}
              spring={spring}
            />
          )}

          {honeypotField}

          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={stepIndex}
              ref={stepContainerRef}
              custom={direction}
              initial={
                isMultiStep
                  ? { x: direction > 0 ? 32 : -32, opacity: 0 }
                  : false
              }
              animate={{ x: 0, opacity: 1 }}
              exit={
                isMultiStep
                  ? { x: direction > 0 ? -32 : 32, opacity: 0 }
                  : undefined
              }
              transition={spring}
              onAnimationComplete={postIframeHeight}
            >
              {currentStep.heading && (
                <h1 className="text-xl @sm:text-2xl font-bold text-gray-900 mb-4">
                  {currentStep.heading}
                </h1>
              )}

              <StepContent
                stepFields={currentStep.fields}
                required={fieldRequired}
                labelFor={labelFor}
                accentColor={accentColor}
                errorFor={errorFor}
                showCheckFor={showCheckFor}
                focusedField={focusedField}
                onFocusFactory={onFocusFactory}
                onBlurFactory={onBlurFactory}
                moveDate={moveDate}
                setMoveDate={setMoveDate}
                moveSize={moveSize}
                setMoveSize={setMoveSize}
                moveSizeOptions={
                  config.moveSizeOptions?.length
                    ? config.moveSizeOptions
                    : DEFAULT_MOVE_SIZE_OPTIONS
                }
                firstName={firstName}
                setFirstName={setFirstName}
                lastName={lastName}
                setLastName={setLastName}
                fullName={fullName}
                setFullName={setFullName}
                email={email}
                setEmail={setEmail}
                phone={phone}
                setPhone={(next) => {
                  setPhone(formatPhoneNumber(next, phone));
                }}
                phoneType={phoneType}
                setPhoneType={setPhoneType}
                originText={originText}
                setOriginText={setOriginText}
                originPlace={originPlace}
                setOriginPlace={setOriginPlace}
                destinationText={destinationText}
                setDestinationText={setDestinationText}
                destinationPlace={destinationPlace}
                setDestinationPlace={setDestinationPlace}
                companyName={companyName}
                setCompanyName={setCompanyName}
              />

              {/* Admin-defined custom fields — always the tail of the form
                  (last step in a wizard). Values live in customValues keyed
                  by the field's stable id. */}
              {isLastStep && customFields.length > 0 && (
                <div className="space-y-4 mt-4">
                  {customFields.map((cf) => (
                    <CustomFieldInput
                      key={cf.id}
                      field={cf}
                      value={customValues[cf.id] ?? ''}
                      onChange={(v) => setCustomValue(cf.id, v)}
                      focused={focusedField === `cf:${cf.id}`}
                      error={customErrorFor(cf)}
                      accentColor={accentColor}
                      onFocus={() => setFocusedField(`cf:${cf.id}`)}
                      onBlur={() => {
                        setFocusedField((f) => (f === `cf:${cf.id}` ? null : f));
                        markTouched(`cf:${cf.id}`);
                      }}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Step-level error (echoes the first field error for screen
              readers / users skimming). Per-field errors render inline
              below their inputs. */}
          <AnimatePresence>
            {stepError && (
              <motion.p
                key="step-error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="text-red-500 text-sm mt-3 text-center"
              >
                {stepError}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-3 mt-6">
            {isMultiStep && !isFirstStep && (
              <button
                type="button"
                onClick={goBack}
                disabled={submitting}
                className="h-12 px-4 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white text-gray-700 font-medium text-sm hover:bg-gray-50 active:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            )}
            <div className="flex-1">
              {isLastStep ? (
                <MorphingSubmitButton
                  label={config.theme.buttonText}
                  submitting={submitting}
                  disabled={false}
                  accentColor={accentColor}
                  spring={spring}
                  onClick={handleSubmit}
                />
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  style={{ backgroundColor: accentColor }}
                  className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl text-white font-semibold text-base shadow-sm hover:opacity-95 active:opacity-90 transition-opacity"
                >
                  Continue
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Step content (renders any field subset, canonical order) -------------

interface StepContentProps {
  stepFields: Set<FieldKey>;
  required: (id: FieldKey) => boolean;
  labelFor: (id: FieldKey) => string;
  accentColor: string;
  errorFor: (id: FieldKey) => string | null;
  showCheckFor: (id: FieldKey) => boolean;
  focusedField: string | null;
  onFocusFactory: (id: FieldKey) => () => void;
  onBlurFactory: (id: FieldKey) => () => void;
  moveDate: string;
  setMoveDate: (v: string) => void;
  moveSize: string;
  setMoveSize: (v: string) => void;
  moveSizeOptions: string[];
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  fullName: string;
  setFullName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  phoneType: 'mobile' | 'home' | 'work' | '';
  setPhoneType: (v: 'mobile' | 'home' | 'work' | '') => void;
  originText: string;
  setOriginText: (v: string) => void;
  originPlace: NormalizedAddress | null;
  setOriginPlace: (v: NormalizedAddress | null) => void;
  destinationText: string;
  setDestinationText: (v: string) => void;
  destinationPlace: NormalizedAddress | null;
  setDestinationPlace: (v: NormalizedAddress | null) => void;
  companyName: string;
  setCompanyName: (v: string) => void;
}

function StepContent(props: StepContentProps) {
  const enabledFields = props.stepFields;
  const {
    required,
    labelFor,
    accentColor,
    errorFor,
    showCheckFor,
    focusedField,
    onFocusFactory,
    onBlurFactory,
  } = props;

  // Inline focus tinting for select / date button — Tailwind classes can't
  // reference dynamic brand colors at runtime.
  const applyFocusBorder = (
    e: React.FocusEvent<HTMLSelectElement | HTMLButtonElement>,
  ) => {
    e.currentTarget.style.borderColor = accentColor;
    e.currentTarget.style.boxShadow = `0 0 0 3px ${accentColor}33`;
  };
  const clearFocusBorder = (
    e: React.FocusEvent<HTMLSelectElement | HTMLButtonElement>,
  ) => {
    e.currentTarget.style.borderColor = '';
    e.currentTarget.style.boxShadow = '';
  };

  // Same for text inputs.
  const applyFocusInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = accentColor;
    e.currentTarget.style.boxShadow = `0 0 0 3px ${accentColor}33`;
  };
  const clearFocusInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = '';
    e.currentTarget.style.boxShadow = '';
  };

  const showFirstLast = enabledFields.has('firstName') || enabledFields.has('lastName');
  const showFullNameStandalone =
    enabledFields.has('fullName') &&
    !enabledFields.has('firstName') &&
    !enabledFields.has('lastName');
  const showPhonePair = enabledFields.has('phone') || enabledFields.has('phoneType');

  return (
    <div className="space-y-4">
      {enabledFields.has('moveDate') && (
        <Field
          id="moveDate"
          label={labelFor('moveDate')}
          required={required('moveDate')}
          filled={!!props.moveDate}
          focused={focusedField === 'moveDate'}
          error={errorFor('moveDate')}
          showCheck={showCheckFor('moveDate')}
          accentColor={accentColor}
          rightAdornment={<CalendarIcon className="w-5 h-5 text-gray-300" />}
        >
          <Popover>
            <PopoverTrigger asChild>
              <button
                id="moveDate"
                type="button"
                aria-required={required('moveDate')}
                onFocus={(e) => {
                  applyFocusBorder(e);
                  onFocusFactory('moveDate')();
                }}
                onBlur={(e) => {
                  clearFocusBorder(e);
                  onBlurFactory('moveDate')();
                }}
                className={cn(
                  floatingInputClass,
                  'pr-10 text-left flex items-center',
                  errorFor('moveDate') && errorInputClass,
                )}
              >
                {(() => {
                  const parsed = props.moveDate
                    ? parse(props.moveDate, 'yyyy-MM-dd', new Date())
                    : null;
                  return parsed && isValid(parsed) ? format(parsed, 'PPP') : ' ';
                })()}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={
                  props.moveDate
                    ? (() => {
                        const d = parse(props.moveDate, 'yyyy-MM-dd', new Date());
                        return isValid(d) ? d : undefined;
                      })()
                    : undefined
                }
                onSelect={(date) =>
                  props.setMoveDate(date ? format(date, 'yyyy-MM-dd') : '')
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </Field>
      )}

      {enabledFields.has('moveSize') && (
        <Field
          id="moveSize"
          label={labelFor('moveSize')}
          required={required('moveSize')}
          filled={!!props.moveSize}
          focused={focusedField === 'moveSize'}
          error={errorFor('moveSize')}
          showCheck={showCheckFor('moveSize')}
          accentColor={accentColor}
        >
          <select
            id="moveSize"
            value={props.moveSize}
            onChange={(e) => props.setMoveSize(e.target.value)}
            onFocus={(e) => {
              applyFocusBorder(e);
              onFocusFactory('moveSize')();
            }}
            onBlur={(e) => {
              clearFocusBorder(e);
              onBlurFactory('moveSize')();
            }}
            required={required('moveSize')}
            className={cn(
              floatingInputClass,
              'appearance-none pr-10',
              errorFor('moveSize') && errorInputClass,
            )}
          >
            <option value=""></option>
            {props.moveSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </Field>
      )}

      {showFirstLast && (
        <div
          className={cn(
            enabledFields.has('firstName') && enabledFields.has('lastName')
              ? 'grid grid-cols-1 @xs:grid-cols-2 gap-3'
              : 'block',
          )}
        >
          {enabledFields.has('firstName') && (
            <Field
              id="firstName"
              label={labelFor('firstName')}
              required={required('firstName')}
              filled={!!props.firstName}
              focused={focusedField === 'firstName'}
              error={errorFor('firstName')}
              showCheck={showCheckFor('firstName')}
              accentColor={accentColor}
            >
              <input
                id="firstName"
                type="text"
                autoComplete="given-name"
                value={props.firstName}
                onChange={(e) => props.setFirstName(e.target.value)}
                onFocus={(e) => {
                  applyFocusInput(e);
                  onFocusFactory('firstName')();
                }}
                onBlur={(e) => {
                  clearFocusInput(e);
                  onBlurFactory('firstName')();
                }}
                placeholder=" "
                required={required('firstName')}
                className={cn(
                  floatingInputClass,
                  errorFor('firstName') && errorInputClass,
                )}
              />
            </Field>
          )}
          {enabledFields.has('lastName') && (
            <Field
              id="lastName"
              label={labelFor('lastName')}
              required={required('lastName')}
              filled={!!props.lastName}
              focused={focusedField === 'lastName'}
              error={errorFor('lastName')}
              showCheck={showCheckFor('lastName')}
              accentColor={accentColor}
            >
              <input
                id="lastName"
                type="text"
                autoComplete="family-name"
                value={props.lastName}
                onChange={(e) => props.setLastName(e.target.value)}
                onFocus={(e) => {
                  applyFocusInput(e);
                  onFocusFactory('lastName')();
                }}
                onBlur={(e) => {
                  clearFocusInput(e);
                  onBlurFactory('lastName')();
                }}
                placeholder=" "
                required={required('lastName')}
                className={cn(
                  floatingInputClass,
                  errorFor('lastName') && errorInputClass,
                )}
              />
            </Field>
          )}
        </div>
      )}

      {showFullNameStandalone && (
        <Field
          id="fullName"
          label={labelFor('fullName')}
          required={required('fullName')}
          filled={!!props.fullName}
          focused={focusedField === 'fullName'}
          error={errorFor('fullName')}
          showCheck={showCheckFor('fullName')}
          accentColor={accentColor}
        >
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            value={props.fullName}
            onChange={(e) => props.setFullName(e.target.value)}
            onFocus={(e) => {
              applyFocusInput(e);
              onFocusFactory('fullName')();
            }}
            onBlur={(e) => {
              clearFocusInput(e);
              onBlurFactory('fullName')();
            }}
            placeholder=" "
            required={required('fullName')}
            className={cn(
              floatingInputClass,
              errorFor('fullName') && errorInputClass,
            )}
          />
        </Field>
      )}

      {enabledFields.has('email') && (
        <Field
          id="email"
          label={labelFor('email')}
          required={required('email')}
          filled={!!props.email}
          focused={focusedField === 'email'}
          error={errorFor('email')}
          showCheck={showCheckFor('email')}
          accentColor={accentColor}
        >
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={props.email}
            onChange={(e) => props.setEmail(e.target.value)}
            onFocus={(e) => {
              applyFocusInput(e);
              onFocusFactory('email')();
            }}
            onBlur={(e) => {
              clearFocusInput(e);
              onBlurFactory('email')();
            }}
            placeholder=" "
            required={required('email')}
            className={cn(
              floatingInputClass,
              errorFor('email') && errorInputClass,
            )}
            aria-invalid={!!errorFor('email')}
            aria-describedby={errorFor('email') ? 'email-error' : undefined}
          />
        </Field>
      )}

      {showPhonePair && (
        <div
          className={cn(
            enabledFields.has('phone') && enabledFields.has('phoneType')
              ? 'grid grid-cols-1 @xs:grid-cols-2 gap-3'
              : 'block',
          )}
        >
          {enabledFields.has('phone') && (
            <Field
              id="phone"
              label={labelFor('phone')}
              required
              filled={!!props.phone}
              focused={focusedField === 'phone'}
              error={errorFor('phone')}
              showCheck={showCheckFor('phone')}
              accentColor={accentColor}
            >
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={props.phone}
                onChange={(e) => props.setPhone(e.target.value)}
                onFocus={(e) => {
                  applyFocusInput(e);
                  onFocusFactory('phone')();
                }}
                onBlur={(e) => {
                  clearFocusInput(e);
                  onBlurFactory('phone')();
                }}
                placeholder=" "
                required
                aria-invalid={!!errorFor('phone')}
                aria-describedby={errorFor('phone') ? 'phone-error' : undefined}
                className={cn(
                  floatingInputClass,
                  errorFor('phone') && errorInputClass,
                )}
              />
            </Field>
          )}
          {enabledFields.has('phoneType') && (
            <Field
              id="phoneType"
              label={labelFor('phoneType')}
              required={required('phoneType')}
              filled={!!props.phoneType}
              focused={focusedField === 'phoneType'}
              error={errorFor('phoneType')}
              showCheck={showCheckFor('phoneType')}
              accentColor={accentColor}
            >
              <select
                id="phoneType"
                value={props.phoneType}
                onChange={(e) =>
                  props.setPhoneType(e.target.value as 'mobile' | 'home' | 'work' | '')
                }
                onFocus={(e) => {
                  applyFocusBorder(e);
                  onFocusFactory('phoneType')();
                }}
                onBlur={(e) => {
                  clearFocusBorder(e);
                  onBlurFactory('phoneType')();
                }}
                required={required('phoneType')}
                className={cn(
                  floatingInputClass,
                  'appearance-none pr-10',
                  errorFor('phoneType') && errorInputClass,
                )}
              >
                <option value=""></option>
                {PHONE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}

      {enabledFields.has('origin') && (
        <AddressInput
          id="origin"
          label={labelFor('origin')}
          required={required('origin')}
          accentColor={accentColor}
          value={props.originText}
          placeSelected={!!props.originPlace}
          focused={focusedField === 'origin'}
          error={errorFor('origin')}
          onFocus={onFocusFactory('origin')}
          onBlur={onBlurFactory('origin')}
          onTextChange={props.setOriginText}
          onPlaceSelect={(place) => props.setOriginPlace(place)}
          onPlaceCleared={() => props.setOriginPlace(null)}
        />
      )}

      {enabledFields.has('destination') && (
        <AddressInput
          id="destination"
          label={labelFor('destination')}
          required={required('destination')}
          accentColor={accentColor}
          value={props.destinationText}
          placeSelected={!!props.destinationPlace}
          focused={focusedField === 'destination'}
          error={errorFor('destination')}
          onFocus={onFocusFactory('destination')}
          onBlur={onBlurFactory('destination')}
          onTextChange={props.setDestinationText}
          onPlaceSelect={(place) => props.setDestinationPlace(place)}
          onPlaceCleared={() => props.setDestinationPlace(null)}
        />
      )}

      {enabledFields.has('companyName') && (
        <Field
          id="companyName"
          label={labelFor('companyName')}
          required={required('companyName')}
          filled={!!props.companyName}
          focused={focusedField === 'companyName'}
          error={errorFor('companyName')}
          showCheck={showCheckFor('companyName')}
          accentColor={accentColor}
        >
          <input
            id="companyName"
            type="text"
            value={props.companyName}
            onChange={(e) => props.setCompanyName(e.target.value)}
            onFocus={(e) => {
              applyFocusInput(e);
              onFocusFactory('companyName')();
            }}
            onBlur={(e) => {
              clearFocusInput(e);
              onBlurFactory('companyName')();
            }}
            placeholder=" "
            required={required('companyName')}
            className={cn(
              floatingInputClass,
              errorFor('companyName') && errorInputClass,
            )}
          />
        </Field>
      )}
    </div>
  );
}

// --- Custom field input ----------------------------------------------------
//
// Renders one admin-defined custom field with the same floating-label
// treatment as the built-ins. Textareas keep the label floated permanently —
// a vertically-centered label on a multi-line box reads wrong.

function CustomFieldInput({
  field,
  value,
  onChange,
  focused,
  error,
  accentColor,
  onFocus,
  onBlur,
}: {
  field: CustomFieldConfig;
  value: string;
  onChange: (v: string) => void;
  focused: boolean;
  error: string | null;
  accentColor: string;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const id = `cf-${field.id}`;

  const applyFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    e.currentTarget.style.borderColor = accentColor;
    e.currentTarget.style.boxShadow = `0 0 0 3px ${accentColor}33`;
    onFocus();
  };
  const clearFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    e.currentTarget.style.borderColor = '';
    e.currentTarget.style.boxShadow = '';
    onBlur();
  };

  const showCheck =
    field.required && !error && !!value.trim() && !focused;

  return (
    <Field
      id={id}
      label={field.label}
      required={field.required}
      filled={!!value || field.type === 'textarea'}
      focused={focused}
      error={error}
      showCheck={showCheck}
      accentColor={accentColor}
    >
      {field.type === 'textarea' ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={applyFocus}
          onBlur={clearFocus}
          placeholder=" "
          required={field.required}
          rows={3}
          className={cn(floatingInputClass, 'resize-none', error && errorInputClass)}
        />
      ) : field.type === 'select' ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={applyFocus}
          onBlur={clearFocus}
          required={field.required}
          className={cn(
            floatingInputClass,
            'appearance-none pr-10',
            error && errorInputClass,
          )}
        >
          <option value=""></option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={applyFocus}
          onBlur={clearFocus}
          placeholder=" "
          required={field.required}
          className={cn(floatingInputClass, error && errorInputClass)}
        />
      )}
    </Field>
  );
}

// --- Preview result view (editor-triggered simulation) --------------------

const ACTION_LABEL: Record<string, string> = {
  'inline-message': 'Show a thank-you message',
  'redirect-chooser': 'Push to self-survey (Record Video or Take Photos)',
  'schedule-call': 'Schedule a virtual call',
  'self-survey-or-schedule': 'Let the customer choose (self-survey OR virtual call)',
};

function actionLabel(kind: string): string {
  return ACTION_LABEL[kind] ?? kind;
}

function formatCapturedValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.raw === 'string') return obj.raw;
    return JSON.stringify(value);
  }
  return String(value);
}

const CAPTURED_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  phoneType: 'Phone type',
  moveDate: 'Move date',
  moveSize: 'Move size',
  origin: 'Origin',
  destination: 'Destination',
  companyName: 'Company',
};

const CAPTURED_ORDER = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'phoneType',
  'moveSize',
  'moveDate',
  'origin',
  'destination',
  'companyName',
];

function PreviewResultView({
  result,
  onReset,
}: {
  result: PreviewResult;
  onReset: () => void;
}) {
  const fallbackTriggered =
    result.credits.consumesCredit &&
    result.credits.overQuota &&
    result.configuredAction.kind !== result.effectiveAction.kind;

  const captured = result.capturedData ?? {};
  const capturedEntries = CAPTURED_ORDER.filter(
    (key) => captured[key] != null && captured[key] !== '',
  );

  return (
    <div className="bg-transparent p-2 sm:p-3">
      <div className="@container max-w-md w-full mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 p-4 @xs:p-5 @sm:p-7 @md:p-8 space-y-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">
              Preview submitted
            </h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Here is exactly what would happen if a real customer submitted
              this form right now.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Customer would see
          </div>
          <div className="text-sm font-medium text-gray-900">
            {actionLabel(result.effectiveAction.kind)}
          </div>
          {result.effectiveAction.kind === 'inline-message' &&
            result.effectiveAction.message && (
              <div className="text-sm text-gray-600 italic mt-1">
                &ldquo;{result.effectiveAction.message}&rdquo;
              </div>
            )}
        </div>

        {fallbackTriggered && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 flex-1 min-w-0">
              <div className="font-semibold">Over your monthly credit allowance</div>
              <div className="mt-0.5">
                Your form is configured for{' '}
                <strong>{actionLabel(result.configuredAction.kind)}</strong>,
                but you&apos;ve used{' '}
                {result.credits.used.toLocaleString()} of{' '}
                {result.credits.allowance.toLocaleString()} credits this month.
                Real customers fall back to the thank-you message until the
                1st.
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            How this was selected
          </div>
          <div className="text-sm text-gray-700">
            {result.selection.kind === 'move-size-rule' ? (
              <>
                Move size{' '}
                <span className="font-medium text-gray-900">
                  &ldquo;{result.selection.option}&rdquo;
                </span>{' '}
                matched a routing rule overriding the form default.
              </>
            ) : result.selection.kind === 'business-hours' ? (
              <>
                Current time is{' '}
                <span className="font-medium text-gray-900">
                  {result.selection.branch === 'during'
                    ? 'inside'
                    : 'outside'}
                </span>{' '}
                business hours — used the{' '}
                {result.selection.branch === 'during'
                  ? 'during-hours'
                  : 'after-hours'}{' '}
                branch.
              </>
            ) : (
              <>Used the form-level default action.</>
            )}
          </div>
        </div>

        {capturedEntries.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Captured data
            </div>
            <dl className="rounded-lg border border-gray-200 divide-y divide-gray-100">
              {capturedEntries.map((key) => (
                <div
                  key={key}
                  className="flex items-start gap-3 px-3 py-2 text-sm"
                >
                  <dt className="w-32 flex-shrink-0 text-gray-500">
                    {CAPTURED_LABELS[key] ?? key}
                  </dt>
                  <dd className="flex-1 min-w-0 text-gray-900 break-words">
                    {formatCapturedValue(captured[key])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <button
          type="button"
          onClick={onReset}
          className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Submit another preview
        </button>
      </div>
    </div>
  );
}

// --- Helpers --------------------------------------------------------------

function parseUploadToken(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const match = parsed.pathname.match(/^\/customer-upload\/([^/]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function navigateTo(uploadUrl: string) {
  let relative = uploadUrl;
  try {
    const parsed = new URL(uploadUrl);
    relative = parsed.pathname + parsed.search + parsed.hash;
  } catch {
    // already relative
  }
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = relative;
      return;
    }
  } catch {
    // cross-origin top — fall through
  }
  window.location.href = relative;
}

// SuccessState is still used elsewhere (legacy / shared); keep it imported
// even though this file uses PremiumSuccess directly.
void SuccessState;
