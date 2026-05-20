'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Package } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Level 2 ("Balanced") matches the current Railway box-recommendation prompt;
// orgs that never touch the slider keep producing today's output.
const DEFAULT_LEVEL = 2;
const DEFAULT_ENABLED = true;

// Each step maps 1:1 to a hidden prompt template consumed by the
// box-recommendation step of the Railway processors. The customer-facing
// copy here describes the resulting estimate behavior — the prompts
// themselves are intentionally not surfaced.
//
// "Light" (was leftmost) and "Generous" (was rightmost) variants are
// commented out below. To re-enable, slot them back in at new positions,
// renumber the keys, widen SELECTABLE_LEVELS, and widen the schema/API
// min/max from 1..3 back out.
const LEVEL_LABELS: Record<number, { name: string; description: string }> = {
  // Light — 'Fewest boxes. Lowest total packing cuft on the estimate — suits crews that prefer to add boxes on move day if needed.'
  1: {
    name: 'Competitive',
    description: 'Lean estimate. Slightly fewer boxes than the inventory implies — useful for staying price-competitive against quotes from other movers.'
  },
  2: {
    name: 'Balanced',
    description: 'Default. Recommends boxes that match the inventory without padding the estimate.'
  },
  3: {
    name: 'Padded',
    description: 'Slight overestimate. Adds a small buffer of boxes on top of the inventory so the crew rarely runs short.'
  }
  // Generous — 'Highest box count. Maximum packing coverage — recommends boxes liberally on top of the inventory.'
};

const SELECTABLE_LEVELS = [1, 2, 3] as const;
const MIN_SELECTABLE = SELECTABLE_LEVELS[0];
const MAX_SELECTABLE = SELECTABLE_LEVELS[SELECTABLE_LEVELS.length - 1];

export default function BoxRecommendationsSettingsPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [enabled, setEnabled] = useState<boolean>(DEFAULT_ENABLED);
  const [level, setLevel] = useState<number>(DEFAULT_LEVEL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      loadSettings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, organization, hasUnsavedChanges]);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings/box-recommendations');
      if (response.ok) {
        const config = await response.json();
        setEnabled(config.boxRecommendationsEnabled ?? DEFAULT_ENABLED);
        setLevel(config.boxRecommendationLevel ?? DEFAULT_LEVEL);
      } else if (response.status === 403) {
        setLoading(false);
        return;
      } else {
        setEnabled(DEFAULT_ENABLED);
        setLevel(DEFAULT_LEVEL);
      }
    } catch (error) {
      console.error('Error loading box recommendation settings:', error);
      setEnabled(DEFAULT_ENABLED);
      setLevel(DEFAULT_LEVEL);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/box-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxRecommendationsEnabled: enabled, boxRecommendationLevel: level })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save: ${response.status}`);
      }

      setHasUnsavedChanges(false);
      toast.success('Box recommendation settings saved.');
    } catch (error) {
      console.error('Error saving box recommendation settings:', error);
      toast.error(`Failed to save. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSliderChange = (value: number[]) => {
    setLevel(value[0]);
    setHasUnsavedChanges(true);
  };

  const handleEnabledChange = (next: boolean) => {
    setEnabled(next);
    setHasUnsavedChanges(true);
  };

  const current = LEVEL_LABELS[level] ?? LEVEL_LABELS[DEFAULT_LEVEL];
  const displayPosition = SELECTABLE_LEVELS.indexOf(level as 1 | 2 | 3) + 1;
  const displayTotal = SELECTABLE_LEVELS.length;

  return (
    <SettingsPageShell
      title="Box Recommendations"
      subtitle="How aggressively the AI recommends packing boxes on every estimate."
      icon={Package}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={loading}
      unsavedChanges={hasUnsavedChanges}
      saving={saving}
      onSave={saveSettings}
      onDiscard={() => {
        setHasUnsavedChanges(false);
        loadSettings();
      }}
    >
      <div className="space-y-6">
        {/* Master enable/disable */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-lg font-medium">Enable Box Recommendations</h2>
              <p className="text-sm text-gray-500 mt-1">
                When off, estimates won&apos;t include any packing-box recommendations. The AI will still capture furniture and existing packed boxes.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => handleEnabledChange(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>

        {/* Level — disabled when the master switch is off */}
        <div
          className={cn(
            'rounded-xl border border-gray-200 bg-white shadow-sm p-6 transition-opacity',
            !enabled && 'opacity-50 pointer-events-none select-none'
          )}
          aria-disabled={!enabled}
        >
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="text-lg font-medium">Recommendation Level</h2>
            <div className="text-right">
              <span className="text-2xl font-bold text-blue-600">{displayPosition > 0 ? displayPosition : '–'}</span>
              <span className="text-sm text-gray-500"> / {displayTotal}</span>
            </div>
          </div>
          <p className="text-sm text-gray-500 mb-6">
            Lower values bias the AI toward fewer boxes and a lighter packing estimate. Higher values bias it toward more boxes and heavier coverage.
          </p>

          <Slider
            value={[level]}
            onValueChange={handleSliderChange}
            min={MIN_SELECTABLE}
            max={MAX_SELECTABLE}
            step={1}
            className="w-full"
            disabled={!enabled}
          />

          <div className="flex justify-between text-xs text-gray-500 mt-2 px-0.5">
            <span>Fewer</span>
            <span>More</span>
          </div>

          <div
            className="grid gap-1 mt-3 text-center"
            style={{ gridTemplateColumns: `repeat(${SELECTABLE_LEVELS.length}, minmax(0, 1fr))` }}
          >
            {SELECTABLE_LEVELS.map((n) => (
              <button
                type="button"
                key={n}
                onClick={() => handleSliderChange([n])}
                disabled={!enabled}
                className={
                  'text-[11px] font-medium px-1 py-1 rounded transition-colors disabled:cursor-not-allowed ' +
                  (n === level ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50')
                }
              >
                {LEVEL_LABELS[n].name}
              </button>
            ))}
          </div>

          <div className="bg-gray-50 rounded-lg p-4 mt-6">
            <p className="text-sm font-medium text-gray-900 mb-1">{current.name}</p>
            <p className="text-sm text-gray-700">{current.description}</p>
          </div>
        </div>
      </div>
    </SettingsPageShell>
  );
}
