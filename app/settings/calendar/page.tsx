'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import { CalendarDays, CheckCircle, Loader2, ExternalLink, Unlink, Globe, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import { toast } from 'sonner';
import IntercomChat from '@/components/IntercomChat';

// Common US timezones (most users will be in these)
const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (MT - no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
];

// Get all available timezones for the "Other" option
const getAllTimezones = () => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    // Fallback for older browsers
    return COMMON_TIMEZONES.map(tz => tz.value);
  }
};

export default function CalendarSettingsPage() {
  const { user, isLoaded } = useUser();

  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [googleAccount, setGoogleAccount] = useState<{
    email: string;
    id: string;
    hasCalendarScope: boolean;
  } | null>(null);

  // Timezone state
  const [timezone, setTimezone] = useState<string>('');
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [showAllTimezones, setShowAllTimezones] = useState(false);

  // Get browser's detected timezone
  const detectedTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'America/New_York';
    }
  }, []);

  // All timezones for the expanded dropdown
  const allTimezones = useMemo(() => getAllTimezones(), []);

  useEffect(() => {
    if (isLoaded && user) {
      checkGoogleConnection();
      // Load saved timezone from user metadata
      const savedTimezone = (user.publicMetadata as any)?.calendarTimezone;
      setTimezone(savedTimezone || detectedTimezone);
    }
  }, [isLoaded, user, detectedTimezone]);

  // Check URL params for OAuth callback status
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('calendar');

    if (status === 'connected') {
      toast.success('Google Calendar connected successfully!');
      // Clean up URL
      window.history.replaceState({}, '', '/settings/calendar');
      checkGoogleConnection();
    } else if (status === 'error') {
      toast.error('Failed to connect Google Calendar. Please try again.');
      window.history.replaceState({}, '', '/settings/calendar');
    }
  }, []);

  const checkGoogleConnection = async () => {
    try {
      // Check Clerk external accounts for Google
      const googleExternal = user?.externalAccounts?.find(
        (account) => account.provider === 'google'
      );

      if (googleExternal) {
        // Check if calendar scope was granted
        const approvedScopes = (googleExternal as any).approvedScopes || '';
        const hasCalendarScope = approvedScopes.includes('calendar');

        setGoogleAccount({
          email: googleExternal.emailAddress || 'Connected',
          id: googleExternal.id,
          hasCalendarScope,
        });
      } else {
        setGoogleAccount(null);
      }
    } catch (error) {
      console.error('Error checking Google connection:', error);
    } finally {
      setLoading(false);
    }
  };

  const connectGoogle = async () => {
    setConnecting(true);
    try {
      // Check if there's already a Google account connected (without calendar scope)
      const existingGoogle = user?.externalAccounts?.find(
        (account) => account.provider === 'google'
      );

      // If there's an existing connection without calendar scope, remove it first
      if (existingGoogle) {
        try {
          await existingGoogle.destroy();
          // Reload user to get updated state
          await user?.reload();
        } catch (destroyError: any) {
          // Handle reverification requirement for destroy
          if (destroyError?.message?.includes('additional verification') ||
              destroyError?.errors?.[0]?.code === 'session_reverification_required') {
            toast.error(
              'For security, please sign out and sign back in, then try connecting again.',
              { duration: 5000 }
            );
            setConnecting(false);
            return;
          }
          throw destroyError;
        }
      }

      // Use Clerk's external account connection with calendar scope
      // This will open a popup for Google OAuth
      const externalAccount = await user?.createExternalAccount({
        strategy: 'oauth_google',
        redirectUrl: `${window.location.origin}/settings/calendar?calendar=connected`,
        additionalScopes: ['https://www.googleapis.com/auth/calendar.events'],
      });

      // Get the OAuth URL and redirect
      const url = externalAccount?.verification?.externalVerificationRedirectURL;
      if (url) {
        window.location.href = url.toString();
      } else {
        throw new Error('Failed to get OAuth URL');
      }
    } catch (error: any) {
      console.error('Error connecting Google:', error);

      // Handle Clerk's reverification requirement
      if (error?.message?.includes('additional verification') ||
          error?.errors?.[0]?.code === 'session_reverification_required') {
        toast.error(
          'For security, please sign out and sign back in, then try connecting again.',
          { duration: 5000 }
        );
      } else if (error?.errors?.[0]?.code === 'external_account_exists') {
        toast.error('This Google account is already connected to another user.');
      } else if (error?.message?.includes('Another account is already connected')) {
        // This shouldn't happen now, but just in case
        toast.error(
          'A Google account is already linked. Please disconnect it first, then reconnect.',
          { duration: 5000 }
        );
      } else if (error?.errors?.[0]?.code !== 'user_cancelled') {
        toast.error('Failed to connect Google Calendar. Please try again.');
      }
      setConnecting(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!googleAccount) return;

    setDisconnecting(true);
    try {
      const externalAccount = user?.externalAccounts?.find(
        (account) => account.provider === 'google'
      );

      if (externalAccount) {
        await externalAccount.destroy();
        setGoogleAccount(null);
        toast.success('Google Calendar disconnected.');
      }
    } catch (error: any) {
      console.error('Error disconnecting Google:', error);

      // Handle Clerk's reverification requirement
      if (error?.message?.includes('additional verification') ||
          error?.errors?.[0]?.code === 'session_reverification_required') {
        toast.error(
          'For security, please sign out and sign back in, then try disconnecting again.',
          { duration: 5000 }
        );
      } else {
        toast.error('Failed to disconnect. Please try again.');
      }
    } finally {
      setDisconnecting(false);
    }
  };

  const handleTimezoneChange = async (newTimezone: string) => {
    const previousTimezone = timezone;
    setTimezone(newTimezone);
    setSavingTimezone(true);

    try {
      const response = await fetch('/api/user/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: newTimezone }),
      });

      if (!response.ok) {
        throw new Error('Failed to save timezone');
      }

      toast.success('Timezone updated');
    } catch (error) {
      console.error('Error saving timezone:', error);
      toast.error('Failed to save timezone');
      // Revert on error
      setTimezone(previousTimezone);
    } finally {
      setSavingTimezone(false);
    }
  };

  // Check if current timezone is in common list
  const isCommonTimezone = COMMON_TIMEZONES.some(tz => tz.value === timezone);

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
              <h1 className="text-2xl font-bold">Link Calendar</h1>
            </div>
          </div>

          {loading || !isLoaded ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="max-w-2xl">
              <div className="space-y-6">
                {/* Info Box */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-900 mb-1">Personal Calendar</h3>
                  <p className="text-sm text-blue-700">
                    Connect your Google Calendar to automatically create events when you schedule video calls.
                    This is linked to your personal account, not the organization.
                  </p>
                </div>

                {/* Google Calendar Connection */}
                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-white border rounded-lg flex items-center justify-center">
                        <svg viewBox="0 0 24 24" className="w-8 h-8">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                      </div>
                    </div>

                    <div className="flex-1">
                      <h2 className="text-lg font-medium mb-1">Google Calendar</h2>
                      <p className="text-sm text-gray-600 mb-4">
                        When you schedule video calls, events will be created on your Google Calendar with the meeting link included.
                      </p>

                      {googleAccount ? (
                        <div className="space-y-3">
                          {googleAccount.hasCalendarScope ? (
                            <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-2 rounded-lg">
                              <CheckCircle className="h-4 w-4" />
                              <span className="text-sm font-medium">Connected as {googleAccount.email}</span>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                                <CalendarDays className="h-4 w-4" />
                                <span className="text-sm font-medium">Connected as {googleAccount.email}</span>
                              </div>
                              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                <p className="text-sm text-amber-800">
                                  Calendar access not granted. Please reconnect to enable calendar event creation.
                                </p>
                                <Button
                                  onClick={connectGoogle}
                                  disabled={connecting}
                                  size="sm"
                                  className="mt-2 bg-amber-600 hover:bg-amber-700"
                                >
                                  {connecting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                  )}
                                  Grant Calendar Access
                                </Button>
                              </div>
                            </>
                          )}

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={disconnectGoogle}
                            disabled={disconnecting}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            {disconnecting ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Unlink className="mr-2 h-4 w-4" />
                            )}
                            Disconnect
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={connectGoogle}
                          disabled={connecting}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          {connecting ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ExternalLink className="mr-2 h-4 w-4" />
                          )}
                          Connect Google Calendar
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Timezone Setting */}
                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-blue-50 border rounded-lg flex items-center justify-center">
                        <Globe className="w-6 h-6 text-blue-600" />
                      </div>
                    </div>

                    <div className="flex-1">
                      <h2 className="text-lg font-medium mb-1">Timezone</h2>
                      <p className="text-sm text-gray-600 mb-4">
                        Set your timezone for scheduling video calls. Calendar events and SMS reminders will use this timezone.
                      </p>

                      <div className="space-y-3">
                        <div className="relative">
                          <select
                            value={isCommonTimezone || showAllTimezones ? timezone : 'other'}
                            onChange={(e) => {
                              if (e.target.value === 'other') {
                                setShowAllTimezones(true);
                              } else {
                                setShowAllTimezones(false);
                                handleTimezoneChange(e.target.value);
                              }
                            }}
                            disabled={savingTimezone}
                            className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer disabled:opacity-50"
                          >
                            {COMMON_TIMEZONES.map((tz) => (
                              <option key={tz.value} value={tz.value}>
                                {tz.label}
                              </option>
                            ))}
                            <option value="other">Other timezone...</option>
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        </div>

                        {/* Show all timezones dropdown when "Other" is selected */}
                        {showAllTimezones && (
                          <div className="relative">
                            <select
                              value={timezone}
                              onChange={(e) => handleTimezoneChange(e.target.value)}
                              disabled={savingTimezone}
                              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer disabled:opacity-50"
                            >
                              {allTimezones.map((tz) => (
                                <option key={tz} value={tz}>
                                  {tz.replace(/_/g, ' ')}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                          </div>
                        )}

                        {savingTimezone && (
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Saving...
                          </div>
                        )}

                        {timezone === detectedTimezone && (
                          <p className="text-xs text-gray-500">
                            This matches your browser's detected timezone.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* How it works */}
                <div className="bg-gray-50 rounded-lg border p-6">
                  <h3 className="font-medium mb-3">How it works</h3>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-start gap-2">
                      <span className="font-medium text-gray-900">1.</span>
                      Connect your Google account above
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-medium text-gray-900">2.</span>
                      When scheduling a video call, check "Add to Google Calendar"
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-medium text-gray-900">3.</span>
                      An event is created with the video call link
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-medium text-gray-900">4.</span>
                      Optionally invite the customer via their email
                    </li>
                  </ul>
                </div>

                {/* Note about different accounts */}
                <p className="text-xs text-gray-500 text-center">
                  You can connect any Google account - it doesn't need to match your login email.
                </p>
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
