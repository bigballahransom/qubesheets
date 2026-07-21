'use client';

// app/global-error.tsx - Last-resort boundary: catches errors thrown by the
// root layout itself (below-layout errors are handled by app/error.tsx).
// This REPLACES the root layout when it renders, so it must provide its own
// <html>/<body> and cannot rely on Tailwind/globals.css being present —
// inline styles only.

import { useEffect } from 'react';
import { reportClientError } from '@/lib/client-error-reporting';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      source: 'app/global-error',
    });
  }, [error]);

  const buttonStyle: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#111827',
    color: '#ffffff',
    fontSize: 14,
    cursor: 'pointer',
  };

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 32,
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#111827' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: '#4b5563', margin: '0 0 24px' }}>
            An unexpected error occurred while loading the app.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button type="button" style={buttonStyle} onClick={reset}>
              Try again
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, background: '#ffffff', color: '#111827' }}
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
