'use client';

// components/UploadChooser.tsx
//
// The "Record Video / Take or Upload Photos" chooser screen. Renders in two
// contexts:
//
//   1. The existing /customer-upload/[token] route — the route owns the
//      viewMode state machine and passes its already-fetched validation in
//      via `prefetchedValidation`. Picks call `onChoose(kind)` which swaps
//      viewMode in place.
//
//   2. The embed iframe at /embed/[configId] after a successful submission.
//      No prefetched validation (the iframe just got back a token from the
//      lead pipeline), so the component fetches /validate itself. No
//      onChoose is provided; the default break-out fires — top-frame nav to
//      /customer-upload/<token>?greeting=lead&start=<kind> so the full-page
//      experience handles the actual media capture.
//
// Keeping all chooser UI here means the route's page.tsx no longer carries
// the 150-line block and any future tweaks to the chooser apply equally to
// both consumers.

import { useEffect, useState } from 'react';
import { Building2, CalendarCheck, CheckCircle, ImageIcon, Loader2, Video } from 'lucide-react';
import { canRecordVideo } from '@/lib/deviceDetection';
import Logo from '../public/logo';

export interface UploadChooserValidation {
  customerName: string;
  projectName: string;
  branding?: { companyName: string; companyLogo?: string } | null;
  uploadMode?: 'files' | 'recording' | 'both';
  isWalkthrough?: boolean;
  photosEnabled?: boolean;
}

export interface UploadChooserProps {
  token: string;
  /** Skip the internal /validate fetch. The existing route passes its
   *  already-fetched validation here so we don't double-fetch. */
  prefetchedValidation?: UploadChooserValidation | null;
  /** Render "Hi {firstName}!" above the standard greeting. */
  showLeadGreeting?: boolean;
  /** Called when the customer picks an option. When omitted, the component
   *  performs the default break-out behavior — top-frame nav to the
   *  customer-upload route at /customer-upload/<token>?greeting=lead&start=
   *  with a cross-origin fallback to in-frame navigation. */
  onChoose?: (kind: 'recording' | 'upload') => void;
  /** When true, render in the embed-card style: same outer wrapper +
   *  card framing as the lead form, no header / greeting / footer, just
   *  the two action buttons. Used when the chooser is shown as the next
   *  view inside the embed iframe. */
  embedded?: boolean;
  /** Optional callback for a third "Schedule a virtual call" option.
   *  When provided AND `embedded` is true, the chooser renders three
   *  buttons instead of two. The parent (LeadForm) wires this to swap
   *  into the scheduler view. */
  onSchedule?: () => void;
}

const DEFAULT_VALIDATION: UploadChooserValidation = {
  customerName: 'Customer',
  projectName: 'Photo Upload',
  branding: null,
  uploadMode: 'both',
  isWalkthrough: false,
  photosEnabled: true,
};

// Outer wrapper + card classes that match LeadForm's framing. Content-sized
// (no min-height) so the host iframe shrinks to the chooser's actual height
// — same approach LeadForm uses, keeping the post-submit transition tight.
const EMBED_OUTER = 'bg-transparent p-2 sm:p-3';
const EMBED_CARD =
  '@container max-w-md w-full mx-auto bg-white rounded-xl @sm:rounded-2xl shadow-lg @sm:shadow-xl border border-gray-200 p-5 @sm:p-7 @md:p-8';

export default function UploadChooser({
  token,
  prefetchedValidation,
  showLeadGreeting,
  onChoose,
  embedded,
  onSchedule,
}: UploadChooserProps) {
  const [validation, setValidation] = useState<UploadChooserValidation | null>(
    prefetchedValidation ?? null,
  );
  const [loading, setLoading] = useState(!prefetchedValidation);
  const [supportsRecording, setSupportsRecording] = useState(false);

  useEffect(() => {
    setSupportsRecording(canRecordVideo());
  }, []);

  useEffect(() => {
    if (prefetchedValidation) {
      setValidation(prefetchedValidation);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(`/api/customer-upload/${token}/validate`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setValidation({
            customerName: data.customerName || 'Customer',
            projectName: data.projectName || 'Photo Upload',
            branding: data.branding ?? null,
            uploadMode: data.uploadMode ?? 'both',
            isWalkthrough: !!data.isWalkthrough,
            photosEnabled: data.photosEnabled !== false,
          });
        } else {
          setValidation(DEFAULT_VALIDATION);
        }
      })
      .catch(() => {
        if (!cancelled) setValidation(DEFAULT_VALIDATION);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, prefetchedValidation]);

  const handleChoose = (kind: 'recording' | 'upload') => {
    if (onChoose) {
      onChoose(kind);
      return;
    }
    // Default: break out of any iframe to the full-page customer-upload
    // experience, where the recorder/uploader runs with full viewport and
    // direct browser camera/mic permissions.
    const relative = `/customer-upload/${token}?greeting=lead&start=${kind}`;
    try {
      if (typeof window !== 'undefined' && window.top && window.top !== window.self) {
        window.top.location.href = relative;
        return;
      }
    } catch {
      // Cross-origin top — fall through to in-frame nav.
    }
    if (typeof window !== 'undefined') {
      window.location.href = relative;
    }
  };

  if (loading) {
    if (embedded) {
      return (
        <div className={EMBED_OUTER}>
          <div className={`${EMBED_CARD} flex items-center justify-center min-h-[600px]`}>
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-label="Loading" />
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Loading</h2>
            <p className="text-slate-600">Setting up your upload page…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!validation) {
    if (embedded) {
      return (
        <div className={EMBED_OUTER}>
          <div className={`${EMBED_CARD} flex flex-col justify-center text-center`}>
            <h2 className="text-base font-semibold text-gray-900 mb-1">Upload page unavailable</h2>
            <p className="text-gray-600 text-sm">Please refresh the page or contact your moving company.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Upload page unavailable</h2>
            <p className="text-slate-600">Please refresh the page or contact your moving company.</p>
          </div>
        </div>
      </div>
    );
  }

  const photosAllowed = validation.photosEnabled !== false;
  const canRecord = supportsRecording && validation.uploadMode !== 'files';
  const canUpload = validation.uploadMode !== 'recording' && photosAllowed;
  const noOptionsAvailable = !canRecord && !canUpload;
  const leadFirstName = validation.customerName?.split(' ')[0]?.trim();

  if (embedded) {
    const thanksName =
      (showLeadGreeting && leadFirstName) || validation.customerName;
    return (
      <div className={EMBED_OUTER}>
        <div className={`${EMBED_CARD} space-y-6`}>
          {/* Greeting block (no company-branding header above). */}
          <div className="text-center">
            {validation.isWalkthrough ? (
              <>
                <h1 className="text-xl @sm:text-2xl font-bold text-gray-900 mb-2">
                  On-site walkthrough
                </h1>
                <p className="text-gray-600 text-sm @sm:text-base">
                  Capturing inventory for <strong>{validation.projectName}</strong>
                </p>
              </>
            ) : (
              <>
                <CheckCircle
                  className="w-12 h-12 @sm:w-14 @sm:h-14 text-green-500 mx-auto mb-3"
                  aria-hidden
                />
                <h1 className="text-xl @sm:text-2xl font-bold text-gray-900 mb-2">
                  Thanks, {thanksName}!
                </h1>
                <p className="text-gray-600 text-sm @sm:text-base">
                  We&apos;ve received your information and will get back to you shortly.
                </p>
                <p className="text-gray-600 text-sm @sm:text-base mt-3">
                  Skip the wait and lock in an accurate quote — just walk us through your home below.
                </p>
              </>
            )}
          </div>

          {noOptionsAvailable ? (
            <div className="text-center">
              <h2 className="text-base font-semibold text-gray-900 mb-1">
                This link is no longer accepting uploads
              </h2>
              <p className="text-gray-600 text-sm">
                {validation.branding?.companyName || 'Your moving company'} has temporarily disabled photo uploads.
              </p>
            </div>
          ) : (
            <div className="space-y-3 @sm:space-y-4">
              {canRecord && (
                <button
                  onClick={() => handleChoose('recording')}
                  className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl @sm:rounded-2xl p-5 @sm:p-6 text-left transition-colors shadow-md"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 @sm:w-14 @sm:h-14 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Video className="w-6 h-6 @sm:w-7 @sm:h-7" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base @sm:text-lg font-semibold mb-0.5">Record Video</h2>
                      <p className="text-blue-100 text-xs @sm:text-sm">
                        Walk through your home and record your belongings
                      </p>
                    </div>
                  </div>
                </button>
              )}
              {canUpload && (
                <button
                  onClick={() => handleChoose('upload')}
                  className="w-full bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-900 rounded-xl @sm:rounded-2xl p-5 @sm:p-6 text-left transition-colors shadow-sm border border-gray-200"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 @sm:w-14 @sm:h-14 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <ImageIcon className="w-6 h-6 @sm:w-7 @sm:h-7 text-gray-600" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base @sm:text-lg font-semibold mb-0.5">Take or Upload Photos</h2>
                      <p className="text-gray-500 text-xs @sm:text-sm">
                        Snap photos in-app or pick from your photo library
                      </p>
                    </div>
                  </div>
                </button>
              )}
              {onSchedule && (
                <button
                  onClick={() => onSchedule()}
                  className="w-full bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-900 rounded-xl @sm:rounded-2xl p-5 @sm:p-6 text-left transition-colors shadow-sm border border-gray-200"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 @sm:w-14 @sm:h-14 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
                      <CalendarCheck className="w-6 h-6 @sm:w-7 @sm:h-7 text-green-600" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base @sm:text-lg font-semibold mb-0.5">Schedule a virtual call</h2>
                      <p className="text-gray-500 text-xs @sm:text-sm">
                        Talk live with our team to walk through your home together
                      </p>
                    </div>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* Security note sits at the bottom of the natural content stack. */}
          <div className="flex items-center justify-center gap-2 text-xs @sm:text-sm text-gray-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Your media is private and secure</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 flex flex-col">
      {/* Header */}
      <header className="p-4 flex items-center justify-between border-b border-slate-200/50 bg-white/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          {validation.branding?.companyLogo ? (
            <img
              src={validation.branding.companyLogo}
              alt={validation.branding.companyName}
              className="w-10 h-10 object-contain rounded-lg"
            />
          ) : (
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
          )}
          <div>
            <p className="font-medium text-slate-800">
              {validation.branding?.companyName || 'Moving Company'}
            </p>
            <p className="text-sm text-slate-500">Self-Serve Inventory Upload</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          {/* Lead-pipeline greeting: shown when this is a lead-pipeline arrival. */}
          {showLeadGreeting && leadFirstName && (
            <h1 className="text-2xl font-bold mb-2 text-center">
              Hi {leadFirstName}!
            </h1>
          )}

          {validation.isWalkthrough ? (
            <>
              <h1 className="text-2xl font-bold text-slate-800 mb-2">
                On-site walkthrough
              </h1>
              <p className="text-slate-600 mb-8">
                Capturing inventory for <strong>{validation.projectName}</strong>
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-800 mb-2">
                Hi {validation.customerName}!
              </h1>
              <p className="text-slate-600 mb-8">
                Help us ensure a wonderful moving experience by preparing your moving inventory
              </p>
            </>
          )}

          {noOptionsAvailable && (
            <div className="bg-white rounded-2xl p-6 text-left shadow-lg border border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800 mb-2">
                This link is no longer accepting uploads
              </h2>
              <p className="text-slate-600 text-sm">
                {validation.branding?.companyName || 'Your moving company'} has temporarily disabled photo uploads. Please reach out to them for a new link or to schedule a video walkthrough.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {canRecord && (
              <button
                onClick={() => handleChoose('recording')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl p-6 text-left transition-all shadow-lg hover:shadow-xl"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Video className="w-7 h-7" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold mb-1">Record Video</h2>
                    <p className="text-blue-100 text-sm">
                      Walk through your home and record your belongings
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-blue-200 text-xs">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Recommended - fastest way to capture everything</span>
                </div>
              </button>
            )}

            {canUpload && (
              <button
                onClick={() => handleChoose('upload')}
                className="w-full bg-white hover:bg-slate-50 text-slate-800 rounded-2xl p-6 text-left transition-all shadow-lg hover:shadow-xl border border-slate-200"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <ImageIcon className="w-7 h-7 text-slate-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold mb-1">Take or Upload Photos</h2>
                    <p className="text-slate-500 text-sm">
                      Snap photos in-app or pick from your photo library
                    </p>
                  </div>
                </div>
              </button>
            )}
          </div>

          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-slate-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Your media is private and secure</span>
          </div>
        </div>
      </main>

      <footer className="p-4 text-center">
        <div className="inline-flex items-center text-slate-400 text-sm">
          <span>Powered by</span>
          <div className="scale-[0.7] origin-center -ml-1">
            <Logo />
          </div>
        </div>
      </footer>
    </div>
  );
}
