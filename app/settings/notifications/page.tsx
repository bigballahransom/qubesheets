'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Bell, Phone } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

// Phone formatting utilities
const formatPhoneNumber = (value: string, previousValue: string = ''): string => {
  const digits = value.replace(/\D/g, '');
  const prevDigits = previousValue.replace(/\D/g, '');
  const isDeleting = digits.length < prevDigits.length;
  const limitedDigits = digits.slice(0, 10);

  if (limitedDigits.length === 0) return '';
  if (isDeleting && limitedDigits.length <= 3) return limitedDigits;
  if (limitedDigits.length >= 7) {
    return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
  } else if (limitedDigits.length >= 4) {
    return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3)}`;
  } else if (limitedDigits.length >= 1) {
    return isDeleting ? limitedDigits : `(${limitedDigits}`;
  }
  return limitedDigits;
};

const formatPhoneForDisplay = (twilioPhone: string): string => {
  if (!twilioPhone) return '';
  const digits = twilioPhone.replace(/^\+1/, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return twilioPhone;
};

export default function NotificationsPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [enableInventoryUpdates, setEnableInventoryUpdates] = useState(false);
  const [notificationScope, setNotificationScope] = useState<'all' | 'unassigned-and-mine' | 'mine'>('all');
  const [phoneNumber, setPhoneNumber] = useState('');

  const [enableCustomerFollowUps, setEnableCustomerFollowUps] = useState(false);
  const [followUpDelayHours, setFollowUpDelayHours] = useState(4);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasOrgChanges, setHasOrgChanges] = useState(false);

  useEffect(() => {
    if (organization && user) {
      setIsOrgAdmin(true);
    }
  }, [organization, user]);

  useEffect(() => {
    if (!hasUnsavedChanges && !hasOrgChanges) {
      loadNotificationSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, organization, hasUnsavedChanges, hasOrgChanges]);

  const loadNotificationSettings = async () => {
    try {
      const response = await fetch('/api/notification-settings');
      if (response.ok) {
        const settings = await response.json();
        setEnableInventoryUpdates(settings.enableInventoryUpdates || false);
        setNotificationScope(settings.notificationScope || 'all');
        setPhoneNumber(formatPhoneForDisplay(settings.phoneNumber || ''));
      } else {
        setEnableInventoryUpdates(false);
        setNotificationScope('all');
        setPhoneNumber('');
      }

      if (organization) {
        const orgResponse = await fetch('/api/organization-settings');
        if (orgResponse.ok) {
          const orgSettings = await orgResponse.json();
          setEnableCustomerFollowUps(orgSettings.enableCustomerFollowUps || false);
          setFollowUpDelayHours(orgSettings.followUpDelayHours || 4);
        }
      }
    } catch (error) {
      console.error('Error loading notification settings:', error);
      toast.error('Failed to load notification settings');
    } finally {
      setLoading(false);
    }
  };

  const saveNotificationSettings = async () => {
    setSaving(true);
    try {
      if (hasUnsavedChanges) {
        const response = await fetch('/api/notification-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enableInventoryUpdates,
            notificationScope,
            phoneNumber: phoneNumber.trim() || null
          })
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed to save individual settings: ${response.status}`);
        }
      }

      if (hasOrgChanges && isOrgAdmin && organization) {
        const orgResponse = await fetch('/api/organization-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enableCustomerFollowUps, followUpDelayHours })
        });
        if (!orgResponse.ok) {
          const errorData = await orgResponse.json();
          throw new Error(errorData.error || `Failed to save organization settings: ${orgResponse.status}`);
        }
      }

      setHasUnsavedChanges(false);
      setHasOrgChanges(false);
      toast.success('Settings saved.');
    } catch (error) {
      console.error('❌ Error saving settings:', error);
      toast.error(`Failed to save settings. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = formatPhoneNumber(e.target.value, phoneNumber);
    setPhoneNumber(newValue);
    setHasUnsavedChanges(true);
  };

  const handleToggleChange = (checked: boolean) => {
    setEnableInventoryUpdates(checked);
    setHasUnsavedChanges(true);
  };

  const dirty = hasUnsavedChanges || hasOrgChanges;

  return (
    <SettingsPageShell
      title="Notifications"
      subtitle="SMS alerts for inventory uploads, plus follow-up reminders for customers who haven't uploaded yet."
      icon={Bell}
      scope={organization ? 'mixed' : 'personal'}
      organizationName={organization?.name}
      loading={loading}
      unsavedChanges={dirty}
      saving={saving}
      onSave={saveNotificationSettings}
      onDiscard={() => {
        setHasUnsavedChanges(false);
        setHasOrgChanges(false);
        loadNotificationSettings();
      }}
    >
      <div className="space-y-6">
        {/* Inventory Update Notifications — Personal */}
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-start justify-between mb-4 gap-3">
            <div>
              <h2 className="text-lg font-medium">Inventory Update Notifications</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Just for you — other org members configure their own.
              </p>
            </div>
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Personal
            </span>
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 pr-4">
                <h3 className="font-medium">Enable Inventory Updates</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Get notified every time a project&apos;s inventory gets updated.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableInventoryUpdates}
                  onChange={(e) => handleToggleChange(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {enableInventoryUpdates && (
              <>
                <div className="pt-4 border-t">
                  <label className="block text-sm font-medium mb-2">Which projects?</label>
                  <div className="space-y-2">
                    {([
                      { value: 'all', title: 'All projects', desc: 'Notify on every project in the org (default).' },
                      {
                        value: 'unassigned-and-mine',
                        title: 'Unassigned projects and my projects',
                        desc: 'Projects assigned to or created by me, plus projects from automated sources (Smart Moving, API, the global self-survey link) that haven\'t been assigned yet.'
                      },
                      { value: 'mine', title: 'My projects only', desc: 'Only projects assigned to me, or projects I created if no one else is assigned.' }
                    ] as const).map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          notificationScope === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <input
                          type="radio"
                          name="notificationScope"
                          value={opt.value}
                          checked={notificationScope === opt.value}
                          onChange={() => {
                            setNotificationScope(opt.value);
                            setHasUnsavedChanges(true);
                          }}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="font-medium text-sm">{opt.title}</div>
                          <div className="text-xs text-gray-600 mt-0.5">{opt.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <label className="block text-sm font-medium mb-2">
                    Phone Number <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      type="tel"
                      value={phoneNumber}
                      onChange={handlePhoneChange}
                      placeholder="(555) 123-4567"
                      className="pl-10"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">US phone number required for SMS notifications</p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Customer Follow-up Reminders — Organization */}
        {organization && (
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
            <div className="flex items-start justify-between mb-4 gap-3">
              <div>
                <h2 className="text-lg font-medium">Customer Follow-up Reminders</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Auto-reminders to customers who haven&apos;t uploaded — affects the whole org.
                </p>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 text-xs font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                Organization
              </span>
            </div>

            {!isOrgAdmin && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-700">Only organization admins can modify these settings.</p>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-4">
                  <h3 className="font-medium">Enable Follow-up Reminders</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Automatically send follow-up messages to customers who haven&apos;t uploaded inventory.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableCustomerFollowUps}
                    onChange={(e) => {
                      if (isOrgAdmin) {
                        setEnableCustomerFollowUps(e.target.checked);
                        setHasOrgChanges(true);
                      }
                    }}
                    disabled={!isOrgAdmin}
                    className="sr-only peer"
                  />
                  <div
                    className={`w-11 h-6 ${
                      !isOrgAdmin ? 'opacity-50' : ''
                    } bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600`}
                  ></div>
                </label>
              </div>

              {enableCustomerFollowUps && (
                <div className="pt-4 border-t">
                  <label className="block text-sm font-medium mb-2">Follow-up Delay</label>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      value={followUpDelayHours}
                      onChange={(e) => {
                        if (isOrgAdmin) {
                          const value = parseInt(e.target.value) || 4;
                          const clamped = Math.max(1, Math.min(168, value));
                          setFollowUpDelayHours(clamped);
                          setHasOrgChanges(true);
                        }
                      }}
                      disabled={!isOrgAdmin}
                      min="1"
                      max="168"
                      className="w-24"
                    />
                    <span className="text-sm text-gray-600">hours after sending upload link</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Send reminder if customer hasn&apos;t uploaded any photos (1–168 hours)</p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </SettingsPageShell>
  );
}
