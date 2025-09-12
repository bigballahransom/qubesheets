'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Bell, Phone, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { toast } from 'sonner';

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
  
  const [enableInventoryUpdates, setEnableInventoryUpdates] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load notification settings on component mount
  useEffect(() => {
    if (!hasUnsavedChanges) {
      loadNotificationSettings();
    }
  }, [user, organization, hasUnsavedChanges]);

  const loadNotificationSettings = async () => {
    try {
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
    } catch (error) {
      console.error('Error loading notification settings:', error);
      toast.error('Failed to load notification settings');
    } finally {
      setLoading(false);
    }
  };

  const saveNotificationSettings = async () => {
    console.log('💾 Saving notification settings:', { enableInventoryUpdates, phoneNumber });
    setSaving(true);
    try {
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
        throw new Error(errorData.error || `Failed to save settings: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('✅ Save successful:', result);
      setHasUnsavedChanges(false);
      toast.success('Notification settings saved successfully!');
    } catch (error) {
      console.error('❌ Error saving notification settings:', error);
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
    <SidebarProvider>
      <AppSidebar />
      <div className="h-16"></div>
      <div className="container mx-auto p-4 max-w-4xl lg:pl-64">
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

              {/* Save Button */}
              <Button 
                onClick={saveNotificationSettings}
                disabled={saving || !hasUnsavedChanges}
                className="w-full"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : hasUnsavedChanges ? 'Save Changes' : 'No Changes to Save'}
              </Button>
              
              {hasUnsavedChanges && (
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
  );
}