'use client';

// Qube Sheets internal admin dashboard shell (staff allowlist only). Owns the
// page chrome, the shared time-range picker, and the top-level tabs; each tab
// component fetches its own staff-gated stats API.

import { useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { DesktopHeaderBar } from '@/components/DesktopHeaderBar';
import { RANGES, RangeSel } from './adminShared';
import AdminPasscodeGate from './AdminPasscodeGate';
import AdminSelfServeDashboard from './AdminSelfServeDashboard';
import AdminVirtualCallsTab from './AdminVirtualCallsTab';
import AdminCompaniesTab from './AdminCompaniesTab';
import AdminAdoptionTab from './AdminAdoptionTab';
import AdminLeadFormsTab from './AdminLeadFormsTab';

const TABS = [
  { key: 'adoption', label: 'Adoption Scores', blurb: 'Human-usage health scores, outreach queue, and top companies for Customer Success.' },
  { key: 'self-serve', label: 'Self-serve recording', blurb: 'Conversion and failures across all companies.' },
  { key: 'virtual-calls', label: 'Virtual calls', blurb: 'Scheduled call outcomes, reps, and recordings across all companies.' },
  { key: 'lead-forms', label: 'Lead forms', blurb: 'Step completion and post-submission funnels across all companies.' },
  { key: 'companies', label: 'Companies', blurb: 'How each company is using Qube Sheets.' }
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function AdminDashboard() {
  // Client state, so every navigation to /admin re-asks for the passcode
  // even while the httpOnly API cookie is still valid.
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<TabKey>('adoption');
  const [range, setRange] = useState<RangeSel>({ days: 7 });
  // Draft values for the custom date inputs (applied on the Apply click).
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  // Bumped by the refresh button; tabs refetch when it changes.
  const [reloadKey, setReloadKey] = useState(0);

  const customActive = !('days' in range);
  const applyCustom = () => {
    if (!draftFrom) return;
    setRange({ from: draftFrom, to: draftTo || draftFrom });
  };

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16 lg:hidden"></div>
        <div className="min-h-screen bg-slate-50 lg:pl-64 pt-4 lg:pt-20 w-full">
          <div className="max-w-7xl mx-auto p-4 lg:p-6">
            {!unlocked ? (
              <AdminPasscodeGate onUnlock={() => setUnlocked(true)} />
            ) : (
              <>
            {/* Header + time range */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 flex items-center gap-2">
                  <ShieldCheck className="w-6 h-6 text-blue-600" />
                  Admin · {active.label}
                </h1>
                <p className="text-sm text-gray-500 mt-1">{active.blurb} Internal only.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
                  {RANGES.map((r) => (
                    <button
                      key={r.days}
                      onClick={() => setRange({ days: r.days })}
                      className={`px-3 py-1.5 text-sm rounded transition-colors cursor-pointer ${
                        !customActive && 'days' in range && range.days === r.days
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {/* Custom date range (applies on Apply; telemetry only reaches back 90 days) */}
                <div
                  className={`inline-flex items-center gap-1.5 rounded-md border bg-white p-0.5 pl-2 ${
                    customActive ? 'border-blue-400' : 'border-gray-200'
                  }`}
                >
                  <input
                    type="date"
                    value={draftFrom}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className="text-sm text-gray-700 bg-transparent outline-none w-[8.2rem]"
                    aria-label="From date"
                  />
                  <span className="text-gray-400 text-sm">–</span>
                  <input
                    type="date"
                    value={draftTo}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className="text-sm text-gray-700 bg-transparent outline-none w-[8.2rem]"
                    aria-label="To date"
                  />
                  <button
                    onClick={applyCustom}
                    disabled={!draftFrom}
                    className={`px-2.5 py-1.5 text-sm rounded cursor-pointer transition-colors ${
                      customActive
                        ? 'bg-blue-600 text-white'
                        : draftFrom
                          ? 'text-blue-600 hover:bg-blue-50'
                          : 'text-gray-300'
                    }`}
                  >
                    Apply
                  </button>
                </div>
                <button
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="p-2 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 cursor-pointer"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Top-level tabs */}
            <div className="flex flex-wrap gap-1 border-b border-gray-200 mb-6">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3.5 py-2 text-sm -mb-px border-b-2 transition-colors cursor-pointer ${
                    tab === t.key
                      ? 'border-blue-600 text-blue-700 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'self-serve' && <AdminSelfServeDashboard range={range} reloadKey={reloadKey} />}
            {tab === 'virtual-calls' && <AdminVirtualCallsTab range={range} reloadKey={reloadKey} />}
            {tab === 'lead-forms' && <AdminLeadFormsTab range={range} reloadKey={reloadKey} />}
            {tab === 'companies' && <AdminCompaniesTab range={range} reloadKey={reloadKey} />}
            {tab === 'adoption' && <AdminAdoptionTab range={range} reloadKey={reloadKey} />}
              </>
            )}
          </div>
        </div>
        <SidebarTrigger />
      </SidebarProvider>
    </>
  );
}
