'use client';

// Media Vault tab — org-wide view of vault captures (crew walk-in / walk-out,
// damage docs) so the office can see which jobs got covered without opening
// each project. Per-job rollup table + recent-captures thumbnail feed; rows
// and cards deep-link to the project's Vault tab (?tab=vault).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Camera, Film, ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import SafeIcon from '@/components/icons/SafeIcon';
import KpiCard from '../KpiCard';
import { useDashboard } from '../DashboardContext';

interface VaultData {
  range: string;
  summary: {
    total: number;
    photos: number;
    videos: number;
    jobs: number;
    prevTotal: number;
    prevPhotos: number;
    prevVideos: number;
  };
  perProject: {
    projectId: string;
    name: string;
    customerName: string | null;
    vaultUnfiled: boolean;
    photos: number;
    videos: number;
    total: number;
    lastCaptureAt: string;
    labels: string[];
  }[];
  recent: {
    kind: 'video' | 'image' | 'recording';
    id: string;
    projectId: string;
    projectName: string;
    label: string | null;
    description: string | null;
    name: string;
    mediaType: 'video' | 'image';
    createdAt: string;
    streamUrl: string | null;
  }[];
  recentTruncated: boolean;
}

export default function VaultTab() {
  const { rangeQuery, range } = useDashboard();
  const [data, setData] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/dashboard/vault?${rangeQuery}`);
        if (response.ok && !cancelled) {
          setData(await response.json());
        }
      } catch (error) {
        console.error('Failed to load vault activity:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [rangeQuery]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)}
        </div>
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[240px] rounded-xl" />
      </div>
    );
  }

  const { summary, perProject, recent } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Vault captures" value={summary.total} prev={summary.prevTotal} range={range} />
        <KpiCard label="Photos" value={summary.photos} prev={summary.prevPhotos} range={range} />
        <KpiCard label="Videos" value={summary.videos} prev={summary.prevVideos} range={range} />
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Jobs with captures</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{summary.jobs.toLocaleString('en-US')}</p>
          <p className="text-xs text-slate-400 mt-0.5">in this period</p>
        </div>
      </div>

      {/* Per-job rollup — the "who did a walk-in/walk-out where" answer */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <SafeIcon size={20} className="text-blue-500" />
          Vault Activity by Job
        </h2>
        <p className="text-sm text-gray-500 mt-1 mb-4">
          Every job that received vault media (walk-ins, walk-outs, damage docs) in this period
        </p>

        {perProject.length === 0 ? (
          <div className="text-center py-10 text-gray-500 bg-slate-50 rounded-lg">
            <p>No vault captures in this period</p>
            <p className="text-sm text-gray-400 mt-1">
              Crew captures from the vault link will show up here as they come in
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-slate-100">
                  <th className="py-2 pr-4 font-medium">Job</th>
                  <th className="py-2 pr-4 font-medium text-right">Photos</th>
                  <th className="py-2 pr-4 font-medium text-right">Videos</th>
                  <th className="py-2 pr-4 font-medium">Latest capture</th>
                  <th className="py-2 font-medium">Labels</th>
                </tr>
              </thead>
              <tbody>
                {perProject.map((p) => (
                  <tr key={p.projectId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <td className="py-2.5 pr-4">
                      <Link
                        href={`/projects/${p.projectId}?tab=vault`}
                        className="font-medium text-gray-900 hover:text-blue-600 inline-flex items-center gap-1.5 group"
                      >
                        {p.name}
                        <ExternalLink className="h-3.5 w-3.5 text-gray-300 group-hover:text-blue-500" />
                      </Link>
                      {p.customerName && p.customerName !== p.name && (
                        <span className="block text-xs text-gray-400">{p.customerName}</span>
                      )}
                      {p.vaultUnfiled && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs text-amber-700">
                          Unfiled
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{p.photos.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{p.videos.toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-gray-500 whitespace-nowrap">{formatWhen(p.lastCaptureAt)}</td>
                    <td className="py-2.5 text-gray-500">
                      {p.labels.length > 0 ? p.labels.join(' · ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent captures feed */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900">Recent Captures</h2>
        <p className="text-sm text-gray-500 mt-1 mb-4">
          Newest vault media across all jobs{data.recentTruncated ? ` (latest ${recent.length} shown)` : ''}
        </p>

        {recent.length === 0 ? (
          <div className="text-center py-8 text-gray-500 bg-slate-50 rounded-lg">
            <p>Nothing captured yet in this period</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {recent.map((item) => (
              <Link
                key={`${item.kind}-${item.id}`}
                href={`/projects/${item.projectId}?tab=vault`}
                className="group rounded-lg border border-slate-200 overflow-hidden hover:border-blue-300 hover:shadow-sm transition-shadow bg-white"
              >
                <div className="h-32 bg-slate-100 flex items-center justify-center overflow-hidden">
                  {item.streamUrl ? (
                    item.mediaType === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.streamUrl}
                        alt={item.label || item.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <video
                        src={item.streamUrl}
                        className="h-full w-full object-cover"
                        preload="metadata"
                        muted
                        playsInline
                      />
                    )
                  ) : item.mediaType === 'image' ? (
                    <Camera className="h-8 w-8 text-slate-300" />
                  ) : (
                    <Film className="h-8 w-8 text-slate-300" />
                  )}
                </div>
                <div className="p-2.5">
                  <p className="text-sm font-medium text-gray-900 truncate group-hover:text-blue-600">
                    {item.label || item.name}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{item.projectName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatWhen(item.createdAt)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatWhen(value: string) {
  try {
    const date = new Date(value);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}
