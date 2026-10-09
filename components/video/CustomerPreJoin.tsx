// components/video/CustomerPreJoin.tsx - Lobby/waiting room for customers.
//
// Flow: priming screen (gesture-gated) → one combined camera+mic prompt →
// Do Not Disturb page → waiting room. The waiting room / consultant-start gate
// is unchanged: `ready` is reported once media is granted, and entry into the
// live call is still driven by the parent (callStatus === 'live').
'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Video,
  VideoOff,
  Loader2,
  SwitchCamera,
  RefreshCw,
  ShieldAlert,
  Camera,
  Mic,
  CheckCircle2,
  Clock,
  ExternalLink,
  Copy,
  Moon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAndroidCompatibleVideoTrack } from '@/lib/hooks/useAndroidCompatibleVideoTrack';
import { UnsupportedBrowserScreen } from './UnsupportedBrowserScreen';
import { detectInAppBrowser } from '@/lib/deviceDetection';
import { reportCallEvent } from '@/lib/call-telemetry';

type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied';

interface CustomerPreJoinProps {
  participantName?: string;
  agentPresent: boolean;
  agentDisplayName?: string | null;
  callStatus: 'lobby' | 'live' | 'ended';
  isScheduled: boolean;
  noShowExpired: boolean;
  onReadyChange?: (ready: boolean) => void;
  // The agent was in this lobby but their heartbeat went quiet — likely off
  // starting a fresh room; the presence poll will auto-redirect us there.
  agentSteppedAway?: boolean;
  // For pre-join telemetry (in-app-browser blocks, audio-only joins).
  roomId?: string;
  // Customer chose to join without a camera after a camera failure; the page
  // passes videoEnabled=false into the call so LiveKitRoom doesn't fight a
  // device we know is unavailable.
  onAudioOnlyChange?: (audioOnly: boolean) => void;
}

const GRADIENT = 'min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900';

function detectBrowser(): 'chrome' | 'safari' | 'firefox' | 'edge' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('chrome') && !ua.includes('edg/')) return 'chrome';
  if (ua.includes('safari')) return 'safari';
  return 'other';
}

function getPermissionInstructions(browser: ReturnType<typeof detectBrowser>): string {
  switch (browser) {
    case 'chrome':
    case 'edge':
      return 'Tap the camera/lock icon to the left of the address bar, set Camera and Microphone to Allow, then reload.';
    case 'safari':
      return 'Open Safari Settings → Websites → Camera and Microphone, set this site to Allow, then reload.';
    case 'firefox':
      return 'Tap the camera/lock icon in the address bar, clear the blocked permissions, then reload and try again.';
    default:
      return 'Open your browser settings and allow camera and microphone access for this site, then reload.';
  }
}

export default function CustomerPreJoin({
  participantName,
  agentPresent,
  agentDisplayName,
  callStatus,
  isScheduled,
  noShowExpired,
  onReadyChange,
  agentSteppedAway = false,
  roomId,
  onAudioOnlyChange,
}: CustomerPreJoinProps) {
  const previewElRef = useRef<HTMLVideoElement | null>(null);
  const [micPermission, setMicPermission] = useState<PermissionState>('unknown');
  const [cameraPermission, setCameraPermission] = useState<PermissionState>('unknown');
  const [audioOnly, setAudioOnly] = useState(false);
  const [isRequestingAudioOnly, setIsRequestingAudioOnly] = useState(false);
  // Gesture gating: the combined camera+mic prompt fires only after the
  // customer taps "I'm ready" (or is auto-skipped when already granted). This
  // makes getUserMedia run on a user gesture (more reliable on mobile) and
  // lets us set context before the browser asks.
  const [primed, setPrimed] = useState(false);
  const [dndAcknowledged, setDndAcknowledged] = useState(false);
  const browser = detectBrowser();

  // SMS/social links often open inside an in-app webview (Messenger, Instagram,
  // the generic Android WebView), where getUserMedia commonly fails — a major
  // source of "we both joined but couldn't see each other".
  const inAppBrowser = useMemo(() => detectInAppBrowser(), []);

  useEffect(() => {
    if (inAppBrowser && roomId) {
      reportCallEvent(roomId, 'customer', 'in_app_browser_blocked', { inAppBrowser });
    }
  }, [inAppBrowser, roomId]);

  const {
    videoTrack,
    audioTrack,
    isInitializing,
    error: cameraError,
    capabilities,
    deviceInfo,
    retry: startMedia,
    switchCamera,
    canSwitchCamera,
  } = useAndroidCompatibleVideoTrack({
    facingMode: 'user',
    // One combined "Camera and Microphone" prompt instead of two.
    enableAudio: true,
    // Gesture-gated: never acquire on mount; we trigger startMedia() explicitly.
    autoStart: false,
    onConstraintFallback: (from, to) => {
      console.log(`[CustomerPreJoin] Camera fallback: ${from} -> ${to}`);
      toast.info('Adjusted video quality for your device');
    },
  });

  const isMobile = deviceInfo?.isMobile ?? false;
  const isIOS = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return (
      /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)
    );
  }, []);

  // Attach the live camera to whichever preview <video> is currently mounted.
  // A CALLBACK REF — not a plain ref + effect — because the preview element
  // mounts at a different time than the track is acquired: in the combined-
  // prompt flow the camera track is ready during the Do Not Disturb slide, and
  // the lobby's <video> only mounts AFTER the customer finishes DND. An effect
  // keyed on the track alone never re-fires on that later mount, so the track
  // exists ("Camera: Ready") but is never attached → black preview. This fires
  // on every mount/unmount and swaps cleanly when the track changes (flip).
  const attachedTrackRef = useRef<typeof videoTrack>(null);
  const setPreviewVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      if (attachedTrackRef.current && previewElRef.current) {
        try { attachedTrackRef.current.detach(previewElRef.current); } catch {}
        attachedTrackRef.current = null;
      }
      previewElRef.current = el;
      if (el && videoTrack) {
        try {
          videoTrack.attach(el);
          attachedTrackRef.current = videoTrack;
          el.play?.().catch(() => {});
          // iOS Safari often paints this element black on mount even though the
          // camera is live and frames are flowing — a known repaint bug (NOT a
          // capture failure). Flipping fixes it only because it re-attaches a
          // track. So re-attach a couple times here to force Safari to paint.
          // Scheduled from the callback ref (not an effect) so it fires when
          // the element actually mounts — which, after the DND slide, is later
          // than when the track was acquired.
          if (isIOS) {
            [450, 1300, 2600].forEach((d) =>
              setTimeout(() => {
                if (previewElRef.current !== el || !videoTrack) return;
                try {
                  videoTrack.detach(el);
                  videoTrack.attach(el);
                  el.play?.().catch(() => {});
                } catch { /* best-effort repaint */ }
              }, d)
            );
          }
        } catch (e) {
          console.warn('[CustomerPreJoin] preview attach failed:', e);
        }
      }
    },
    [videoTrack, isIOS]
  );

  // Camera permission derived from the combined acquisition result.
  useEffect(() => {
    if (cameraError) {
      if (cameraError.type === 'PERMISSION_DISMISSED') setCameraPermission('prompt');
      else setCameraPermission('denied');
    } else if (videoTrack) {
      setCameraPermission('granted');
    }
  }, [videoTrack, cameraError]);

  // Mic permission derived from the SAME combined prompt: an audio track means
  // the combined grant succeeded; a permission denial on the combined prompt
  // denies the mic too. (A camera-busy failure is NOT a mic denial — the mic
  // can still be acquired for an audio-only join, see chooseAudioOnly.)
  useEffect(() => {
    if (audioTrack) setMicPermission('granted');
    else if (cameraError?.type === 'PERMISSION_DENIED') setMicPermission('denied');
  }, [audioTrack, cameraError]);

  // startMedia (the hook's retry) changes identity whenever a track is
  // (re)acquired; keep a ref so the mount effect below can call the latest one
  // without listing it as a dependency — otherwise the effect would re-run on
  // every acquisition and loop.
  const startMediaRef = useRef(startMedia);
  startMediaRef.current = startMedia;

  // Decide whether to show priming or skip it — ONCE on mount. Chromium can
  // tell us the state up front; Safari/Firefox throw on the query, so we simply
  // show priming and branch on the getUserMedia result after the tap.
  useEffect(() => {
    if (inAppBrowser) return; // the interstitial handles this — don't acquire.
    let cancelled = false;
    (async () => {
      if (typeof navigator === 'undefined' || !navigator.permissions) return; // show priming
      try {
        const [cam, mic] = await Promise.all([
          navigator.permissions.query({ name: 'camera' as PermissionName }),
          navigator.permissions.query({ name: 'microphone' as PermissionName }),
        ]);
        if (cancelled) return;
        if (cam.state === 'granted' && mic.state === 'granted') {
          // Returning customer — skip priming, acquire silently (no prompt).
          setPrimed(true);
          void startMediaRef.current();
        } else if (cam.state === 'denied' || mic.state === 'denied') {
          // Blocked earlier — skip priming and surface recovery via the lobby.
          setPrimed(true);
          void startMediaRef.current();
        }
        // else 'prompt' → leave the priming screen showing.
      } catch {
        // Query unsupported (Safari/iOS/Firefox) → show priming.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount; inAppBrowser is a stable memo and startMedia is reffed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePrime = useCallback(() => {
    setPrimed(true);
    if (roomId) reportCallEvent(roomId, 'customer', 'priming_accepted');
    void startMedia();
  }, [roomId, startMedia]);

  // Audio-only escape: a customer whose camera is held by another app (common
  // on Android) can still join by voice. The camera-busy failure did NOT grant
  // the mic (the combined call rejected), so acquire it now — permission is
  // already granted, so this won't prompt again.
  const chooseAudioOnly = useCallback(async () => {
    if (isRequestingAudioOnly) return;
    setIsRequestingAudioOnly(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission('granted');
      setAudioOnly(true);
      if (roomId) {
        reportCallEvent(roomId, 'customer', 'audio_only_join', {
          cameraErrorType: cameraError?.type,
          errorMessage: cameraError?.message,
        });
      }
    } catch {
      toast.error("Couldn't turn on your microphone. Check your browser's mic permission and try again.");
    } finally {
      setIsRequestingAudioOnly(false);
    }
  }, [isRequestingAudioOnly, roomId, cameraError]);

  const retryCameraFromAudioOnly = useCallback(() => {
    setAudioOnly(false);
    void startMedia();
  }, [startMedia]);

  const acknowledgeDnd = useCallback(
    (confirmed: boolean) => {
      setDndAcknowledged(true);
      if (roomId) reportCallEvent(roomId, 'customer', confirmed ? 'dnd_confirmed' : 'dnd_skipped');
    },
    [roomId]
  );

  // Audio-only escape: mic still required — the survey is useless without audio.
  const ready = (cameraPermission === 'granted' || audioOnly) && micPermission === 'granted';

  // The customer is only "ready to be brought into the call" once they have
  // finished BOTH slides: permissions granted AND Do Not Disturb acknowledged.
  // The parent gates call entry on this, and the consultant's Start button is
  // gated on it too — so the customer can't be pulled in mid-setup.
  const fullyReady = ready && dndAcknowledged;

  useEffect(() => {
    onReadyChange?.(fullyReady);
  }, [fullyReady, onReadyChange]);

  useEffect(() => {
    onAudioOnlyChange?.(audioOnly);
  }, [audioOnly, onAudioOnlyChange]);

  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const handleSwitchCamera = useCallback(async () => {
    if (isSwitchingCamera) return;
    setIsSwitchingCamera(true);
    try {
      await switchCamera();
    } catch (error) {
      console.error('Failed to switch camera:', error);
      toast.error('Failed to switch camera');
    } finally {
      setIsSwitchingCamera(false);
    }
  }, [switchCamera, isSwitchingCamera]);

  // ── Terminal states — win over everything, need no camera ──────────────
  if (noShowExpired && isScheduled) {
    return (
      <div className={`${GRADIENT} flex items-center justify-center p-4`}>
        <div className="relative z-10 w-full max-w-md bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-yellow-500/20 mx-auto mb-4 flex items-center justify-center">
            <Clock className="w-8 h-8 text-yellow-300" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Your consultant is delayed</h1>
          <p className="text-white/80 leading-relaxed">
            We're sorry — looks like your moving consultant hasn't been able to join yet. They'll reach out to reschedule shortly. You can close this window.
          </p>
        </div>
      </div>
    );
  }

  if (callStatus === 'ended') {
    return (
      <div className={`${GRADIENT} flex items-center justify-center p-4`}>
        <div className="relative z-10 w-full max-w-md bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 text-center">
          <h1 className="text-2xl font-bold text-white mb-2">This call has ended</h1>
          <p className="text-white/80">You can close this window. Thanks!</p>
        </div>
      </div>
    );
  }

  if (inAppBrowser) {
    return (
      <div className={`${GRADIENT} flex items-center justify-center p-4`}>
        <div className="relative z-10 w-full max-w-md bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-blue-500/20 mx-auto mb-4 flex items-center justify-center">
            <ExternalLink className="w-8 h-8 text-blue-300" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Open in your browser</h1>
          <p className="text-white/80 leading-relaxed mb-4">
            Video calls don&apos;t work reliably inside {inAppBrowser}. Tap the menu
            (usually <span className="font-semibold">⋯</span> or{' '}
            <span className="font-semibold">↗</span>) and choose{' '}
            <span className="font-semibold">&ldquo;Open in browser&rdquo;</span> — or copy the
            link below and paste it into Chrome or Safari.
          </p>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href).then(
                () => toast.success('Link copied — paste it into your browser'),
                () => toast.error('Could not copy — long-press the address bar instead')
              );
            }}
            className="w-full px-4 py-3 bg-white/15 hover:bg-white/25 rounded-xl text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
          >
            <Copy className="w-4 h-4" />
            Copy call link
          </button>
        </div>
      </div>
    );
  }

  if (capabilities && !capabilities.isSupported) {
    return <UnsupportedBrowserScreen reason={capabilities.unsupportedReason} deviceInfo={deviceInfo} />;
  }

  // ── Priming screen — value first, on a screen we control. The button is
  //    what fires the single combined camera+mic prompt. ──────────────────
  if (!primed) {
    return (
      <div className={`${GRADIENT} flex flex-col items-center justify-center p-4 relative`}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        </div>
        <div className="relative z-10 w-full max-w-md">
          {participantName && (
            <p className="text-center text-white/70 mb-4">
              Joining as <span className="text-white font-medium">{participantName}</span>
            </p>
          )}
          <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-7">
            <div className="w-full aspect-[5/3] rounded-2xl bg-white/5 border border-white/15 flex items-center justify-center mb-5">
              <Video className="w-11 h-11 text-white/70" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2 text-center">Ready for your video tour?</h1>
            <p className="text-white/75 text-center leading-relaxed mb-5">
              We&apos;ll set up your camera and mic together so your consultant can see your home as you walk.
            </p>
            <div className="space-y-2 mb-5">
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5 border border-white/12 text-white/90 text-sm font-medium">
                <Video className="w-4 h-4" /> Camera
              </div>
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/5 border border-white/12 text-white/90 text-sm font-medium">
                <Mic className="w-4 h-4" /> Microphone
              </div>
              <p className="text-center text-white/50 text-xs font-medium tracking-wide">enabled together · one tap</p>
            </div>
            <button
              onClick={handlePrime}
              className="w-full py-3.5 bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 text-white rounded-2xl font-semibold text-base transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30"
            >
              <Camera className="w-5 h-5" />
              I&apos;m ready — turn on both
            </button>
            <p className="text-center text-white/55 text-xs mt-4">
              When your phone asks, tap <span className="font-semibold text-white/80">Allow</span> — it covers both.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Do Not Disturb page — its own screen, non-blocking. We can't set or
  //    verify DND from the web, so this is honest coaching + a soft confirm;
  //    Skip and the button both continue. ─────────────────────────────────
  if (ready && !dndAcknowledged) {
    const isAndroid = deviceInfo?.isAndroid ?? false;
    return (
      <div className={`${GRADIENT} flex flex-col items-center justify-center p-4 relative`}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        </div>
        <div className="relative z-10 w-full max-w-md">
          <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-7 text-center">
            <div className="w-16 h-16 rounded-full bg-blue-300/15 border border-blue-300/35 mx-auto mb-5 flex items-center justify-center">
              <Moon className="w-8 h-8 text-blue-200" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">One quick thing before we start</h1>
            <p className="text-white/75 leading-relaxed mb-5">
              An incoming phone call can cut off your mic mid-tour. Turn on Do Not Disturb so nothing interrupts.
            </p>
            <div className="flex items-start gap-3 text-left bg-white/5 border border-white/12 rounded-2xl p-4 mb-6">
              <div className="w-9 h-9 rounded-xl bg-black/25 flex items-center justify-center flex-shrink-0">
                <Moon className="w-4 h-4 text-white" />
              </div>
              <p className="text-white/85 text-sm leading-relaxed">
                {isAndroid ? (
                  <>Swipe down from the top of your screen and tap <span className="font-semibold text-white">Do Not Disturb</span>.</>
                ) : (
                  <>Swipe down from the top-right corner and tap the <span className="font-semibold text-white">moon</span> (Focus / Do Not Disturb).</>
                )}
              </p>
            </div>
            <button
              onClick={() => acknowledgeDnd(true)}
              className="w-full py-3.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-500 hover:to-blue-700 text-white rounded-2xl font-semibold text-base transition-all active:scale-[0.98] shadow-lg shadow-blue-900/30"
            >
              I&apos;ve turned on Do Not Disturb
            </button>
            <button
              onClick={() => acknowledgeDnd(false)}
              className="mt-3 text-white/55 hover:text-white/80 text-sm font-medium transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Lobby — camera preview, permission status / recovery, and the
  //    waiting room. The consultant-start gate is unchanged. ──────────────
  const permissionsDenied = (!audioOnly && cameraPermission === 'denied') || micPermission === 'denied';
  // The customer closed the combined prompt without choosing (Chrome reports
  // this as "dismissed"): permission is still 'prompt', so re-firing works.
  const promptDismissed = !ready && !audioOnly && cameraError?.type === 'PERMISSION_DISMISSED';
  // Only show the "setting up" spinner while genuinely acquiring — not when an
  // error (e.g. a dismissed prompt) is already showing, which would strand the
  // customer on a spinner with no way out.
  const permissionsPending = !ready && !permissionsDenied && !cameraError;
  // Offer audio-only only when the camera failed but the mic is still
  // acquirable (e.g. camera busy) — not when the mic itself was denied.
  const offerAudioOnly =
    !audioOnly &&
    cameraPermission === 'denied' &&
    (micPermission === 'unknown' || micPermission === 'prompt');

  return (
    <div className={`${GRADIENT} flex flex-col items-center justify-center p-4 relative`}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white mb-2">
            {/* The "Welcome to your call" waiting room only appears AFTER the
                customer has finished the Do Not Disturb slide. Before that,
                this screen is the permissions slide (requesting / recovering
                camera + mic), so it gets a setup header instead. */}
            {!dndAcknowledged
              ? 'Set up your camera and microphone'
              : ready && agentPresent && callStatus === 'lobby'
                ? "You're all set!"
                : 'Welcome to your call'}
          </h1>
          {participantName && (
            <p className="text-white/70">
              Joining as <span className="text-white font-medium">{participantName}</span>
            </p>
          )}
        </div>

        <div className="bg-white/10 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden">
          {/* Camera preview */}
          <div className="relative aspect-[4/3] bg-black/50 overflow-hidden">
            <video
              ref={setPreviewVideoEl}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${deviceInfo?.isAndroid ? 'android-video-fix' : ''}`}
            />

            {isInitializing && cameraPermission !== 'denied' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-white animate-spin" />
              </div>
            )}

            {audioOnly && (
              <div className="absolute inset-0 flex items-center justify-center text-white bg-gradient-to-b from-black/70 to-black/85">
                <div className="text-center p-6 max-w-xs">
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 mx-auto mb-4 flex items-center justify-center">
                    <Mic className="w-8 h-8 text-blue-300" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Joining without camera</h3>
                  <p className="text-sm text-white/80 leading-relaxed mb-3">
                    You&apos;ll be connected by voice. Your consultant needs video for the
                    home tour, so try the camera again when you can.
                  </p>
                  <button
                    onClick={retryCameraFromAudioOnly}
                    className="px-4 py-2 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Try camera again
                  </button>
                </div>
              </div>
            )}

            {cameraError && !audioOnly && (
              <div className="absolute inset-0 flex items-center justify-center text-white bg-gradient-to-b from-black/70 to-black/85">
                <div className="text-center p-6 max-w-xs">
                  <div className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center ${
                    cameraError.type === 'PERMISSION_DENIED' || cameraError.type === 'PERMISSION_DISMISSED'
                      ? 'bg-yellow-500/20'
                      : cameraError.type === 'CAMERA_IN_USE'
                      ? 'bg-orange-500/20'
                      : 'bg-red-500/20'
                  }`}>
                    {cameraError.type === 'PERMISSION_DENIED' || cameraError.type === 'PERMISSION_DISMISSED' ? (
                      <ShieldAlert className="w-8 h-8 text-yellow-400" />
                    ) : cameraError.type === 'CAMERA_IN_USE' ? (
                      <Camera className="w-8 h-8 text-orange-400" />
                    ) : (
                      <VideoOff className="w-8 h-8 text-red-400" />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">
                    {cameraError.type === 'PERMISSION_DENIED' ? 'Camera blocked' :
                     cameraError.type === 'PERMISSION_DISMISSED' ? 'Please allow camera' :
                     cameraError.type === 'CAMERA_IN_USE' ? 'Camera in use' :
                     cameraError.type === 'NO_CAMERA' ? 'No camera found' :
                     'Camera problem'}
                  </h3>
                  <p className="text-sm text-white/80 leading-relaxed">{cameraError.message}</p>
                </div>
              </div>
            )}

            {isMobile && !cameraError && canSwitchCamera && (
              <button
                onClick={handleSwitchCamera}
                disabled={isSwitchingCamera}
                className="absolute top-4 right-4 w-12 h-12 rounded-full bg-black/40 backdrop-blur-lg flex items-center justify-center text-white transition-all active:scale-95 disabled:opacity-50"
              >
                {isSwitchingCamera ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <SwitchCamera className="w-5 h-5" />
                )}
              </button>
            )}
          </div>

          <div className="p-6 space-y-4">
            {/* Permission status */}
            <div className="space-y-2.5">
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                cameraPermission === 'granted'
                  ? 'bg-emerald-500/15 text-emerald-100 border border-emerald-400/30'
                  : cameraPermission === 'denied'
                  ? 'bg-red-500/15 text-red-100 border border-red-400/30'
                  : 'bg-white/5 text-white/70 border border-white/15'
              }`}>
                <span className="flex items-center gap-2 text-sm">
                  <Video className="w-4 h-4" />
                  Camera
                </span>
                <span className="text-xs font-medium">
                  {audioOnly ? 'Skipped' : cameraPermission === 'granted' ? 'Ready' : cameraPermission === 'denied' ? 'Blocked' : 'Checking…'}
                </span>
              </div>
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                micPermission === 'granted'
                  ? 'bg-emerald-500/15 text-emerald-100 border border-emerald-400/30'
                  : micPermission === 'denied'
                  ? 'bg-red-500/15 text-red-100 border border-red-400/30'
                  : 'bg-white/5 text-white/70 border border-white/15'
              }`}>
                <span className="flex items-center gap-2 text-sm">
                  <Mic className="w-4 h-4" />
                  Microphone
                </span>
                <span className="text-xs font-medium">
                  {micPermission === 'granted' ? 'Ready' : micPermission === 'denied' ? 'Blocked' : 'Checking…'}
                </span>
              </div>
            </div>

            {/* Permission recovery actions */}
            {permissionsDenied && (
              <div className="bg-yellow-500/10 border border-yellow-400/30 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-5 h-5 text-yellow-300 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-yellow-100 leading-relaxed">
                    <strong>Camera and microphone access required.</strong> {getPermissionInstructions(browser)}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cameraPermission === 'denied' && (
                    <button
                      onClick={() => startMedia()}
                      className="px-3 py-2.5 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 text-white"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Retry Camera
                    </button>
                  )}
                  {micPermission === 'denied' && (
                    <button
                      onClick={() => startMedia()}
                      className="px-3 py-2.5 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 text-white"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Retry Microphone
                    </button>
                  )}
                </div>
                {offerAudioOnly && (
                  <button
                    onClick={chooseAudioOnly}
                    disabled={isRequestingAudioOnly}
                    className="w-full px-3 py-2.5 bg-blue-500/80 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 text-white disabled:opacity-50"
                  >
                    {isRequestingAudioOnly ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                    Can&apos;t fix the camera? Join with audio only
                  </button>
                )}
              </div>
            )}

            {/* Dismissed prompt — re-fire it (permission is still undecided). */}
            {promptDismissed && (
              <div className="bg-yellow-500/10 border border-yellow-400/30 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-5 h-5 text-yellow-300 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-yellow-100 leading-relaxed">
                    <strong>You closed the permission request.</strong> Tap below and choose <strong>Allow</strong> so your consultant can see and hear you.
                  </div>
                </div>
                <button
                  onClick={() => startMedia()}
                  className="w-full px-3 py-2.5 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 text-white"
                >
                  <RefreshCw className="w-4 h-4" />
                  Turn on camera &amp; microphone
                </button>
              </div>
            )}

            {/* Status pill */}
            {ready && (
              <div className={`rounded-xl px-4 py-3 border text-sm flex items-center gap-2.5 ${
                agentPresent
                  ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100'
                  : 'bg-white/5 border-white/15 text-white/70'
              }`}>
                {agentPresent ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                    <span>
                      <span className="font-semibold">{agentDisplayName || 'Your consultant'}</span> has joined. Waiting for them to start the meeting…
                    </span>
                  </>
                ) : agentSteppedAway ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                    <span>
                      Your consultant stepped away for a moment — hang tight, we&apos;ll
                      connect you automatically.
                    </span>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                    <span>Waiting for your moving consultant to join…</span>
                  </>
                )}
              </div>
            )}

            {permissionsPending && (
              <div className="rounded-xl px-4 py-3 border bg-white/5 border-white/15 text-white/70 text-sm flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Setting up your camera and microphone…</span>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-white/50 text-sm mt-4">
          Your call will start automatically once your consultant is ready.
        </p>
      </div>
    </div>
  );
}
