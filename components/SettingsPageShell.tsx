'use client';

// components/SettingsPageShell.tsx
//
// Shared chrome for every page under /app/settings/**. Provides:
//   - Page background + container + sidebar
//   - Icon-badge header with title and subtitle
//   - Scope pill (Personal / Organization / Mixed) so the user can tell at a
//     glance who a setting affects
//   - "Organization required" fallback when the page only makes sense in an
//     org context
//   - Optional sticky save bar that appears when unsavedChanges is true
//
// Pages provide ONLY the form content as children. The shell handles the
// SidebarProvider, the header layout, loading states, and the fallback.

import React from 'react';
import { LucideIcon } from 'lucide-react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { DesktopHeaderBar } from '@/components/DesktopHeaderBar';
import IntercomChat from '@/components/IntercomChat';
import { cn } from '@/lib/utils';

export type SettingsScope = 'personal' | 'organization' | 'mixed';

interface SettingsPageShellProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  scope: SettingsScope;
  /** Organization name to show inside the scope pill / banner. */
  organizationName?: string;
  /** When true and no organizationName is provided, render the org-required fallback. */
  requiresOrganization?: boolean;
  loading?: boolean;
  /** Optional content rendered next to the title (e.g. page-level CTAs). */
  headerAction?: React.ReactNode;
  /** Widens the inner content from the default max-w-3xl. */
  wide?: boolean;
  children: React.ReactNode;

  // Sticky save bar (optional — pages without a save flow leave these unset).
  unsavedChanges?: boolean;
  saving?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
  /** Custom label for the primary action; defaults to "Save changes". */
  saveLabel?: string;
}

const SCOPE_PILL_CLASSES: Record<SettingsScope, string> = {
  personal: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  organization: 'bg-blue-50 text-blue-700 border-blue-200',
  mixed: 'bg-purple-50 text-purple-700 border-purple-200'
};

function ScopePill({ scope, organizationName }: { scope: SettingsScope; organizationName?: string }) {
  const label =
    scope === 'personal'
      ? 'Personal Setting'
      : scope === 'organization'
      ? 'Organization Setting'
      : 'Personal + Organization';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        SCOPE_PILL_CLASSES[scope]
      )}
      title={
        scope === 'personal'
          ? 'Only affects your account.'
          : scope === 'organization'
          ? organizationName
            ? `Applies to everyone in ${organizationName}.`
            : 'Applies to everyone in your organization.'
          : 'Has both personal and organization-wide sections on this page.'
      }
    >
      <span className={cn('h-1.5 w-1.5 rounded-full',
        scope === 'personal' ? 'bg-emerald-500' :
        scope === 'organization' ? 'bg-blue-500' : 'bg-purple-500')}
      />
      {label}
    </span>
  );
}

export function SettingsPageShell({
  title,
  subtitle,
  icon: Icon,
  scope,
  organizationName,
  requiresOrganization,
  loading,
  headerAction,
  wide,
  children,
  unsavedChanges,
  saving,
  onSave,
  onDiscard,
  saveLabel
}: SettingsPageShellProps) {
  const showOrgFallback = requiresOrganization && !organizationName;
  const hasSaveBar = !!onSave;

  return (
    <>
      <SidebarProvider>
        <AppSidebar />
        <DesktopHeaderBar />
        <div className="h-16" />
        <div className="min-h-[calc(100dvh-4rem)] bg-gray-50/60">
          <div
            className={cn(
              'container mx-auto px-4 sm:px-6 lg:px-8 lg:pl-64 lg:pt-16 pt-6',
              hasSaveBar ? 'pb-28' : 'pb-12',
              wide ? 'max-w-7xl' : 'max-w-4xl'
            )}
          >
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div className="flex items-start gap-3 min-w-0">
                <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
                    <ScopePill scope={scope} organizationName={organizationName} />
                  </div>
                  {subtitle && (
                    <p className="text-sm text-gray-500 mt-1 max-w-prose">{subtitle}</p>
                  )}
                </div>
              </div>
              {headerAction && <div className="shrink-0">{headerAction}</div>}
            </div>

            {/* Body */}
            {loading ? (
              <div className="flex justify-center py-16">
                <div className="text-sm text-gray-500">Loading…</div>
              </div>
            ) : showOrgFallback ? (
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 max-w-2xl">
                <h3 className="font-medium text-yellow-900 mb-1">Organization required</h3>
                <p className="text-sm text-yellow-800">
                  This setting is only available for organization accounts. Switch to or create an organization to access it.
                </p>
              </div>
            ) : (
              <div className={wide ? 'max-w-7xl' : 'max-w-3xl'}>{children}</div>
            )}
          </div>

          {/* Sticky save bar */}
          {hasSaveBar && unsavedChanges && (
            <div className="fixed bottom-0 inset-x-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
              <div className={cn(
                'container mx-auto px-4 sm:px-6 lg:px-8 lg:pl-64 py-3 flex items-center justify-between gap-3',
                wide ? 'max-w-7xl' : 'max-w-4xl'
              )}>
                <p className="text-sm text-gray-600 flex items-center">
                  <span className="inline-block h-2 w-2 rounded-full bg-orange-500 mr-2 align-middle" />
                  You have unsaved changes
                </p>
                <div className="flex gap-2">
                  {onDiscard && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onDiscard}
                      disabled={saving}
                    >
                      Discard
                    </Button>
                  )}
                  <Button type="button" onClick={onSave} disabled={saving} size="sm">
                    <Save className="mr-1.5 h-4 w-4" />
                    {saving ? 'Saving…' : saveLabel || 'Save changes'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
        <SidebarTrigger />
      </SidebarProvider>
      <IntercomChat />
    </>
  );
}

export default SettingsPageShell;
