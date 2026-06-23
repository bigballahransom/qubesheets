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

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import LeadForm from '@/components/embed/LeadForm';

interface PublicFormConfig {
  id: string;
  name: string;
  isActive: boolean;
  fields: Array<{ id: string; enabled: boolean; required: boolean }>;
  theme: {
    title: string;
    subtitle?: string;
    buttonText: string;
    buttonColor: string;
    logoUrl?: string;
  };
  postSubmit: { kind: 'inline-message' | 'redirect-chooser'; message?: string };
  moveSizeOptions?: string[];
  steps?: Array<{ heading?: string; fields: string[] }>;
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

export default function EmbedPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const configId = typeof params?.configId === 'string' ? params.configId : '';
  // Preview mode is triggered from the editor via `?preview=1`. The form
  // shows a sticky banner and routes submissions to the simulation
  // endpoint — no Customer/Project/credit consumption.
  const previewMode = searchParams?.get('preview') === '1';

  const [config, setConfig] = useState<PublicFormConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
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
  }, [configId]);

  // Keep the host iframe sized correctly while we're in skeleton/unavailable
  // states. Once <LeadForm /> mounts it takes over height reporting itself.
  useEffect(() => {
    postIframeHeight();
  }, [loading, unavailable]);

  if (loading) {
    return <FormSkeleton />;
  }

  if (unavailable || !config) {
    return <Unavailable />;
  }

  return <LeadForm config={config} configId={configId} previewMode={previewMode} />;
}
