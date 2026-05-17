'use client';

// app/onsite-walkthrough/[token]/page.tsx
// Mobile recording page for the onsite walkthrough flow. P1a scope: validate
// the token, show a "session loaded" confirmation. LiveKit join + recording
// UI ships in P1b.
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, AlertCircle, CheckCircle2, Camera } from 'lucide-react';

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
        const msg = e instanceof Error ? e.message : 'Validation failed.';
        setError(msg);
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
        <header className="mb-6 flex items-center gap-2">
          <Camera className="h-5 w-5 text-slate-700" />
          <h1 className="text-lg font-semibold text-slate-900">
            Onsite Walkthrough
          </h1>
        </header>

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
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-sm font-medium">
                Session loaded for {session.projectName}
              </span>
            </div>

            <dl className="space-y-2 text-xs text-slate-600">
              <div className="flex justify-between gap-3">
                <dt className="font-medium text-slate-700">LiveKit room</dt>
                <dd className="break-all text-right font-mono">
                  {session.liveKitRoomName}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-medium text-slate-700">Project ID</dt>
                <dd className="break-all text-right font-mono">
                  {session.projectId}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-medium text-slate-700">Max duration</dt>
                <dd>{Math.round(session.maxRecordingDuration / 60)} min</dd>
              </div>
            </dl>

            <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">P1a build — recording not wired up yet.</p>
              <p className="mt-1">
                LiveKit join + camera/mic capture + egress will land in P1b.
                Seeing this screen means the token, mode, and room name made it
                through end-to-end.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
