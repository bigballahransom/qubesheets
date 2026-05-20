'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Camera, Link2, MessageSquare, Building2 } from 'lucide-react';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

const DEFAULT_ENABLED = true;

interface PhotoFlags {
  photosEnabledGlobalLink: boolean;
  photosEnabledCustomerLink: boolean;
  photosEnabledWalkthrough: boolean;
}

const DEFAULT_FLAGS: PhotoFlags = {
  photosEnabledGlobalLink: DEFAULT_ENABLED,
  photosEnabledCustomerLink: DEFAULT_ENABLED,
  photosEnabledWalkthrough: DEFAULT_ENABLED
};

type FlagKey = keyof PhotoFlags;

interface FlagDefinition {
  key: FlagKey;
  title: string;
  description: string;
  icon: typeof Link2;
}

const FLAG_DEFINITIONS: FlagDefinition[] = [
  {
    key: 'photosEnabledGlobalLink',
    title: 'Global Self-Survey Link',
    description: 'The single link you share publicly. When off, customers landing on it will only see the video-recording option.',
    icon: Link2
  },
  {
    key: 'photosEnabledCustomerLink',
    title: 'Customer Upload Links',
    description: 'Per-customer links you text or email. When off, the recipient will only see the video-recording option.',
    icon: MessageSquare
  },
  {
    key: 'photosEnabledWalkthrough',
    title: 'On-Site Walkthroughs',
    description: 'When an employee starts a walkthrough from a project. When off, the in-app photo capture is hidden — video only.',
    icon: Building2
  }
];

export default function PhotosSettingsPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [flags, setFlags] = useState<PhotoFlags>(DEFAULT_FLAGS);
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
      const response = await fetch('/api/settings/photos');
      if (response.ok) {
        const config = await response.json();
        setFlags({
          photosEnabledGlobalLink: config.photosEnabledGlobalLink ?? DEFAULT_ENABLED,
          photosEnabledCustomerLink: config.photosEnabledCustomerLink ?? DEFAULT_ENABLED,
          photosEnabledWalkthrough: config.photosEnabledWalkthrough ?? DEFAULT_ENABLED
        });
      } else if (response.status === 403) {
        setLoading(false);
        return;
      } else {
        setFlags(DEFAULT_FLAGS);
      }
    } catch (error) {
      console.error('Error loading photo settings:', error);
      setFlags(DEFAULT_FLAGS);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flags)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save: ${response.status}`);
      }

      setHasUnsavedChanges(false);
      toast.success('Photo settings saved.');
    } catch (error) {
      console.error('Error saving photo settings:', error);
      toast.error(`Failed to save. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleFlagChange = (key: FlagKey, next: boolean) => {
    setFlags((prev) => ({ ...prev, [key]: next }));
    setHasUnsavedChanges(true);
  };

  const anyDisabled = Object.values(flags).some((v) => v === false);

  return (
    <SettingsPageShell
      title="Photo Capture"
      subtitle="Turn photo capture on or off per upload-link flow."
      icon={Camera}
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

        {anyDisabled && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <h3 className="font-medium text-amber-900 mb-1">Heads up</h3>
            <p className="text-sm text-amber-800">
              Existing links minted as photos-only for any flow you&apos;ve turned off will show a &quot;no longer accepting uploads&quot; message until photos are re-enabled or a new link is issued.
            </p>
          </div>
        )}
      </div>
    </SettingsPageShell>
  );
}
