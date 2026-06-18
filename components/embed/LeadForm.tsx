// components/embed/LeadForm.tsx
//
// Client-side lead-capture form rendered inside the iframe at /embed/:configId.
// Renders only the fields the config has enabled, posts to the public
// /api/leads/from-embed endpoint, and dispatches a redirect or inline-message
// based on the response action.
//
// Server-only code (Mongoose models, DB connections) is never imported here.

'use client';

import { useCallback, useState } from 'react';
import { useLoadScript } from '@react-google-maps/api';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  Eye,
  Loader2,
  MapPin,
} from 'lucide-react';
import { format, parse, isValid } from 'date-fns';
import PlacesAutocomplete from '@/components/PlacesAutocomplete';
import { SuccessState, ErrorState } from '@/components/embed/EmbedShell';
import UploadChooser from '@/components/UploadChooser';
import ScheduleCallView, { type SlotsPayload } from '@/components/embed/ScheduleCallView';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatPhoneNumber, validatePhone } from '@/lib/phone';
import type { FieldKey } from '@/models/LeadFormConfig';
import type { NormalizedAddress } from '@/lib/leads/types';

// Module-level constant so the `useLoadScript` libraries array has a
// stable identity across renders (otherwise the loader re-initializes).
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

interface FieldConfig {
  id: string;
  enabled: boolean;
  required: boolean;
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
  };
  configId: string;
  /** Editor-triggered simulation mode (via `?preview=1`). Form behaves
   *  normally but submissions go to the preview endpoint with no DB
   *  writes, no CRM, no credit consumption, and a banner is shown. */
  previewMode?: boolean;
}

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
  // `chooser` may carry a submissionId — when present the chooser renders
  // a third "Schedule a virtual call" button alongside Record/Photos. The
  // schedule path transitions to the `schedule` view below.
  | { kind: 'chooser'; token: string; submissionId?: string }
  | { kind: 'schedule'; submissionId: string; prefetched?: SlotsPayload }
  | { kind: 'preview-result'; result: PreviewResult };

const inputBaseClass =
  'w-full px-3 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400 ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-base';
const labelClass = 'block text-sm font-medium text-gray-900 mb-1.5';

export default function LeadForm({ config, configId, previewMode = false }: LeadFormProps) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  // Field state
  const [moveDate, setMoveDate] = useState('');
  const [moveSize, setMoveSize] = useState('');
  const [fullName, setFullName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneType, setPhoneType] = useState<'mobile' | 'home' | 'work' | ''>('');
  const [companyName, setCompanyName] = useState('');

  // Address fields carry both the raw text and the structured Places data.
  const [originText, setOriginText] = useState('');
  const [originPlace, setOriginPlace] = useState<NormalizedAddress | null>(null);
  const [destinationText, setDestinationText] = useState('');
  const [destinationPlace, setDestinationPlace] = useState<NormalizedAddress | null>(null);

  // Honeypot — bound to state so React owns it. Real users never touch this.
  const [honeypot, setHoneypot] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<ViewState>({ kind: 'form' });

  const fieldEnabled = useCallback(
    (id: FieldKey): boolean =>
      config.fields.some((f) => f.id === id && f.enabled),
    [config.fields]
  );

  const fieldRequired = useCallback(
    (id: FieldKey): boolean =>
      config.fields.some((f) => f.id === id && f.enabled && f.required),
    [config.fields]
  );

  const handleOriginSelect = useCallback((place: google.maps.places.PlaceResult) => {
    setOriginPlace({
      raw: place.formatted_address ?? '',
      placeId: place.place_id,
      lat: place.geometry?.location?.lat(),
      lng: place.geometry?.location?.lng(),
    });
  }, []);

  const handleDestinationSelect = useCallback((place: google.maps.places.PlaceResult) => {
    setDestinationPlace({
      raw: place.formatted_address ?? '',
      placeId: place.place_id,
      lat: place.geometry?.location?.lat(),
      lng: place.geometry?.location?.lng(),
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    // Re-run phone validation at submit time so a paste / autofill that
    // bypassed the onChange formatter still gets caught. Phone is required
    // for every form (10DLC product decision).
    if (fieldEnabled('phone')) {
      const err = validatePhone(phone) ?? (!phone ? 'Phone number is required' : null);
      if (err) {
        setPhoneError(err);
        return;
      }
    }

    setSubmitting(true);

    // Origin/destination payload: prefer the structured Places result; fall
    // back to the raw typed text so manual entries still go through.
    const origin =
      fieldEnabled('origin') && (originPlace || originText)
        ? originPlace ?? { raw: originText }
        : undefined;
    const destination =
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
    if (origin) payload.origin = origin;
    if (destination) payload.destination = destination;
    if (fieldEnabled('companyName') && companyName) payload.companyName = companyName;

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

      // Preview mode short-circuit — render the simulation result card
      // instead of dispatching the action.
      if (previewMode) {
        setView({ kind: 'preview-result', result: data as PreviewResult });
        return;
      }

      const action = data.action;
      if (action?.kind === 'redirect-chooser' && typeof action.uploadUrl === 'string') {
        // Parse the token out of /customer-upload/<token> so the chooser can
        // render INSIDE the iframe as the next view. Only when the customer
        // picks Record Video / Take Photos does the chooser break out to the
        // full-page experience for actual media capture.
        let token: string | null = null;
        try {
          const parsed = new URL(action.uploadUrl, window.location.origin);
          const match = parsed.pathname.match(/^\/customer-upload\/([^/]+)/);
          if (match) token = match[1] ?? null;
        } catch {
          // Malformed URL — fall through to legacy break-out below.
        }

        if (token) {
          setView({ kind: 'chooser', token });
          return;
        }

        // Fallback: token unparseable. Don't strand the lead on the form —
        // navigate the way we did before introducing the in-iframe chooser.
        let relative = action.uploadUrl;
        try {
          const parsed = new URL(action.uploadUrl);
          relative = parsed.pathname + parsed.search + parsed.hash;
        } catch {
          // Already relative, or malformed — use as-is.
        }
        try {
          if (window.top && window.top !== window.self) {
            window.top.location.href = relative;
            return;
          }
        } catch {
          // Cross-origin top — fall through to in-frame nav.
        }
        window.location.href = relative;
        return;
      }

      if (action?.kind === 'schedule-call' && typeof action.submissionId === 'string') {
        // Pre-fetch slots BEFORE swapping views so the customer doesn't
        // see the form briefly collapse into a tiny spinner card. We
        // keep `submitting` true through this so the button stays in
        // "Submitting…" state. If the prefetch fails, fall back to the
        // schedule view's own loading state — better than stranding.
        const submissionId = action.submissionId;
        try {
          const slotsRes = await fetch(`/api/leads/schedule-call/${submissionId}`);
          if (slotsRes.ok) {
            const prefetched = (await slotsRes.json()) as SlotsPayload;
            setView({ kind: 'schedule', submissionId, prefetched });
            return;
          }
        } catch {
          // ignore — fall through to unprefetched
        }
        setView({ kind: 'schedule', submissionId });
        return;
      }

      if (
        action?.kind === 'self-survey-or-schedule' &&
        typeof action.uploadUrl === 'string' &&
        typeof action.submissionId === 'string'
      ) {
        // Show the chooser with a third "Schedule a virtual call" button.
        let token: string | null = null;
        try {
          const parsed = new URL(action.uploadUrl, window.location.origin);
          const match = parsed.pathname.match(/^\/customer-upload\/([^/]+)/);
          if (match) token = match[1] ?? null;
        } catch {
          // fall through to schedule-only
        }
        if (token) {
          setView({ kind: 'chooser', token, submissionId: action.submissionId });
        } else {
          // Token unparseable — degrade to scheduler-only so the lead
          // isn't stranded on the form.
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

      // Defensive fallback.
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

  // Honeypot must be present in every render path — declare it once so we
  // can drop it into both the loading state and the form itself.
  const honeypotField = (
    <input
      type="text"
      name="_hp_company"
      tabIndex={-1}
      autoComplete="off"
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

  if (view.kind === 'preview-result') {
    return (
      <>
        {honeypotField}
        {previewBanner}
        <PreviewResultView
          result={view.result}
          onReset={() => setView({ kind: 'form' })}
        />
      </>
    );
  }

  if (view.kind === 'success') {
    return (
      <>
        {honeypotField}
        {previewBanner}
        <SuccessState message={view.message} />
      </>
    );
  }

  if (view.kind === 'error') {
    return (
      <>
        {honeypotField}
        {previewBanner}
        <ErrorState message={view.message} />
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
    // No onChoose → component's default break-out fires (top-frame nav to
    // /customer-upload/<token>?greeting=lead&start=<kind>, falling back to
    // in-frame nav for sandboxed iframes). The lead-pipeline arrival is by
    // definition a lead, so the personalized greeting always shows.
    //
    // When the chooser was launched from a self-survey-or-schedule action
    // we also pass `onSchedule`, which renders a third button. Picking it
    // swaps in the scheduler view in the same iframe.
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

  // Google Maps failed to load entirely (network blocked, invalid key, etc.).
  // We surface a clear error rather than silently breaking the address inputs.
  if (loadError) {
    return (
      <>
        {honeypotField}
        {previewBanner}
        <ErrorState message="Address lookup failed to load. Please refresh the page or try again later." />
      </>
    );
  }

  // Still loading the Maps SDK — render a lightweight placeholder. We keep
  // the honeypot mounted so a bot can't race the form mount.
  if (!isLoaded) {
    return (
      <>
        {previewBanner}
        <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-transparent">
          {honeypotField}
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-label="Loading form" />
        </div>
      </>
    );
  }

  return (
    <>
      {previewBanner}
      <div className="min-h-screen bg-transparent px-3 py-4 sm:px-4 sm:py-10 flex flex-col">
      {/* @container enables Tailwind container queries on the card's
          children so two-column rows (first/last, phone/phoneType)
          collapse to single column when the iframe is narrow — host
          sites embed the form at widths from 320px on phones to 600px+
          on desktop. Viewport-based breakpoints don't work for that.

          `flex-1` lets the card stretch to fill the iframe's available
          vertical space so the form and the post-submit chooser
          (UploadChooser embedded variant) both occupy the same area —
          the second screen "inherits" the first's height. */}
      <div className="@container max-w-md w-full mx-auto flex-1 bg-white rounded-xl @sm:rounded-2xl shadow-lg @sm:shadow-xl border border-gray-200 p-5 @sm:p-7 @md:p-8">
        {config.theme.logoUrl && (
          <img
            src={config.theme.logoUrl}
            alt=""
            className="h-10 @sm:h-12 mx-auto mb-3 @sm:mb-4 object-contain"
          />
        )}
        <h1 className="text-xl @sm:text-2xl font-bold text-gray-900 mb-1">{config.theme.title}</h1>
        {config.theme.subtitle && (
          <p className="text-gray-600 text-sm @sm:text-base mb-5 @sm:mb-6">{config.theme.subtitle}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {honeypotField}

          {fieldEnabled('moveDate') && (
            <div>
              <label htmlFor="moveDate" className={labelClass}>
                Move Date
                {fieldRequired('moveDate') && <span className="text-red-500 ml-1">*</span>}
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    id="moveDate"
                    type="button"
                    aria-required={fieldRequired('moveDate')}
                    className={cn(
                      inputBaseClass,
                      'pr-10 text-left relative cursor-pointer flex items-center',
                      !moveDate && 'text-gray-400',
                    )}
                  >
                    {(() => {
                      const parsed = moveDate
                        ? parse(moveDate, 'yyyy-MM-dd', new Date())
                        : null;
                      return parsed && isValid(parsed)
                        ? format(parsed, 'PPP')
                        : 'Select a date';
                    })()}
                    <CalendarIcon className="w-5 h-5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-0"
                  align="start"
                  // Inside an iframe the default portal collide with the
                  // host page's z-index. Render inline so the calendar
                  // floats above the form correctly.
                >
                  <Calendar
                    mode="single"
                    selected={
                      moveDate
                        ? (() => {
                            const d = parse(moveDate, 'yyyy-MM-dd', new Date());
                            return isValid(d) ? d : undefined;
                          })()
                        : undefined
                    }
                    onSelect={(date) =>
                      setMoveDate(date ? format(date, 'yyyy-MM-dd') : '')
                    }
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {fieldEnabled('moveSize') && (
            <div>
              <label htmlFor="moveSize" className={labelClass}>
                Move size
                {fieldRequired('moveSize') && <span className="text-red-500 ml-1">*</span>}
              </label>
              <select
                id="moveSize"
                value={moveSize}
                onChange={(e) => setMoveSize(e.target.value)}
                required={fieldRequired('moveSize')}
                className={inputBaseClass}
              >
                <option value="">Select</option>
                {(config.moveSizeOptions?.length
                  ? config.moveSizeOptions
                  : DEFAULT_MOVE_SIZE_OPTIONS
                ).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(fieldEnabled('firstName') || fieldEnabled('lastName')) && (
            <div
              className={cn(
                fieldEnabled('firstName') && fieldEnabled('lastName')
                  ? 'grid grid-cols-1 @xs:grid-cols-2 gap-3'
                  : 'block',
              )}
            >
              {fieldEnabled('firstName') && (
                <div>
                  <label htmlFor="firstName" className={labelClass}>
                    First Name
                    {fieldRequired('firstName') && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First Name"
                    required={fieldRequired('firstName')}
                    className={inputBaseClass}
                  />
                </div>
              )}
              {fieldEnabled('lastName') && (
                <div>
                  <label htmlFor="lastName" className={labelClass}>
                    Last Name
                    {fieldRequired('lastName') && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last Name"
                    required={fieldRequired('lastName')}
                    className={inputBaseClass}
                  />
                </div>
              )}
            </div>
          )}

          {fieldEnabled('fullName') && !fieldEnabled('firstName') && !fieldEnabled('lastName') && (
            <div>
              <label htmlFor="fullName" className={labelClass}>
                Full Name
                {fieldRequired('fullName') && <span className="text-red-500 ml-1">*</span>}
              </label>
              <input
                id="fullName"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full Name"
                required={fieldRequired('fullName')}
                className={inputBaseClass}
              />
            </div>
          )}

          {fieldEnabled('email') && (
            <div>
              <label htmlFor="email" className={labelClass}>
                Email
                {fieldRequired('email') && <span className="text-red-500 ml-1">*</span>}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required={fieldRequired('email')}
                className={inputBaseClass}
              />
            </div>
          )}

          {(fieldEnabled('phone') || fieldEnabled('phoneType')) && (
            <div
              className={cn(
                fieldEnabled('phone') && fieldEnabled('phoneType')
                  ? 'grid grid-cols-1 @xs:grid-cols-2 gap-3'
                  : 'block',
              )}
            >
              {fieldEnabled('phone') && (
                <div>
                  <label htmlFor="phone" className={labelClass}>
                    Phone Number<span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => {
                      const formatted = formatPhoneNumber(e.target.value, phone);
                      setPhone(formatted);
                      setPhoneError(validatePhone(formatted));
                    }}
                    placeholder="(555) 123-4567"
                    required
                    aria-invalid={!!phoneError}
                    aria-describedby={phoneError ? 'phone-error' : undefined}
                    className={cn(
                      inputBaseClass,
                      phoneError && 'border-red-500 focus:ring-red-500 focus:border-red-500',
                    )}
                  />
                  {phoneError && (
                    <p id="phone-error" className="text-sm text-red-500 mt-1">
                      {phoneError}
                    </p>
                  )}
                </div>
              )}
              {fieldEnabled('phoneType') && (
                <div>
                  <label htmlFor="phoneType" className={labelClass}>
                    Phone Type
                    {fieldRequired('phoneType') && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <select
                    id="phoneType"
                    value={phoneType}
                    onChange={(e) => setPhoneType(e.target.value as 'mobile' | 'home' | 'work' | '')}
                    required={fieldRequired('phoneType')}
                    className={inputBaseClass}
                  >
                    <option value="">Select</option>
                    {PHONE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {fieldEnabled('origin') && (
            <div>
              <label htmlFor="origin" className={labelClass}>
                Origin Address / Postal Code
                {fieldRequired('origin') && <span className="text-red-500 ml-1">*</span>}
              </label>
              <div className="relative">
                <MapPin className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
                <div className="[&_input]:pl-10">
                  <PlacesAutocomplete
                    value={originText}
                    onChange={(v) => {
                      setOriginText(v);
                      // Clear the structured place if the user edits the text
                      // away from the previously-selected formatted address.
                      if (originPlace && v !== originPlace.raw) setOriginPlace(null);
                    }}
                    onSelect={handleOriginSelect}
                    placeholder="Origin"
                  />
                </div>
              </div>
            </div>
          )}

          {fieldEnabled('destination') && (
            <div>
              <label htmlFor="destination" className={labelClass}>
                Destination Address / Postal Code
                {fieldRequired('destination') && <span className="text-red-500 ml-1">*</span>}
              </label>
              <div className="relative">
                <MapPin className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
                <div className="[&_input]:pl-10">
                  <PlacesAutocomplete
                    value={destinationText}
                    onChange={(v) => {
                      setDestinationText(v);
                      if (destinationPlace && v !== destinationPlace.raw) setDestinationPlace(null);
                    }}
                    onSelect={handleDestinationSelect}
                    placeholder="Destination"
                  />
                </div>
              </div>
            </div>
          )}

          {fieldEnabled('companyName') && (
            <div>
              <label htmlFor="companyName" className={labelClass}>
                Company Name
                {fieldRequired('companyName') && <span className="text-red-500 ml-1">*</span>}
              </label>
              <input
                id="companyName"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Company Name"
                required={fieldRequired('companyName')}
                className={inputBaseClass}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{ backgroundColor: config.theme.buttonColor }}
            className="w-full text-white font-semibold py-3.5 px-4 rounded-lg transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-60 disabled:cursor-not-allowed mt-2 text-base shadow-sm"
          >
            {submitting ? 'Submitting...' : config.theme.buttonText}
          </button>
        </form>
      </div>
    </div>
    </>
  );
}

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
    <div className="min-h-screen bg-transparent px-3 py-4 sm:px-4 sm:py-10 flex flex-col">
      <div className="@container max-w-md w-full mx-auto flex-1 bg-white rounded-xl @sm:rounded-2xl shadow-lg @sm:shadow-xl border border-gray-200 p-5 @sm:p-7 @md:p-8 space-y-5">
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
