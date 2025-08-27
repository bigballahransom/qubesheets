'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Save, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { toast } from 'sonner';

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load template data on component mount
  useEffect(() => {
    loadTemplateData();
  }, [user, organization]);

  const loadTemplateData = async () => {
    try {
      const response = await fetch('/api/templates/customer_instructions');
      if (response.ok) {
        const template = await response.json();
        setInstructions(template.content || getDefaultInstructions());
      } else {
        // No existing template, use defaults
        setInstructions(getDefaultInstructions());
      }
    } catch (error) {
      console.error('Error loading template:', error);
      // Use defaults on error
      setInstructions(getDefaultInstructions());
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

  const saveTemplate = async () => {
    console.log('💾 Saving template:', { length: instructions.length });
    setSaving(true);
    try {
      const response = await fetch('/api/templates/customer_instructions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: instructions,
        }),
      });
      
      console.log('📡 Response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error('❌ API Error:', errorData);
        throw new Error(`Failed to save template: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('✅ Save successful:', result);
      toast.success('Customer instructions saved successfully!');
    } catch (error) {
      console.error('❌ Error saving template:', error);
      toast.error(`Failed to save template. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    setInstructions(getDefaultInstructions());
    toast.info('Reset to default instructions');
  };


  return (
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
                  <h3 className="font-medium text-blue-900 mb-1">Organization Template</h3>
                  <p className="text-sm text-blue-700">
                    This template will apply to all customer upload pages for <strong>{organization.name}</strong>.
                  </p>
                </div>
              )}
              
              {/* Template Editor */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-medium">Edit Instructions</h2>
                  <Button
                    onClick={resetToDefault}
                    variant="outline"
                    size="sm"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset to Default
                  </Button>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Customer Instructions Template
                    </label>
                    <Textarea
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="Enter your custom upload instructions..."
                      className="min-h-[300px] font-mono text-sm"
                      disabled={saving}
                    />
                  </div>
                  
                </div>

                {/* Save Button */}
                <div className="mt-6">
                  <Button 
                    onClick={saveTemplate}
                    disabled={saving}
                    className="w-full"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Instructions Template'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <SidebarTrigger />
    </SidebarProvider>
  );
}