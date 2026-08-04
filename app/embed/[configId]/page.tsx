'use client';

// app/embed/[configId]/page.tsx
//
// Pure client page. Earlier this was a server component that fetched the
// public config server-side and rendered <LeadForm /> as a client
// reference. That path consistently hit a Next 15 server-side webpack
// module-id resolution error (`__webpack_modules__[moduleId] is not a
// function`) regardless of clean builds, dynamic imports, or config
// tweaks. Since there's nothing useful to SSR for the form anyway (it
// needs the Google Maps script, which only exists in the browser), we
// just do the fetch in useEffect and render entirely on the client.
//
// While the config is in flight, render a skeleton card whose shape matches
// the form so the user sees something tangible immediately and there's no
// layout shift when the real form takes over.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import LeadForm, { PremiumSuccess } from '@/components/embed/LeadForm';
import { ErrorState } from '@/components/embed/EmbedShell';
import { ChooserSkeleton, ScheduleSkeleton } from '@/components/embed/ActionSkeleton';
import {
  googleFontHref,
  resolveFontStack,
  resolveText,
  sanitizeCustomCss,
  type LeadFormPreviewScreen,
  type LeadFormTextOverrides,
} from '@/lib/leads/appearance';

// Post-submit views used by the draft-preview harness — lazy like LeadForm's
// own dynamic imports so the plain embed path doesn't pay for them.
const UploadChooser = dynamic(() => import('@/components/UploadChooser'), {
  ssr: false,
  loading: () => <ChooserSkeleton />,
});
const ScheduleCallView = dynamic(() => import('@/components/embed/ScheduleCallView'), {
  ssr: false,
  loading: () => <ScheduleSkeleton />,
});

interface PublicFormConfig {
  id: string;
  name: string;
  isActive: boolean;
  fields: Array<{ id: string; enabled: boolean; required: boolean; label?: string }>;
  theme: {
    title: string;
    subtitle?: string;
    buttonText: string;
    buttonColor: string;
    logoUrl?: string;
    backgroundColor?: string;
    fontFamily?: string;
    customCss?: string;
    text?: LeadFormTextOverrides;
  };
  postSubmit: { kind: 'inline-message' | 'redirect-chooser'; message?: string };
  moveSizeOptions?: string[];
  steps?: Array<{ heading?: string; fields: string[] }>;
  customFields?: Array<{
    id: string;
    label: string;
    type: 'text' | 'textarea' | 'select';
    required: boolean;
    options?: string[];
  }>;
}

// Same outer-shell dimensions as the real form so the skeleton occupies the
// same footprint — zero layout shift when the form swaps in.
function FormSkeleton() {
  return (
    <div className="bg-transparent p-2 sm:p-3">
      <div
        className="@container max-w-md w-full mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 p-5 @sm:p-7 @md:p-8"
        aria-busy="true"
        aria-label="Loading form"
      >
        {/* Title bar */}
        <div className="h-6 w-2/3 mx-auto rounded-md bg-gray-100 animate-pulse mb-3" />
        <div className="h-4 w-1/2 mx-auto rounded-md bg-gray-100 animate-pulse mb-6" />
        {/* Progress dots placeholder */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          <div className="h-1.5 w-7 rounded-full bg-gray-200" />
          <div className="h-1.5 w-1.5 rounded-full bg-gray-200" />
          <div className="h-1.5 w-1.5 rounded-full bg-gray-200" />
        </div>
        {/* Heading */}
        <div className="h-7 w-3/4 rounded-md bg-gray-100 animate-pulse mb-5" />
        {/* Two input shapes */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="h-3 w-20 rounded bg-gray-100 animate-pulse" />
            <div className="h-12 w-full rounded-xl bg-gray-100 animate-pulse" />
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-24 rounded bg-gray-100 animate-pulse" />
            <div className="h-12 w-full rounded-xl bg-gray-100 animate-pulse" />
          </div>
        </div>
        {/* Button */}
        <div className="h-12 w-full rounded-xl bg-gray-200 animate-pulse mt-6" />
      </div>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="bg-transparent p-2 sm:p-3">
      <div className="@container max-w-md w-full mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 p-8 text-center">
        <p className="text-gray-600 text-base">This form is not available.</p>
      </div>
    </div>
  );
}

// Notify the parent iframe of our body height after every render — covers the
// skeleton, the error state, and any transient state before LeadForm takes
// over its own height management.
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

// --- Draft-preview harness -------------------------------------------------
//
// Rendered when the editor opens this page with `?draftPreview=1` inside its
// live-preview iframe. Nothing is fetched: the editor postMessages the
// UNSAVED draft config on every change, and this host re-renders the chosen
// screen with it. The non-form screens use mock data (fake customer, fake
// slots) so they render fully with zero backend calls, and no interaction
// in here can create submissions, SMS, or bookings.

interface DraftPreviewPayload {
  config: PublicFormConfig;
  screen: LeadFormPreviewScreen;
  // Bumped by the editor when a screen pill is clicked — used as the form's
  // key so re-clicking "Form" restarts a form that was submitted in preview.
  nonce: number;
}

function buildMockSlots(): string[] {
  const slots: string[] = [];
  const base = new Date();
  for (let day = 1; day <= 3; day++) {
    for (const hour of [9, 10, 11, 13, 14]) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + day, hour, 0, 0);
      slots.push(d.toISOString());
    }
  }
  return slots;
}

function DraftPreviewHost() {
  const [payload, setPayload] = useState<DraftPreviewPayload | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only the editor (same origin) may drive the preview.
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type === 'qs-draft-preview' && data.config) {
        setPayload({
          config: data.config as PublicFormConfig,
          screen: (data.screen as LeadFormPreviewScreen) ?? 'form',
          nonce: typeof data.nonce === 'number' ? data.nonce : 0,
        });
      }
    };
    window.addEventListener('message', onMessage);
    // Ask the editor for the initial payload — it may have posted before this
    // listener attached.
    window.parent?.postMessage({ type: 'qs-draft-preview-ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Keep the host iframe sized to the content on every screen/config change.
  useEffect(() => {
    postIframeHeight();
    const observer = new ResizeObserver(() => postIframeHeight());
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [payload]);

  const fontHref = googleFontHref(payload?.config.theme.fontFamily);
  useEffect(() => {
    if (!fontHref) return;
    if (document.head.querySelector(`link[href="${fontHref}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontHref;
    document.head.appendChild(link);
  }, [fontHref]);

  const mockSlots = useMemo(buildMockSlots, []);

  if (!payload) return <FormSkeleton />;

  const { config, screen, nonce } = payload;
  const theme = config.theme;
  const text = theme.text;
  const fontStack = resolveFontStack(theme.fontFamily);
  const customCss = theme.customCss?.trim() ? sanitizeCustomCss(theme.customCss) : null;
  const cardStyle = theme.backgroundColor
    ? { backgroundColor: theme.backgroundColor }
    : undefined;
  const successMessage =
    (config.postSubmit.kind === 'inline-message' && config.postSubmit.message) ||
    resolveText(text, 'successFallbackMessage');

  return (
    <div
      className="qs-embed-root"
      style={fontStack ? { fontFamily: fontStack } : undefined}
    >
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}

      {screen === 'form' && (
        <LeadForm
          key={nonce}
          config={config}
          configId={config.id || 'draft-preview'}
          staticPreview
        />
      )}

      {screen === 'success' && (
        <PremiumSuccess
          message={successMessage}
          title={resolveText(text, 'successTitle')}
          accentColor={theme.buttonColor}
          cardStyle={cardStyle}
          spring={{ duration: 0 }}
        />
      )}

      {screen === 'error' && (
        <ErrorState
          message="We could not submit your form. Please try again."
          title={resolveText(text, 'errorTitle')}
          retryLabel={resolveText(text, 'errorRetryButton')}
          backLabel={resolveText(text, 'errorBackButton')}
          cardStyle={cardStyle}
          onRetry={() => {}}
          onBack={() => {}}
        />
      )}

      {screen === 'chooser' && (
        <UploadChooser
          token="draft-preview"
          embedded
          showLeadGreeting
          prefetchedValidation={{
            customerName: 'Jane Smith',
            projectName: 'Preview',
            branding: null,
            uploadMode: 'both',
            isWalkthrough: false,
            photosEnabled: true,
          }}
          textOverrides={text}
          onChoose={() => {}}
          onSchedule={() => {}}
        />
      )}

      {screen === 'schedule' && (
        // Display-only: slot clicks are harmless but the confirm button would
        // POST to a booking endpoint, so the whole view is inert.
        <div className="pointer-events-none">
          <ScheduleCallView
            submissionId="draft-preview"
            prefetched={{
              timezone:
                Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              customerName: 'Jane Smith',
              slots: mockSlots,
            }}
            textOverrides={text}
          />
        </div>
      )}
    </div>
  );
}

export default function EmbedPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const configId = typeof params?.configId === 'string' ? params.configId : '';
  // Preview mode is triggered from the editor via `?preview=1`. The form
  // shows a sticky banner and routes submissions to the simulation
  // endpoint — no Customer/Project/credit consumption.
  const previewMode = searchParams?.get('preview') === '1';
  // Draft-preview mode: the editor's live-preview iframe. No fetch — the
  // editor streams the unsaved draft config in via postMessage.
  const draftPreview = searchParams?.get('draftPreview') === '1';

  const [config, setConfig] = useState<PublicFormConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (draftPreview) return;
    if (!configId) {
      setUnavailable(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    fetch(`/api/embedded-forms/${configId}/public`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setConfig(data);
        } else {
          setUnavailable(true);
        }
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [configId, draftPreview]);

  // Keep the host iframe sized correctly while we're in skeleton/unavailable
  // states. Once <LeadForm /> mounts it takes over height reporting itself.
  useEffect(() => {
    postIframeHeight();
  }, [loading, unavailable]);

  // Load the themed Google Font (if any) by appending a stylesheet link.
  // Done imperatively — React only hoists <link rel="stylesheet"> rendered
  // in the body when given a `precedence` prop, and a plain DOM append is
  // unambiguous about when the font starts loading.
  const fontHref = googleFontHref(config?.theme.fontFamily);
  useEffect(() => {
    if (!fontHref) return;
    if (document.head.querySelector(`link[href="${fontHref}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = fontHref;
    document.head.appendChild(link);
    // Intentionally never removed — fonts are cheap to keep and removal
    // would flash the fallback if the config refetches.
  }, [fontHref]);

  if (draftPreview) {
    return <DraftPreviewHost />;
  }

  if (loading) {
    return <FormSkeleton />;
  }

  if (unavailable || !config) {
    return <Unavailable />;
  }

  const fontStack = resolveFontStack(config.theme.fontFamily);
  const customCss = config.theme.customCss?.trim()
    ? sanitizeCustomCss(config.theme.customCss)
    : null;

  // qs-embed-root + the injected style tag are the custom-CSS surface: the
  // wrapper carries the themed font (inputs/buttons inherit it via Tailwind
  // preflight) and every view — form, thank-you, error, chooser, scheduler —
  // renders inside it.
  return (
    <div
      className="qs-embed-root"
      style={fontStack ? { fontFamily: fontStack } : undefined}
    >
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}
      <LeadForm config={config} configId={configId} previewMode={previewMode} />
    </div>
  );
}
