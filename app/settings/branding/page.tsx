'use client';

import { useState, useRef, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { Palette, Upload, Save, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
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

  // Load branding data on component mount - but don't reload if user has unsaved changes
  useEffect(() => {
    if (!hasUnsavedChanges) {
      loadBrandingData();
    }
  }, [user, organization, hasUnsavedChanges]);

  const loadBrandingData = async () => {
    try {
      const response = await fetch('/api/branding');
      if (response.ok) {
        const branding = await response.json();
        setCompanyName(branding.companyName || getDefaultCompanyName());
        setLogo(branding.companyLogo || null); // Use saved logo or null, don't fall back to defaults
      } else {
        // No existing branding, use defaults
        setCompanyName(getDefaultCompanyName());
        setLogo(null); // Start with no logo
      }
    } catch (error) {
      console.error('Error loading branding:', error);
      // Use defaults on error
      setCompanyName(getDefaultCompanyName());
      setLogo(null); // Start with no logo on error
    } finally {
      setLoading(false);
    }
  };

  const getDefaultCompanyName = () => {
    if (organization) {
      return organization.name || 'Your Company';
    }
    return user?.fullName || user?.firstName || 'Your Company';
  };


  const saveBranding = async () => {
    console.log('💾 Saving branding:', { companyName, hasLogo: !!logo });
    setSaving(true);
    try {
      const response = await fetch('/api/branding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyName,
          companyLogo: logo,
        }),
      });
      
      console.log('📡 Response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.text();
        console.error('❌ API Error:', errorData);
        throw new Error(`Failed to save branding: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('✅ Save successful:', result);
      setHasUnsavedChanges(false);
      toast.success('Branding settings saved successfully!');
    } catch (error) {
      console.error('❌ Error saving branding:', error);
      toast.error(`Failed to save branding settings. ${error instanceof Error ? error.message : 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    console.log('📁 File selected:', file?.name, file?.size, file?.type);
    if (file) {
      // Validate file size (2MB limit)
      if (file.size > 2 * 1024 * 1024) {
        toast.error('File size must be less than 2MB');
        return;
      }
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast.error('Please select a valid image file');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        console.log('🖼️ Logo uploaded, size:', result?.length);
        setLogo(result);
        setHasUnsavedChanges(true);
        toast.success('Logo uploaded successfully!');
      };
      reader.onerror = () => {
        console.error('❌ Error reading file');
        toast.error('Error reading file');
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="h-16"></div>
      <div className="container mx-auto p-4 max-w-4xl lg:pl-64">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            {/* <Palette className="h-6 w-6" /> */}
            <h1 className="text-2xl font-bold">Branding</h1>
          </div>
        </div>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="text-gray-500">Loading branding settings...</div>
          </div>
        ) : (
          <div className="max-w-2xl">
            <div className="space-y-6">
              {/* Organization/User Info */}
              {organization && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-900 mb-1">Organization Settings</h3>
                  <p className="text-sm text-blue-700">
                    These branding settings will apply to all members of <strong>{organization.name}</strong>.
                  </p>
                </div>
              )}
              
              {/* Company Information */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="text-lg font-medium mb-4">Company Information</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Company Name</label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter your company name"
                    />
                  </div>
                </div>
              </div>

              {/* Logo Upload */}
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="text-lg font-medium mb-4">Company Logo</h2>
                
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    {logo ? (
                      <div className="w-20 h-20 border rounded-lg overflow-hidden bg-gray-50">
                        <img src={logo} alt="Company Logo" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50">
                        <Image className="h-8 w-8 text-gray-400" />
                      </div>
                    )}
                    <div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => fileInputRef.current?.click()}
                          variant="outline"
                        >
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
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Save Button */}
              <Button 
                onClick={saveBranding}
                disabled={saving}
                className="w-full"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : hasUnsavedChanges ? 'Save Changes' : 'Save Branding Settings'}
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