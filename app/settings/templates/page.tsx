'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Save, RotateCcw, FileText, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { toast } from 'sonner';
import { DEFAULT_SMS_UPLOAD_TEMPLATE } from '@/lib/sms-template-helpers';
import IntercomChat from '@/components/IntercomChat';

const DEFAULT_INSTRUCTIONS = `📸 Upload Tips from {companyName}

• Take clear, well-lit photos of your items
• Include multiple angles for large furniture  
• Group similar items together when possible
• Add descriptions to help with identification
• Upload as many photos as needed`;

export default function TemplatesPage() {
  const { user } = useUser();
  const { organization } = useOrganization();
  
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [smsTemplate, setSmsTemplate] = useState(DEFAULT_SMS_UPLOAD_TEMPLATE);
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
      
      // Load SMS template from organization settings if in an organization
      if (organization) {
        const orgResponse = await fetch('/api/organization-settings');
        if (orgResponse.ok) {
          const orgSettings = await orgResponse.json();
          setSmsTemplate(orgSettings.smsUploadLinkTemplate || DEFAULT_SMS_UPLOAD_TEMPLATE);
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
    console.log('💾 Saving templates');
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
        console.error('❌ API Error:', errorData);
        throw new Error(`Failed to save customer instructions: ${response.status}`);
      }
      
      // Save SMS template if in organization
      if (organization) {
        const orgResponse = await fetch('/api/organization-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            smsUploadLinkTemplate: smsTemplate,
          }),
        });
        
        if (!orgResponse.ok) {
          const errorData = await orgResponse.json();
          throw new Error(errorData.error || `Failed to save SMS template: ${orgResponse.status}`);
        }
      }
      
      setHasChanges(false);
      toast.success('Templates saved successfully!');
    } catch (error) {
      console.error('❌ Error saving templates:', error);
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


  return (
    <>
      <SidebarProvider>
      <AppSidebar />
      <div className="h-16"></div>
      <div className="container mx-auto p-4 max-w-4xl lg:pl-64">
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