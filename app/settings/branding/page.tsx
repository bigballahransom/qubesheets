'use client';

import { useState, useRef, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Palette, Upload, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

export default function BrandingPage() {
  const { user } = useUser();
  const { organization } = useOrganization();

  const [companyName, setCompanyName] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      loadBrandingData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, organization, hasUnsavedChanges]);

  const loadBrandingData = async () => {
    try {
      const response = await fetch('/api/branding');
      if (response.ok) {
        const branding = await response.json();
        setCompanyName(branding.companyName || getDefaultCompanyName());
        setLogo(branding.companyLogo || null);
      } else {
        setCompanyName(getDefaultCompanyName());
        setLogo(null);
      }
    } catch (error) {
      console.error('Error loading branding:', error);
      setCompanyName(getDefaultCompanyName());
      setLogo(null);
    } finally {
      setLoading(false);
    }
  };

  const getDefaultCompanyName = () => {
    if (organization) return organization.name || 'Your Company';
    return user?.fullName || user?.firstName || 'Your Company';
  };

  const saveBranding = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/branding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, companyLogo: logo })
      });
      if (!response.ok) {
        const errorData = await response.text();
        console.error('❌ API Error:', errorData);
        throw new Error(`Failed to save branding: ${response.status}`);
      }
      setHasUnsavedChanges(false);
      toast.success('Branding saved.');
    } catch (error) {
      console.error('❌ Error saving branding:', error);
      toast.error(`Failed to save branding. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error('File size must be less than 2MB');
        return;
      }
      if (!file.type.startsWith('image/')) {
        toast.error('Please select a valid image file');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setLogo(result);
        setHasUnsavedChanges(true);
        toast.success('Logo uploaded.');
      };
      reader.onerror = () => {
        toast.error('Error reading file');
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <SettingsPageShell
      title="Branding"
      subtitle="Your company name and logo, used wherever the AI generates customer-facing output."
      icon={Palette}
      scope="organization"
      organizationName={organization?.name}
      loading={loading}
      unsavedChanges={hasUnsavedChanges}
      saving={saving}
      onSave={saveBranding}
      onDiscard={() => {
        setHasUnsavedChanges(false);
        loadBrandingData();
      }}
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <h2 className="text-lg font-medium mb-4">Company Information</h2>
          <label className="block text-sm font-medium mb-2">Company Name</label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => {
              setCompanyName(e.target.value);
              setHasUnsavedChanges(true);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter your company name"
          />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <h2 className="text-lg font-medium mb-4">Company Logo</h2>
          <div className="flex items-center gap-4">
            {logo ? (
              <div className="w-20 h-20 border rounded-lg overflow-hidden bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo} alt="Company Logo" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50">
                <ImageIcon className="h-8 w-8 text-gray-400" />
              </div>
            )}
            <div>
              <div className="flex gap-2">
                <Button onClick={() => fileInputRef.current?.click()} variant="outline">
                  <Upload className="mr-2 h-4 w-4" />
                  {logo ? 'Replace Logo' : 'Upload Logo'}
                </Button>
                {logo && (
                  <Button
                    onClick={() => {
                      setLogo(null);
                      setHasUnsavedChanges(true);
                    }}
                    variant="outline"
                    size="sm"
                  >
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">PNG, JPG up to 2MB</p>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
        </div>
      </div>
    </SettingsPageShell>
  );
}
