'use client';

// app/settings/lead-forms/[id]/page.tsx
//
// Editor host page. Fetches the config by id and hands it off to the
// ConfigEditor client component.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useOrganization } from '@clerk/nextjs';
import { FileText } from 'lucide-react';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import {
  ConfigEditor,
  type LeadFormConfigDTO,
} from '@/components/settings/lead-forms/ConfigEditor';
import { toast } from 'sonner';

export default function LeadFormEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { organization } = useOrganization();

  const [config, setConfig] = useState<LeadFormConfigDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/embedded-forms/${id}`);
        if (response.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!response.ok) {
          toast.error('Failed to load lead form');
          return;
        }
        const data = (await response.json()) as LeadFormConfigDTO;
        if (!cancelled) setConfig(data);
      } catch (error) {
        console.error('Error loading lead form:', error);
        toast.error('Failed to load lead form');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <SettingsPageShell
      title="Edit Lead Form"
      subtitle="Configure form fields, CRM routing, and grab the embed snippet."
      icon={FileText}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
      wide
    >
      {notFound ? (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 max-w-2xl">
          <h3 className="font-medium text-yellow-900 mb-1">Form not found</h3>
          <p className="text-sm text-yellow-800">
            This lead form may have been deleted or belongs to a different
            organization.
          </p>
        </div>
      ) : config ? (
        <ConfigEditor config={config} />
      ) : null}
    </SettingsPageShell>
  );
}
