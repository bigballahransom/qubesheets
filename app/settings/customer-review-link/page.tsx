'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { ClipboardCheck, Truck } from 'lucide-react';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

const DEFAULT_ENABLED = true;

interface ReviewFlags {
  customerReviewShowTruckSize: boolean;
}

const DEFAULT_FLAGS: ReviewFlags = {
  customerReviewShowTruckSize: DEFAULT_ENABLED
};

type FlagKey = keyof ReviewFlags;

interface FlagDefinition {
  key: FlagKey;
  title: string;
  description: string;
  icon: typeof Truck;
}

const FLAG_DEFINITIONS: FlagDefinition[] = [
  {
    key: 'customerReviewShowTruckSize',
    title: 'Show Truck Size',
    description:
      'Display the recommended truck size card in the stat bar on the customer review page. When off, the stat bar shows Items, Boxes, and Weight only.',
    icon: Truck
  }
];

export default function CustomerReviewLinkSettingsPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [flags, setFlags] = useState<ReviewFlags>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      loadSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, organization, hasUnsavedChanges]);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings/customer-review-link');
      if (response.ok) {
        const config = await response.json();
        setFlags({
          customerReviewShowTruckSize:
            config.customerReviewShowTruckSize ?? DEFAULT_ENABLED
        });
      } else if (response.status === 403) {
        setLoading(false);
        return;
      } else {
        setFlags(DEFAULT_FLAGS);
      }
    } catch (error) {
      console.error('Error loading customer review link settings:', error);
      setFlags(DEFAULT_FLAGS);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/customer-review-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flags)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save: ${response.status}`);
      }

      setHasUnsavedChanges(false);
      toast.success('Customer review link settings saved.');
    } catch (error) {
      console.error('Error saving customer review link settings:', error);
      toast.error(
        `Failed to save. ${error instanceof Error ? error.message : 'Please try again.'}`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleFlagChange = (key: FlagKey, next: boolean) => {
    setFlags((prev) => ({ ...prev, [key]: next }));
    setHasUnsavedChanges(true);
  };

  return (
    <SettingsPageShell
      title="Customer Review Link"
      subtitle="Control what appears on the customer-facing inventory review page (/inventory-review/[id])."
      icon={ClipboardCheck}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
      unsavedChanges={hasUnsavedChanges}
      saving={saving}
      onSave={saveSettings}
      onDiscard={() => {
        setHasUnsavedChanges(false);
        loadSettings();
      }}
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
          {FLAG_DEFINITIONS.map(({ key, title, description, icon: Icon }) => (
            <div key={key} className="flex items-start justify-between gap-4 p-6">
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-medium text-gray-900">{title}</h2>
                  <p className="text-sm text-gray-500 mt-1">{description}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                <input
                  type="checkbox"
                  checked={flags[key]}
                  onChange={(e) => handleFlagChange(key, e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          ))}
        </div>
      </div>
    </SettingsPageShell>
  );
}
