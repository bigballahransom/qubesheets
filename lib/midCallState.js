// Shared derivation for mid-call "Stop & Process" UI states.
//
// A mid-call-processed virtual call is ONE VideoRecording doc whose
// walkthrough becomes playable/analyzed while the call is still live
// (continuation egress recording), and whose s3Key is later repointed to the
// stitched full-call video. Consumers (Virtual Calls tab rows, the video
// modal) render from this state instead of re-deriving field combinations.

/**
 * @returns {'none'|'live_analyzing'|'live_ready'|'finalizing'|'stitched'|'wrap_unavailable'}
 */
// A continuation can't legitimately be "live" this long after the button was
// pressed — past this, a starting/recording continuationStatus is a stale doc
// (lost webhook, sweeper lag) and must not render a Live chip.
const STALE_LIVE_MS = 6 * 60 * 60 * 1000;

export function getMidCallState(recording) {
  if (!recording?.midCallProcessedAt) return 'none';

  const cont = recording.continuationStatus;
  const analysis = recording.analysisResult?.status;

  if (cont === 'starting' || cont === 'recording') {
    const age = Date.now() - new Date(recording.midCallProcessedAt).getTime();
    if (age > STALE_LIVE_MS) return 'wrap_unavailable';
    return analysis === 'completed' || analysis === 'failed' ? 'live_ready' : 'live_analyzing';
  }
  if (cont === 'completed' || cont === 'concatenating') {
    // Same staleness bound: a stitch that hasn't landed hours later isn't
    // coming (the sweeper will mark it concat_failed) — stop showing spinners.
    const age = Date.now() - new Date(recording.midCallProcessedAt).getTime();
    if (age > STALE_LIVE_MS) return 'wrap_unavailable';
    return 'finalizing';
  }
  if (cont === 'concatenated') return 'stitched';
  if (cont === 'failed' || cont === 'concat_failed') return 'wrap_unavailable';
  // midCallProcessedAt set but no continuation state persisted (e.g. the
  // continuation write raced) — treat as walkthrough-only.
  return 'wrap_unavailable';
}

export function isMidCallInFlight(recording) {
  const state = getMidCallState(recording);
  return state === 'live_analyzing' || state === 'live_ready' || state === 'finalizing';
}

export function isMidCallLive(recording) {
  const state = getMidCallState(recording);
  return state === 'live_analyzing' || state === 'live_ready';
}

// Pre-stitch, doc.duration IS the walkthrough duration; the concat job
// preserves it in metadata.walkthroughDuration before repointing.
export function getWalkthroughDuration(recording) {
  return recording?.metadata?.walkthroughDuration ?? recording?.duration ?? null;
}

export function getContinuationDuration(recording) {
  return recording?.metadata?.continuationDuration ?? null;
}

export function formatSeconds(totalSeconds) {
  if (totalSeconds == null || !isFinite(totalSeconds)) return null;
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}
