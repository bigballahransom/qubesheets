'use client';

// components/ClientErrorReporter.tsx
//
// Render-nothing side-effect component (same shape as EmergencyCleanup):
// installs the global window error/unhandledrejection listeners that report
// client crashes to /api/debug/client-error.

import { useEffect } from 'react';
import { installGlobalErrorListeners } from '@/lib/client-error-reporting';

export default function ClientErrorReporter() {
  useEffect(() => {
    installGlobalErrorListeners();
  }, []);

  return null;
}
