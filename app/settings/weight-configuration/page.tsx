'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Scale } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

type WeightMode = 'actual' | 'custom';

export default function WeightConfigurationPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [weightMode, setWeightMode] = useState<WeightMode>('actual');
  const [customWeightMultiplier, setCustomWeightMultiplier] = useState(7);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      loadWeightConfiguration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, organization, hasUnsavedChanges]);

  const loadWeightConfiguration = async () => {
    try {
      const response = await fetch('/api/settings/weight-configuration');
      if (response.ok) {
        const config = await response.json();
        setWeightMode(config.weightMode || 'actual');
        setCustomWeightMultiplier(config.customWeightMultiplier ?? 7);
      } else if (response.status === 403) {
        setLoading(false);
        return;
      } else {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weightMode, customWeightMultiplier })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save: ${response.status}`);
      }

      setHasUnsavedChanges(false);
      toast.success('Weight configuration saved.');
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

  return (
    <SettingsPageShell
      title="Weight Configuration"
      subtitle="Controls how the AI calculates item weights on every estimate."
      icon={Scale}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
      unsavedChanges={hasUnsavedChanges}
      saving={saving}
      onSave={saveWeightConfiguration}
      onDiscard={() => {
        setHasUnsavedChanges(false);
        loadWeightConfiguration();
      }}
    >
      <div className="space-y-6">
        {/* Mode */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <h2 className="text-lg font-medium mb-4">Weight Mode</h2>

          <label className="block text-sm font-medium mb-2">Select Weight Mode</label>
          <select
            value={weightMode}
            onChange={handleWeightModeChange}
            className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="actual">Actual Weight</option>
            <option value="custom">Custom Weight</option>
          </select>

          <div className="bg-gray-50 rounded-lg p-4 mt-4">
            {weightMode === 'actual' ? (
              <p className="text-sm text-gray-700">
                <strong>Actual Weight:</strong> Our most accurate weight, derived per-item by the AI.
              </p>
            ) : (
              <p className="text-sm text-gray-700">
                <strong>Custom Weight:</strong> Use a custom multiplier to integrate with weight-based estimating systems.
              </p>
            )}
          </div>
        </div>

        {/* Multiplier (only when custom) */}
        {weightMode === 'custom' && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-lg font-medium">Weight Multiplier</h2>
              <div className="text-right">
                <span className="text-2xl font-bold text-blue-600">{customWeightMultiplier}</span>
              </div>
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
        )}
      </div>
    </SettingsPageShell>
  );
}
