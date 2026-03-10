// components/modals/ShareInventoryReviewLinkModal.tsx
'use client';

import { useState, useEffect } from 'react';
import { X, Send, Phone, User, ClipboardCheck, Check, AlertCircle, Link, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ShareInventoryReviewLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  customerName?: string;
  customerPhone?: string;
}

export default function ShareInventoryReviewLinkModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  customerName: initialCustomerName = '',
  customerPhone: initialCustomerPhone = ''
}: ShareInventoryReviewLinkModalProps) {
  const [customerName, setCustomerName] = useState(initialCustomerName);
  const [customerPhone, setCustomerPhone] = useState(initialCustomerPhone);
  const [phoneError, setPhoneError] = useState('');
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [reviewUrl, setReviewUrl] = useState('');
  const [existingLink, setExistingLink] = useState<any>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Phone formatting utilities - defined before useEffects that depend on them
  const formatPhoneNumber = (value: string, previousValue: string = ''): string => {
    const digits = value.replace(/\D/g, '');
    const prevDigits = previousValue.replace(/\D/g, '');
    const isDeleting = digits.length < prevDigits.length;
    const limitedDigits = digits.slice(0, 10);

    if (limitedDigits.length === 0) {
      return '';
    }

    if (isDeleting && limitedDigits.length <= 3) {
      return limitedDigits;
    }

    if (limitedDigits.length >= 7) {
      return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3, 6)}-${limitedDigits.slice(6)}`;
    } else if (limitedDigits.length >= 4) {
      return `(${limitedDigits.slice(0, 3)}) ${limitedDigits.slice(3)}`;
    } else if (limitedDigits.length >= 1) {
      return isDeleting ? limitedDigits : `(${limitedDigits}`;
    }

    return limitedDigits;
  };

  const formatPhoneForTwilio = (formattedPhone: string): string => {
    const digits = formattedPhone.replace(/\D/g, '');
    return digits.length === 10 ? `+1${digits}` : '';
  };

  const formatTwilioToDisplay = (twilioPhone: string): string => {
    if (twilioPhone && twilioPhone.startsWith('+1') && twilioPhone.length === 12) {
      const digits = twilioPhone.slice(2);
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return twilioPhone || '';
  };

  // Update state when initial props change
  useEffect(() => {
    setCustomerName(initialCustomerName);
    setCustomerPhone(formatTwilioToDisplay(initialCustomerPhone));
  }, [initialCustomerName, initialCustomerPhone]);

  // Check for existing link when modal opens
  useEffect(() => {
    if (isOpen && projectId) {
      checkExistingLink();
    }
  }, [isOpen, projectId]);

  const checkExistingLink = async () => {
    setLoadingExisting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/inventory-review-link`);
      if (response.ok) {
        const data = await response.json();
        if (data.exists) {
          setExistingLink(data);
          setReviewUrl(data.reviewUrl);
          if (data.customerName) {
            setCustomerName(data.customerName);
          }
          if (data.customerPhone) {
            setCustomerPhone(formatTwilioToDisplay(data.customerPhone));
          }
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
    if (!customerName.trim()) {
      toast.error('Please enter customer name');
      return;
    }

    setGenerating(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/inventory-review-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: customerPhone ? formatPhoneForTwilio(customerPhone) : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate review link');
      }

      const result = await response.json();
      setReviewUrl(result.reviewUrl);
      setExistingLink(result);
      toast.success('Review link generated successfully!');
    } catch (error) {
      console.error('Error generating review link:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate review link');
    } finally {
      setGenerating(false);
    }
  };

  const handleSendSMS = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerName.trim() || !customerPhone.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    setSending(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/send-inventory-review-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: formatPhoneForTwilio(customerPhone),
          reviewToken: existingLink?.reviewToken,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send review link');
      }

      const result = await response.json();
      setReviewUrl(result.reviewUrl);
      setSuccess(true);
      toast.success('Review link sent successfully!');
    } catch (error) {
      console.error('Error sending review link:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send review link');
    } finally {
      setSending(false);
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
    setCustomerName(initialCustomerName);
    setCustomerPhone(formatTwilioToDisplay(initialCustomerPhone));
    setPhoneError('');
    setSuccess(false);
    setReviewUrl('');
    setExistingLink(null);
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
              <ClipboardCheck className="text-blue-500" size={24} />
              Share Inventory Review Link
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
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="ml-2 text-slate-600">Loading...</span>
            </div>
          ) : success ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Link Sent Successfully!
                </h3>
                <p className="text-gray-600">
                  {customerName} will receive a text message with the review link.
                </p>
              </div>
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-blue-800 font-medium">Review URL:</p>
                <p className="text-xs text-blue-600 break-all mt-1">{reviewUrl}</p>
              </div>
              <button
                onClick={handleClose}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg cursor-pointer transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-blue-50 p-4 rounded-lg mb-4">
                <p className="text-sm text-blue-800">
                  <strong>Project:</strong> {projectName}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Customer will be able to review inventory and sign off
                </p>
              </div>

              {/* Existing link info */}
              {existingLink && existingLink.signature && (
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <p className="text-sm text-green-800 font-medium">
                    Already signed by {existingLink.signature.customerName}
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    Signed on {new Date(existingLink.signature.signedAt).toLocaleString()}
                  </p>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSendSMS} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <User className="inline w-4 h-4 mr-1" />
                    Customer Name
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Enter customer's full name"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                    disabled={sending || generating}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Phone className="inline w-4 h-4 mr-1" />
                    Phone Number (optional for copy link)
                  </label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => {
                      const formatted = formatPhoneNumber(e.target.value, customerPhone);
                      setCustomerPhone(formatted);
                      const digits = formatted.replace(/\D/g, '');
                      if (formatted && digits.length > 0 && digits.length !== 10) {
                        setPhoneError('Phone number must be 10 digits');
                      } else {
                        setPhoneError('');
                      }
                    }}
                    placeholder="(555) 123-4567"
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      phoneError ? 'border-red-500' : ''
                    }`}
                    disabled={sending || generating}
                  />
                  {phoneError && (
                    <p className="text-sm text-red-500 mt-1">{phoneError}</p>
                  )}
                </div>

                {/* Link display */}
                {reviewUrl && (
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-slate-700 flex items-center gap-1">
                        <Link className="w-4 h-4" />
                        Review Link
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

                <div className="bg-yellow-50 p-4 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div>
                      <p className="text-sm text-yellow-800">
                        <strong>Link will include:</strong>
                      </p>
                      <ul className="text-xs text-yellow-700 mt-1 space-y-1">
                        <li>• All media (photos, videos) with identified items</li>
                        <li>• Inventory grouped by room</li>
                        <li>• Box recommendations</li>
                        <li>• Digital signature area</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-col gap-2">
                  {!reviewUrl ? (
                    <button
                      type="button"
                      onClick={handleGenerateLink}
                      disabled={generating || !customerName.trim()}
                      className="w-full bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 text-slate-700 py-3 rounded-lg font-medium flex items-center justify-center gap-2"
                    >
                      {generating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Link size={16} />
                          Generate Link (Copy Only)
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-lg font-medium flex items-center justify-center gap-2"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-green-500" />
                          Link Copied!
                        </>
                      ) : (
                        <>
                          <Copy size={16} />
                          Copy Link
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={sending || !customerName.trim() || !customerPhone.trim() || !!phoneError}
                    className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2"
                  >
                    {sending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending SMS...
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        Send via SMS
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
