'use client';

// features/lead-intake/components/settings/LeadFormAdvanced.tsx
//
// Collapsible "Advanced settings" panel for the embeddable lead form. Holds the
// secondary controls so the top of the page stays focused on the website domain
// + the embed code:
//   - Form active toggle (when off, the link/embeds show "unavailable")
//   - Additional allowed domains (CORS allow-list beyond the primary website domain)
//   - Editable internal name (label only — no longer shown on the hosted page)
//   - Read-only public formId
// State is owned by the parent (LeadFormSettings) so the page's single save bar
// covers every field.

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MAX_ALLOWED_DOMAINS = 20;

// Light client-side normalization for display + de-dupe. The SERVER re-normalizes
// authoritatively (lib/cors.ts normalizeHost) before storing, so this only needs
// to produce a sensible host string and avoid obvious dupes.
function normalizeForDisplay(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .trim();
}

interface LeadFormAdvancedProps {
  isActive: boolean;
  onActiveChange: (next: boolean) => void;
  allowedDomains: string[];
  onAllowedDomainsChange: (next: string[]) => void;
  name: string;
  onNameChange: (next: string) => void;
  formId: string;
}

export default function LeadFormAdvanced({
  isActive,
  onActiveChange,
  allowedDomains,
  onAllowedDomainsChange,
  name,
  onNameChange,
  formId,
}: LeadFormAdvancedProps) {
  const [domainInput, setDomainInput] = useState('');

  const addDomain = () => {
    const host = normalizeForDisplay(domainInput);
    if (!host) return;
    if (allowedDomains.includes(host)) {
      setDomainInput('');
      return;
    }
    if (allowedDomains.length >= MAX_ALLOWED_DOMAINS) return;
    onAllowedDomainsChange([...allowedDomains, host]);
    setDomainInput('');
  };

  const removeDomain = (host: string) => {
    onAllowedDomainsChange(allowedDomains.filter((d) => d !== host));
  };

  const atCap = allowedDomains.length >= MAX_ALLOWED_DOMAINS;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-gray-900">Form active</h3>
          <p className="text-sm text-gray-500 mt-1">
            When off, the form link and embeds show “This form is unavailable” and stop accepting
            submissions.
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => onActiveChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      <div className="border-t border-gray-100 pt-6">
        <span className="block text-sm font-medium text-gray-900">Additional allowed domains</span>
        <p className="mt-1 text-sm text-gray-500">
          Extra sites that may post to this form directly (the primary one is the Website domain above).
          You only need these if you build your own form and submit cross-origin; the hosted link and embed
          codes work without any of them.
        </p>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={domainInput}
            maxLength={200}
            disabled={atCap}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDomain();
              }
            }}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
            placeholder="partner.example.com"
          />
          <Button type="button" variant="outline" onClick={addDomain} disabled={atCap || !domainInput.trim()}>
            Add
          </Button>
        </div>

        {atCap && (
          <p className="mt-2 text-xs text-amber-600">
            You’ve reached the limit of {MAX_ALLOWED_DOMAINS} additional domains.
          </p>
        )}

        {allowedDomains.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {allowedDomains.map((host) => (
              <li
                key={host}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-1 pl-3 pr-1.5 text-sm text-gray-800"
              >
                <code className="text-xs">{host}</code>
                <button
                  type="button"
                  onClick={() => removeDomain(host)}
                  aria-label={`Remove ${host}`}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-gray-100 pt-6">
        <label htmlFor="lead-form-name" className="block text-sm font-medium text-gray-900">
          Form name
        </label>
        <p className="mt-1 text-sm text-gray-500">
          An internal label to help you identify this form. Not shown to customers on the hosted page.
        </p>
        <input
          id="lead-form-name"
          type="text"
          value={name}
          maxLength={200}
          onChange={(e) => onNameChange(e.target.value)}
          className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Lead Form"
        />
      </div>

      <div className="border-t border-gray-100 pt-6">
        <span className="block text-sm font-medium text-gray-900">Form ID</span>
        <p className="mt-1 text-sm text-gray-500">
          The public identifier in your embed URLs. Generated automatically and not editable.
        </p>
        <code className="mt-2 block w-full break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          {formId}
        </code>
      </div>
    </div>
  );
}
