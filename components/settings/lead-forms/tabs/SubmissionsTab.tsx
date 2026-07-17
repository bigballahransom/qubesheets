'use client';

// components/settings/lead-forms/tabs/SubmissionsTab.tsx
//
// Captured submissions for one form, newest first, with each lead's
// after-submit outcome: scheduled a call, recorded a video, uploaded photos,
// inventory extracted — or nothing yet. Rows link to the lead's project page.
//
// Data comes from GET /api/embedded-forms/[id]/submissions (cursor
// pagination). Fetched on mount rather than on tab focus — the payload is
// small and this keeps the tab instant when the admin clicks over.

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  Calendar,
  Camera,
  ChevronDown,
  ExternalLink,
  Inbox,
  Loader2,
  Package,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SubmissionRow {
  id: string;
  submittedAt: string;
  source: 'embed' | 'api';
  consumedCredit: boolean;
  lead: {
    name: string | null;
    email: string | null;
    phone: string | null;
    moveDate: string | null;
    moveSize: string | null;
  };
  customerId: string | null;
  projectId: string | null;
  // Custom-field answers, snapshotted at submit time.
  custom: Array<{ id: string; label: string; value: string }>;
  outcome: {
    scheduledCall?: {
      scheduledFor: string;
      status: 'scheduled' | 'started' | 'completed' | 'cancelled';
    };
    video?: { sessions: number; completed: boolean; durationSeconds?: number };
    photos?: { photoCount: number };
    inventoryItems: number;
  };
}

interface SubmissionsTabProps {
  configId: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// One pill per thing the customer actually did after submitting. A lead can
// have several (recorded a video AND had inventory extracted from it).
function OutcomeBadges({ outcome }: { outcome: SubmissionRow['outcome'] }) {
  const badges: React.ReactNode[] = [];

  const call = outcome.scheduledCall;
  if (call) {
    const when = format(new Date(call.scheduledFor), 'MMM d, h:mm a');
    const label =
      call.status === 'cancelled'
        ? `Call cancelled (${when})`
        : call.status === 'completed'
          ? `Call completed (${when})`
          : `Call scheduled · ${when}`;
    badges.push(
      <span
        key="call"
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          call.status === 'cancelled'
            ? 'bg-gray-100 text-gray-500 line-through'
            : call.status === 'completed'
              ? 'bg-green-50 text-green-700'
              : 'bg-blue-50 text-blue-700',
        )}
      >
        <Calendar className="h-3 w-3" />
        {label}
      </span>,
    );
  }

  const video = outcome.video;
  if (video) {
    const label = video.completed
      ? `Video recorded${
          video.durationSeconds ? ` (${formatDuration(video.durationSeconds)})` : ''
        }`
      : 'Video started';
    badges.push(
      <span
        key="video"
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          video.completed ? 'bg-purple-50 text-purple-700' : 'bg-purple-50/60 text-purple-500',
        )}
      >
        <Video className="h-3 w-3" />
        {label}
      </span>,
    );
  }

  if (outcome.photos) {
    badges.push(
      <span
        key="photos"
        className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"
      >
        <Camera className="h-3 w-3" />
        {outcome.photos.photoCount} photo
        {outcome.photos.photoCount === 1 ? '' : 's'}
      </span>,
    );
  }

  if (outcome.inventoryItems > 0) {
    badges.push(
      <span
        key="inventory"
        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
      >
        <Package className="h-3 w-3" />
        {outcome.inventoryItems} item
        {outcome.inventoryItems === 1 ? '' : 's'} captured
      </span>,
    );
  }

  if (badges.length === 0) {
    return <span className="text-xs text-gray-400">No action yet</span>;
  }
  return <div className="flex flex-wrap gap-1.5">{badges}</div>;
}

export function SubmissionsTab({ configId }: SubmissionsTabProps) {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Submission ids whose custom-answer detail row is open.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      const qs = cursor ? `?before=${encodeURIComponent(cursor)}` : '';
      const res = await fetch(`/api/embedded-forms/${configId}/submissions${qs}`);
      if (!res.ok) throw new Error(`Failed to load submissions (${res.status})`);
      return (await res.json()) as {
        submissions: SubmissionRow[];
        hasMore: boolean;
        nextCursor: string | null;
      };
    },
    [configId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPage(null)
      .then((data) => {
        if (cancelled) return;
        setRows(data.submissions);
        setNextCursor(data.hasMore ? data.nextCursor : null);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load submissions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(nextCursor);
      setRows((prev) => [...prev, ...data.submissions]);
      setNextCursor(data.hasMore ? data.nextCursor : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading submissions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-10 text-center">
        <Inbox className="h-8 w-8 text-gray-300 mx-auto mb-3" />
        <h3 className="text-sm font-medium text-gray-900">No submissions yet</h3>
        <p className="text-sm text-gray-500 mt-1">
          Leads who submit this form will show up here, along with what they
          did after submitting.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-medium text-gray-900">Submissions</h2>
        <p className="text-sm text-gray-500 mt-1">
          Every lead captured by this form, newest first, with what they did
          after submitting.
        </p>
      </div>

      {/* Wide table scrolls inside the card on narrow screens */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/60 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3 font-medium">Submitted</th>
              <th className="px-4 py-3 font-medium">Lead</th>
              <th className="px-4 py-3 font-medium">Move</th>
              <th className="px-4 py-3 font-medium">After submit</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => {
              const hasCustom = row.custom.length > 0;
              const isExpanded = hasCustom && expanded.has(row.id);
              return (
                <Fragment key={row.id}>
                  <tr className="hover:bg-gray-50/50">
                    <td className="px-6 py-3 whitespace-nowrap align-top">
                      <div className="text-gray-900">
                        {format(new Date(row.submittedAt), 'MMM d, yyyy')}
                      </div>
                      <div className="text-xs text-gray-400">
                        {format(new Date(row.submittedAt), 'h:mm a')}
                        {row.source === 'api' && ' · API'}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top min-w-[10rem]">
                      <div className="font-medium text-gray-900">
                        {row.lead.name ?? '—'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {[row.lead.phone, row.lead.email].filter(Boolean).join(' · ') || '—'}
                      </div>
                      {hasCustom && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(row.id)}
                          aria-expanded={isExpanded}
                          className="mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-blue-600 hover:text-blue-800"
                        >
                          <ChevronDown
                            className={cn(
                              'h-3 w-3 transition-transform',
                              isExpanded ? 'rotate-0' : '-rotate-90',
                            )}
                          />
                          {row.custom.length} answer
                          {row.custom.length === 1 ? '' : 's'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <div className="text-gray-900">{row.lead.moveSize ?? '—'}</div>
                      <div className="text-xs text-gray-500">
                        {row.lead.moveDate
                          ? format(new Date(`${row.lead.moveDate}T00:00:00`), 'MMM d, yyyy')
                          : '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top min-w-[14rem]">
                      <OutcomeBadges outcome={row.outcome} />
                    </td>
                    <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                      {row.projectId && (
                        <Link
                          href={`/projects/${row.projectId}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                        >
                          Go to project
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={5} className="px-6 py-3">
                        <dl className="space-y-1.5">
                          {row.custom.map((c) => (
                            <div key={c.id} className="flex gap-3 text-xs">
                              <dt className="w-48 shrink-0 text-gray-500">
                                {c.label}
                              </dt>
                              <dd className="flex-1 min-w-0 text-gray-900 whitespace-pre-wrap break-words">
                                {c.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="px-6 py-4 border-t border-gray-100 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Loading…
              </>
            ) : (
              'Load more'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
