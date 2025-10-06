'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Bell, Phone, Save, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import { toast } from 'sonner';
import IntercomChat from '@/components/IntercomChat';

// Phone formatting utilities
const formatPhoneNumber = (value: string, previousValue: string = ''): string => {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '');
  
  // If user is deleting and we have fewer digits than before, don't add formatting yet
  const prevDigits = previousValue.replace(/\D/g, '');
  const isDeleting = digits.length < prevDigits.length;
  
  // Limit to 10 digits
  const limitedDigits = digits.slice(0, 10);
  
  // If empty or deleting and less than 4 digits, return just the digits
  if (limitedDigits.length === 0) {
    return '';
  }
  
  if (isDeleting && limitedDigits.length <= 3) {
    return limitedDigits;
  }
  
  // Format as (xxx) xxx-xxxx
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
  // Convert +1XXXXXXXXXX to (XXX) XXX-XXXX
  const digits = twilioPhone.replace(/^\+1/, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return twilioPhone;
};

export default function NotificationsPage() {
  const { user } = useUser();
  const { organization } = useOrganization();
  
  // Individual settings
  const [enableInventoryUpdates, setEnableInventoryUpdates] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  
  // Organization settings
  const [enableCustomerFollowUps, setEnableCustomerFollowUps] = useState(false);
  const [followUpDelayHours, setFollowUpDelayHours] = useState(4);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hasOrgChanges, setHasOrgChanges] = useState(false);

  // Check if user is org admin
  useEffect(() => {
    if (organization && user) {
      // For now, allow all org members to update settings
      // In production, you'd check the user's role in the organization
      setIsOrgAdmin(true);
    }
  }, [organization, user]);

  // Load notification settings on component mount
  useEffect(() => {
    if (!hasUnsavedChanges && !hasOrgChanges) {
      loadNotificationSettings();
    }
  }, [user, organization, hasUnsavedChanges, hasOrgChanges]);

  const loadNotificationSettings = async () => {
    try {
      // Load individual settings
      const response = await fetch('/api/notification-settings');
      if (response.ok) {
        const settings = await response.json();
        setEnableInventoryUpdates(settings.enableInventoryUpdates || false);
        setPhoneNumber(formatPhoneForDisplay(settings.phoneNumber || ''));
      } else {
        // Use defaults if no settings exist
        setEnableInventoryUpdates(false);
        setPhoneNumber('');
      }
      
      // Load organization settings if in an organization
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
    console.log('💾 Saving notification settings');
    setSaving(true);
    try {
      // Save individual settings if changed
      if (hasUnsavedChanges) {
        const response = await fetch('/api/notification-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            enableInventoryUpdates,
            phoneNumber: phoneNumber.trim() || null,
          }),
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed to save individual settings: ${response.status}`);
        }
      }
      
      // Save organization settings if changed and user is admin
      if (hasOrgChanges && isOrgAdmin && organization) {
        const orgResponse = await fetch('/api/organization-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            enableCustomerFollowUps,
            followUpDelayHours,
          }),
        });
        
        if (!orgResponse.ok) {
          const errorData = await orgResponse.json();
          throw new Error(errorData.error || `Failed to save organization settings: ${orgResponse.status}`);
        }
      }
      
      setHasUnsavedChanges(false);
      setHasOrgChanges(false);
      toast.success('Settings saved successfully!');
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

  return (
    <>
      <SidebarProvider>
      <AppSidebar />
      <DesktopHeaderBar />
      <div className="h-16"></div>
      <div className="container mx-auto p-4 max-w-4xl lg:pl-64 lg:pt-16">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Bell className="h-6 w-6" />
            <h1 className="text-2xl font-bold">Notification Settings</h1>
          </div>
        </div>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="text-gray-500">Loading notification settings...</div>
          </div>
        ) : (
          <div className="max-w-2xl">
            <div className="space-y-6">
              {/* Organization/User Info */}
              {organization && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-900 mb-1">Individual Settings</h3>
                  <p className="text-sm text-blue-700">
                    These notification settings are individual to you within <strong>{organization.name}</strong>. 
                    Other members can configure their own separate notification preferences.
                  </p>
                </div>
              )}
              
              {/* Inventory Updates Notification */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="text-lg font-medium mb-4">Inventory Update Notifications</h2>
                
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-medium">Enable Inventory Updates</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Get notified every time a project's inventory gets updated
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer ml-4">
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
                    <div className="pt-4 border-t">
                      <label className="block text-sm font-medium mb-2">
                        Phone Number <span className="text-red-500">*</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                          <Input
                            type="tel"
                            value={phoneNumber}
                            onChange={handlePhoneChange}
                            placeholder="(555) 123-4567"
                            className="pl-10"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        US phone number required for SMS notifications
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer Follow-up Notifications - Organization Settings */}
              {organization && (
                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-medium">Customer Follow-up Reminders</h2>
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
                      Organization Setting
                    </span>
                  </div>
                  
                  {!isOrgAdmin && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                      <p className="text-sm text-yellow-700">
                        Only organization admins can modify these settings.
                      </p>
                    </div>
                  )}
                  
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium">Enable Follow-up Reminders</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          Automatically send follow-up messages to customers who haven't uploaded inventory
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer ml-4">
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
                        <div className={`w-11 h-6 ${!isOrgAdmin ? 'opacity-50' : ''} bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600`}></div>
                      </label>
                    </div>
                    
                    {enableCustomerFollowUps && (
                      <div className="pt-4 border-t">
                        <label className="block text-sm font-medium mb-2">
                          Follow-up Delay
                        </label>
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
                        <p className="text-xs text-gray-500 mt-1">
                          Send reminder if customer hasn't uploaded any photos (1-168 hours)
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Save Button */}
              <Button 
                onClick={saveNotificationSettings}
                disabled={saving || (!hasUnsavedChanges && !hasOrgChanges)}
                className="w-full"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : (hasUnsavedChanges || hasOrgChanges) ? 'Save Changes' : 'No Changes to Save'}
              </Button>
              
              {(hasUnsavedChanges || hasOrgChanges) && (
                <p className="text-sm text-orange-600 text-center mt-2">
                  You have unsaved changes
                </p>
              )}
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