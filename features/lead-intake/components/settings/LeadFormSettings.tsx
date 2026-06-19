'use client';

// features/lead-intake/components/settings/LeadFormSettings.tsx
//
// The org-admin settings UI for the embeddable lead form. Owns the load/edit/
// save flow and renders SettingsPageShell (so the route page stays a one-liner).
//
//   - "Your lead form" card: public URL + iframe and JS-widget embed snippets,
//     each with a copy button (+ a preview-in-new-tab for the URL).
//   - Settings block (save-bar driven): website domain (CORS) + active toggle.
//   - Advanced settings (collapsible): display name + read-only formId.
//   - How-it-works explainer.
//
// All identity is server-derived: GET auto-provisions the org's default form and
// POST re-derives it from the authed org, so nothing here sends an org/formId for
// identity. See app/api/settings/embeddable-lead-forms/route.ts.

import { useCallback, useEffect, useState } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { Code, Copy, Check, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';
import {
  buildIframeSnippet,
  buildWidgetSnippet,
} from '@/features/lead-intake/lib/embedCode';
import LeadFormAdvanced from './LeadFormAdvanced';

const ENDPOINT = '/api/settings/embeddable-lead-forms';

interface FormState {
  formId: string;
  name: string;
  websiteDomain: string;
  isActive: boolean;
}

function getBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
}

// Only the editable fields participate in the dirty check.
function isDirty(saved: FormState | null, draft: FormState | null): boolean {
  if (!saved || !draft) return false;
  return (
    saved.name !== draft.name ||
    saved.websiteDomain !== draft.websiteDomain ||
    saved.isActive !== draft.isActive
  );
}

export default function LeadFormSettings() {
  const { organization } = useOrganization();

  const [saved, setSaved] = useState<FormState | null>(null);
  const [draft, setDraft] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT);
      if (res.ok) {
        const data: FormState = await res.json();
        setSaved(data);
        setDraft(data);
      } else if (res.status === 403) {
        // Personal account — the shell renders the "Organization required"
        // fallback (no organizationName), so just stop loading.
      } else {
        toast.error('Failed to load lead form settings.');
      }
    } catch (error) {
      console.error('Error loading embeddable lead form settings:', error);
      toast.error('Failed to load lead form settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadSettings();
  }, [organization, loadSettings]);

  const saveSettings = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          websiteDomain: draft.websiteDomain,
          isActive: draft.isActive,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save: ${res.status}`);
      }
      const data: FormState = await res.json();
      setSaved(data);
      setDraft(data);
      toast.success('Lead form settings saved.');
    } catch (error) {
      console.error('Error saving embeddable lead form settings:', error);
      toast.error(
        `Failed to save. ${error instanceof Error ? error.message : 'Please try again.'}`
      );
    } finally {
      setSaving(false);
    }
  };

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success('Copied to clipboard!');
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      toast.error('Failed to copy.');
    }
  };

  const baseUrl = getBaseUrl();
  const publicUrl = draft ? `${baseUrl}/embed/forms/lead-forms/${draft.formId}` : '';
  const iframeSnippet = draft ? buildIframeSnippet(draft.formId, baseUrl) : '';
  const widgetSnippet = draft ? buildWidgetSnippet(draft.formId, baseUrl) : '';
  const unsavedChanges = isDirty(saved, draft);

  return (
    <SettingsPageShell
      title="Embeddable Form"
      subtitle="Drop a lead-capture form onto your own website. Submissions create a project and hand the customer off to your self-survey for a faster estimate."
      icon={Code}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
      unsavedChanges={unsavedChanges}
      saving={saving}
      onSave={saveSettings}
      onDiscard={() => setDraft(saved)}
    >
      {draft && (
        <div className="space-y-6">
          {/* Website domain — first, because the form is meant to live on the org's site */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
            <label htmlFor="website-domain" className="block text-sm font-medium text-gray-900">
              Website domain
            </label>
            <p className="mt-1 text-sm text-gray-500">
              The site you’ll embed this form on (e.g. <code>example.com</code>). The hosted link and
              embed codes work without it, but set it so direct submissions from your own page code are
              accepted.
            </p>
            <input
              id="website-domain"
              type="text"
              value={draft.websiteDomain}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, websiteDomain: e.target.value })}
              className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="example.com"
            />
          </div>

          {/* Your lead form: URL + embed snippets */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Code className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-medium">Your lead form</h2>
                <p className="text-sm text-gray-500">
                  Embed it on your site, or share the link directly.
                </p>
              </div>
            </div>

            {/* Public URL */}
            <label className="block text-sm font-medium text-gray-900">Public link</label>
            <div className="mt-1.5 bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
              <code className="text-sm text-gray-800 break-all">{publicUrl}</code>
            </div>
            <div className="flex flex-wrap gap-3 mb-6">
              <Button onClick={() => copy('url', publicUrl)} className="flex-1 sm:flex-none">
                {copiedKey === 'url' ? (
                  <><Check className="mr-2 h-4 w-4" />Copied!</>
                ) : (
                  <><Copy className="mr-2 h-4 w-4" />Copy link</>
                )}
              </Button>
              <Button
                onClick={() => window.open(publicUrl, '_blank')}
                variant="outline"
                className="flex-1 sm:flex-none"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Preview
              </Button>
            </div>

            {/* iframe snippet */}
            <EmbedSnippet
              label="Embed code (iframe)"
              hint="Paste this anywhere in your page’s HTML where you want the form to appear."
              snippet={iframeSnippet}
              copied={copiedKey === 'iframe'}
              onCopy={() => copy('iframe', iframeSnippet)}
            />

            {/* widget snippet */}
            <div className="mt-5">
              <EmbedSnippet
                label="Embed code (JavaScript widget)"
                hint="Two parts: (1) put the <div> in your page’s body where you want the form, then (2) add the <script> tag (anywhere in the body). The script drops the form into that <div>."
                snippet={widgetSnippet}
                copied={copiedKey === 'widget'}
                onCopy={() => copy('widget', widgetSnippet)}
              />
            </div>
          </div>

          {/* Advanced settings (collapsible): active toggle + name + formId */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Advanced settings
            </button>
            {showAdvanced && (
              <div className="mt-6">
                <LeadFormAdvanced
                  isActive={draft.isActive}
                  onActiveChange={(isActive) => setDraft({ ...draft, isActive })}
                  name={draft.name}
                  onNameChange={(name) => setDraft({ ...draft, name })}
                  formId={draft.formId}
                />
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
            <h2 className="text-lg font-medium mb-4">How it works</h2>
            <div className="space-y-4">
              {[
                { step: 1, title: 'Embed the form', desc: 'Add the iframe or widget code to your website (or just share the link).' },
                { step: 2, title: 'Customer submits', desc: 'Their details create a new project in your account automatically.' },
                { step: 3, title: 'Self-survey handoff', desc: 'On success they’re offered your self-survey — a QR on desktop, a tap-through on mobile.' },
              ].map(({ step, title, desc }) => (
                <div key={step} className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 font-medium text-sm">{step}</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">{title}</h3>
                    <p className="text-sm text-gray-600">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </SettingsPageShell>
  );
}

function EmbedSnippet({
  label,
  hint,
  snippet,
  copied,
  onCopy,
}: {
  label: string;
  hint: string;
  snippet: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="block text-sm font-medium text-gray-900">{label}</span>
          <span className="text-xs text-gray-500">{hint}</span>
        </div>
        <Button size="sm" variant="outline" onClick={onCopy}>
          {copied ? (
            <><Check className="mr-1.5 h-3.5 w-3.5" />Copied</>
          ) : (
            <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy</>
          )}
        </Button>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md border border-gray-200 bg-gray-900 p-3 text-xs leading-relaxed text-gray-100">
        <code>{snippet}</code>
      </pre>
    </div>
  );
}
