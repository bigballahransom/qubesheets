'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import IntercomChat from '@/components/IntercomChat';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardProvider, isDashboardRange, useDashboard, type DashboardRange } from '@/components/dashboard/DashboardContext';
import DateRangeControl from '@/components/dashboard/DateRangeControl';
import RepFilter from '@/components/dashboard/RepFilter';
import MyStuffTab from '@/components/dashboard/tabs/MyStuffTab';
// Old KPI overview tab — parked while the Activity view serves as the Overview
// import OverviewTab from '@/components/dashboard/tabs/OverviewTab';
import PipelineTab from '@/components/dashboard/tabs/PipelineTab';
import ActivityTab from '@/components/dashboard/tabs/ActivityTab';
import LeadsTab from '@/components/dashboard/tabs/LeadsTab';

// 'overview' renders the Activity view (capture types, survey mix, by-rep)
const TABS = ['my-stuff', 'overview', 'pipeline', 'leads'] as const;
type DashboardTab = (typeof TABS)[number];

function isDashboardTab(value: string | null): value is DashboardTab {
  return !!value && (TABS as readonly string[]).includes(value);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export default function QubesheetsDashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams?.get('tab') ?? null;
  const rangeParam = searchParams?.get('range') ?? null;
  const fromParam = searchParams?.get('from') ?? null;
  const toParam = searchParams?.get('to') ?? null;

  // 'activity' is the tab's old URL name — keep deep links working
  const tab: DashboardTab = isDashboardTab(tabParam) ? tabParam : tabParam === 'activity' ? 'overview' : 'my-stuff';
  const customFrom = fromParam && YMD.test(fromParam) ? fromParam : null;
  const customTo = toParam && YMD.test(toParam) ? toParam : null;
  const range: DashboardRange =
    rangeParam === 'custom'
      ? customFrom && customTo ? 'custom' : '30d'
      : isDashboardRange(rangeParam) ? rangeParam : '30d';

  const updateParams = (next: {
    tab?: DashboardTab;
    range?: DashboardRange;
    from?: string | null;
    to?: string | null;
  }) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', next.tab ?? tab);
    const nextRange = next.range ?? range;
    params.set('range', nextRange);
    const nextFrom = next.from !== undefined ? next.from : customFrom;
    const nextTo = next.to !== undefined ? next.to : customTo;
    if (nextRange === 'custom' && nextFrom && nextTo) {
      params.set('from', nextFrom);
      params.set('to', nextTo);
    } else {
      params.delete('from');
      params.delete('to');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16 lg:hidden"></div>
        <div className="min-h-screen bg-slate-50 lg:pl-64 pt-4 lg:pt-20">
          <div className="max-w-7xl mx-auto p-4 lg:p-6">
            <DashboardProvider
              range={range}
              customFrom={customFrom}
              customTo={customTo}
              setRange={(r) => updateParams({ range: r, from: null, to: null })}
              setCustomRange={(from, to) => updateParams({ range: 'custom', from, to })}
            >
              <DashboardHeader tab={tab} />
              <DashboardTabs tab={tab} onTabChange={(t) => updateParams({ tab: t })} />
            </DashboardProvider>
          </div>
        </div>
        <SidebarTrigger />
      </SidebarProvider>

      <IntercomChat />
    </>
  );
}

function DashboardHeader({ tab }: { tab: DashboardTab }) {
  const { rep, setRep } = useDashboard();

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Welcome back! Here's what's happening today.</p>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {/* My Stuff has its own per-widget filters that default to the viewer */}
        {tab !== 'my-stuff' && <RepFilter value={rep} onChange={setRep} />}
        <DateRangeControl />
      </div>
    </div>
  );
}

function DashboardTabs({ tab, onTabChange }: { tab: DashboardTab; onTabChange: (tab: DashboardTab) => void }) {
  const { leadsEnabled, bootstrapLoading } = useDashboard();

  // Deep link to a tab that turns out to be unavailable → fall back to My Stuff
  useEffect(() => {
    if (!bootstrapLoading && tab === 'leads' && !leadsEnabled) {
      onTabChange('my-stuff');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapLoading, leadsEnabled, tab]);

  return (
    <Tabs value={tab} onValueChange={(t) => onTabChange(t as DashboardTab)}>
      <TabsList className="mb-4">
        <TabsTrigger value="my-stuff">My Stuff</TabsTrigger>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="pipeline">Survey Pipeline</TabsTrigger>
        {leadsEnabled && <TabsTrigger value="leads">Leads</TabsTrigger>}
      </TabsList>
      <TabsContent value="my-stuff">
        <MyStuffTab />
      </TabsContent>
      {/* The Activity view is the Overview now; the old KPI overview is parked:
      <TabsContent value="overview">
        <OverviewTab />
      </TabsContent> */}
      <TabsContent value="overview">
        <ActivityTab />
      </TabsContent>
      <TabsContent value="pipeline">
        <PipelineTab />
      </TabsContent>
      {leadsEnabled && (
        <TabsContent value="leads">
          <LeadsTab />
        </TabsContent>
      )}
    </Tabs>
  );
}
