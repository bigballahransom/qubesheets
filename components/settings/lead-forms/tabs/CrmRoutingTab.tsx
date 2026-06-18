'use client';

// components/settings/lead-forms/tabs/CrmRoutingTab.tsx
//
// Two routing sections (SmartMoving / Supermove). Each section is gated
// behind the org actually having that integration configured. We fetch
// configuration status from existing endpoints on mount.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useOrganization } from '@clerk/nextjs';
import type { ILeadFormConfigCrmRouting } from '@/models/LeadFormConfig';

interface CrmRoutingTabProps {
  routing: ILeadFormConfigCrmRouting;
  onChange: (next: ILeadFormConfigCrmRouting) => void;
}

interface IntegrationStatus {
  smartmoving: boolean;
  supermove: boolean;
  loading: boolean;
}

export function CrmRoutingTab({ routing, onChange }: CrmRoutingTabProps) {
  const { organization } = useOrganization();
  const [status, setStatus] = useState<IntegrationStatus>({
    smartmoving: false,
    supermove: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const smartmovingPromise = fetch('/api/integrations/smartmoving')
        .then((r) => (r.ok ? r.json() : { exists: false }))
        .then((d) => !!d?.exists)
        .catch(() => false);

      const supermovePromise = organization?.id
        ? fetch(`/api/organizations/${organization.id}/supermove`)
            .then((r) => (r.ok ? r.json() : { configured: false }))
            .then((d) => !!d?.configured)
            .catch(() => false)
        : Promise.resolve(false);

      const [smartmoving, supermove] = await Promise.all([
        smartmovingPromise,
        supermovePromise,
      ]);
      if (cancelled) return;
      setStatus({ smartmoving, supermove, loading: false });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [organization?.id]);

  const smartmovingEnabled = !!routing.smartmoving;
  const supermoveEnabled = !!routing.supermove;

  const toggleSmartmoving = (next: boolean) => {
    if (next) {
      onChange({
        ...routing,
        smartmoving: routing.smartmoving ?? {
          branchId: '',
          referralSource: '',
          serviceType: '',
        },
      });
    } else {
      const { smartmoving: _drop, ...rest } = routing;
      onChange(rest);
    }
  };

  const updateSmartmoving = (
    patch: Partial<NonNullable<ILeadFormConfigCrmRouting['smartmoving']>>
  ) => {
    onChange({
      ...routing,
      smartmoving: {
        ...(routing.smartmoving ?? {}),
        ...patch,
      },
    });
  };

  const toggleSupermove = (next: boolean) => {
    if (next) {
      onChange({
        ...routing,
        supermove: routing.supermove ?? {
          projectType: '',
          jobType: '',
        },
      });
    } else {
      const { supermove: _drop, ...rest } = routing;
      onChange(rest);
    }
  };

  const updateSupermove = (
    patch: Partial<NonNullable<ILeadFormConfigCrmRouting['supermove']>>
  ) => {
    onChange({
      ...routing,
      supermove: {
        projectType: routing.supermove?.projectType ?? '',
        jobType: routing.supermove?.jobType ?? '',
        salespersonEmail: routing.supermove?.salespersonEmail,
        ...patch,
      },
    });
  };

  if (status.loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your CRM integrations…
      </div>
    );
  }

  const supermoveProjectMissing =
    supermoveEnabled && !routing.supermove?.projectType?.trim();
  const supermoveJobMissing =
    supermoveEnabled && !routing.supermove?.jobType?.trim();

  return (
    <div className="space-y-6">
      {/* SmartMoving */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div>
            <h2 className="text-base font-medium text-gray-900">
              SmartMoving
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Send leads to SmartMoving as new opportunities.
            </p>
          </div>
          <Switch
            checked={smartmovingEnabled}
            disabled={!status.smartmoving}
            onCheckedChange={toggleSmartmoving}
          />
        </div>

        {!status.smartmoving ? (
          <div className="border-t border-gray-100 px-6 py-4 bg-gray-50/60 text-sm text-gray-600">
            Connect SmartMoving first.{' '}
            <Link
              href="/settings/integrations"
              className="text-blue-600 hover:underline"
            >
              Go to Settings → Integrations
            </Link>
            .
          </div>
        ) : (
          smartmovingEnabled && (
            <div className="border-t border-gray-100 px-6 py-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sm-branch">Branch ID</Label>
                <Input
                  id="sm-branch"
                  type="text"
                  value={routing.smartmoving?.branchId ?? ''}
                  onChange={(e) =>
                    updateSmartmoving({ branchId: e.target.value })
                  }
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sm-referral">Referral source</Label>
                <Input
                  id="sm-referral"
                  type="text"
                  value={routing.smartmoving?.referralSource ?? ''}
                  onChange={(e) =>
                    updateSmartmoving({ referralSource: e.target.value })
                  }
                  placeholder="e.g. Website"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sm-service">Service type</Label>
                <Input
                  id="sm-service"
                  type="text"
                  value={routing.smartmoving?.serviceType ?? ''}
                  onChange={(e) =>
                    updateSmartmoving({ serviceType: e.target.value })
                  }
                  placeholder="e.g. Moving"
                />
              </div>
            </div>
          )
        )}
      </section>

      {/* Supermove */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div>
            <h2 className="text-base font-medium text-gray-900">Supermove</h2>
            <p className="text-sm text-gray-500 mt-1">
              Send leads to Supermove as new projects.
            </p>
          </div>
          <Switch
            checked={supermoveEnabled}
            disabled={!status.supermove}
            onCheckedChange={toggleSupermove}
          />
        </div>

        {!status.supermove ? (
          <div className="border-t border-gray-100 px-6 py-4 bg-gray-50/60 text-sm text-gray-600">
            Connect Supermove first.{' '}
            <Link
              href="/settings/integrations"
              className="text-blue-600 hover:underline"
            >
              Go to Settings → Integrations
            </Link>
            .
          </div>
        ) : (
          supermoveEnabled && (
            <div className="border-t border-gray-100 px-6 py-5 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sv-project">
                  Project type <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="sv-project"
                  type="text"
                  value={routing.supermove?.projectType ?? ''}
                  onChange={(e) =>
                    updateSupermove({ projectType: e.target.value })
                  }
                  aria-invalid={supermoveProjectMissing}
                  placeholder="Required"
                />
                {supermoveProjectMissing && (
                  <p className="text-xs text-red-600">
                    Project type is required when Supermove routing is on.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="sv-job">
                  Job type <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="sv-job"
                  type="text"
                  value={routing.supermove?.jobType ?? ''}
                  onChange={(e) =>
                    updateSupermove({ jobType: e.target.value })
                  }
                  aria-invalid={supermoveJobMissing}
                  placeholder="Required"
                />
                {supermoveJobMissing && (
                  <p className="text-xs text-red-600">
                    Job type is required when Supermove routing is on.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="sv-email">Salesperson email</Label>
                <Input
                  id="sv-email"
                  type="email"
                  value={routing.supermove?.salespersonEmail ?? ''}
                  onChange={(e) =>
                    updateSupermove({ salespersonEmail: e.target.value })
                  }
                  placeholder="Optional"
                />
              </div>
            </div>
          )
        )}
      </section>
    </div>
  );
}
