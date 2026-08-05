// app/vault/[orgId]/page.tsx - Org-wide Media Vault crew capture link
//
// One static QR for all mover/warehouse devices. The worker enters the
// customer's name + phone; /api/vault/[orgId]/start phone-matches to an
// existing project (or auto-creates one flagged Unfiled) and returns that
// project's permanent vault token. We then hand off to the standard
// /customer-upload/{token} capture flow, which renders vault-branded copy
// and stores everything as reference media — never inventoried.
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Building2, User, ArrowRight, Phone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { shouldShowQRCode } from '@/lib/deviceDetection';
import Logo from '../../../public/logo';
import SafeIcon from '@/components/icons/SafeIcon';

interface BrandingData {
  companyName: string;
  companyLogo?: string;
}

interface OrgConfig {
  branding?: BrandingData | null;
}

export default function GlobalVaultPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params?.orgId as string;

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  // Desktop visitors get a QR that reopens this page on their phone —
  // capture needs the phone camera. Same pattern as /upload/[orgId].
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setIsDesktop(shouldShowQRCode());
  }, []);

  // Branding comes from the same org config endpoint the self-survey uses.
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`/api/upload/${orgId}/config`);
        if (response.ok) {
          setConfig(await response.json());
        } else {
          setConfig({ branding: null });
        }
      } catch {
        setConfig({ branding: null });
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, [orgId]);

  const formatPhoneNumber = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = customerName.trim();
    const phoneDigits = customerPhone.replace(/\D/g, '');

    if (!trimmedName) {
      setFormError("Please enter the customer's name");
      return;
    }
    if (phoneDigits.length !== 10) {
      setFormError('Please enter a valid 10-digit phone number');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/vault/${orgId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: trimmedName,
          customerPhone: phoneDigits,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to continue');
      }

      const result = await response.json();
      if (!result.uploadToken) {
        throw new Error('Server did not return an upload token');
      }

      // ?device=mobile bypasses the desktop QR branch on the capture page.
      router.replace(`/customer-upload/${result.uploadToken}?device=mobile`);
    } catch (error) {
      console.error('Error starting vault capture:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to continue. Please try again.');
      setSubmitting(false);
    }
    // Keep the button in its loading state on success until redirect lands.
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800 mb-2">Loading...</h2>
            <p className="text-slate-600">Setting up the Media Vault...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isDesktop) {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const mobileUrl = `${baseUrl}/vault/${orgId}?device=mobile`;
    const companyName = config?.branding?.companyName || 'Moving Company';
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col">
        <header className="p-6 flex items-center gap-3">
          {config?.branding?.companyLogo ? (
            <img
              src={config.branding.companyLogo}
              alt={companyName}
              className="h-10 object-contain"
            />
          ) : (
            <span className="text-xl font-semibold text-slate-800">{companyName}</span>
          )}
        </header>
        <main className="flex-1 flex items-center justify-center px-6 pb-12">
          <div className="max-w-lg w-full">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-slate-900 mb-2 flex items-center justify-center gap-2">
                <SafeIcon size={28} className="text-slate-700" />
                Media Vault
              </h1>
              <p className="text-slate-600">
                Capture happens on a phone. Scan this QR code to add reference media —
                it will not be inventoried.
              </p>
            </div>
            <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
              <div className="bg-white p-4 rounded-xl inline-block shadow-inner border-2 border-slate-100 mb-6">
                <QRCodeSVG
                  value={mobileUrl}
                  size={220}
                  level="M"
                  includeMargin
                  bgColor="#ffffff"
                  fgColor="#1f2937"
                />
              </div>
              <div className="text-left bg-slate-50 rounded-lg p-4">
                <p className="text-sm text-slate-700 mb-2 font-medium">How it works:</p>
                <ol className="text-sm text-slate-600 space-y-1">
                  <li>1. Open your phone&apos;s camera app</li>
                  <li>2. Point it at the QR code above</li>
                  <li>3. Tap the link that appears</li>
                  <li>4. Enter the customer&apos;s name and phone, then capture</li>
                </ol>
              </div>
            </div>
            <div className="text-center py-8">
              <div className="inline-flex items-center text-slate-400 text-sm">
                <span>Powered by</span>
                <div className="scale-[0.8] origin-center -ml-2">
                  <Logo />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            {config?.branding?.companyLogo ? (
              <img
                src={config.branding.companyLogo}
                alt={config.branding.companyName}
                className="w-10 h-10 object-contain rounded-lg"
              />
            ) : (
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-slate-600" />
              </div>
            )}
            <div>
              <p className="font-medium text-slate-800">
                {config?.branding?.companyName || 'Moving Company'}
              </p>
              <p className="text-sm text-slate-500">Media Vault</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="text-center space-y-4 mb-8">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
            <SafeIcon size={28} className="text-slate-700" />
          </div>
          <h1 className="text-3xl font-bold text-slate-800">Add to the Media Vault</h1>
          <p className="text-slate-600">
            Enter the customer&apos;s info so this media is filed with the right job.
            Vault media is stored for reference — it is not inventoried.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
                Customer / Job Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  id="name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="John Smith"
                  className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none transition-colors"
                  disabled={submitting}
                />
              </div>
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-2">
                Customer Phone Number
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="tel"
                  id="phone"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(formatPhoneNumber(e.target.value))}
                  placeholder="(555) 123-4567"
                  className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none transition-colors"
                  disabled={submitting}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">
                If this phone matches an existing job, the media files there automatically.
              </p>
            </div>

            {formError && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-slate-700 hover:bg-slate-800 text-white font-medium py-3 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Finding job...
                </>
              ) : (
                <>
                  Continue to Capture
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center py-8">
          <div className="inline-flex items-center text-slate-400 text-sm">
            <span>Powered by</span>
            <div className="scale-[0.8] origin-center -ml-2">
              <Logo />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
