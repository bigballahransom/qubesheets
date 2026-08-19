// lib/captureLiveness.ts
//
// Capture-liveness verification for the local recording engine.
//
// Why this exists: when iOS seizes the camera/mic for a phone call, WebKit
// later fires 'unmute' on the getUserMedia tracks even when the capture
// pipeline never actually restarted — the tracks *claim* to be live but
// deliver black frames and digital silence from then on (prod 2026-08-17:
// a 6s call interruption at 1:49 left the remaining 3m40s of a walkthrough
// black and silent). The track's word is worthless; resume only after this
// module proves real frames and audio are flowing.

/** Mean-luma ceiling (0–255 full range) below which a frame counts as pure
 *  black. Camera-off black encodes at ~0–5; any lit room — even a dark
 *  basement — lands well above 10. Matches the server-side quality gate's
 *  YAVG≤26 limited-range threshold (≈12 full range). */
export const BLACK_LUMA_THRESHOLD = 10;

let sampleCanvas: HTMLCanvasElement | null = null;

/** Mean luma (0–255) of the element's current frame, or null when nothing
 *  can be sampled (no element, no frame yet, canvas failure). Downscales to
 *  48×27 so sampling every few seconds is free. */
export function sampleVideoLuma(video: HTMLVideoElement | null): number | null {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  try {
    sampleCanvas ??= document.createElement('canvas');
    const w = 48;
    const h = 27;
    sampleCanvas.width = w;
    sampleCanvas.height = h;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return sum / (data.length / 4);
  } catch {
    return null;
  }
}

export interface CaptureLivenessResult {
  alive: boolean;
  /** New frames arrived at the preview element during the probe window. A
   *  frozen preview (last pre-call frame, no new frames) fails this. */
  framesFlowing: boolean;
  /** Every sampled frame in the window was pure black. */
  videoBlack: boolean;
  /** The mic produced bit-exact digital silence for the whole window. */
  audioSilent: boolean;
}

/**
 * Watch the preview element + stream for ~2.5s and report whether capture is
 * genuinely alive: new frames arriving (requestVideoFrameCallback), frames
 * that aren't pure black, and a mic producing at least a noise floor. Any
 * check that can't run (rVFC unsupported, no AudioContext, context stuck
 * suspended) counts as alive — this must never strand a healthy recording.
 */
export async function verifyCaptureAlive(
  video: HTMLVideoElement | null,
  stream: MediaStream | null,
  audioCtx: AudioContext | null,
  windowMs = 2500
): Promise<CaptureLivenessResult> {
  // iOS pauses media elements during a call, and a paused element never
  // reports new frames. Muted+playsinline play() needs no user gesture.
  try {
    await video?.play();
  } catch {}

  let frameCount = 0;
  let stopRvfc: (() => void) | null = null;
  const rvfcSupported =
    !!video && typeof (video as any).requestVideoFrameCallback === 'function';
  if (rvfcSupported && video) {
    let handle = 0;
    const onFrame = () => {
      frameCount += 1;
      handle = (video as any).requestVideoFrameCallback(onFrame);
    };
    handle = (video as any).requestVideoFrameCallback(onFrame);
    stopRvfc = () => {
      try {
        (video as any).cancelVideoFrameCallback?.(handle);
      } catch {}
    };
  }

  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let audioCheckable = false;
  try {
    if (audioCtx && stream && stream.getAudioTracks().length > 0) {
      if (audioCtx.state === 'suspended') {
        try {
          await audioCtx.resume();
        } catch {}
      }
      if (audioCtx.state === 'running') {
        source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        audioCheckable = true;
      }
    }
  } catch {
    audioCheckable = false;
  }

  const lumaSamples: number[] = [];
  let maxAudioLevel = 0;
  const audioBuf = analyser ? new Float32Array(analyser.fftSize) : null;
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const luma = sampleVideoLuma(video);
    if (luma != null) lumaSamples.push(luma);
    if (analyser && audioBuf) {
      try {
        analyser.getFloatTimeDomainData(audioBuf);
        for (let i = 0; i < audioBuf.length; i++) {
          const a = Math.abs(audioBuf[i]);
          if (a > maxAudioLevel) maxAudioLevel = a;
        }
      } catch {}
    }
  }
  stopRvfc?.();
  try {
    source?.disconnect();
  } catch {}

  const framesFlowing = rvfcSupported ? frameCount > 0 : true;
  // Only an unbroken run of pure-black samples counts — one real frame
  // proves the camera is delivering pictures again.
  const videoBlack =
    lumaSamples.length > 0 && lumaSamples.every((l) => l <= BLACK_LUMA_THRESHOLD);
  // Real mics never produce bit-exact zero — even a silent room has a noise
  // floor. Sustained exact-zero means the audio pipeline is dead.
  const audioSilent = audioCheckable && maxAudioLevel < 1e-4;

  return {
    alive: framesFlowing && !videoBlack && !audioSilent,
    framesFlowing,
    videoBlack,
    audioSilent
  };
}
