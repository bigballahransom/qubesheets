// components/modals/VaultLinkModal.tsx
// Media Vault capture link modal — a permanent, QR-able, no-login link for
// this project. Anyone with the link/QR (crew, warehouse staff) can add
// videos and photos that are stored for reference only, never inventoried.
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, Link, Copy, Loader2, Download } from 'lucide-react';
import SafeIcon from '@/components/icons/SafeIcon';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';

interface VaultLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export default function VaultLinkModal({
  isOpen,
  onClose,
  projectId,
  projectName,
}: VaultLinkModalProps) {
  const [generating, setGenerating] = useState(false);
  const [vaultUrl, setVaultUrl] = useState('');
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrWrapperRef = useRef<HTMLDivElement>(null);

  const checkExistingLink = useCallback(async () => {
    setLoadingExisting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/vault-link`);
      if (response.ok) {
        const data = await response.json();
        if (data.exists) {
          setVaultUrl(data.uploadUrl);
        }
      }
    } catch (error) {
      console.error('Error checking existing vault link:', error);
    } finally {
      setLoadingExisting(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen && projectId) {
      checkExistingLink();
    }
  }, [isOpen, projectId, checkExistingLink]);

  if (!isOpen) return null;

  const handleGenerateLink = async () => {
    setGenerating(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/vault-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create vault link');
      }

      const result = await response.json();
      setVaultUrl(result.uploadUrl);
      toast.success(result.created ? 'Vault capture link created!' : 'Vault capture link ready');
    } catch (error) {
      console.error('Error creating vault link:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create vault link');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!vaultUrl) return;
    try {
      await navigator.clipboard.writeText(vaultUrl);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleDownloadQr = () => {
    const canvas = qrWrapperRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    const cleanName = projectName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    link.download = `vault-qr-${cleanName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleClose = () => {
    setVaultUrl('');
    setCopied(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <SafeIcon className="text-slate-600" size={24} />
              Media Vault Link
            </h2>
            <button
              onClick={handleClose}
              className="p-1 hover:bg-gray-100 rounded-md cursor-pointer transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {loadingExisting ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
              <span className="ml-2 text-slate-600">Loading...</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <p className="text-sm text-slate-800">
                  <strong>Project:</strong> {projectName}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  Anyone with this link or QR code can add videos and photos to this
                  project&apos;s Media Vault — no login needed. Vault media is stored for
                  reference and is <strong>never inventoried</strong>.
                </p>
              </div>

              {vaultUrl ? (
                <>
                  {/* QR code */}
                  <div className="flex flex-col items-center gap-3 bg-white border border-slate-200 rounded-lg p-4">
                    <div ref={qrWrapperRef}>
                      <QRCodeCanvas value={vaultUrl} size={192} marginSize={2} />
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadQr}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Download QR code
                    </button>
                  </div>

                  {/* Link display */}
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700 flex items-center gap-1">
                        <Link className="w-4 h-4" />
                        Vault Capture Link
                      </p>
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-white border rounded hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3 h-3 text-green-500" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 break-all">{vaultUrl}</p>
                  </div>

                  <p className="text-xs text-slate-500">
                    This link is permanent — print the QR code and post it where crews or
                    warehouse staff capture media (walk-ins, walk-outs, receiving, damage
                    documentation).
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateLink}
                  disabled={generating}
                  className="w-full bg-slate-700 hover:bg-slate-800 disabled:bg-slate-400 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Link size={16} />
                      Create Vault Link
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
