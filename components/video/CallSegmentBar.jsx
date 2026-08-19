'use client';

import { Loader2 } from 'lucide-react';
import { formatSeconds } from '@/lib/midCallState';

// Segment bar for mid-call-processed calls — the single source of truth for
// "what part of this call exists right now". Green = walkthrough (playable),
// striped = the part that doesn't exist yet (still on the call / being
// stitched). In the final state both segments are solid and clickable
// (jump-to navigation), and the bar stays forever.
const stripes = (a, b) =>
  `repeating-linear-gradient(-45deg, ${a} 0, ${a} 8px, ${b} 8px, ${b} 16px)`;

export default function CallSegmentBar({
  state,
  walkthroughDuration,
  continuationDuration,
  itemsCount,
  onSeek,
}) {
  if (!state || state === 'none') return null;

  const wt = walkthroughDuration || null;
  const cont = continuationDuration || null;
  const flexA = wt && cont ? wt : 3;
  const flexB = wt && cont ? cont : 2;
  const wtLabel = formatSeconds(wt);
  const contLabel = formatSeconds(cont);

  const segBase =
    'flex items-center justify-center gap-1.5 px-2 whitespace-nowrap overflow-hidden text-white';

  if (state === 'wrap_unavailable') {
    return (
      <div className="mt-2">
        <div className="flex h-8 rounded-lg overflow-hidden text-[11px] font-semibold">
          <div className={`flex-1 bg-emerald-600 ${segBase}`}>
            🎬 Walkthrough — analyzed{wtLabel ? ` · ${wtLabel}` : ''}
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-1 mb-0">
          Wrap-up portion unavailable for this call.
        </p>
      </div>
    );
  }

  if (state === 'stitched') {
    return (
      <div className="mt-2">
        <div className="flex h-8 rounded-lg overflow-hidden text-[11px] font-semibold">
          <button
            type="button"
            onClick={() => onSeek?.(0)}
            style={{ flex: flexA }}
            className={`bg-emerald-600 hover:bg-emerald-700 transition-colors ${segBase}`}
            title="Jump to the walkthrough"
          >
            🎬 Walkthrough{wtLabel ? ` · ${wtLabel}` : ''}
          </button>
          <button
            type="button"
            onClick={() => wt && onSeek?.(wt)}
            style={{ flex: flexB }}
            className={`bg-slate-600 hover:bg-slate-700 transition-colors ${segBase}`}
            title="Jump to the review & wrap-up"
          >
            💬 Review &amp; wrap-up{contLabel ? ` · ${contLabel}` : ''}
          </button>
        </div>
        <div className="text-[11px] text-gray-400 mt-1">
          Click a segment to jump there
        </div>
      </div>
    );
  }

  // In-flight: live_analyzing | live_ready | finalizing
  const isLive = state === 'live_analyzing' || state === 'live_ready';
  const analyzing = state === 'live_analyzing';

  return (
    <div className="mt-2">
      <div className="flex h-8 rounded-lg overflow-hidden text-[11px] font-semibold">
        <div
          style={{ flex: flexA, ...(analyzing ? { background: stripes('#059669', '#0a7f5c') } : {}) }}
          className={`${analyzing ? 'animate-pulse' : 'bg-emerald-600'} ${segBase}`}
        >
          {analyzing ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
              Walkthrough — analyzing…
            </>
          ) : (
            <>🎬 Walkthrough — analyzed{itemsCount ? ` · ${itemsCount} items` : ''}</>
          )}
        </div>
        <div
          style={{ flex: flexB, background: stripes('#64748b', '#56637a') }}
          className={`animate-pulse ${segBase}`}
        >
          {isLive ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 flex-shrink-0" />
              Still on the call — wrap-up will be added
            </>
          ) : (
            <>
              <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
              Adding wrap-up to this video…
            </>
          )}
        </div>
      </div>
      <div className="flex justify-between text-[11px] text-gray-400 mt-1">
        <span>{wtLabel ? `Playable now: ${wtLabel} walkthrough` : 'Playable now: walkthrough'}</span>
        <span>{isLive ? 'Updates automatically' : 'Full call video coming shortly'}</span>
      </div>
    </div>
  );
}
