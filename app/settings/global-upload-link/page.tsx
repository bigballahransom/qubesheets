'use client';

import { useState, useEffect } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { Link2, Copy, ExternalLink, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DesktopHeaderBar } from "@/components/DesktopHeaderBar";
import { toast } from 'sonner';
import IntercomChat from '@/components/IntercomChat';

export default function GlobalUploadLinkPage() {
  const { organization, isLoaded } = useOrganization();
  const [copied, setCopied] = useState(false);

  const getBaseUrl = () => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  };

  const uploadLink = organization?.id
    ? `${getBaseUrl()}/upload/${organization.id}`
    : null;

  const copyToClipboard = async () => {
    if (!uploadLink) return;

    try {
      await navigator.clipboard.writeText(uploadLink);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      toast.error('Failed to copy link');
    }
  };

  const openInNewTab = () => {
    if (!uploadLink) return;
    window.open(uploadLink, '_blank');
  };

  if (!isLoaded) {
    return (
      <>
        <SidebarProvider>
          <AppSidebar />
          <DesktopHeaderBar />
          <div className="h-16"></div>
          <div className="container mx-auto p-4 max-w-4xl lg:pl-64 lg:pt-16">
            <div className="flex justify-center py-8">
              <div className="text-gray-500">Loading...</div>
            </div>
          </div>
          <SidebarTrigger />
        </SidebarProvider>
        <IntercomChat />
      </>
    );
  }

  if (!organization) {
    return (
      <>
        <SidebarProvider>
          <AppSidebar />
          <DesktopHeaderBar />
          <div className="h-16"></div>
          <div className="container mx-auto p-4 max-w-4xl lg:pl-64 lg:pt-16">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">Global Self-Survey Link</h1>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <h3 className="font-medium text-yellow-900 mb-2">Organization Required</h3>
              <p className="text-yellow-700">
                The Global Self-Survey Link feature is only available for organization accounts.
                Please create or join an organization to use this feature.
              </p>
            </div>
          </div>
          <SidebarTrigger />
        </SidebarProvider>
        <IntercomChat />
      </>
    );
  }

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
              <h1 className="text-2xl font-bold">Global Self-Survey Link</h1>
            </div>
          </div>

          <div className="max-w-2xl space-y-6">
            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-medium text-blue-900 mb-1">Share with Customers</h3>
              <p className="text-sm text-blue-700">
                This link allows customers to upload photos of their belongings directly.
                When they visit the link, they will enter their name and phone number,
                which creates a new project automatically.
              </p>
            </div>

            {/* Upload Link Card */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Link2 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-medium">Your Upload Link</h2>
                  <p className="text-sm text-gray-500">Share this link with your customers</p>
                </div>
              </div>

              {/* Link Display */}
              <div className="bg-gray-50 border rounded-lg p-4 mb-4">
                <code className="text-sm text-gray-800 break-all">
                  {uploadLink}
                </code>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={copyToClipboard}
                  variant="default"
                  className="flex-1 sm:flex-none"
                >
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy Link
                    </>
                  )}
                </Button>

                <Button
                  onClick={openInNewTab}
                  variant="outline"
                  className="flex-1 sm:flex-none"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Preview Link
                </Button>
              </div>
            </div>

            {/* How It Works */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-lg font-medium mb-4">How It Works</h2>

              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 font-medium text-sm">1</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">Customer Enters Info</h3>
                    <p className="text-sm text-gray-600">
                      Customer visits the link and enters their name and phone number.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 font-medium text-sm">2</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">Project Created Automatically</h3>
                    <p className="text-sm text-gray-600">
                      A new project is created in your account with the customer's information.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 font-medium text-sm">3</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">Customer Uploads Photos</h3>
                    <p className="text-sm text-gray-600">
                      Customer uploads photos of their belongings using the same upload interface.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 font-medium text-sm">4</span>
                  </div>
                  <div>
                    <h3 className="font-medium text-gray-900">AI Analyzes Inventory</h3>
                    <p className="text-sm text-gray-600">
                      Our AI automatically identifies and catalogs all items in the photos.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Tips */}
            <div className="bg-gray-50 rounded-lg border p-4">
              <h3 className="font-medium text-gray-900 mb-2">Tips</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Add this link to your website for easy customer access</li>
                <li>• Share via text message, email, or QR code</li>
                <li>• New projects will appear in your "Unassigned" filter</li>
              </ul>
            </div>
          </div>
        </div>
        <SidebarTrigger />
      </SidebarProvider>
      <IntercomChat />
    </>
  );
}
