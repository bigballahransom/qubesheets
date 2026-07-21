'use client';

// app/error.tsx - Route-level error boundary for everything below the root
// layout. Replaces Next's production white screen ("Application error: a
// client-side exception has occurred") with a recoverable fallback, and
// reports the crash to /api/debug/client-error so we can see the stack.

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reportClientError } from '@/lib/client-error-reporting';

export default function Error({
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
      source: 'app/error',
    });
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h1 className="text-lg font-semibold text-gray-900 mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          An unexpected error occurred. You can try again — if the problem
          keeps happening, our team has been notified.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button
            variant="outline"
            onClick={() => {
              // Hard navigation so a poisoned client tree fully remounts.
              window.location.href = '/projects';
            }}
          >
            Go to projects
          </Button>
        </div>
      </div>
    </div>
  );
}
