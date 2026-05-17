'use client';

// components/onsite-walkthrough/OnsiteWalkthroughQRView.tsx
// Render a QR code for the mover to scan with their phone/tablet.
// Pure presentational — no fetching, no state.
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface OnsiteWalkthroughQRViewProps {
  mobileUrl: string;
  liveKitRoomName: string;
  uploadToken: string;
}

export default function OnsiteWalkthroughQRView({
  mobileUrl,
  liveKitRoomName,
  uploadToken,
}: OnsiteWalkthroughQRViewProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <QRCodeSVG value={mobileUrl} size={240} level="M" includeMargin />
      </div>

      <div className="text-center">
        <p className="text-sm font-medium text-slate-700">
          Scan with the mover&apos;s phone or tablet.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Opens the onsite walkthrough recorder on the device.
        </p>
      </div>

      <details className="w-full max-w-sm text-xs text-slate-500">
        <summary className="cursor-pointer select-none text-slate-600">
          Session details
        </summary>
        <dl className="mt-2 space-y-1 break-all">
          <div>
            <dt className="inline font-medium">URL: </dt>
            <dd className="inline">{mobileUrl}</dd>
          </div>
          <div>
            <dt className="inline font-medium">LiveKit room: </dt>
            <dd className="inline font-mono">{liveKitRoomName}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Token: </dt>
            <dd className="inline font-mono">{uploadToken.slice(0, 12)}…</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
