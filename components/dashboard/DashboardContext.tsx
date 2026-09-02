'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type DashboardRange = 'today' | '7d' | '30d' | '90d' | 'custom';

export const DASHBOARD_RANGE_PRESETS: { value: Exclude<DashboardRange, 'custom'>; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

export function isDashboardRange(value: string | null): value is DashboardRange {
  return !!value && (value === 'custom' || DASHBOARD_RANGE_PRESETS.some((r) => r.value === value));
}

export interface DashboardMember {
  userId: string;
  firstName: string;
  lastName: string;
  name: string;
  imageUrl: string;
  identifier: string;
  role: string;
}

interface DashboardContextValue {
  range: DashboardRange;
  /** Inclusive YYYY-MM-DD bounds, set when range === 'custom' */
  customFrom: string | null;
  customTo: string | null;
  setRange: (range: Exclude<DashboardRange, 'custom'>) => void;
  setCustomRange: (from: string, to: string) => void;
  /** Query-string fragment for range + tz — append to every dashboard fetch */
  rangeQuery: string;
  /** Global rep filter (all analytics tabs; My Stuff has its own me-defaults) */
  rep: string;
  setRep: (rep: string) => void;
  me: { userId: string } | null;
  members: DashboardMember[];
  leadsEnabled: boolean;
  isPersonalAccount: boolean;
  bootstrapLoading: boolean;
  /** Viewer's IANA timezone, passed to aggregation endpoints for day bucketing */
  tz: string;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  range,
  customFrom,
  customTo,
  setRange,
  setCustomRange,
  children,
}: {
  range: DashboardRange;
  customFrom: string | null;
  customTo: string | null;
  setRange: (range: Exclude<DashboardRange, 'custom'>) => void;
  setCustomRange: (from: string, to: string) => void;
  children: ReactNode;
}) {
  const [rep, setRep] = useState('all');
  const [me, setMe] = useState<{ userId: string } | null>(null);
  const [members, setMembers] = useState<DashboardMember[]>([]);
  const [leadsEnabled, setLeadsEnabled] = useState(false);
  const [isPersonalAccount, setIsPersonalAccount] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const rangeQuery = useMemo(() => {
    const params = new URLSearchParams({ range, tz });
    if (range === 'custom' && customFrom && customTo) {
      params.set('from', customFrom);
      params.set('to', customTo);
    }
    return params.toString();
  }, [range, customFrom, customTo, tz]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/dashboard/bootstrap');
        if (response.ok && !cancelled) {
          const data = await response.json();
          setMe(data.me || null);
          setMembers(data.members || []);
          setLeadsEnabled(!!data.leadsEnabled);
          setIsPersonalAccount(!!data.isPersonalAccount);
        }
      } catch (error) {
        console.error('Error loading dashboard bootstrap:', error);
      } finally {
        if (!cancelled) setBootstrapLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <DashboardContext.Provider
      value={{
        range, customFrom, customTo, setRange, setCustomRange, rangeQuery,
        rep, setRep,
        me, members, leadsEnabled, isPersonalAccount, bootstrapLoading, tz,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return ctx;
}
