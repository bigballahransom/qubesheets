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

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-label="Loading form" />
      </div>
    );
  }

  if (unavailable || !config) {
    return (
      <div className="p-8 text-center text-gray-600">
        This form is not available.
      </div>
    );
  }

  return <LeadForm config={config} configId={configId} previewMode={previewMode} />;
}
