'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Video as VideoIcon, Info, PieChart as PieChartIcon, Check, FolderOpen, Loader2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '../DashboardContext';

type CaptureTypeValue = 'virtual' | 'self_serve' | 'on_site' | 'photo';

const CAPTURE_TYPE_OPTIONS: { value: CaptureTypeValue; label: string }[] = [
  { value: 'virtual', label: 'Virtual calls' },
  { value: 'self_serve', label: 'Self-serve' },
  { value: 'on_site', label: 'On-site / manual upload' },
  { value: 'photo', label: 'Photos' },
];

interface ActivityData {
  range: string;
  kpis: {
    recordingSessions: number;
    photosCollected: number;
    showRate: number | null;
    avgDurationSec: number | null;
    footageMinutes: number;
    itemsCaptured: number;
    totalFileSizeBytes: number;
  };
  typeTotals: { virtual: number; selfServe: number; onSite: number; photos: number };
  weeklyVolume: { week: string; virtual: number; selfServe: number; onSite: number; photos: number }[];
  perRep: {
    userId: string;
    name: string;
    imageUrl: string | null;
    virtual: number;
    selfServe: number;
    onSite: number;
    photos: number;
    showRate: number | null;
    avgDurationSec: number | null;
    totalDurationSec: number;
    totalSurveys: number;
    signOffs: number;
  }[];
}

// Same capture-bucket palette/order as the Overview tab
const seriesConfig = {
  virtual: { label: 'Virtual calls', color: '#2a78d6' },
  selfServe: { label: 'Self-serve', color: '#1baf7a' },
  onSite: { label: 'On-site / manual upload', color: '#eda100' },
  photos: { label: 'Photo batches', color: '#008300' },
} satisfies ChartConfig;

export default function ActivityTab() {
  const { rangeQuery, rep, isPersonalAccount } = useDashboard();
  // Empty set = no type filter (all types)
  const [selectedTypes, setSelectedTypes] = useState<Set<CaptureTypeValue>>(new Set());
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  // Rep whose project list is open in the dialog; captureType narrows it to
  // projects with that capture type in the selected period
  const [repDialog, setRepDialog] = useState<{
    userId: string;
    name: string;
    captureType?: CaptureTypeValue;
    typeLabel?: string;
  } | null>(null);

  const typesParam = selectedTypes.size === 0 ? 'all' : [...selectedTypes].join(',');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/dashboard/activity-metrics?${rangeQuery}&rep=${encodeURIComponent(rep)}&captureTypes=${encodeURIComponent(typesParam)}`
        );
        if (response.ok && !cancelled) {
          setData(await response.json());
        }
      } catch (error) {
        console.error('Failed to load activity metrics:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [rangeQuery, rep, typesParam]);

  const toggleType = (type: CaptureTypeValue) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      // Selecting every type is the same as no filter
      if (next.size === CAPTURE_TYPE_OPTIONS.length) next.clear();
      return next;
    });
  };

  const pieData = data
    ? [
        { key: 'virtual', name: 'Virtual calls', value: data.typeTotals.virtual, color: seriesConfig.virtual.color },
        { key: 'selfServe', name: 'Self-serve', value: data.typeTotals.selfServe, color: seriesConfig.selfServe.color },
        { key: 'onSite', name: 'On-site / manual upload', value: data.typeTotals.onSite, color: seriesConfig.onSite.color },
        { key: 'photos', name: 'Photo batches', value: data.typeTotals.photos, color: seriesConfig.photos.color },
      ].filter((d) => d.value > 0)
    : [];
  const pieTotal = pieData.reduce((a, d) => a + d.value, 0);

  return (
    <div className="space-y-6">
      {/* Capture-type filter (multi-select) */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setSelectedTypes(new Set())}
          className={`px-3 py-1.5 text-sm rounded-full border transition-colors cursor-pointer ${
            selectedTypes.size === 0
              ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          All types
        </button>
        {CAPTURE_TYPE_OPTIONS.map((f) => {
          const active = selectedTypes.has(f.value);
          return (
            <button
              key={f.value}
              onClick={() => toggleType(f.value)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors cursor-pointer flex items-center gap-1.5 ${
                active
                  ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {active && <Check className="h-3.5 w-3.5" />}
              {f.label}
            </button>
          );
        })}
        {selectedTypes.size > 0 && (
          <span className="text-xs text-gray-400 ml-1">{selectedTypes.size} selected — click to toggle</span>
        )}
      </div>

      {loading || !data ? (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[300px] rounded-xl" />
          <Skeleton className="h-[240px] rounded-xl" />
        </>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
            <Stat label="Recording sessions" value={data.kpis.recordingSessions.toLocaleString()} />
            <Stat label="Photos collected" value={data.kpis.photosCollected.toLocaleString()} />
            <Stat
              label="Show rate (virtual)"
              value={data.kpis.showRate !== null ? `${Math.round(data.kpis.showRate * 100)}%` : '—'}
            />
            <Stat label="Avg recording length" value={formatDuration(data.kpis.avgDurationSec)} />
            <Stat label="Total footage" value={`${data.kpis.footageMinutes.toLocaleString()} min`} />
            <Stat label="Items captured" value={data.kpis.itemsCaptured.toLocaleString()} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Survey mix pie */}
            <div className="bg-white rounded-xl border shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <PieChartIcon className="h-5 w-5 text-blue-500" />
                Survey Mix
              </h2>
              <p className="text-sm text-gray-500 mt-1 mb-2">Share of captures by type in this period</p>

              {pieTotal === 0 ? (
                <div className="text-center py-10 text-gray-500 bg-slate-50 rounded-lg">
                  <p>No captures in this period</p>
                </div>
              ) : (
                <>
                  <ChartContainer config={seriesConfig} className="h-[190px] w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={80}
                        paddingAngle={2}
                        strokeWidth={0}
                        isAnimationActive={false}
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.key} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className="flex flex-col gap-1.5 mt-2">
                    {pieData.map((d) => (
                      <div key={d.key} className="flex items-center gap-2 text-sm">
                        <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="text-gray-600 truncate">{d.name}</span>
                        <span className="text-gray-900 font-medium ml-auto tabular-nums">
                          {d.value.toLocaleString()}
                          <span className="text-gray-400 font-normal ml-1.5">{Math.round((d.value / pieTotal) * 100)}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Weekly volume */}
            <div className="bg-white rounded-xl border shadow-sm p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <VideoIcon className="h-5 w-5 text-blue-500" />
                Capture Volume by Week
              </h2>
              <p className="text-sm text-gray-500 mt-1 mb-4">Sessions and photo batches captured, stacked by type</p>

              {data.weeklyVolume.length === 0 ? (
                <div className="text-center py-10 text-gray-500 bg-slate-50 rounded-lg">
                  <p>No capture activity in this period</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 flex-wrap mb-3 text-sm">
                    {Object.entries(seriesConfig).map(([key, cfg]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: cfg.color }} />
                        <span className="text-gray-600">{cfg.label}</span>
                      </div>
                    ))}
                  </div>
                  <ChartContainer config={seriesConfig} className="h-[260px] w-full">
                    <BarChart data={data.weeklyVolume} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-slate-200" />
                      <XAxis
                        dataKey="week"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `Wk of ${formatDay(String(v))}`}
                      />
                      <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={32} />
                      <ChartTooltip
                        content={<ChartTooltipContent labelFormatter={(label) => `Week of ${formatDay(String(label))}`} />}
                      />
                      <Bar dataKey="virtual" stackId="a" isAnimationActive={false} fill="var(--color-virtual)" />
                      <Bar dataKey="selfServe" stackId="a" isAnimationActive={false} fill="var(--color-selfServe)" />
                      <Bar dataKey="onSite" stackId="a" isAnimationActive={false} fill="var(--color-onSite)" />
                      <Bar dataKey="photos" stackId="a" isAnimationActive={false} fill="var(--color-photos)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </>
              )}
            </div>
          </div>

          {/* Per-rep table */}
          {!isPersonalAccount && (
            <div className="bg-white rounded-xl border shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900">By Rep</h2>
              <p className="text-sm text-gray-500 mt-1 mb-4 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" />
                Sessions credit the rep who ran them, or the project's assigned rep for customer-driven captures. Click a row for the rep's projects, or a count for just that capture type's projects.
              </p>

              {data.perRep.length === 0 ? (
                <div className="text-center py-8 text-gray-500 bg-slate-50 rounded-lg">
                  <p>No rep activity in this period</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-slate-100">
                        <th className="py-2 pr-4 font-medium">Rep</th>
                        <th className="py-2 pr-4 font-medium text-right">Virtual</th>
                        <th className="py-2 pr-4 font-medium text-right">Self-serve</th>
                        <th className="py-2 pr-4 font-medium text-right">On-site</th>
                        <th className="py-2 pr-4 font-medium text-right">Photos</th>
                        <th className="py-2 pr-4 font-medium text-right">Total surveys</th>
                        <th className="py-2 pr-4 font-medium text-right">Show rate</th>
                        <th className="py-2 pr-4 font-medium text-right">Avg length</th>
                        <th className="py-2 pr-4 font-medium text-right">Total length</th>
                        <th className="py-2 font-medium text-right">Sign-offs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.perRep.map((r) => (
                        <tr
                          key={r.userId}
                          onClick={() => setRepDialog({ userId: r.userId, name: r.name })}
                          className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer"
                        >
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-2">
                              {r.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.imageUrl} alt="" className="w-6 h-6 rounded-full" />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center">
                                  {r.name.charAt(0)}
                                </div>
                              )}
                              <span className="font-medium text-gray-900">{r.name}</span>
                            </div>
                          </td>
                          <TypeCell rep={r} value={r.virtual} captureType="virtual" typeLabel="Virtual calls" onOpen={setRepDialog} />
                          <TypeCell rep={r} value={r.selfServe} captureType="self_serve" typeLabel="Self-serve" onOpen={setRepDialog} />
                          <TypeCell rep={r} value={r.onSite} captureType="on_site" typeLabel="On-site / manual upload" onOpen={setRepDialog} />
                          <TypeCell rep={r} value={r.photos} captureType="photo" typeLabel="Photos" onOpen={setRepDialog} />
                          <td className="py-2.5 pr-4 text-right tabular-nums font-medium">{r.totalSurveys.toLocaleString()}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">
                            {r.showRate !== null ? `${Math.round(r.showRate * 100)}%` : '—'}
                          </td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{formatDuration(r.avgDurationSec)}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{formatDuration(r.totalDurationSec)}</td>
                          <td className="py-2.5 text-right tabular-nums">{r.signOffs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <RepProjectsDialog rep={repDialog} onClose={() => setRepDialog(null)} />
    </div>
  );
}

// A count cell in the By Rep table: clicking narrows the project dialog to
// that capture type (row click shows all of the rep's projects)
function TypeCell({
  rep,
  value,
  captureType,
  typeLabel,
  onOpen,
}: {
  rep: { userId: string; name: string };
  value: number;
  captureType: CaptureTypeValue;
  typeLabel: string;
  onOpen: (dialog: { userId: string; name: string; captureType: CaptureTypeValue; typeLabel: string }) => void;
}) {
  return (
    <td
      onClick={(e) => {
        e.stopPropagation();
        onOpen({ userId: rep.userId, name: rep.name, captureType, typeLabel });
      }}
      className="py-2.5 pr-4 text-right tabular-nums cursor-pointer hover:text-blue-700 hover:underline underline-offset-2"
      title={`${typeLabel} projects`}
    >
      {value}
    </td>
  );
}

// Project list behind a By Rep row or cell click
function RepProjectsDialog({
  rep,
  onClose,
}: {
  rep: { userId: string; name: string; captureType?: CaptureTypeValue; typeLabel?: string } | null;
  onClose: () => void;
}) {
  const { rangeQuery } = useDashboard();
  const [projects, setProjects] = useState<
    { projectId: string; name: string; customerName: string | null; updatedAt: string }[]
  >([]);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!rep) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setProjects([]);
      try {
        const params = rep.captureType
          ? `rep=${encodeURIComponent(rep.userId)}&captureType=${rep.captureType}&${rangeQuery}`
          : `rep=${encodeURIComponent(rep.userId)}`;
        const response = await fetch(`/api/dashboard/rep-projects?${params}`);
        if (response.ok && !cancelled) {
          const data = await response.json();
          setProjects(data.projects || []);
          setCapped(!!data.capped);
        }
      } catch (error) {
        console.error('Failed to load rep projects:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rep]);

  const baseTitle = rep?.name === 'Unassigned' ? 'Unassigned projects' : `${rep?.name}'s projects`;

  return (
    <Dialog open={!!rep} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-blue-500" />
            {rep?.typeLabel ? `${baseTitle} · ${rep.typeLabel}` : baseTitle}
          </DialogTitle>
          {rep?.typeLabel && (
            <p className="text-sm text-gray-500">
              Projects with {rep.typeLabel.toLowerCase()} captures in the selected period
            </p>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-500 gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading projects...
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-10 text-gray-500 bg-slate-50 rounded-lg">
            <p>No active projects</p>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 -mx-1 px-1">
            <div className="divide-y divide-slate-100">
              {projects.map((p) => (
                <Link
                  key={p.projectId}
                  href={`/projects/${p.projectId}`}
                  className="flex items-center justify-between gap-3 py-2.5 px-2 rounded-lg hover:bg-slate-50 group"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate group-hover:text-blue-700">{p.name}</p>
                    {p.customerName && <p className="text-xs text-gray-400 truncate">{p.customerName}</p>}
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                    {new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </Link>
              ))}
            </div>
            {capped && (
              <p className="text-xs text-gray-400 text-center py-2">Showing the 100 most recently updated projects</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-800 mt-1">{value}</p>
    </div>
  );
}

function formatDuration(seconds: number | null) {
  if (seconds === null || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatDay(value: string) {
  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}
