'use client';

// components/SelfServeRecorderLiveKit.tsx
// Self-serve video recording using LiveKit (server-side recording via Egress)
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectionQuality } from 'livekit-client';
import { useSelfServeRecordingLiveKit } from '@/lib/hooks/useSelfServeRecordingLiveKit';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { detectInAppBrowser, getBrowser, isIOS, isAndroid } from '@/lib/deviceDetection';
import { getCameraPermissionState, watchCameraPermission, type CameraPermissionState } from '@/lib/cameraPermission';

/** State machine for the "upload a video file instead" escape hatch offered
 *  on every error screen. Uses the existing public presigned-URL customer
 *  upload flow, so it works even when WebRTC/live recording can't. */
type FallbackUploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; progress: number }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

// ─── Permission-retry reload flag ──────────────────────────────────
// On iOS WebKit a camera-permission deny only lasts for the current page
// load — a RELOAD gets a fresh native prompt. This sessionStorage flag
// carries "we're mid permission-retry" across that reload so the recorder
// can skip the instructions screen and show a "tap Allow this time" priming
// screen instead. The count caps doomed reload loops ("Never for this
// Website" blocks survive reloads) so we can switch to settings guidance.
const PERM_RETRY_KEY = 'qs-perm-retry';
const PERM_RETRY_FRESH_MS = 5 * 60_000;

function readPermRetry(): { count: number; at: number } | null {
  try {
    const raw = sessionStorage.getItem(PERM_RETRY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.count === 'number' && typeof v?.at === 'number' ? v : null;
  } catch {
    return null;
  }
}

function clearPermRetry() {
  try { sessionStorage.removeItem(PERM_RETRY_KEY); } catch {}
}

// Fire-and-forget telemetry helper (mirrors the one in the hook). Tells the
// server "this device opened the recorder UI" so we can see what hardware
// is hitting the page even if recording never starts.
function pingTelemetry(uploadToken: string, payload: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    const body = JSON.stringify({
      ...payload,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      screenWidth: window.screen?.width,
      screenHeight: window.screen?.height,
      url: window.location?.href
    });
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(`/api/self-serve/${uploadToken}/video/telemetry`, blob);
    } else {
      fetch(`/api/self-serve/${uploadToken}/video/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => {});
    }
  } catch {}
}

interface SelfServeRecorderLiveKitProps {
  uploadToken: string;
  maxDuration?: number;
  instructions?: string;
  onComplete?: (sessionId?: string) => void;
  onCancel?: () => void;
  companyName?: string;
  /** Set when the recorder is mounted under an employee on-site walkthrough.
   *  Replaces the "Recording Complete! / Upload more" CTA on the complete
   *  screen with a "Back to project" button that routes to this URL. */
  walkthroughReturnUrl?: string;
  /** Media Vault capture — reference-only copy, no "AI is analyzing" promises. */
  isVault?: boolean;
}

export function SelfServeRecorderLiveKit({
  uploadToken,
  maxDuration = 1200,
  instructions,
  onComplete,
  onCancel,
  companyName,
  walkthroughReturnUrl,
  isVault
}: SelfServeRecorderLiveKitProps) {
  const router = useRouter();
  const [showInstructions, setShowInstructions] = useState(true);
  // Vault-only: optional title/description typed on the completion screen,
  // saved to the session via vault-annotate (the webhook copies them onto
  // the VideoRecording it creates).
  const [vaultTitle, setVaultTitle] = useState('');
  const [vaultDesc, setVaultDesc] = useState('');
  const [vaultSaveState, setVaultSaveState] = useState('idle'); // idle | saving | saved

  const [videoReady, setVideoReady] = useState(false);

  // Tell the server "the recorder UI mounted on this device" so we can see
  // who's hitting the page even if they never tap Start (or if init crashes
  // somewhere we don't catch).
  useEffect(() => {
    pingTelemetry(uploadToken, {
      event: 'recorder_mounted',
      browser: getBrowser(),
      platform: isIOS() ? 'iOS' : isAndroid() ? 'Android' : 'Other',
      inAppBrowser: detectInAppBrowser()
    });
  }, [uploadToken]);

  // Set body/html background color to match iOS Safari dark mode
  useEffect(() => {
    const originalBodyBg = document.body.style.backgroundColor;
    const originalHtmlBg = document.documentElement.style.backgroundColor;

    // iOS Safari dark mode color
    const darkColor = '#111827';
    document.body.style.backgroundColor = darkColor;
    document.documentElement.style.backgroundColor = darkColor;

    // Also set meta theme-color for status bar
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    const originalThemeColor = metaThemeColor?.getAttribute('content');

    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute('content', darkColor);

    return () => {
      document.body.style.backgroundColor = originalBodyBg;
      document.documentElement.style.backgroundColor = originalHtmlBg;
      if (metaThemeColor && originalThemeColor) {
        metaThemeColor.setAttribute('content', originalThemeColor);
      }
    };
  }, []);

  const {
    status,
    isRecording,
    recordingStarted,
    duration,
    durationWarning,
    remainingTime,
    videoRef,
    sessionId,
    connectionState,
    facingMode,
    initStage,
    cameraInterrupted,
    errorKind,
    permissionPromptShown,
    savedDuration,
    connectionQuality,
    isReconnecting,
    uploadConfirmed,
    initialize,
    startRecording,
    stopRecording,
    flipCamera,
    retryFromError,
    error
  } = useSelfServeRecordingLiveKit({
    uploadToken,
    maxDuration,
    onRecordingComplete: (sid) => {
      onComplete?.(sid);
    },
    onDurationWarning: (warning, remaining) => {
      console.log(`Duration warning: ${warning}, ${remaining}s remaining`);
    }
  });

  // Format duration as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ─── "Upload a video file instead" escape hatch ──────────────────
  // Offered on every error screen: the native camera app records on every
  // device and every network, so however the live flow failed, the customer
  // always has a path that produces a video. Reuses the existing public
  // presigned-URL customer upload endpoints.
  const [fallbackUpload, setFallbackUpload] = useState<FallbackUploadState>({ phase: 'idle' });
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  const handleFallbackFile = async (file: File) => {
    const mimeType = file.type || 'video/mp4';
    try {
      setFallbackUpload({ phase: 'uploading', progress: 5 });

      const presignedRes = await fetch('/api/generate-video-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
          mimeType,
          isCustomerUpload: true,
          customerToken: uploadToken
        })
      });
      if (!presignedRes.ok) {
        const err = await presignedRes.json().catch(() => ({}));
        throw new Error(err.error || 'Could not prepare the upload.');
      }
      const { uploadUrl, s3Key, metadata } = await presignedRes.json();

      // XHR instead of fetch for upload progress events.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', mimeType);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setFallbackUpload({ phase: 'uploading', progress: 5 + Math.round((e.loaded / e.total) * 85) });
          }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
          ? resolve()
          : reject(new Error(`Upload failed (${xhr.status}). Please try again.`));
        xhr.onerror = () => reject(new Error('Upload failed — please check your connection and try again.'));
        xhr.send(file);
      });

      setFallbackUpload({ phase: 'uploading', progress: 95 });
      const confirmRes = await fetch('/api/confirm-video-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key, metadata, actualFileSize: file.size })
      });
      if (!confirmRes.ok) {
        const err = await confirmRes.json().catch(() => ({}));
        throw new Error(err.error || 'Could not finalize the upload.');
      }

      setFallbackUpload({ phase: 'done' });
      onComplete?.();
    } catch (err) {
      setFallbackUpload({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Upload failed. Please try again.'
      });
    }
  };

  const openFallbackPicker = () => fallbackInputRef.current?.click();

  // Hidden file input shared by every screen that offers the fallback.
  const fallbackInput = (
    <input
      ref={fallbackInputRef}
      type="file"
      accept="video/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleFallbackFile(f);
        e.target.value = '';
      }}
    />
  );

  // Format max duration
  const formatMaxDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    return `${mins} min`;
  };

  // Get warning styles
  const getWarningStyles = (warning: typeof durationWarning): string => {
    switch (warning) {
      case '30sec':
        return 'bg-red-500 text-white animate-pulse';
      case '1min':
        return 'bg-orange-500 text-white';
      case '2min':
        return 'bg-yellow-500 text-black';
      default:
        return 'bg-black/50 text-white';
    }
  };

  // Fire the real camera/mic permission prompt directly inside a user
  // gesture, BEFORE the server/LiveKit handshake. The native popup appears
  // the instant the user taps — not seconds later over a spinner — and once
  // granted, initialize()'s own camera step proceeds without a second ask
  // (grants persist for the page load). Best-effort: on deny/failure we
  // continue into initialize(), whose camera step classifies the failure
  // and routes to the right recovery screen.
  const requestPermissionUpfront = async (context: 'start' | 'priming') => {
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('upfront-prompt-timeout')), 60_000)
        )
      ]);
      stream.getTracks().forEach((t) => t.stop());
      pingTelemetry(uploadToken, { event: 'upfront_prompt_result', context, result: 'granted' });
    } catch (err: any) {
      pingTelemetry(uploadToken, {
        event: 'upfront_prompt_result',
        context,
        result: err?.name || 'error'
      });
    }
  };

  // Handle start
  const handleStart = async () => {
    ensureAudioReady();
    setShowInstructions(false);
    if (status === 'idle') {
      await requestPermissionUpfront('start');
      await initialize();
    }
  };

  // ─── Permission-denial recovery ────────────────────────────────────
  // showPriming: this page load is a deliberate permission retry (the flag
  // survived the reload) — skip instructions, show "tap Allow this time".
  const [showPriming, setShowPriming] = useState(false);
  const [primingStarted, setPrimingStarted] = useState(false);
  // Camera permission state via the Permissions API (Chrome family gives a
  // definitive answer + live onchange; WebKit returns 'unknown').
  const [camPermState, setCamPermState] = useState<CameraPermissionState | null>(null);
  const autoRetriedRef = useRef(false);
  const permRetryCount = useRef(0);

  // On mount: if we're arriving from a permission-retry reload, go straight
  // to the priming screen instead of the instructions screen.
  useEffect(() => {
    const flag = readPermRetry();
    if (flag) {
      permRetryCount.current = flag.count;
      if (Date.now() - flag.at < PERM_RETRY_FRESH_MS) {
        setShowInstructions(false);
        setShowPriming(true);
        pingTelemetry(uploadToken, { event: 'perm_priming_shown', retryCount: flag.count });
      } else {
        clearPermRetry();
        permRetryCount.current = 0;
      }
    }
  }, [uploadToken]);

  // Permission retry via full page reload — the only way to get a fresh
  // native prompt on iOS WebKit after a deny. Bumps the attempt count so we
  // stop offering reloads that can't work (hard blocks survive them).
  const reloadForPermissionRetry = () => {
    const next = (readPermRetry()?.count ?? permRetryCount.current) + 1;
    try { sessionStorage.setItem(PERM_RETRY_KEY, JSON.stringify({ count: next, at: Date.now() })); } catch {}
    pingTelemetry(uploadToken, { event: 'perm_retry_reload', retryCount: next });
    window.location.reload();
  };

  // Success after a permission retry → record the win and clear the flag.
  useEffect(() => {
    if ((status === 'ready' || status === 'recording') && readPermRetry()) {
      pingTelemetry(uploadToken, { event: 'perm_unblocked_after_reload', retryCount: permRetryCount.current });
      clearPermRetry();
      permRetryCount.current = 0;
    }
  }, [status, uploadToken]);

  // While stuck on the permission-denied screen: query the Permissions API
  // for a definitive verdict, and (Chrome family) watch for the user flipping
  // the site setting — the moment access is no longer denied, retry
  // automatically so recovery needs zero extra taps.
  useEffect(() => {
    if (status !== 'error' || errorKind !== 'permission_denied') return;
    autoRetriedRef.current = false;
    getCameraPermissionState().then(setCamPermState);
    const unwatch = watchCameraPermission((state) => {
      setCamPermState(state);
      if ((state === 'granted' || state === 'prompt') && !autoRetriedRef.current) {
        autoRetriedRef.current = true;
        pingTelemetry(uploadToken, { event: 'perm_unblocked_after_settings' });
        retryFromError();
      }
    });
    return unwatch;
  }, [status, errorKind, uploadToken, retryFromError]);

  // Measurement: record when a user hits the hard-blocked wall (settings
  // change required) — the population the reload trick can't save.
  const hardBlockedReportedRef = useRef(false);
  useEffect(() => {
    if (status !== 'error' || errorKind !== 'permission_denied') {
      hardBlockedReportedRef.current = false;
      return;
    }
    const hard = camPermState === 'denied' || (permissionPromptShown === false && permRetryCount.current >= 2);
    if (hard && !hardBlockedReportedRef.current) {
      hardBlockedReportedRef.current = true;
      pingTelemetry(uploadToken, {
        event: 'perm_hard_blocked',
        camPermState: camPermState || 'unknown',
        retryCount: permRetryCount.current,
        promptShown: permissionPromptShown === true
      });
    }
  }, [status, errorKind, camPermState, permissionPromptShown, uploadToken]);

  // Start recording after connection is ready. 'ready' now means the camera
  // is live (not just the WebSocket), so the server-side egress can never
  // start recording a camera-less room.
  useEffect(() => {
    if (status === 'ready' && !showInstructions) {
      startRecording();
    }
  }, [status, showInstructions, startRecording]);

  // ─── 3-2-1 countdown on recording start ──────────────────────────
  // Runs the moment recording kicks off, CONCURRENTLY with the server-side
  // egress spin-up (the /start-recording API + composite renderer take a
  // few seconds to actually begin encoding). By the time the countdown ends
  // and REC appears, the egress is genuinely rolling — so the user's first
  // words land on tape instead of being clipped during startup.
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownStartedRef = useRef(false);

  // ─── Countdown audio cues (Web Audio, no asset files) ─────────────
  // Soft tick on 3-2-1, brighter two-tone on "go" — the camera-self-timer
  // pattern, so the user knows when to start talking without watching the
  // screen. The AudioContext must be created/resumed inside a user gesture
  // (iOS requirement), so every button that leads into recording calls
  // ensureAudioReady(). Everything here is best-effort: if audio can't
  // play, the visual countdown carries the interaction unchanged.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastCueRef = useRef<number | null>(null);

  const ensureAudioReady = () => {
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        void audioCtxRef.current.resume();
      }
    } catch { /* no audio — countdown stays visual-only */ }
  };

  const playCue = (kind: 'tick' | 'go') => {
    try {
      const ctx = audioCtxRef.current;
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      if (kind === 'tick') {
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 880;
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + 0.12);
      } else {
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        const o1 = ctx.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = 988; // B5
        o1.connect(gain);
        o1.start(now);
        o1.stop(now + 0.15);
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = 1319; // E6
        o2.connect(gain);
        o2.start(now + 0.15);
        o2.stop(now + 0.35);
      }
    } catch { /* best-effort */ }
    // Haptic tick where supported (Android; iOS Safari has no web haptics).
    try { (navigator as any).vibrate?.(kind === 'tick' ? 30 : 60); } catch {}
  };

  // Tidy up the AudioContext when the recorder unmounts.
  useEffect(() => {
    return () => { try { audioCtxRef.current?.close(); } catch {} };
  }, []);

  useEffect(() => {
    if (isRecording && !countdownStartedRef.current) {
      countdownStartedRef.current = true;
      lastCueRef.current = null;
      setCountdown(3);
    } else if (!isRecording && status !== 'stopping' && status !== 'processing') {
      // Reset for a fresh take (retry after error, new session, etc.).
      countdownStartedRef.current = false;
      lastCueRef.current = null;
      setCountdown(null);
    }
  }, [isRecording, status]);

  useEffect(() => {
    if (countdown === null) return;
    // Cue once per value (the ref guard also absorbs StrictMode's dev-mode
    // double effect invocation).
    if (lastCueRef.current !== countdown) {
      lastCueRef.current = countdown;
      playCue(countdown <= 0 ? 'go' : 'tick');
    }
    if (countdown <= 0) {
      setCountdown(null);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const countingDown = countdown !== null && countdown > 0;

  // Safety net for the "Starting camera..." overlay: iOS Safari sometimes
  // never fires loadeddata for an attached MediaStream even though frames are
  // flowing. Clear the overlay after a few seconds so a cosmetic event miss
  // can't leave a permanent spinner over a live recording.
  useEffect(() => {
    if (videoReady) return;
    if (status !== 'ready' && status !== 'recording') return;
    const timer = setTimeout(() => setVideoReady(true), 6000);
    return () => clearTimeout(timer);
  }, [videoReady, status]);

  // Fallback file-upload flow takes over the screen once the user picks a
  // file (from any error screen). Rendered before the status branches so it
  // wins over the error state that launched it.
  if (fallbackUpload.phase === 'uploading' || fallbackUpload.phase === 'done' || fallbackUpload.phase === 'error') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white p-6 items-center justify-center"
        style={{ width: '100vw', height: '100dvh', minHeight: '-webkit-fill-available' }}
      >
        {fallbackInput}
        {fallbackUpload.phase === 'uploading' && (
          <div className="w-full max-w-sm flex flex-col items-center text-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
            <h2 className="text-xl font-semibold mb-2">Uploading your video…</h2>
            <p className="text-gray-400 mb-6">Keep this page open until the upload finishes.</p>
            <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-500 h-full transition-all duration-300"
                style={{ width: `${fallbackUpload.progress}%` }}
              />
            </div>
            <p className="text-sm text-gray-500 mt-2">{fallbackUpload.progress}%</p>
          </div>
        )}
        {fallbackUpload.phase === 'done' && (
          <div className="w-full max-w-sm flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-6">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-2">Video uploaded!</h2>
            <p className="text-gray-400 mb-8">
              {isVault
                ? 'Saved to the Media Vault for reference.'
                : 'Our AI is now analyzing it to create your inventory.'}
            </p>
            {walkthroughReturnUrl ? (
              <Button
                onClick={() => router.push(walkthroughReturnUrl)}
                size="lg"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                Back to project
              </Button>
            ) : (
              onCancel && (
                <Button
                  onClick={onCancel}
                  variant="outline"
                  size="lg"
                  className="w-full bg-transparent border-gray-700 hover:bg-gray-800 text-white"
                >
                  Upload more
                </Button>
              )
            )}
          </div>
        )}
        {fallbackUpload.phase === 'error' && (
          <div className="w-full max-w-sm flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mb-6">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">Upload failed</h2>
            <p className="text-gray-400 mb-6">{fallbackUpload.message}</p>
            <Button onClick={openFallbackPicker} size="lg" className="w-full bg-blue-600 hover:bg-blue-700 mb-3">
              Try uploading again
            </Button>
            <Button
              onClick={() => setFallbackUpload({ phase: 'idle' })}
              variant="outline"
              size="lg"
              className="w-full bg-transparent border-gray-700 hover:bg-gray-800 text-white"
            >
              Back
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Permission-retry priming screen — shown after the recovery reload,
  // instead of the instructions screen. The whole point: the "tap Allow"
  // coaching is on screen BEFORE and WHILE the native permission prompt is
  // up, so the second ask succeeds.
  if (showPriming && (status === 'idle' || status === 'initializing' || status === 'connecting')) {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white p-6 items-center justify-center"
        style={{ width: '100vw', height: '100dvh', minHeight: '-webkit-fill-available' }}
      >
        {fallbackInput}
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mb-6">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2">This time, tap "Allow"</h2>
          <p className="text-gray-400 mb-6">
            Tap <span className="font-semibold text-white">Allow</span> below —
            the real popup will appear right where you tapped. Tap Allow on it too.
          </p>

          {/* Interactive rehearsal of the native prompt: the Allow button IS
              the action. Firing getUserMedia inside this tap makes the real
              popup appear instantly, with the user's thumb already in
              position and "tap Allow" fresh in muscle memory. */}
          <div className="bg-gray-800 rounded-xl p-4 mb-6 w-full">
            <p className="text-sm text-gray-300 mb-3">
              This website would like to access your camera and microphone
            </p>
            <div className="flex gap-3 justify-center">
              <span className="px-4 py-1.5 rounded-lg bg-gray-700 text-gray-500 text-sm opacity-60 select-none">Don't Allow</span>
              <button
                type="button"
                disabled={primingStarted}
                onClick={async () => {
                  if (primingStarted) return;
                  ensureAudioReady();
                  setPrimingStarted(true);
                  await requestPermissionUpfront('priming');
                  await initialize();
                }}
                className={cn(
                  'px-5 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold',
                  primingStarted
                    ? 'opacity-60'
                    : 'ring-2 ring-blue-300/70 animate-pulse active:bg-blue-700'
                )}
              >
                Allow
              </button>
            </div>
          </div>

          {primingStarted && (
            <div className="flex items-center gap-3 mb-4 text-gray-300">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Now tap "Allow" on the popup
            </div>
          )}

          <button
            onClick={openFallbackPicker}
            className="text-gray-400 hover:text-white text-sm"
          >
            Or upload a video instead
          </button>
        </div>
      </div>
    );
  }

  // Instructions screen
  if (showInstructions) {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white p-4 overflow-auto"
        style={{
          width: '100vw',
          height: '100dvh',
          minHeight: '-webkit-fill-available'
        }}
      >
        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto text-center">
          <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mb-6">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold mb-2">
            {isVault ? 'Record video' : walkthroughReturnUrl ? 'Record walkthrough' : 'Record Your Home'}
          </h1>
          <p className="text-gray-400 mb-6">
            {isVault
              ? 'This video is saved to the Media Vault for reference — it will not be inventoried.'
              : walkthroughReturnUrl
              ? 'Walk through each room slowly to capture inventory.'
              : companyName
                ? `${companyName} is ready to help with your move!`
                : 'Help us prepare your moving quote'}
          </p>

          <div className="bg-gray-800 rounded-lg p-4 mb-6 text-left w-full">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Instructions
            </h2>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">1.</span>
                Walk slowly through each room
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">2.</span>
                Show furniture and items clearly
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">3.</span>
                Speak aloud about items going/staying
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400 mt-0.5">4.</span>
                Max recording time: {formatMaxDuration(maxDuration)}
              </li>
            </ul>
            {instructions && (
              <p className="mt-3 pt-3 border-t border-gray-700 text-sm text-gray-400 italic">
                "{instructions}"
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Your video is private and secure
          </div>

          {/* Pre-prompt priming: warn about the permission ask BEFORE it
              fires, so first-attempt denials (the expensive ones) drop. */}
          <p className="text-sm text-gray-400 mb-6">
            Your browser will ask to use the camera &amp; microphone — tap{' '}
            <span className="font-semibold text-white">Allow</span>.
          </p>

          <Button
            onClick={handleStart}
            size="lg"
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            Start Recording
          </Button>

          {onCancel && (
            <button
              onClick={onCancel}
              className="mt-4 text-gray-400 hover:text-white text-sm"
            >
              Upload photos instead
            </button>
          )}
        </div>
      </div>
    );
  }

  // Error state — screen matches the actual failure so the recovery path is
  // never a dead end: every variant offers a way to still deliver a video.
  if (status === 'error') {
    const kind = errorKind ?? 'generic';

    // Per-platform steps for re-enabling a denied camera permission (browsers
    // never re-show the prompt after a hard deny — the user must flip it).
    const browser = getBrowser();
    const permissionSteps: string[] = isIOS()
      ? browser === 'Safari'
        ? [
            'Tap the "aA" (or puzzle piece) icon in Safari\'s address bar',
            'Choose "Website Settings"',
            'Set Camera and Microphone to "Allow"'
          ]
        : [
            'Open your iPhone Settings app',
            `Scroll to ${browser === 'Chrome' ? 'Chrome' : 'your browser'}`,
            'Turn on access for Camera and Microphone'
          ]
      : isAndroid()
        ? [
            'Tap the lock (or tune) icon in the address bar',
            'Tap "Permissions"',
            'Allow Camera and Microphone',
            'Still blocked? Open phone Settings → Apps → your browser → Permissions → allow Camera & Microphone'
          ]
        : [
            'Click the camera icon in your browser\'s address bar',
            'Choose "Allow" for camera and microphone'
          ];

    // Permission-denial recovery branching:
    // - Chrome family reports 'denied' via the Permissions API → definitive:
    //   a reload can NOT re-prompt; only the site-settings toggle helps (and
    //   the watcher auto-retries the instant it flips).
    // - WebKit (iOS): a deny is per-page-load, so a primed RELOAD gets a
    //   fresh prompt — unless repeated reloads keep failing instantly with no
    //   prompt shown, which means "Never for this Website" / OS-level block.
    const permDefinitiveDenied = camPermState === 'denied';
    const permHardBlocked =
      kind === 'permission_denied' &&
      (permDefinitiveDenied || (permissionPromptShown === false && permRetryCount.current >= 2));

    const screens: Record<string, { title: string; body: string; primaryLabel: string; showSteps?: boolean; hideRetry?: boolean }> = {
      permission_denied: permHardBlocked
        ? {
            title: 'Camera access is turned off',
            body: 'Your browser is blocking camera access for this site. Here\'s how to turn it back on:',
            primaryLabel: permDefinitiveDenied ? 'Check again' : 'Try again',
            showSteps: true
          }
        : {
            title: 'Camera access needed',
            body: 'No problem — we\'ll ask one more time. When the popup appears, tap "Allow".',
            primaryLabel: 'Try again'
          },
      camera_in_use: {
        title: 'Your camera is busy',
        body: 'Another app is using your camera. Close any app that might be using it (camera, video calls), then try again.',
        primaryLabel: 'Try again'
      },
      camera_not_found: {
        title: 'No camera found',
        body: 'We couldn\'t find a usable camera on this device. You can record with your camera app and upload the video instead.',
        primaryLabel: 'Try again'
      },
      disconnected_mid_recording: {
        title: 'Connection lost',
        body: `Don't worry — the first ${formatDuration(savedDuration)} you recorded was saved and is being processed. When you're ready, continue where you left off.`,
        primaryLabel: 'Record the rest'
      },
      upload_failed: {
        title: 'Recording couldn\'t be saved',
        body: 'Something went wrong saving your video on our end. Please record again — or record with your camera app and upload the file.',
        primaryLabel: 'Record again'
      },
      unsupported_browser: {
        title: 'This browser can\'t record',
        body: error?.message || 'Live recording isn\'t supported here. You can still record with your camera app and upload the video below.',
        primaryLabel: 'Try again',
        hideRetry: true
      },
      generic: {
        title: 'Something went wrong',
        body: error?.message || 'Unable to access camera. Please check permissions and try again.',
        primaryLabel: 'Try again'
      }
    };
    const screen = screens[kind] || screens.generic;
    const isDisconnectSave = kind === 'disconnected_mid_recording';

    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white p-6 items-center justify-center overflow-auto"
        style={{
          width: '100vw',
          height: '100dvh',
          minHeight: '-webkit-fill-available'
        }}
      >
        {fallbackInput}
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <div className={cn(
            'w-16 h-16 rounded-full flex items-center justify-center mb-6',
            isDisconnectSave ? 'bg-green-500' : kind === 'permission_denied' ? 'bg-yellow-500' : 'bg-red-500'
          )}>
            {isDisconnectSave ? (
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className={cn('w-8 h-8', kind === 'permission_denied' && 'text-black')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
          </div>
          <h2 className="text-xl font-semibold mb-2">{screen.title}</h2>
          <p className="text-gray-400 mb-4">{screen.body}</p>

          {screen.showSteps && (
            <ol className="bg-gray-800 rounded-lg p-4 mb-4 text-left w-full space-y-2 text-sm text-gray-300">
              {permissionSteps.map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-blue-400 font-semibold">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
          )}

          {screen.showSteps && permDefinitiveDenied && (
            <p className="text-sm text-gray-500 mb-4">
              This screen updates automatically once you allow access.
            </p>
          )}

          {!screen.hideRetry && (
            <Button
              onClick={() => {
                ensureAudioReady();
                // WebKit permission denials recover via a primed reload (a
                // fresh page load re-prompts); everything else — including
                // Chrome's definitive denied state, where a reload is
                // pointless — retries in place.
                if (kind === 'permission_denied' && !permDefinitiveDenied) {
                  reloadForPermissionRetry();
                } else {
                  retryFromError();
                }
              }}
              size="lg"
              className="w-full bg-blue-600 hover:bg-blue-700 mb-3"
            >
              {screen.primaryLabel}
            </Button>
          )}
          <Button
            onClick={openFallbackPicker}
            variant={screen.hideRetry ? 'default' : 'outline'}
            size="lg"
            className={cn(
              'w-full',
              screen.hideRetry
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-transparent border-gray-700 hover:bg-gray-800 text-white'
            )}
          >
            Upload a video instead
          </Button>
          {kind === 'unsupported_browser' && (
            <p className="text-sm text-gray-500 mt-4">
              Or copy this link and open it in Safari or Chrome to record live.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Initializing / Connecting state
  if (status === 'idle' || status === 'initializing' || status === 'connecting') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white items-center justify-center"
        style={{
          width: '100vw',
          height: '100dvh',
          minHeight: '-webkit-fill-available'
        }}
      >
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-400">
          {initStage === 'camera'
            ? 'Waiting for camera & microphone access...'
            : initStage === 'connect'
              ? 'Connecting to video service...'
              : 'Setting up...'}
        </p>
        {initStage === 'camera' && (
          <p className="text-gray-500 text-sm mt-2 max-w-xs text-center">
            If prompted, tap "Allow" so we can record your walkthrough.
          </p>
        )}
      </div>
    );
  }

  // Complete state — recording finished. Camera/mic are released by the
  // hook's cleanup() (called by stopRecording before transitioning here),
  // so this screen no longer holds any media permissions.
  if (status === 'complete') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white p-6 items-center justify-center"
        style={{
          width: '100vw',
          height: '100dvh',
          minHeight: '-webkit-fill-available'
        }}
      >
        <div className="w-full max-w-sm flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-6">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-semibold mb-2">
            {walkthroughReturnUrl ? 'Walkthrough recorded!' : 'Recording Complete!'}
          </h2>
          <p className="text-gray-400 mb-4">
            {isVault
              ? uploadConfirmed
                ? 'Your video has been saved to the Media Vault for reference.'
                : 'Your video is finishing up. It will be saved to the Media Vault for reference.'
              : uploadConfirmed
              ? 'Your video has been uploaded. Our AI is now analyzing it to create your inventory.'
              : 'Your video is finishing up. Our AI will analyze it to create your inventory.'}
          </p>
          <div className="bg-gray-800 rounded-lg p-4 mb-4 w-full">
            <p className="text-sm text-gray-400">Recording duration</p>
            <p className="text-2xl font-mono">{formatDuration(duration)}</p>
          </div>
          {/* Upload verification — true means the server webhook confirmed
              the file; null means confirmation hadn't arrived when the poll
              window closed (long videos finalize for a while). */}
          {uploadConfirmed ? (
            <p className="flex items-center gap-1.5 text-sm text-green-400 mb-6">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Upload verified
            </p>
          ) : (
            <p className="text-sm text-yellow-500/90 mb-6">
              Still finalizing your upload — it's safe to close this page. Your
              video will appear in a few minutes.
            </p>
          )}
          {!walkthroughReturnUrl && !isVault && (
            <p className="text-sm text-gray-500 mb-8">
              You'll receive a notification when your inventory is ready.
            </p>
          )}

          {/* Vault-only: optional title + description for this recording */}
          {isVault && (
            <div className="w-full bg-gray-800 rounded-lg p-4 mb-6 text-left space-y-2">
              <p className="text-sm font-medium text-gray-300">Add details (optional)</p>
              <input
                value={vaultTitle}
                onChange={(e) => { setVaultTitle(e.target.value); setVaultSaveState('idle'); }}
                placeholder="Title — e.g. Walk-in, Job 65503"
                className="w-full text-sm bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <textarea
                value={vaultDesc}
                onChange={(e) => { setVaultDesc(e.target.value); setVaultSaveState('idle'); }}
                placeholder="Description — condition notes, contents, context"
                rows={2}
                className="w-full text-sm bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />
              <Button
                onClick={async () => {
                  if (vaultSaveState === 'saving' || (!vaultTitle.trim() && !vaultDesc.trim())) return;
                  setVaultSaveState('saving');
                  try {
                    const r = await fetch(`/api/customer-upload/${uploadToken}/vault-annotate`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        kind: 'session',
                        id: sessionId,
                        label: vaultTitle.trim(),
                        description: vaultDesc.trim(),
                      }),
                    });
                    setVaultSaveState(r.ok ? 'saved' : 'idle');
                  } catch {
                    setVaultSaveState('idle');
                  }
                }}
                size="sm"
                disabled={vaultSaveState === 'saving' || (!vaultTitle.trim() && !vaultDesc.trim())}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {vaultSaveState === 'saving'
                  ? 'Saving...'
                  : vaultSaveState === 'saved'
                  ? 'Details saved ✓'
                  : 'Save details'}
              </Button>
            </div>
          )}

          {walkthroughReturnUrl ? (
            <>
              <Button
                onClick={() => router.push(walkthroughReturnUrl)}
                size="lg"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white mb-3"
              >
                Back to project
              </Button>
              {onCancel && (
                <Button
                  onClick={onCancel}
                  variant="outline"
                  size="lg"
                  className="w-full bg-transparent border-gray-700 hover:bg-gray-800 text-white"
                >
                  Upload more
                </Button>
              )}
            </>
          ) : (
            // "Not finished?" path — sends the user back to the upload-link
            // landing screen (Record Video / Upload Photos choice) so they can
            // add another video or upload supplemental photos.
            onCancel && (
              <div className="w-full pt-6 border-t border-gray-800">
                <p className="text-sm text-gray-400 mb-3">Not finished?</p>
                <Button
                  onClick={onCancel}
                  variant="outline"
                  size="lg"
                  className="w-full bg-transparent border-gray-700 hover:bg-gray-800 text-white"
                >
                  Upload more
                </Button>
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  // Processing state
  if (status === 'processing' || status === 'stopping') {
    return (
      <div
        className="fixed inset-0 flex flex-col bg-gray-900 text-white items-center justify-center p-4"
        style={{
          width: '100vw',
          height: '100dvh',
          minHeight: '-webkit-fill-available'
        }}
      >
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-xl font-semibold mb-2">Saving Your Recording</h2>
        <p className="text-gray-400 text-center max-w-sm">
          Confirming your video was saved — this can take up to 30 seconds.
        </p>
        <div className="mt-4 bg-gray-800 rounded-lg p-4 text-center">
          <p className="text-sm text-gray-400">Recording duration</p>
          <p className="text-2xl font-mono">{formatDuration(duration)}</p>
        </div>
      </div>
    );
  }

  // Recording / Ready UI - True full screen with minimal overlaid controls
  return (
    <div
      className="fixed inset-0 bg-[#111827]"
      style={{
        width: '100vw',
        height: '100dvh',
        // iOS Safari fix - extend beyond safe areas
        minHeight: '-webkit-fill-available'
      }}
    >
      {/* Full Screen Video Preview - edge to edge, extend into safe areas */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedData={() => setVideoReady(true)}
        onPlaying={() => setVideoReady(true)}
        className="w-full h-full object-cover"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100dvh',
          minHeight: '-webkit-fill-available'
        }}
      />

      {/* Loading overlay - shown until video is ready */}
      {!videoReady && (
        <div
          className="absolute z-20 bg-[#111827] flex flex-col items-center justify-center"
          style={{
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100dvh',
            minHeight: '-webkit-fill-available'
          }}
        >
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mb-4" />
          <p className="text-white/70 text-sm">Starting camera...</p>
        </div>
      )}

      {/* Camera-interrupted warning — the server is receiving black video
          (screen was locked, app backgrounded, or the OS took the camera).
          The hook auto-stops after ~30s if this isn't resolved. */}
      {cameraInterrupted && isRecording && (
        <div className="absolute inset-0 z-30 bg-black/80 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center mb-5">
            <svg className="w-8 h-8 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-white text-xl font-semibold mb-2">We can&apos;t see your camera</h2>
          <p className="text-gray-300 max-w-sm">
            Keep this screen open while recording. If your phone locked or you
            switched apps, come back here to continue — otherwise the recording
            will stop automatically.
          </p>
        </div>
      )}

      {/* 3-2-1 countdown — big number over the live preview so the user can
          compose their shot. Runs concurrently with egress startup; controls
          and REC are hidden until it finishes. */}
      {countingDown && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 pointer-events-none">
          <span
            key={countdown}
            className="text-white font-bold drop-shadow-2xl animate-in zoom-in-50 fade-in duration-300"
            style={{ fontSize: '9rem', lineHeight: 1 }}
          >
            {countdown}
          </span>
        </div>
      )}

      {/* Top overlay - minimal, just REC indicator and time. Hidden during
          the countdown (the ticking duration + STARTING spinner would fight
          the big numbers). */}
      {!countingDown && (
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
        {/* Recording indicator. Show "STARTING…" while /start-recording is in
            flight so the user doesn't think the recording has begun and tap
            Stop too early (which would race the egress and produce a 0s file). */}
        {isRecording && !recordingStarted && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-white/70 border-t-white rounded-full animate-spin" />
            <span className="text-white text-sm font-medium drop-shadow-lg">STARTING…</span>
          </div>
        )}
        {isRecording && recordingStarted && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="text-white text-sm font-medium drop-shadow-lg">REC</span>
          </div>
        )}
        {status === 'ready' && !isRecording && <div />}

        {/* Duration - compact */}
        <div className={cn(
          'px-2.5 py-1 rounded-full font-mono text-xs',
          durationWarning === '30sec' ? 'bg-red-500 text-white animate-pulse' :
          durationWarning === '1min' ? 'bg-orange-500 text-white' :
          durationWarning === '2min' ? 'bg-yellow-500 text-black' :
          'bg-black/40 text-white backdrop-blur-sm'
        )}>
          {formatDuration(duration)} / {formatDuration(maxDuration)}
        </div>
      </div>
      )}

      {/* Network status — with server-side egress, a degraded uplink degrades
          the RECORDING, not just the preview, so surface it prominently. */}
      {isReconnecting && (
        <div className="absolute top-14 left-0 right-0 z-20 flex justify-center px-4" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="bg-orange-500 text-white px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-2 shadow-lg">
            <div className="w-3.5 h-3.5 border-2 border-white/60 border-t-white rounded-full animate-spin" />
            Reconnecting — hold tight…
          </div>
        </div>
      )}
      {!isReconnecting && isRecording && connectionQuality === ConnectionQuality.Poor && (
        <div className="absolute top-14 left-0 right-0 z-20 flex justify-center px-4" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="bg-yellow-500/95 text-black px-4 py-1.5 rounded-full text-xs font-semibold shadow-lg">
            Weak connection — video quality may be reduced
          </div>
        </div>
      )}

      {/* Duration Warning - centered, only when warning */}
      {durationWarning !== 'none' && durationWarning !== 'maxed' && (
        <div className="absolute top-20 left-0 right-0 z-10 flex justify-center">
          <div className={cn(
            'px-4 py-2 rounded-full text-sm font-semibold',
            durationWarning === '30sec' ? 'bg-red-500 animate-pulse text-white' :
            durationWarning === '1min' ? 'bg-orange-500 text-white' : 'bg-yellow-500 text-black'
          )}>
            {durationWarning === '30sec' && '30 seconds left!'}
            {durationWarning === '1min' && '1 minute left'}
            {durationWarning === '2min' && '2 minutes left'}
          </div>
        </div>
      )}

      {/* Bottom controls - centered stop button */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex justify-center" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 60px)' }}>
        {status === 'ready' && (
          <button
            onClick={() => { ensureAudioReady(); startRecording(); }}
            className="w-[72px] h-[72px] bg-red-500 hover:bg-red-600 active:bg-red-700 rounded-full flex items-center justify-center shadow-lg border-4 border-white/30"
            aria-label="Start recording"
          >
            <div className="w-6 h-6 bg-white rounded-full" />
          </button>
        )}
        {isRecording && !countingDown && (
          <button
            onClick={stopRecording}
            disabled={!recordingStarted}
            className={cn(
              'w-[72px] h-[72px] rounded-full flex items-center justify-center shadow-lg border-4 border-white/30',
              recordingStarted
                ? 'bg-red-500 hover:bg-red-600 active:bg-red-700'
                : 'bg-gray-500/60 cursor-not-allowed'
            )}
            aria-label={recordingStarted ? 'Stop recording' : 'Recording is starting, please wait'}
          >
            {recordingStarted ? (
              <div className="w-6 h-6 bg-white rounded-[4px]" />
            ) : (
              <div className="w-6 h-6 border-2 border-white/70 border-t-white rounded-full animate-spin" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default SelfServeRecorderLiveKit;
