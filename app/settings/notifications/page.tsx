'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Bell, Phone, PenTool, Mail } from 'lucide-react';
import SafeIcon from '@/components/icons/SafeIcon';
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
  const [enableReviewSignedUpdates, setEnableReviewSignedUpdates] = useState(false);
  const [reviewSignedNotificationScope, setReviewSignedNotificationScope] = useState<'all' | 'unassigned-and-mine' | 'mine'>('all');
  const [enableVaultMediaUpdates, setEnableVaultMediaUpdates] = useState(false);
  const [vaultMediaNotificationScope, setVaultMediaNotificationScope] = useState<'all' | 'unassigned-and-mine' | 'mine'>('all');
  // Email channel — one shared address, opted in per event type
  const [notificationEmail, setNotificationEmail] = useState('');
  const [enableInventoryUpdateEmails, setEnableInventoryUpdateEmails] = useState(false);
  const [enableReviewSignedEmails, setEnableReviewSignedEmails] = useState(false);
  const [enableVaultMediaEmails, setEnableVaultMediaEmails] = useState(false);
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
        setEnableReviewSignedUpdates(settings.enableReviewSignedUpdates || false);
        setReviewSignedNotificationScope(settings.reviewSignedNotificationScope || 'all');
        setEnableVaultMediaUpdates(settings.enableVaultMediaUpdates || false);
        setVaultMediaNotificationScope(settings.vaultMediaNotificationScope || 'all');
        setNotificationEmail(settings.notificationEmail || '');
        setEnableInventoryUpdateEmails(settings.enableInventoryUpdateEmails || false);
        setEnableReviewSignedEmails(settings.enableReviewSignedEmails || false);
        setEnableVaultMediaEmails(settings.enableVaultMediaEmails || false);
        setPhoneNumber(formatPhoneForDisplay(settings.phoneNumber || ''));
      } else {
        setEnableInventoryUpdates(false);
        setNotificationScope('all');
        setEnableReviewSignedUpdates(false);
        setReviewSignedNotificationScope('all');
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
    // Every enabled event needs at least one working channel — a valid
    // phone for SMS, or the email toggle plus an address. Catch the
    // "enabled but notifies nobody" state before saving.
    const hasPhone = phoneNumber.replace(/\D/g, '').length === 10;
    const hasEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail.trim());
    const channelGap = [
      enableInventoryUpdates && !hasPhone && !(enableInventoryUpdateEmails && hasEmail) && 'Inventory Updates',
      enableReviewSignedUpdates && !hasPhone && !(enableReviewSignedEmails && hasEmail) && 'Review Signed',
      enableVaultMediaUpdates && !hasPhone && !(enableVaultMediaEmails && hasEmail) && 'Media Vault',
    ].filter(Boolean);
    if (channelGap.length > 0) {
      toast.error(
        `${channelGap.join(', ')}: add a phone number for SMS or turn on email with an address — otherwise no one gets notified.`
      );
      return;
    }

    setSaving(true);
    try {
      if (hasUnsavedChanges) {
        const response = await fetch('/api/notification-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enableInventoryUpdates,
            notificationScope,
            enableReviewSignedUpdates,
            reviewSignedNotificationScope,
            enableVaultMediaUpdates,
            vaultMediaNotificationScope,
            notificationEmail: notificationEmail.trim() || null,
            enableInventoryUpdateEmails,
            enableReviewSignedEmails,
            enableVaultMediaEmails,
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

  // Email channel block rendered inside each personal notification section.
  // One shared address; each event type opts the email channel in
  // independently. Delivery still requires the section's master toggle.
  const renderEmailChannel = (
    emailEnabled: boolean,
    setEmailEnabled: (v: boolean) => void
  ) => (
    <div className="pt-4 border-t space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex-1 pr-4">
          <h3 className="font-medium flex items-center gap-2">
            <Mail className="w-4 h-4 text-gray-500" />
            Also send email
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Delivered from notifications@qubesheets.com.
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => {
              setEmailEnabled(e.target.checked);
              setHasUnsavedChanges(true);
            }}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>
      {emailEnabled && (
        <div>
          <label className="block text-sm font-medium mb-2">
            Email Address <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="email"
              value={notificationEmail}
              onChange={(e) => {
                setNotificationEmail(e.target.value);
                setHasUnsavedChanges(true);
              }}
              placeholder="you@company.com"
              className="pl-10"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Shared with your other personal email notifications.
          </p>
        </div>
      )}
    </div>
  );

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
                    Phone Number
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
                  <p className="text-xs text-gray-500 mt-1">US phone number for SMS alerts. Leave blank to use email only.</p>
                </div>
                {renderEmailChannel(enableInventoryUpdateEmails, setEnableInventoryUpdateEmails)}
              </>
            )}
          </div>
        </section>

        {/* Review Signed Notifications — Personal */}
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-start justify-between mb-4 gap-3">
            <div>
              <h2 className="text-lg font-medium flex items-center gap-2">
                <PenTool className="w-4 h-4 text-emerald-600" />
                Review Signed Notifications
              </h2>
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
                <h3 className="font-medium">Enable Review Signed Alerts</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Get notified when a customer signs off on their inventory from the review link.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableReviewSignedUpdates}
                  onChange={(e) => {
                    setEnableReviewSignedUpdates(e.target.checked);
                    setHasUnsavedChanges(true);
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {enableReviewSignedUpdates && (
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
                          reviewSignedNotificationScope === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <input
                          type="radio"
                          name="reviewSignedNotificationScope"
                          value={opt.value}
                          checked={reviewSignedNotificationScope === opt.value}
                          onChange={() => {
                            setReviewSignedNotificationScope(opt.value);
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
                    Phone Number
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
                  <p className="text-xs text-gray-500 mt-1">
                    US phone number for SMS alerts — shared with your other personal notifications. Leave blank to use email only.
                  </p>
                </div>
                {renderEmailChannel(enableReviewSignedEmails, setEnableReviewSignedEmails)}
              </>
            )}
          </div>
        </section>

        {/* Media Vault Notifications — Personal */}
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-start justify-between mb-4 gap-3">
            <div>
              <h2 className="text-lg font-medium flex items-center gap-2">
                <SafeIcon size={16} className="text-slate-600" />
                Media Vault Notifications
              </h2>
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
                <h3 className="font-medium">Enable Vault Media Alerts</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Get notified when reference media (walk-in/walk-out videos, receiving,
                  damage documentation) is added to a project&apos;s Media Vault.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableVaultMediaUpdates}
                  onChange={(e) => {
                    setEnableVaultMediaUpdates(e.target.checked);
                    setHasUnsavedChanges(true);
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {enableVaultMediaUpdates && (
              <>
                <div className="pt-4 border-t">
                  <label className="block text-sm font-medium mb-2">Which projects?</label>
                  <div className="space-y-2">
                    {([
                      { value: 'all', title: 'All projects', desc: 'Notify on every project in the org (default).' },
                      {
                        value: 'unassigned-and-mine',
                        title: 'Unassigned projects and my projects',
                        desc: 'Projects assigned to or created by me, plus projects from automated sources (Smart Moving, API, the global links) that haven\'t been assigned yet.'
                      },
                      { value: 'mine', title: 'My projects only', desc: 'Only projects assigned to me, or projects I created if no one else is assigned.' }
                    ] as const).map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          vaultMediaNotificationScope === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <input
                          type="radio"
                          name="vaultMediaNotificationScope"
                          value={opt.value}
                          checked={vaultMediaNotificationScope === opt.value}
                          onChange={() => {
                            setVaultMediaNotificationScope(opt.value);
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
                    Phone Number
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
                  <p className="text-xs text-gray-500 mt-1">
                    US phone number for SMS alerts — shared with your other personal notifications. Leave blank to use email only.
                  </p>
                </div>
                {renderEmailChannel(enableVaultMediaEmails, setEnableVaultMediaEmails)}
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
