'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Scale, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import { toast } from 'sonner';
import IntercomChat from '@/components/IntercomChat';

type WeightMode = 'actual' | 'custom';

export default function WeightConfigurationPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [weightMode, setWeightMode] = useState<WeightMode>('actual');
  const [customWeightMultiplier, setCustomWeightMultiplier] = useState(7);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load weight configuration on component mount
  useEffect(() => {
    if (!hasUnsavedChanges) {
      loadWeightConfiguration();
    }
  }, [user, organization, hasUnsavedChanges]);

  const loadWeightConfiguration = async () => {
    try {
      const response = await fetch('/api/settings/weight-configuration');
      if (response.ok) {
        const config = await response.json();
        setWeightMode(config.weightMode || 'actual');
        setCustomWeightMultiplier(config.customWeightMultiplier ?? 7);
      } else if (response.status === 403) {
        // Personal account - show message
        setLoading(false);
        return;
      } else {
        // Use defaults on error
        setWeightMode('actual');
        setCustomWeightMultiplier(7);
      }
    } catch (error) {
      console.error('Error loading weight configuration:', error);
      setWeightMode('actual');
      setCustomWeightMultiplier(7);
    } finally {
      setLoading(false);
    }
  };

  const saveWeightConfiguration = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/weight-configuration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          weightMode,
          customWeightMultiplier,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save: ${response.status}`);
      }

      setHasUnsavedChanges(false);
      toast.success('Weight configuration saved successfully!');
    } catch (error) {
      console.error('Error saving weight configuration:', error);
      toast.error(`Failed to save weight configuration. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleWeightModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setWeightMode(e.target.value as WeightMode);
    setHasUnsavedChanges(true);
  };

  const handleSliderChange = (value: number[]) => {
    setCustomWeightMultiplier(value[0]);
    setHasUnsavedChanges(true);
  };

  // Check if user is in a personal account (not an organization)
  const isPersonalAccount = !organization;

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
              <h1 className="text-2xl font-bold">Weight Configuration</h1>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="text-gray-500">Loading weight configuration...</div>
            </div>
          ) : isPersonalAccount ? (
            <div className="max-w-2xl">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-medium text-yellow-900 mb-1">Organization Required</h3>
                <p className="text-sm text-yellow-700">
                  Weight configuration is only available for organization accounts. Please switch to an organization to access this setting.
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl">
              <div className="space-y-6">
                {/* Organization Info */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-900 mb-1">Organization Settings</h3>
                  <p className="text-sm text-blue-700">
                    These weight settings will apply to all members of <strong>{organization.name}</strong>.
                  </p>
                </div>

                {/* Weight Mode Selection */}
                <div className="bg-white rounded-lg shadow-sm border p-6">
                  <h2 className="text-lg font-medium mb-4">Weight Mode</h2>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">Select Weight Mode</label>
                      <select
                        value={weightMode}
                        onChange={handleWeightModeChange}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                      >
                        <option value="actual">Actual Weight</option>
                        <option value="custom">Custom Weight</option>
                      </select>
                    </div>

                    {/* Description based on selection */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      {weightMode === 'actual' ? (
                        <p className="text-sm text-gray-700">
                          <strong>Actual Weight:</strong> Our most accurate weight with Weight being found by AI.
                        </p>
                      ) : (
                        <p className="text-sm text-gray-700">
                          <strong>Custom Weight:</strong> Select a custom weight multiplier to better integrate with weight based estimating systems.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Custom Weight Multiplier Slider - Only shown when custom is selected */}
                {weightMode === 'custom' && (
                  <div className="bg-white rounded-lg shadow-sm border p-6">
                    <h2 className="text-lg font-medium mb-4">Weight Multiplier</h2>

                    <div className="space-y-6">
                      <div>
                        <div className="flex justify-between items-center mb-4">
                          <label className="text-sm font-medium">Multiplier Value</label>
                          <span className="text-2xl font-bold text-blue-600">{customWeightMultiplier}</span>
                        </div>

                        <Slider
                          value={[customWeightMultiplier]}
                          onValueChange={handleSliderChange}
                          min={4}
                          max={8}
                          step={1}
                          className="w-full"
                        />

                        <div className="flex justify-between text-xs text-gray-500 mt-2">
                          <span>4</span>
                          <span>5</span>
                          <span>6</span>
                          <span>7</span>
                          <span>8</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Save Button */}
                <Button
                  onClick={saveWeightConfiguration}
                  disabled={saving}
                  className="w-full"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? 'Saving...' : hasUnsavedChanges ? 'Save Changes' : 'Save Weight Configuration'}
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
      <IntercomChat />
    </>
  );
}
