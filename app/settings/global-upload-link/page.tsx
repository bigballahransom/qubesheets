'use client';

import { useState } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { Link2, Copy, ExternalLink, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import { toast } from 'sonner';

export default function GlobalUploadLinkPage() {
  const { organization, isLoaded } = useOrganization();
  const [copied, setCopied] = useState(false);

  const getBaseUrl = () => {
    if (typeof window !== 'undefined') return window.location.origin;
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  };

  const uploadLink = organization?.id ? `${getBaseUrl()}/upload/${organization.id}` : null;

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

  return (
    <SettingsPageShell
      title="Global Self-Survey Link"
      subtitle="Share a single link with customers — they enter their info, photograph their belongings, and a new project lands in your inbox."
      icon={Link2}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={!isLoaded}
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Link2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-medium">Your Upload Link</h2>
              <p className="text-sm text-gray-500">Share this link with your customers</p>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <code className="text-sm text-gray-800 break-all">{uploadLink}</code>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={copyToClipboard} className="flex-1 sm:flex-none">
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
            <Button onClick={openInNewTab} variant="outline" className="flex-1 sm:flex-none">
              <ExternalLink className="mr-2 h-4 w-4" />
              Preview Link
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <h2 className="text-lg font-medium mb-4">How It Works</h2>
          <div className="space-y-4">
            {[
              { step: 1, title: 'Customer Enters Info', desc: 'Customer visits the link and enters their name and phone number.' },
              { step: 2, title: 'Project Created Automatically', desc: "A new project is created in your account with the customer's information." },
              { step: 3, title: 'Customer Uploads Photos', desc: 'Customer uploads photos of their belongings using the same upload interface.' },
              { step: 4, title: 'AI Analyzes Inventory', desc: 'Our AI automatically identifies and catalogs all items in the photos.' }
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex items-start gap-4">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-medium text-sm">{step}</span>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-600">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="font-medium text-gray-900 mb-2">Tips</h3>
          <ul className="text-sm text-gray-600 space-y-1">
            <li>• Add this link to your website for easy customer access</li>
            <li>• Share via text message, email, or QR code</li>
            <li>• New projects will appear in your &quot;Unassigned&quot; filter</li>
          </ul>
        </div>
      </div>
    </SettingsPageShell>
  );
}
