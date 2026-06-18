'use client';

// app/settings/lead-forms/page.tsx
//
// Lists every LeadFormConfig for the current org. Mirrors the
// customer-review-link settings page in layout/typography/spacing.
//
// Subscription gate: when the org lacks the `"leadForm"` add-on, the
// page is fully locked behind a single upgrade card. When the add-on
// is present, the credit balance shows above the form list.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrganization } from '@clerk/nextjs';
import { FileText, Plus, Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { ConfigList } from '@/components/settings/lead-forms/ConfigList';
import LeadFormsUpgradeModal from '@/components/LeadFormsUpgradeModal';
import { toast } from 'sonner';

export interface LeadFormSummary {
  _id: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
  crmRouting?: {
    smartmoving?: Record<string, unknown>;
    supermove?: Record<string, unknown>;
  };
}

interface CreditStatus {
  hasAddOn: boolean;
  allowance: number;
  used: number;
  remaining: number;
}

export default function LeadFormsListPage() {
  const { organization } = useOrganization();

  const [configs, setConfigs] = useState<LeadFormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization]);

  const loadAll = async () => {
    try {
      const [configsRes, creditsRes] = await Promise.all([
        fetch('/api/embedded-forms'),
        fetch('/api/lead-forms/credits'),
      ]);

      if (configsRes.ok) {
        const data = await configsRes.json();
        setConfigs(Array.isArray(data.configs) ? data.configs : []);
      } else if (configsRes.status === 401 || configsRes.status === 403) {
        setConfigs([]);
      }

      if (creditsRes.ok) {
        const data = await creditsRes.json();
        setCredits({
          hasAddOn: !!data.hasAddOn,
          allowance: Number(data.allowance) || 0,
          used: Number(data.used) || 0,
          remaining: Number(data.remaining) || 0,
        });
      }
    } catch (error) {
      console.error('Error loading lead forms:', error);
      toast.error('Failed to load lead forms');
    } finally {
      setLoading(false);
    }
  };

  const showUpgradeOnly = credits !== null && !credits.hasAddOn;

  return (
    <SettingsPageShell
      title="Lead Forms"
      subtitle="Embed lead capture forms on your website. Submissions flow into Qube Sheets and your connected CRMs."
      icon={FileText}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
      headerAction={
        !showUpgradeOnly && (
          <Button asChild>
            <Link href="/settings/lead-forms/new">
              <Plus className="mr-1.5 h-4 w-4" />
              New Form
            </Link>
          </Button>
        )
      }
    >
      {showUpgradeOnly ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 shadow-sm p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <Lock className="w-7 h-7 text-amber-700" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Lead Forms is a paid add-on
          </h2>
          <p className="text-gray-600 text-sm max-w-md mx-auto mb-5">
            Capture leads from your website, route them to SmartMoving or
            Supermove, and let customers self-survey or schedule a virtual
            walk-through. Contact our team to add Lead Forms to your plan.
          </p>
          <Button onClick={() => setUpgradeOpen(true)}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Request upgrade
          </Button>
          <LeadFormsUpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} />
        </div>
      ) : (
        <div className="space-y-4">
          {credits && credits.hasAddOn && (
            <CreditsBalanceCard credits={credits} />
          )}
          <ConfigList configs={configs} />
        </div>
      )}
    </SettingsPageShell>
  );
}

function CreditsBalanceCard({ credits }: { credits: CreditStatus }) {
  const { allowance, used, remaining } = credits;
  const pct = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
  const isExhausted = remaining <= 0 && allowance > 0;
  const isLow = !isExhausted && allowance > 0 && remaining <= allowance * 0.1;

  return (
    <div
      className={
        'rounded-xl border bg-white shadow-sm p-5 ' +
        (isExhausted
          ? 'border-amber-300'
          : isLow
            ? 'border-amber-200'
            : 'border-gray-200')
      }
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Monthly credits
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Each submission that surfaces the chooser, scheduler, or
            customer-choice options uses one credit. Resets on the 1st.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-gray-900 leading-none">
            {used.toLocaleString()}
            <span className="text-gray-400 font-normal text-base">
              {' '}/{' '}
              {allowance.toLocaleString()}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {remaining.toLocaleString()} remaining
          </div>
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className={
            'h-full rounded-full transition-all ' +
            (isExhausted
              ? 'bg-amber-500'
              : isLow
                ? 'bg-amber-400'
                : 'bg-blue-600')
          }
          style={{ width: `${pct}%` }}
        />
      </div>
      {isExhausted && (
        <p className="text-xs text-amber-800 mt-3">
          You&apos;ve used all your credits this month. New submissions will
          show the customer a thank-you message until credits reset on the 1st.
        </p>
      )}
    </div>
  );
}
