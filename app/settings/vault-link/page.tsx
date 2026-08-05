'use client';

// Settings page for the org-wide Media Vault crew link — the one static QR
// movers and warehouse staff keep on their devices. Media captured through
// it is stored as reference only (never inventoried) and auto-files to the
// project matching the customer's phone number.
import { useState, useRef } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { Copy, ExternalLink, Check, Download } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { SettingsPageShell } from '@/components/SettingsPageShell';
import SafeIcon from '@/components/icons/SafeIcon';
import { toast } from 'sonner';

export default function VaultLinkSettingsPage() {
  const { organization, isLoaded } = useOrganization();
  const [copied, setCopied] = useState(false);
  const qrWrapperRef = useRef<HTMLDivElement>(null);

  const getBaseUrl = () => {
    if (typeof window !== 'undefined') return window.location.origin;
    return process.env.NEXT_PUBLIC_APP_URL || 'https://app.qubesheets.com';
  };

  const vaultLink = organization?.id ? `${getBaseUrl()}/vault/${organization.id}` : null;

  const copyToClipboard = async () => {
    if (!vaultLink) return;
    try {
      await navigator.clipboard.writeText(vaultLink);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
      toast.error('Failed to copy link');
    }
  };

  const openInNewTab = () => {
    if (!vaultLink) return;
    window.open(vaultLink, '_blank');
  };

  const downloadQr = () => {
    const canvas = qrWrapperRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'media-vault-crew-qr.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <SettingsPageShell
      title="Media Vault Crew Link"
      subtitle="One QR code for all crew and warehouse devices. Walk-in/walk-out videos, receiving, and damage documentation get stored on the right job — never inventoried."
      icon={SafeIcon}
      scope="organization"
      organizationName={organization?.name}
      requiresOrganization
      loading={!isLoaded}
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
              <SafeIcon size={20} className="text-slate-700" />
            </div>
            <div>
              <h2 className="text-lg font-medium">Your Crew Capture Link</h2>
              <p className="text-sm text-gray-500">Put the QR on crew phones, truck clipboards, and the warehouse wall</p>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
            <code className="text-sm text-gray-800 break-all">{vaultLink}</code>
          </div>

          {vaultLink && (
            <div className="flex flex-col items-center gap-3 bg-white border border-gray-200 rounded-lg p-4 mb-4">
              <div ref={qrWrapperRef}>
                <QRCodeCanvas value={vaultLink} size={192} marginSize={2} />
              </div>
              <Button onClick={downloadQr} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Download QR code
              </Button>
            </div>
          )}

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
              { step: 1, title: 'Crew Scans the QR', desc: 'No login and no seat needed — any phone with the QR can capture.' },
              { step: 2, title: 'They Enter the Customer Info', desc: "Customer name + phone from the job sheet. That's all the typing." },
              { step: 3, title: 'Media Files Itself', desc: "Phone match → the media lands in that job's Vault tab. No match → a new project is created and badged Unfiled so your admin can re-file it." },
              { step: 4, title: 'Stored, Not Inventoried', desc: 'Vault media never touches the inventory, totals, review links, or CRM sync. Run "Process inventory" on any vault video later if you want items from it.' }
            ].map(({ step, title, desc }) => (
              <div key={step} className="flex items-start gap-4">
                <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-slate-700 font-medium text-sm">{step}</span>
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
            <li>• For recurring accounts (designers, logistics), use the per-project vault QR instead — Project → Actions → Vault Capture Link / QR — so everything lands in one folder with zero typing</li>
            <li>• Walk-in / walk-out videos: have crews scan at arrival and after loading</li>
            <li>• Warehouse receiving: post the per-project QR at the receiving dock</li>
          </ul>
        </div>
      </div>
    </SettingsPageShell>
  );
}
