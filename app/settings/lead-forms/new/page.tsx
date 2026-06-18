'use client';

// app/settings/lead-forms/new/page.tsx
//
// Minimal create flow: ask for a name, POST defaults for everything else,
// then redirect into the editor.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOrganization } from '@clerk/nextjs';
import { ArrowLeft, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

const DEFAULT_FIELDS = [
  { id: 'firstName', enabled: true, required: true },
  { id: 'lastName', enabled: true, required: true },
  { id: 'email', enabled: true, required: true },
  { id: 'phone', enabled: true, required: true },
  { id: 'phoneType', enabled: false, required: false },
  { id: 'moveDate', enabled: true, required: false },
  { id: 'moveSize', enabled: true, required: false },
  { id: 'origin', enabled: true, required: false },
  { id: 'destination', enabled: true, required: false },
  { id: 'companyName', enabled: false, required: false },
];

export default function NewLeadFormPage() {
  const router = useRouter();
  const { organization } = useOrganization();

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Please enter a name for the form.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/embedded-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          isActive: true,
          postSubmit: {
            kind: 'redirect-chooser',
          },
          theme: {
            title: 'Get a Quote',
            buttonText: 'Get a Quote',
            buttonColor: '#2563eb',
          },
          fields: DEFAULT_FIELDS,
          crmRouting: {},
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || `Failed to create (${response.status})`);
      }
      const created = await response.json();
      toast.success('Lead form created.');
      router.push(`/settings/lead-forms/${created._id}`);
    } catch (error) {
      console.error('Error creating lead form:', error);
      toast.error(
        `Failed to create. ${
          error instanceof Error ? error.message : 'Please try again.'
        }`
      );
      setCreating(false);
    }
  };

  return (
    <SettingsPageShell
      title="New Lead Form"
      subtitle="Give your form a name. You can configure fields, CRM routing, and the embed code on the next screen."
      icon={FileText}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
    >
      <div className="space-y-4">
        <Link
          href="/settings/lead-forms"
          className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to lead forms
        </Link>

        <form
          onSubmit={create}
          className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="lead-form-name">Form name</Label>
            <Input
              id="lead-form-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Website lead form"
              autoFocus
              disabled={creating}
            />
            <p className="text-xs text-gray-500">
              Used internally to identify this form. Customers do not see it.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/settings/lead-forms')}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                'Create form'
              )}
            </Button>
          </div>
        </form>
      </div>
    </SettingsPageShell>
  );
}
