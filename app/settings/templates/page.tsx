'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Save, RotateCcw, FileText, MessageSquare, Video, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import { toast } from 'sonner';
import { DEFAULT_SMS_UPLOAD_TEMPLATE } from '@/lib/sms-template-helpers';
import IntercomChat from '@/components/IntercomChat';

const DEFAULT_INSTRUCTIONS = `Upload Tips from {companyName}

- Take clear, well-lit photos of your items
- Include multiple angles for large furniture
- Group similar items together when possible
- Add descriptions to help with identification
- Upload as many photos as needed
- For videos: Keep under 1 minute for optimal processing
- Pro tip: Take 1 short video for each room!`;

// Video Call Template Defaults
const DEFAULT_VIDEO_CALL_INVITE = `Video Inventory Call

Join here: {videoCallLink}

Please join the video call at the scheduled time. Make sure you're in a well-lit area and have access to the rooms/items we'll be reviewing.

---
Scheduled by {agentName}
{companyName}`;

const DEFAULT_VIDEO_CALL_CONFIRMATION_SMS = `Hi {customerName}, your video call with {companyName} is scheduled for {scheduledDate} at {scheduledTime}.

Join here: {videoCallLink}`;

const DEFAULT_VIDEO_CALL_REMINDER_SMS = `Reminder: Your video call with {companyName} is in {timeUntil}.

Join here: {videoCallLink}`;

export default function TemplatesPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  // Existing templates
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [smsTemplate, setSmsTemplate] = useState(DEFAULT_SMS_UPLOAD_TEMPLATE);

  // Video call templates
  const [videoCallInviteTemplate, setVideoCallInviteTemplate] = useState(DEFAULT_VIDEO_CALL_INVITE);
  const [videoCallConfirmationSms, setVideoCallConfirmationSms] = useState(DEFAULT_VIDEO_CALL_CONFIRMATION_SMS);
  const [videoCallReminderSms, setVideoCallReminderSms] = useState(DEFAULT_VIDEO_CALL_REMINDER_SMS);

  // Reminder settings
  const [reminder1HourEnabled, setReminder1HourEnabled] = useState(true);
  const [reminder15MinEnabled, setReminder15MinEnabled] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load template data on component mount
  useEffect(() => {
    loadTemplateData();
  }, [user, organization]);

  const loadTemplateData = async () => {
    try {
      // Load customer instructions template
      const response = await fetch('/api/templates/customer_instructions');
      if (response.ok) {
        const template = await response.json();
        setInstructions(template.content || getDefaultInstructions());
      } else {
        // No existing template, use defaults
        setInstructions(getDefaultInstructions());
      }

      // Load templates from organization settings if in an organization
      if (organization) {
        const orgResponse = await fetch('/api/organization-settings');
        if (orgResponse.ok) {
          const orgSettings = await orgResponse.json();
          setSmsTemplate(orgSettings.smsUploadLinkTemplate || DEFAULT_SMS_UPLOAD_TEMPLATE);

          // Video call templates
          setVideoCallInviteTemplate(orgSettings.videoCallInviteTemplate || DEFAULT_VIDEO_CALL_INVITE);
          setVideoCallConfirmationSms(orgSettings.videoCallConfirmationSmsTemplate || DEFAULT_VIDEO_CALL_CONFIRMATION_SMS);
          setVideoCallReminderSms(orgSettings.videoCallReminderSmsTemplate || DEFAULT_VIDEO_CALL_REMINDER_SMS);

          // Reminder settings
          setReminder1HourEnabled(orgSettings.videoCallReminder1HourEnabled ?? true);
          setReminder15MinEnabled(orgSettings.videoCallReminder15MinEnabled ?? true);
        }
      }
    } catch (error) {
      console.error('Error loading template:', error);
      // Use defaults on error
      setInstructions(getDefaultInstructions());
      setSmsTemplate(DEFAULT_SMS_UPLOAD_TEMPLATE);
    } finally {
      setLoading(false);
    }
  };

  const getDefaultInstructions = () => {
    const companyName = getCompanyName();
    return DEFAULT_INSTRUCTIONS.replace('{companyName}', companyName);
  };

  const getCompanyName = () => {
    if (organization) {
      return organization.name || 'Your Company';
    }
    return user?.fullName || user?.firstName || 'Your Company';
  };

  const saveTemplates = async () => {
    console.log('Saving templates');
    setSaving(true);
    try {
      // Save customer instructions
      const response = await fetch('/api/templates/customer_instructions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: instructions,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('API Error:', errorData);
        throw new Error(`Failed to save customer instructions: ${response.status}`);
      }

      // Save all templates to organization settings if in organization
      if (organization) {
        const orgResponse = await fetch('/api/organization-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            smsUploadLinkTemplate: smsTemplate,
            videoCallInviteTemplate: videoCallInviteTemplate,
            videoCallConfirmationSmsTemplate: videoCallConfirmationSms,
            videoCallReminderSmsTemplate: videoCallReminderSms,
            videoCallReminder1HourEnabled: reminder1HourEnabled,
            videoCallReminder15MinEnabled: reminder15MinEnabled,
          }),
        });

        if (!orgResponse.ok) {
          const errorData = await orgResponse.json();
          throw new Error(errorData.error || `Failed to save templates: ${orgResponse.status}`);
        }
      }

      setHasChanges(false);
      toast.success('Templates saved successfully!');
    } catch (error) {
      console.error('Error saving templates:', error);
      toast.error(`Failed to save templates. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const resetInstructionsToDefault = () => {
    setInstructions(getDefaultInstructions());
    setHasChanges(true);
    toast.info('Reset to default instructions');
  };

  const resetSmsToDefault = () => {
    setSmsTemplate(DEFAULT_SMS_UPLOAD_TEMPLATE);
    setHasChanges(true);
    toast.info('Reset to default SMS template');
  };

  const resetVideoCallInviteToDefault = () => {
    setVideoCallInviteTemplate(DEFAULT_VIDEO_CALL_INVITE);
    setHasChanges(true);
    toast.info('Reset to default');
  };

  const resetVideoCallConfirmationToDefault = () => {
    setVideoCallConfirmationSms(DEFAULT_VIDEO_CALL_CONFIRMATION_SMS);
    setHasChanges(true);
    toast.info('Reset to default');
  };

  const resetVideoCallReminderToDefault = () => {
    setVideoCallReminderSms(DEFAULT_VIDEO_CALL_REMINDER_SMS);
    setHasChanges(true);
    toast.info('Reset to default');
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
            <h1 className="text-2xl font-bold">Templates</h1>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="text-gray-500">Loading template...</div>
          </div>
        ) : (
          <div className="max-w-2xl">
            <div className="space-y-6">
              {/* Organization/User Info */}
              {organization && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-900 mb-1">Organization Templates</h3>
                  <p className="text-sm text-blue-700">
                    These templates will apply to all projects for <strong>{organization.name}</strong>.
                  </p>
                </div>
              )}

              {/* Customer Instructions Template */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-gray-600" />
                    <h2 className="text-lg font-medium">Customer Upload Instructions</h2>
                  </div>
                  <Button
                    onClick={resetInstructionsToDefault}
                    variant="outline"
                    size="sm"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset to Default
                  </Button>
                </div>
                <Textarea
                  value={instructions}
                  onChange={(e) => {
                    setInstructions(e.target.value);
                    setHasChanges(true);
                  }}
                  className="w-full min-h-[200px] font-mono text-sm"
                  placeholder="Enter customer instructions..."
                />
                <div className="mt-2 text-xs text-gray-500">
                  <p className="font-medium mb-1">Available variable:</p>
                  <code className="bg-gray-100 px-2 py-1 rounded">{'{companyName}'}</code>
                </div>
              </div>

              {/* SMS Template - Only for Organizations */}
              {organization && (
                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-gray-600" />
                      <h2 className="text-lg font-medium">Send Customer Upload Link</h2>
                    </div>
                    {smsTemplate !== DEFAULT_SMS_UPLOAD_TEMPLATE && (
                      <Button
                        onClick={resetSmsToDefault}
                        variant="outline"
                        size="sm"
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Reset to Default
                      </Button>
                    )}
                  </div>
                  <Textarea
                    value={smsTemplate}
                    onChange={(e) => {
                      setSmsTemplate(e.target.value);
                      setHasChanges(true);
                    }}
                    rows={6}
                    className="w-full font-mono text-sm"
                    placeholder="Enter SMS template..."
                  />
                  <div className="mt-2 text-xs text-gray-500">
                    <p className="font-medium mb-1">Available variables:</p>
                    <div className="flex flex-wrap gap-2">
                      <code className="bg-gray-100 px-2 py-1 rounded">{'{customerName}'}</code>
                      <code className="bg-gray-100 px-2 py-1 rounded">{'{uploadUrl}'}</code>
                      <code className="bg-gray-100 px-2 py-1 rounded">{'{companyName}'}</code>
                    </div>
                  </div>
                </div>
              )}

              {/* Video Call Templates Section */}
              {organization && (
                <>
                  <div className="border-t pt-6 mt-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Video className="h-5 w-5 text-blue-600" />
                      <h2 className="text-lg font-semibold">Scheduled Video Call Templates</h2>
                    </div>
                  </div>

                  {/* Calendar Invite Template */}
                  <div className="bg-white rounded-lg shadow-sm border p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-medium">Calendar Event Description</h3>
                        <p className="text-sm text-gray-500">Used in Google Calendar invites</p>
                      </div>
                      {videoCallInviteTemplate !== DEFAULT_VIDEO_CALL_INVITE && (
                        <Button
                          onClick={resetVideoCallInviteToDefault}
                          variant="outline"
                          size="sm"
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Reset
                        </Button>
                      )}
                    </div>
                    <Textarea
                      value={videoCallInviteTemplate}
                      onChange={(e) => {
                        setVideoCallInviteTemplate(e.target.value);
                        setHasChanges(true);
                      }}
                      rows={8}
                      className="w-full font-mono text-sm"
                      placeholder="Enter calendar invite template..."
                    />
                    <div className="mt-2 text-xs text-gray-500">
                      <p className="font-medium mb-1">Available variables:</p>
                      <div className="flex flex-wrap gap-2">
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{videoCallLink}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{agentName}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{companyName}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{projectName}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{customerName}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{scheduledDate}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{scheduledTime}'}</code>
                      </div>
                    </div>
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-600">
                        <strong>Note:</strong> The calendar event title will be: <code className="bg-gray-200 px-1 rounded">{'{companyName}'} &lt;&gt; {'{projectName}'}</code>
                      </p>
                    </div>
                  </div>

                  {/* Confirmation SMS Template */}
                  <div className="bg-white rounded-lg shadow-sm border p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-medium">Confirmation SMS</h3>
                        <p className="text-sm text-gray-500">Sent when a video call is scheduled</p>
                      </div>
                      {videoCallConfirmationSms !== DEFAULT_VIDEO_CALL_CONFIRMATION_SMS && (
                        <Button
                          onClick={resetVideoCallConfirmationToDefault}
                          variant="outline"
                          size="sm"
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Reset
                        </Button>
                      )}
                    </div>
                    <Textarea
                      value={videoCallConfirmationSms}
                      onChange={(e) => {
                        setVideoCallConfirmationSms(e.target.value);
                        setHasChanges(true);
                      }}
                      rows={4}
                      className="w-full font-mono text-sm"
                      placeholder="Enter confirmation SMS template..."
                    />
                    <div className="mt-2 text-xs text-gray-500">
                      <p className="font-medium mb-1">Available variables:</p>
                      <div className="flex flex-wrap gap-2">
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{customerName}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{companyName}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{scheduledDate}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{scheduledTime}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{videoCallLink}'}</code>
                      </div>
                    </div>
                  </div>

                  {/* Reminder SMS Template */}
                  <div className="bg-white rounded-lg shadow-sm border p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-medium">Reminder SMS</h3>
                        <p className="text-sm text-gray-500">Sent before scheduled video calls</p>
                      </div>
                      {videoCallReminderSms !== DEFAULT_VIDEO_CALL_REMINDER_SMS && (
                        <Button
                          onClick={resetVideoCallReminderToDefault}
                          variant="outline"
                          size="sm"
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Reset
                        </Button>
                      )}
                    </div>
                    <Textarea
                      value={videoCallReminderSms}
                      onChange={(e) => {
                        setVideoCallReminderSms(e.target.value);
                        setHasChanges(true);
                      }}
                      rows={4}
                      className="w-full font-mono text-sm"
                      placeholder="Enter reminder SMS template..."
                    />
                    <div className="mt-2 text-xs text-gray-500">
                      <p className="font-medium mb-1">Available variables:</p>
                      <div className="flex flex-wrap gap-2">
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{customerName}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{companyName}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{timeUntil}'}</code>
                        <code className="bg-gray-100 px-2 py-1 rounded">{'{videoCallLink}'}</code>
                      </div>
                    </div>
                  </div>

                  {/* Reminder Settings */}
                  <div className="bg-white rounded-lg shadow-sm border p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Bell className="h-5 w-5 text-gray-600" />
                      <h3 className="font-medium">Reminder Settings</h3>
                    </div>
                    <p className="text-sm text-gray-500 mb-4">
                      Choose when to send SMS reminders before scheduled video calls
                    </p>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={reminder1HourEnabled}
                          onChange={(e) => {
                            setReminder1HourEnabled(e.target.checked);
                            setHasChanges(true);
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm">Send reminder 1 hour before</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={reminder15MinEnabled}
                          onChange={(e) => {
                            setReminder15MinEnabled(e.target.checked);
                            setHasChanges(true);
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm">Send reminder 15 minutes before</span>
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* Save Button */}
              <Button
                onClick={saveTemplates}
                disabled={saving || !hasChanges}
                className="w-full"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : hasChanges ? 'Save Templates' : 'No Changes to Save'}
              </Button>

              {hasChanges && (
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
