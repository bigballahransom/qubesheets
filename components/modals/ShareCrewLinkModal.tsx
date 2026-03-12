// components/modals/ShareCrewLinkModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { X, Users, Check, Link, Copy, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface ShareCrewLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
}

export default function ShareCrewLinkModal({
  isOpen,
  onClose,
  projectId,
  projectName,
}: ShareCrewLinkModalProps) {
  const [generating, setGenerating] = useState(false);
  const [reviewUrl, setReviewUrl] = useState('');
  const [existingLink, setExistingLink] = useState<any>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check for existing link when modal opens
  useEffect(() => {
    if (isOpen && projectId) {
      checkExistingLink();
    }
  }, [isOpen, projectId]);

  const checkExistingLink = async () => {
    setLoadingExisting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/crew-review-link`);
      if (response.ok) {
        const data = await response.json();
        if (data.exists) {
          setExistingLink(data);
          setReviewUrl(data.reviewUrl);
        }
      }
    } catch (error) {
      console.error('Error checking existing link:', error);
    } finally {
      setLoadingExisting(false);
    }
  };

  if (!isOpen) return null;

  const handleGenerateLink = async () => {
    setGenerating(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/crew-review-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate crew link');
      }

      const result = await response.json();
      setReviewUrl(result.reviewUrl);
      setExistingLink(result);
      toast.success('Crew review link generated!');
    } catch (error) {
      console.error('Error generating crew link:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate crew link');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!reviewUrl) return;

    try {
      await navigator.clipboard.writeText(reviewUrl);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error('Failed to copy link');
    }
  };

  const handleClose = () => {
    setReviewUrl('');
    setExistingLink(null);
    setCopied(false);
    onClose();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Users className="text-indigo-500" size={24} />
              Share Crew Review Link
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
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              <span className="ml-2 text-slate-600">Loading...</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-indigo-50 p-4 rounded-lg mb-4">
                <p className="text-sm text-indigo-800">
                  <strong>Project:</strong> {projectName}
                </p>
                <p className="text-xs text-indigo-600 mt-1">
                  Share this link with crew members to view the full inventory
                </p>
              </div>

              {/* Existing link info */}
              {existingLink && (
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <p className="text-sm font-medium text-slate-700 mb-2">Active Link</p>
                  {existingLink.accessCount > 0 && (
                    <p className="text-xs text-slate-500">
                      Viewed {existingLink.accessCount} time{existingLink.accessCount !== 1 ? 's' : ''}
                      {existingLink.lastAccessedAt && (
                        <span> (last: {formatDate(existingLink.lastAccessedAt)})</span>
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* Link display */}
              {reviewUrl && (
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-slate-700 flex items-center gap-1">
                      <Link className="w-4 h-4" />
                      Crew Review Link
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-white border rounded hover:bg-slate-100 transition-colors"
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
                  <p className="text-xs text-slate-600 break-all">{reviewUrl}</p>
                </div>
              )}

              <div className="bg-amber-50 p-4 rounded-lg">
                <p className="text-sm text-amber-800 font-medium mb-2">
                  Crew members will see:
                </p>
                <ul className="text-xs text-amber-700 space-y-1">
                  <li>• Full inventory with all columns (location, item, qty, cuft, weight, going, PBO)</li>
                  <li>• Summary cards (items, boxes, volume, weight)</li>
                  <li>• All media (photos, videos, recordings)</li>
                  <li>• Project notes</li>
                </ul>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                {!reviewUrl ? (
                  <button
                    type="button"
                    onClick={handleGenerateLink}
                    disabled={generating}
                    className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Link size={16} />
                        Generate Crew Link
                      </>
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="w-full bg-indigo-500 hover:bg-indigo-600 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4" />
                          Link Copied!
                        </>
                      ) : (
                        <>
                          <Copy size={16} />
                          Copy Link
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerateLink}
                      disabled={generating}
                      className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      {generating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <RefreshCw size={14} />
                          Generate New Link
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
