// components/embed/EmbedShell.tsx
//
// Success / error states for the embedded iframe lead form. Use the
// same card frame as LeadForm, UploadChooser, and ScheduleCallView so
// the thank-you screen reads as the natural next step in the same
// surface, not a different page.

'use client';

import { CheckCircle, AlertCircle } from 'lucide-react';

// Match UploadChooser / ScheduleCallView exactly so all post-submit
// views share width + framing.
const EMBED_OUTER =
  'min-h-screen bg-transparent px-3 py-4 sm:px-4 sm:py-10 flex flex-col justify-center';
const EMBED_CARD =
  '@container max-w-md w-full mx-auto bg-white rounded-xl @sm:rounded-2xl shadow-lg @sm:shadow-xl border border-gray-200 p-5 @sm:p-7 @md:p-8';

export function SuccessState({ message }: { message: string }) {
  return (
    <div className={EMBED_OUTER}>
      <div className={`${EMBED_CARD} text-center`}>
        <CheckCircle
          className="w-12 h-12 @sm:w-14 @sm:h-14 text-green-500 mx-auto mb-3"
          aria-hidden
        />
        <h2 className="text-xl @sm:text-2xl font-bold text-gray-900 mb-2">
          Thank you!
        </h2>
        <p className="text-gray-600 text-sm @sm:text-base leading-relaxed">
          {message}
        </p>
      </div>
    </div>
  );
}

/**
 * @param message  Human-readable error.
 * @param onRetry  Retry the failed action without losing form state. When
 *                 provided, renders a primary "Try again" button. When
 *                 omitted, falls back to a page reload (which DOES lose
 *                 state — only use the fallback for terminal errors).
 * @param onBack   Return to the form with state preserved. When provided,
 *                 renders a secondary "Back to form" button. Lets the
 *                 customer fix a typo (e.g., bad email) and resubmit
 *                 without re-typing everything.
 */
export function ErrorState({
  message,
  onRetry,
  onBack,
}: {
  message: string;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  const hasInPlaceActions = !!onRetry || !!onBack;
  return (
    <div className={EMBED_OUTER}>
      <div className={`${EMBED_CARD} text-center`}>
        <AlertCircle
          className="w-12 h-12 @sm:w-14 @sm:h-14 text-red-500 mx-auto mb-3"
          aria-hidden
        />
        <h2 className="text-xl @sm:text-2xl font-bold text-gray-900 mb-2">
          Something went wrong
        </h2>
        <p className="text-gray-600 text-sm @sm:text-base leading-relaxed mb-5">
          {message}
        </p>
        <div className="flex flex-col @xs:flex-row gap-2 justify-center">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              Back to form
            </button>
          )}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="px-5 py-2.5 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800 transition-colors"
            >
              Try again
            </button>
          ) : (
            !hasInPlaceActions && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800 transition-colors"
              >
                Try again
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
