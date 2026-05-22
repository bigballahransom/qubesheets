'use client';

// app/onsite-walkthrough/[token]/page.tsx
// Mobile recording page for the onsite walkthrough flow.
// Validates the token, then mounts OnsiteRecorderLiveKit for the
// LiveKit + egress recording flow.
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, AlertCircle } from 'lucide-react';
import OnsiteRecorderLiveKit from './components/OnsiteRecorderLiveKit';

interface ValidatedSession {
  projectId: string;
  projectName: string;
  liveKitRoomName: string;
  maxRecordingDuration: number;
}

export default function OnsiteWalkthroughMobilePage() {
  const params = useParams();
  const token = typeof params?.token === 'string' ? params.token : '';

  const [session, setSession] = useState<ValidatedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing session token in URL.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/onsite-walkthrough/${token}/validate`, {
          method: 'GET',
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data?.isValid) {
          throw new Error(data?.error || 'Session not valid.');
        }
        setSession({
          projectId: data.projectId,
          projectName: data.projectName,
          liveKitRoomName: data.liveKitRoomName,
          maxRecordingDuration: data.maxRecordingDuration,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Validation failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-md">
        {loading && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white p-8 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Loading session…</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-white p-8 text-center">
            <AlertCircle className="h-6 w-6 text-red-500" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {session && !loading && !error && (
          <OnsiteRecorderLiveKit
            uploadToken={token}
            projectName={session.projectName}
            maxDurationSeconds={session.maxRecordingDuration}
          />
        )}
      </div>
    </main>
  );
}
