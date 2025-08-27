'use client';

import { useState, useRef } from 'react';
import { Palette, Upload, Save, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export default function BrandingPage() {
  const [companyName, setCompanyName] = useState('Your Moving Company');
  const [primaryColor, setPrimaryColor] = useState('#3B82F6');
  const [secondaryColor, setSecondaryColor] = useState('#1E40AF');
  const [logo, setLogo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogo(e.target?.result as string);
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
            <Palette className="h-6 w-6 text-blue-600" />
            <h1 className="text-2xl font-bold">Branding</h1>
          </div>
        </div>
        
        <div className="max-w-2xl">
          <div className="space-y-6">
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
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="outline"
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Logo
                    </Button>
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

            {/* Color Scheme */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-lg font-medium mb-4">Color Scheme</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Primary Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-12 h-10 border rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="#3B82F6"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">Secondary Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="w-12 h-10 border rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="#1E40AF"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <Button className="w-full bg-blue-600 hover:bg-blue-700">
              <Save className="mr-2 h-4 w-4" />
              Save Branding Settings
            </Button>
          </div>
        </div>
      </div>
      <SidebarTrigger />
    </SidebarProvider>
  );
}