// components/embed/ActionSkeleton.tsx
//
// Skeleton placeholders for the post-submit action views (chooser + scheduler).
// Both mirror the form card's outer shell (same outer padding, same rounded
// card, same width cap) so the transition from form → action reads as one
// continuous surface rather than a jump to a new page.
//
// Each is wrapped in a 100ms appear delay so they don't flash on warm cache
// loads — only the cold load (chunk fetch or initial data fetch) sees them.

'use client';

import { useEffect, useState } from 'react';

const EMBED_OUTER =
  'min-h-screen bg-transparent px-3 py-4 sm:px-4 sm:py-10 flex flex-col';
const EMBED_CARD =
  '@container max-w-md w-full mx-auto flex-1 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 @xs:p-5 @sm:p-7 @md:p-8';

// Common deferred-reveal hook. Returns true once `ms` has elapsed; during
// the initial window the caller renders nothing, eliminating the flash for
// warm caches where the underlying view is already loaded.
function useDeferredAppear(ms = 100): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return show;
}

export function ChooserSkeleton() {
  const show = useDeferredAppear();
  if (!show) return null;
  return (
    <div className={EMBED_OUTER} aria-busy="true" aria-label="Loading">
      <div className={EMBED_CARD}>
        {/* Title shape */}
        <div className="h-6 w-2/3 mx-auto rounded-md bg-gray-100 animate-pulse mb-3" />
        <div className="h-4 w-3/4 mx-auto rounded-md bg-gray-100 animate-pulse mb-6" />
        {/* Two big choice buttons stacked, matching UploadChooser's primary
            buttons. On wider widths they sit side by side; we approximate
            with a column for simplicity. */}
        <div className="space-y-3">
          <div className="h-20 w-full rounded-xl bg-gray-100 animate-pulse" />
          <div className="h-20 w-full rounded-xl bg-gray-100 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function ScheduleSkeleton() {
  const show = useDeferredAppear();
  if (!show) return null;
  return (
    <div className={EMBED_OUTER} aria-busy="true" aria-label="Loading available times">
      <div className={EMBED_CARD}>
        {/* Greeting */}
        <div className="h-6 w-1/2 mx-auto rounded-md bg-gray-100 animate-pulse mb-2" />
        <div className="h-4 w-2/3 mx-auto rounded-md bg-gray-100 animate-pulse mb-5" />

        {/* Calendar header */}
        <div className="flex items-center justify-between max-w-[252px] mx-auto mb-3">
          <div className="h-7 w-7 rounded-md bg-gray-100 animate-pulse" />
          <div className="h-4 w-24 rounded bg-gray-100 animate-pulse" />
          <div className="h-7 w-7 rounded-md bg-gray-100 animate-pulse" />
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1 max-w-[252px] mx-auto mb-5">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={`d${i}`} className="h-3 rounded bg-gray-100 animate-pulse" />
          ))}
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={`c${i}`} className="h-7 rounded-md bg-gray-100 animate-pulse" />
          ))}
        </div>

        {/* Time slots */}
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-gray-100 animate-pulse" />
          <div className="grid grid-cols-3 @sm:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 rounded-md bg-gray-100 animate-pulse" />
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="h-12 w-full rounded-xl bg-gray-200 animate-pulse mt-5" />
      </div>
    </div>
  );
}
