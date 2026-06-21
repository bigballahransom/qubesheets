'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Truck, FileText, Building2, Tags } from 'lucide-react';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

type PdfGroupBy = 'room' | 'tag';

interface ReviewFlags {
  customerReviewShowTruckSize: boolean;
}

const DEFAULT_FLAGS: ReviewFlags = {
  customerReviewShowTruckSize: true
};

const DEFAULT_PDF_GROUP_BY: PdfGroupBy = 'room';

type FlagKey = keyof ReviewFlags;

interface FlagDefinition {
  key: FlagKey;
  title: string;
  description: string;
  icon: typeof Truck;
}

const FLAG_DEFINITIONS: FlagDefinition[] = [
  {
    key: 'customerReviewShowTruckSize',
    title: 'Show Truck Size',
    description:
      'Display the recommended truck size card in the stat bar on the customer review page. When off, the stat bar shows Items, Boxes, and Weight only.',
    icon: Truck
  }
];

const PDF_GROUP_OPTIONS: Array<{
  value: PdfGroupBy;
  title: string;
  description: string;
  icon: typeof Truck;
}> = [
  {
    value: 'room',
    title: 'Group by Room',
    description:
      'Inventory is grouped under a banner per room (current default). Each room shows Items, Packed Boxes, and Recommended Boxes together.',
    icon: Building2
  },
  {
    value: 'tag',
    title: 'Group by Tag',
    description:
      'Inventory is grouped under a banner per Smart Tag, with a quantity / Cu.Ft / weight summary at the end of each tag. Items with multiple tags appear in each section; untagged items get their own "-" section.',
    icon: Tags
  }
];

export default function PdfsAndLinksSettingsPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [flags, setFlags] = useState<ReviewFlags>(DEFAULT_FLAGS);
  const [pdfGroupBy, setPdfGroupBy] = useState<PdfGroupBy>(DEFAULT_PDF_GROUP_BY);
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
      const response = await fetch('/api/settings/customer-review-link');
      if (response.ok) {
        const config = await response.json();
        setFlags({
          customerReviewShowTruckSize:
            config.customerReviewShowTruckSize ?? DEFAULT_FLAGS.customerReviewShowTruckSize
        });
        setPdfGroupBy(
          config.pdfGroupInventoryBy === 'tag' ? 'tag' : DEFAULT_PDF_GROUP_BY
        );
      } else if (response.status === 403) {
        setLoading(false);
        return;
      } else {
        setFlags(DEFAULT_FLAGS);
        setPdfGroupBy(DEFAULT_PDF_GROUP_BY);
      }
    } catch (error) {
      console.error('Error loading PDFs and Links settings:', error);
      setFlags(DEFAULT_FLAGS);
      setPdfGroupBy(DEFAULT_PDF_GROUP_BY);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/customer-review-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...flags,
          pdfGroupInventoryBy: pdfGroupBy
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to save: ${response.status}`);
      }

      setHasUnsavedChanges(false);
      toast.success('Settings saved.');
    } catch (error) {
      console.error('Error saving PDFs and Links settings:', error);
      toast.error(
        `Failed to save. ${error instanceof Error ? error.message : 'Please try again.'}`
      );
    } finally {
      setSaving(false);
    }
  };

  const handleFlagChange = (key: FlagKey, next: boolean) => {
    setFlags((prev) => ({ ...prev, [key]: next }));
    setHasUnsavedChanges(true);
  };

  const handlePdfGroupByChange = (next: PdfGroupBy) => {
    setPdfGroupBy(next);
    setHasUnsavedChanges(true);
  };

  return (
    <SettingsPageShell
      title="PDFs and Links"
      subtitle="Control how the project PDF is laid out and what appears on the customer-facing inventory review page."
      icon={FileText}
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
      <div className="space-y-8">
        <section>
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-gray-900">PDF Settings</h2>
            <p className="text-sm text-gray-500 mt-1">
              Control how the generated inventory PDF is organized.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
            <p className="text-sm font-medium text-gray-900 mb-3">Group inventory by</p>
            <div className="space-y-2">
              {PDF_GROUP_OPTIONS.map(({ value, title, description, icon: Icon }) => {
                const selected = pdfGroupBy === value;
                return (
                  <label
                    key={value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="pdfGroupInventoryBy"
                      value={value}
                      checked={selected}
                      onChange={() => handlePdfGroupByChange(value)}
                      className="mt-1"
                    />
                    <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900">{title}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Customer Review Link</h2>
            <p className="text-sm text-gray-500 mt-1">
              Control what appears on the customer-facing inventory review page (/inventory-review/[id]).
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
            {FLAG_DEFINITIONS.map(({ key, title, description, icon: Icon }) => (
              <div key={key} className="flex items-start justify-between gap-4 p-6">
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-medium text-gray-900">{title}</h3>
                    <p className="text-sm text-gray-500 mt-1">{description}</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                  <input
                    type="checkbox"
                    checked={flags[key]}
                    onChange={(e) => handleFlagChange(key, e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            ))}
          </div>
        </section>
      </div>
    </SettingsPageShell>
  );
}
