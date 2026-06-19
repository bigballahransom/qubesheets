'use client';

// features/lead-intake/components/LeadSuccessCTA.tsx
//
// Post-submission success screen + self-survey handoff. The project already
// exists (Phase 1), so we use the per-lead selfSurveyUrl returned by the submit
// endpoint. Device split mirrors the app's existing self-survey pattern:
//   desktop -> QR of the self-survey URL (scan to continue on a phone)
//   mobile  -> a button that opens the self-survey directly
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

// Self-contained device check (deliberately NOT the shared shouldShowQRCode()).
// That helper flips on window.innerWidth <= 768, which is wrong for us: this CTA
// renders inside a ~560px-wide embed iframe, so a width test would report
// "mobile" on every device and the desktop QR would never show. We decide on
// the actual device type (UA), which is stable inside an iframe and at any
// window size: real phones/tablets get the tap-through button, everything else
// (incl. touch-capable desktops and narrow windows) gets the QR.
function shouldShowQR(): boolean {
  if (typeof window === 'undefined') return true; // SSR default = desktop
  const device = new URLSearchParams(window.location.search).get('device');
  if (device === 'mobile') return false;
  if (device === 'desktop') return true;

  const ua = navigator.userAgent || '';
  const isPhone = /Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const isTablet =
    /iPad/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || // iPadOS Safari
    (/Android/i.test(ua) && !/Mobile/i.test(ua));
  return !(isPhone || isTablet); // desktop (any width / any iframe) → QR
}

export default function LeadSuccessCTA({ selfSurveyUrl }: { selfSurveyUrl: string }) {
  // Default to desktop (the SSR default) to avoid a flash before detection.
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    setIsDesktop(shouldShowQR());
  }, []);

  // A phone scanning the desktop QR should land straight on the recorder.
  const qrUrl = selfSurveyUrl.includes('?')
    ? `${selfSurveyUrl}&device=mobile`
    : `${selfSurveyUrl}?device=mobile`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-500">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h2 className="text-xl font-semibold text-slate-900">Request received!</h2>
      <p className="mt-2 max-w-sm text-sm text-slate-600">
        Thanks for reaching out — we&apos;ll be in touch soon to confirm your move details.
      </p>

      <div className="mt-8 w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-900">Want a faster estimate?</h3>
        <p className="mt-1 text-sm text-slate-600">
          Fill out our quick self-survey so we can give you a faster, more accurate quote.
        </p>

        {isDesktop ? (
          <div className="mt-5 flex flex-col items-center">
            <div className="rounded-lg border border-slate-200 p-3">
              <QRCodeSVG
                value={qrUrl}
                size={200}
                level="M"
                includeMargin
                bgColor="#ffffff"
                fgColor="#1f2937"
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Scan with your phone&apos;s camera to start the self-survey.
            </p>
          </div>
        ) : (
          <a
            href={selfSurveyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-indigo-600 px-6 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Start the self-survey
          </a>
        )}
      </div>

      <p className="mt-6 text-[11px] text-slate-400">Powered by QubeSheets</p>
    </div>
  );
}
