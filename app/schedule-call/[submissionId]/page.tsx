// app/schedule-call/[submissionId]/page.tsx
//
// Hosted standalone scheduler for lead submissions. Third-party sites that
// capture leads through the JS plugin (qs-embed.js) receive this URL as
// `action.schedulerUrl` and link customers here to book a virtual call —
// the same ScheduleCallView the embed iframe renders, wrapped in the
// customer-upload page chrome. The customer-upload chooser's "Schedule a
// virtual call" option lands here too.
//
// The submissionId in the path is the authorization (same model as the
// public schedule-call API): anonymous, unguessable, and rejected once the
// scheduling window closes — expired/invalid links get a friendly dead-end.
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Building2, CalendarX, Loader2 } from 'lucide-react';
import ScheduleCallView, {
  type SlotsPayload,
} from '@/components/embed/ScheduleCallView';
import Logo from '../../../public/logo';

interface BrandingData {
  companyName: string;
  companyLogo?: string;
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; slots: SlotsPayload; branding: BrandingData | null };

export default function ScheduleCallPage() {
  const params = useParams();
  const submissionId = params?.submissionId as string;

  const [state, setState] = useState<PageState>({ kind: 'loading' });

  useEffect(() => {
    if (!submissionId) return;
    let cancelled = false;
    fetch(`/api/leads/schedule-call/${submissionId}`)
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok || !json) {
          // 410 = scheduling window expired; 404 = bad/unknown id. Both get
          // the same customer-facing dead-end — the distinction only
          // matters to us.
          throw new Error(
            r.status === 410
              ? 'This scheduling link has expired.'
              : 'This scheduling link is invalid.',
          );
        }
        return json as SlotsPayload & { branding?: BrandingData | null };
      })
      .then((data) => {
        if (cancelled) return;
        const { branding, ...slots } = data;
        setState({ kind: 'ready', slots, branding: branding ?? null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Could not load the scheduler.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  if (state.kind === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Loading Scheduler</h2>
            <p className="text-slate-600">Fetching available times…</p>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CalendarX className="w-8 h-8 text-slate-500" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">
              Scheduling unavailable
            </h2>
            <p className="text-slate-600">
              {state.message} Please contact your moving company to set up a
              virtual call.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 flex flex-col">
      {/* Header — same chrome as the customer-upload chooser. */}
      <header className="p-4 flex items-center justify-between border-b border-slate-200/50 bg-white/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          {state.branding?.companyLogo ? (
            <img
              src={state.branding.companyLogo}
              alt={state.branding.companyName}
              className="w-10 h-10 object-contain rounded-lg"
            />
          ) : (
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-600" />
            </div>
          )}
          <div>
            <p className="font-medium text-slate-800">
              {state.branding?.companyName || 'Moving Company'}
            </p>
            <p className="text-sm text-slate-500">Schedule a Virtual Call</p>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center py-6">
        <div className="w-full max-w-md">
          <ScheduleCallView submissionId={submissionId} prefetched={state.slots} />
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
