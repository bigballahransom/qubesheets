// lib/hooks/useSelfServeRecordingLiveKit.ts
// Hook for self-serve recording using LiveKit (server-side recording via Egress)
import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, ConnectionState, ConnectionQuality, Track, LocalParticipant, Participant } from 'livekit-client';
import { detectInAppBrowser, getBrowser, isIOS, isAndroid } from '@/lib/deviceDetection';

/**
 * Fire-and-forget telemetry to /api/self-serve/[token]/video/telemetry.
 * Used to surface device/failure info from real customers' devices in the
 * server log without remote-debugging access. Never throws, never awaits.
 */
export function sendTelemetry(uploadToken: string, payload: Record<string, unknown>) {
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
    // sendBeacon is best-effort and survives page unload.
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(`/api/self-serve/${uploadToken}/video/telemetry`, blob);
    } else {
      fetch(`/api/self-serve/${uploadToken}/video/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true
      }).catch(() => { /* swallow */ });
    }
  } catch {
    /* never propagate */
  }
}

/**
 * Reject if `promise` doesn't settle within `ms`. Caps every stage of
 * initialization so the customer never stares at an infinite spinner — a
 * hung WebSocket, a camera held by another app, or a stalled fetch all
 * resolve to an actionable error screen instead.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

export type RecordingStatus =
  | 'idle'
  | 'initializing'
  | 'connecting'
  | 'ready'
  | 'recording'
  | 'stopping'
  | 'processing'
  | 'complete'
  | 'error';

/** Which stage of initialization is in flight — lets the UI show accurate
 *  progress copy ("Waiting for camera access…") instead of one generic
 *  "Connecting…" for the whole pipeline. */
export type InitStage = 'session' | 'connect' | 'camera';

/** Classified failure cause, so the UI can show a recovery path that matches
 *  the actual problem instead of one generic "Something went wrong". */
export type RecordingErrorKind =
  | 'permission_denied'          // user denied camera/mic (or it was already denied for the site)
  | 'camera_in_use'              // NotReadableError — another app holds the camera
  | 'camera_not_found'           // no usable camera on the device
  | 'disconnected_mid_recording' // network died while recording; partial footage was saved
  | 'partial_capture'            // stop looked normal, but the server's file is much shorter than the time the user recorded
  | 'capture_interrupted_saved'  // a call took the camera and it came back dead (or never came back); footage up to the interruption was saved (local engine)
  | 'upload_failed'              // egress ended but the server never confirmed a saved file
  | 'nothing_captured'           // local engine: the browser produced zero video data (dead MediaRecorder on every codec) — nothing exists to retry; route to file upload
  | 'unsupported_browser'        // in-app webview / no WebRTC
  | 'generic';

export interface UseSelfServeRecordingLiveKitOptions {
  uploadToken: string;
  maxDuration?: number; // seconds
  onRecordingComplete?: (sessionId?: string) => void;
  onError?: (error: Error) => void;
  onDurationWarning?: (warning: 'none' | '2min' | '1min' | '30sec', remaining: number) => void;
}

export interface UseSelfServeRecordingLiveKitReturn {
  // State
  status: RecordingStatus;
  sessionId: string | null;
  duration: number;
  durationWarning: 'none' | '2min' | '1min' | '30sec' | 'maxed';
  remainingTime: number;
  connectionState: ConnectionState;
  isRecording: boolean;
  /** True once /start-recording has returned successfully. Use this to gate
   *  the Stop button so users can't kill a recording before the server-side
   *  egress has begun. */
  recordingStarted: boolean;
  error: Error | null;
  facingMode: 'environment' | 'user';
  /** Which initialization stage is in flight (only meaningful while status is
   *  'initializing' or 'connecting'). */
  initStage: InitStage;
  /** True while the camera track is muted/dead during a recording (screen
   *  locked, app backgrounded, lens taken by the OS). The UI should show a
   *  prominent "we can't see your camera" warning; the hook auto-stops the
   *  recording if this persists ~30s so we never save minutes of black video. */
  cameraInterrupted: boolean;
  /** What actually went wrong when status is 'error' — drives which recovery
   *  screen the UI shows. Null while there is no error. */
  errorKind: RecordingErrorKind | null;
  /** For permission_denied errors: true = the user saw the browser prompt
   *  and denied it (a reload can re-prompt on WebKit); false = getUserMedia
   *  failed instantly with no prompt (hard-blocked at site/OS level — only a
   *  settings change helps); null = no permission failure yet. */
  permissionPromptShown: boolean | null;
  /** Seconds of footage that were already safely recorded when a
   *  mid-recording disconnect happened (for "your first X:XX was saved"). */
  savedDuration: number;
  /** Publisher-side connection quality, live. 'poor' means the egress is
   *  currently receiving degraded video — surface it to the user. */
  connectionQuality: ConnectionQuality;
  /** True while LiveKit is attempting to re-establish a dropped connection. */
  isReconnecting: boolean;
  /** Post-stop server confirmation: true = webhook confirmed the file saved,
   *  false = server reported failure, null = not yet confirmed (still
   *  finalizing when the poll window closed). */
  uploadConfirmed: boolean | null;

  // LiveKit data
  room: Room | null;
  localVideoTrack: Track | null;

  // Video element ref for preview
  videoRef: React.RefObject<HTMLVideoElement | null>;

  // Actions
  initialize: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  flipCamera: () => Promise<void>;
  /** Reset out of the error state and run initialization again in place —
   *  no full page reload. Creates a fresh session server-side. */
  retryFromError: () => Promise<void>;
  cleanup: () => void;
}

export function useSelfServeRecordingLiveKit({
  uploadToken,
  maxDuration = 1200,
  onRecordingComplete,
  onError,
  onDurationWarning
}: UseSelfServeRecordingLiveKitOptions): UseSelfServeRecordingLiveKitReturn {
  // State
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [durationWarning, setDurationWarning] = useState<'none' | '2min' | '1min' | '30sec' | 'maxed'>('none');
  const [remainingTime, setRemainingTime] = useState(maxDuration);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [error, setError] = useState<Error | null>(null);
  const [localVideoTrack, setLocalVideoTrack] = useState<Track | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment'); // Default to back camera

  // Refs
  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusRef: { current: RecordingStatus } = useRef<RecordingStatus>('idle'); // Track status in ref for callbacks
  const durationWarningRef = useRef<'none' | '2min' | '1min' | '30sec' | 'maxed'>('none');
  const sessionDataRef = useRef<{
    sessionId: string;
    roomName: string;
    wsUrl: string;
  } | null>(null);
  const durationRef = useRef<number>(0); // Track duration in ref for callbacks
  const isStartingRef = useRef<boolean>(false); // Synchronous guard to prevent double-calls
  // Promise-handle for the in-flight /start-recording call. Used by stopRecording
  // to avoid the race where the user taps Stop before the server-side egress
  // has been registered with session.egressId.
  const startInFlightRef = useRef<Promise<void> | null>(null);
  // True once /start-recording has returned successfully (server has an egress
  // ID, the egress is at least starting). Used to gate the Stop button so the
  // user can't kill a recording that hasn't fully begun on the server.
  const [recordingStarted, setRecordingStarted] = useState(false);
  const [initStage, setInitStage] = useState<InitStage>('session');
  const [errorKind, setErrorKind] = useState<RecordingErrorKind | null>(null);
  const [permissionPromptShown, setPermissionPromptShown] = useState<boolean | null>(null);
  const [savedDuration, setSavedDuration] = useState(0);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [uploadConfirmed, setUploadConfirmed] = useState<boolean | null>(null);

  // ─── Camera watchdog + wake lock ─────────────────────────────────
  // The #1 real-world failure: the phone locks or the app is backgrounded
  // mid-walkthrough, the camera track mutes, and the egress records black
  // video with live audio. The watchdog surfaces it to the customer
  // immediately and auto-stops before minutes of black footage accumulate.
  const [cameraInterrupted, setCameraInterrupted] = useState(false);
  const wakeLockRef = useRef<any>(null);
  const interruptWarnTimerRef = useRef<NodeJS.Timeout | null>(null); // debounce transient blips (camera flip)
  const deadVideoStopTimerRef = useRef<NodeJS.Timeout | null>(null); // auto-stop after sustained dead video
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {}); // set below; lets watchdog call stop without dep cycles

  const DEAD_VIDEO_AUTO_STOP_MS = 30_000;
  const INTERRUPT_WARN_DELAY_MS = 1_500;

  // ─── Reconnect give-up cap ───────────────────────────────────────
  // LiveKit can sit in 'Reconnecting' indefinitely (iOS Safari suspends the
  // page mid-retry and the Disconnected event never fires) while the
  // server-side room has already closed and finalized the egress. Without a
  // cap, the UI keeps showing REC + a ticking timer while nothing reaches
  // the server — the user walks their whole house recording into the void.
  const RECONNECT_GIVE_UP_MS = 60_000;
  const reconnectGiveUpTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Wall-clock accounting for time spent reconnecting, so the duration timer
  // can exclude it: footage isn't reaching the server during a reconnect, and
  // an inflated timer is what makes a partial capture look like success.
  const reconnectStartedAtMsRef = useRef<number | null>(null);
  const reconnectPausedMsRef = useRef<number>(0);

  // Keep the screen awake while the camera is live. Without this, phones
  // auto-lock mid-walkthrough (the user is holding the phone up, not
  // touching it), which kills the camera track. Released in cleanup(); the
  // OS auto-releases when the page is hidden, so we re-acquire on
  // visibilitychange. Best-effort: unsupported browsers just keep the
  // pre-wake-lock behavior.
  const acquireWakeLock = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      /* denied or unsupported — non-fatal */
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    try { wakeLockRef.current?.release(); } catch {}
    wakeLockRef.current = null;
  }, []);

  const clearWatchdogTimers = useCallback(() => {
    if (interruptWarnTimerRef.current) { clearTimeout(interruptWarnTimerRef.current); interruptWarnTimerRef.current = null; }
    if (deadVideoStopTimerRef.current) { clearTimeout(deadVideoStopTimerRef.current); deadVideoStopTimerRef.current = null; }
  }, []);

  const onCameraDead = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    if (interruptWarnTimerRef.current || deadVideoStopTimerRef.current) return; // already tracking
    // Small delay so a camera flip's transient unpublish doesn't flash the warning.
    interruptWarnTimerRef.current = setTimeout(() => {
      interruptWarnTimerRef.current = null;
      if (statusRef.current !== 'recording') return;
      setCameraInterrupted(true);
      sendTelemetry(uploadToken, { event: 'camera_interrupted', durationAtInterrupt: durationRef.current });
      deadVideoStopTimerRef.current = setTimeout(() => {
        deadVideoStopTimerRef.current = null;
        if (statusRef.current !== 'recording') return;
        console.warn('⚠️ Camera dead for 30s while recording — auto-stopping to avoid black video');
        sendTelemetry(uploadToken, { event: 'auto_stopped_dead_video', durationAtStop: durationRef.current });
        stopRecordingRef.current();
      }, DEAD_VIDEO_AUTO_STOP_MS);
    }, INTERRUPT_WARN_DELAY_MS);
  }, [uploadToken]);

  const onCameraAlive = useCallback(() => {
    clearWatchdogTimers();
    setCameraInterrupted(false);
  }, [clearWatchdogTimers]);

  // Best-effort server-side stop that works even while the page is being torn
  // down (pagehide) or after the room connection is already gone. Without
  // this, an abandoned session leaves the egress recording an empty (black)
  // room until the LiveKit room's emptyTimeout closes it.
  const bestEffortStop = useCallback(() => {
    const sid = sessionDataRef.current?.sessionId;
    if (!sid) return;
    try {
      const body = JSON.stringify({ sessionId: sid });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          `/api/self-serve/${uploadToken}/video/stop`,
          new Blob([body], { type: 'application/json' })
        );
      } else {
        fetch(`/api/self-serve/${uploadToken}/video/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true
        }).catch(() => {});
      }
    } catch {
      /* best-effort only */
    }
  }, [uploadToken]);

  // Keep refs in sync with state
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    durationWarningRef.current = durationWarning;
  }, [durationWarning]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Cleanup function — releases camera/mic and disconnects from LiveKit.
  // Belt-and-suspenders: in addition to room.disconnect() (which stops local
  // tracks), explicitly stop any tracks attached to videoRef and any tracks
  // we still hold a handle to. iOS Safari can otherwise keep the camera
  // light / orange dot showing on the completion screen.
  const cleanup = useCallback(() => {
    console.log('🧹 Cleaning up LiveKit recording...');

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (reconnectGiveUpTimerRef.current) {
      clearTimeout(reconnectGiveUpTimerRef.current);
      reconnectGiveUpTimerRef.current = null;
    }
    reconnectStartedAtMsRef.current = null;

    clearWatchdogTimers();
    setCameraInterrupted(false);
    releaseWakeLock();

    // Stop any local participant tracks before disconnecting (LiveKit's
    // disconnect should do this, but on iOS Safari we've seen the camera
    // indicator hang around without these explicit stops).
    if (roomRef.current) {
      try {
        roomRef.current.localParticipant.trackPublications.forEach(pub => {
          try { pub.track?.stop(); } catch {}
          try { pub.track?.detach().forEach(el => { (el as HTMLMediaElement).srcObject = null; }); } catch {}
        });
      } catch {}
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    // Detach the preview <video> element from any MediaStream so iOS
    // releases the camera/mic immediately.
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      } catch {}
    }

    setLocalVideoTrack(null);
  }, [clearWatchdogTimers, releaseWakeLock]);

  // Shared mid-recording failure path: the connection is gone (or the server
  // already finalized the egress without us). Stop the egress server-side so
  // it doesn't keep recording an empty room, release the camera, and show
  // the recovery screen. The footage up to the drop IS saved (the egress
  // finalizes on stop) — savedDuration lets the UI say so instead of
  // implying total loss. When the server has told us the real file duration,
  // prefer it over the client timer.
  const failRecordingAsDisconnected = useCallback((telemetryEvent: string, serverSavedDuration?: number | null) => {
    // 'stopping' is included for the stop-while-offline path: the user tapped
    // Stop but the /stop request couldn't reach the server.
    if (!['recording', 'stopping'].includes(statusRef.current)) return;
    console.error(`❌ Recording lost mid-flight (${telemetryEvent})`);
    sendTelemetry(uploadToken, {
      event: telemetryEvent,
      durationAtDisconnect: durationRef.current,
      ...(typeof serverSavedDuration === 'number' ? { serverSavedDuration } : {})
    });
    bestEffortStop();
    cleanup();
    setSavedDuration(typeof serverSavedDuration === 'number' ? serverSavedDuration : durationRef.current);
    setIsReconnecting(false);
    setErrorKind('disconnected_mid_recording');
    setError(new Error('Connection lost during recording'));
    setStatus('error');
  }, [uploadToken, bestEffortStop, cleanup]);

  // After the page comes back from being hidden mid-recording (screen lock,
  // app switch), ask the server whether the session is actually still live.
  // iOS suspension freezes LiveKit's reconnect loop, so the room can close
  // and the egress finalize without any client event ever firing — the UI
  // would happily keep showing REC. The webhook flips the session to
  // analyzing/completed/failed the moment the egress finalizes, so any of
  // those (or a finished egressStatus) while we think we're recording means
  // the recording is already over.
  const verifyServerSessionAlive = useCallback(async () => {
    const sid = sessionDataRef.current?.sessionId;
    if (!sid || statusRef.current !== 'recording') return;
    try {
      const res = await fetch(`/api/self-serve/${uploadToken}/video/status?sessionId=${encodeURIComponent(sid)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (statusRef.current !== 'recording') return; // stopped while we polled
      const egressDone = ['completed', 'failed', 'aborted'].includes(data.egressStatus);
      const sessionDone = ['analyzing', 'completed', 'failed'].includes(data.status);
      if (egressDone || sessionDone) {
        failRecordingAsDisconnected(
          'stale_recording_detected_on_resume',
          typeof data.duration === 'number' ? data.duration : null
        );
      }
    } catch {
      /* offline or transient — the reconnect give-up cap covers this path */
    }
  }, [uploadToken, failRecordingAsDisconnected]);

  // Handle connection state changes.
  // NOTE: Connected deliberately does NOT transition to 'ready' here — 'ready'
  // is only set at the end of initialize(), after the camera is live. The UI
  // auto-starts the server-side egress on 'ready', so going ready on WebSocket
  // connect would start the egress while the OS permission prompt is still
  // open and record black video.
  const handleConnectionStateChanged = useCallback((state: ConnectionState) => {
    console.log(`📡 Connection state: ${state}, current status: ${statusRef.current}`);
    setConnectionState(state);

    if (state === ConnectionState.Disconnected && statusRef.current === 'recording') {
      // Unexpected disconnect during recording (LiveKit's automatic reconnect
      // has already given up by the time Disconnected fires).
      failRecordingAsDisconnected('disconnected_while_recording');
    }
  }, [failRecordingAsDisconnected]);

  // Handle track subscribed (for local preview)
  const handleLocalTrackPublished = useCallback((publication: any, participant: LocalParticipant) => {
    const track = publication.track;
    if (track && track.kind === Track.Kind.Video) {
      console.log('📹 Local video track published');
      setLocalVideoTrack(track);
      // Camera (re)published — e.g. after a flip — means video is alive again.
      onCameraAlive();

      // Attach to video element for preview
      if (videoRef.current) {
        track.attach(videoRef.current);
      }
    }
  }, [onCameraAlive]);

  // Page visibility: backgrounding/locking the phone mutes the camera on
  // mobile browsers. Mark the interruption immediately (don't wait for the
  // LiveKit mute event, which can lag), and on return re-acquire the wake
  // lock (the OS force-releases it when the page hides).
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (statusRef.current === 'recording') {
          sendTelemetry(uploadToken, { event: 'page_hidden_while_recording', durationAtHide: durationRef.current });
          onCameraDead();
        }
      } else {
        if (statusRef.current === 'recording' || statusRef.current === 'ready') {
          acquireWakeLock();
        }
        // The room may have closed and the egress finalized while the page
        // was suspended — no client event fires for that. Verify with the
        // server instead of trusting local state.
        if (statusRef.current === 'recording') {
          verifyServerSessionAlive();
        }
        // If the camera track survived the backgrounding, clear the warning;
        // if it's still muted, leave the watchdog armed (TrackUnmuted will
        // clear it when the camera actually comes back).
        const camTrack = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camTrack && !camTrack.isMuted && camTrack.track) {
          onCameraAlive();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [uploadToken, onCameraDead, onCameraAlive, acquireWakeLock, verifyServerSessionAlive]);

  // Closing the tab / navigating away mid-recording: finalize the egress via
  // sendBeacon (survives page teardown) so the server saves what was captured
  // instead of recording an empty room until the room's emptyTimeout.
  // Deliberately NOT on visibilitychange:hidden — backgrounding gets the
  // watchdog's 30s grace period instead of an instant stop.
  useEffect(() => {
    const onPageHide = () => {
      if (statusRef.current === 'recording' || statusRef.current === 'stopping') {
        bestEffortStop();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [bestEffortStop]);

  // Initialize session and connect to LiveKit
  const initialize = useCallback(async () => {
    if (statusRef.current !== 'idle') {
      console.log('⚠️ Already initialized, current status:', statusRef.current);
      return;
    }

    // Always log the attempt (so even successful init is visible in server log).
    sendTelemetry(uploadToken, {
      event: 'initialize_started',
      browser: getBrowser(),
      platform: isIOS() ? 'iOS' : isAndroid() ? 'Android' : 'Other'
    });

    // FAIL FAST in known broken in-app webviews. These (Instagram, Messenger,
    // TikTok, etc.) lack proper WebRTC support and would otherwise produce
    // cryptic "string did not match the expected pattern" errors deep inside
    // LiveKit's room.connect(). Tell the user up front to open in Safari/Chrome.
    const inAppBrowser = detectInAppBrowser();
    if (inAppBrowser) {
      console.warn(`🚫 Detected in-app browser: ${inAppBrowser}`);
      sendTelemetry(uploadToken, {
        event: 'in_app_browser_blocked',
        inAppBrowser,
        browser: getBrowser()
      });
      const error = new Error(
        `Recording isn't supported inside the ${inAppBrowser} browser. ` +
        `Please open this link in Safari or Chrome to record your home walkthrough.`
      );
      setErrorKind('unsupported_browser');
      setError(error);
      setStatus('error');
      onError?.(error);
      return;
    }

    // FAIL FAST on an already-denied camera permission. Browsers never
    // re-show the prompt after a hard deny — getUserMedia would just fail
    // instantly later. Detecting it up front skips session creation and lands
    // the user directly on the per-platform "how to re-enable" instructions.
    // permissions.query support for 'camera' is spotty (Safari 16+); any
    // throw means "unknown" and we proceed normally.
    try {
      const perm = await (navigator as any).permissions?.query?.({ name: 'camera' });
      if (perm?.state === 'denied') {
        console.warn('🚫 Camera permission already denied for this site');
        sendTelemetry(uploadToken, { event: 'camera_permission_predenied', browser: getBrowser() });
        const error = new Error('Camera access is turned off for this site.');
        // Pre-denied via the Permissions API = blocked before any prompt.
        setPermissionPromptShown(false);
        setErrorKind('permission_denied');
        setError(error);
        setStatus('error');
        onError?.(error);
        return;
      }
    } catch {
      /* query unsupported — proceed and let getUserMedia decide */
    }

    setStatus('initializing');
    setInitStage('session');
    setError(null);
    setErrorKind(null);

    let initData: any;
    let room: Room | null = null;

    // STEP 1: Server init — create session + LiveKit token
    try {
      const deviceInfo = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height
      };

      const initResponse = await withTimeout(
        fetch(`/api/self-serve/${uploadToken}/video/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceInfo })
        }),
        20_000,
        'Setting up took too long. Please check your connection and try again.'
      );

      if (!initResponse.ok) {
        const errorData = await initResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to initialize recording session (HTTP ${initResponse.status})`);
      }

      initData = await initResponse.json();
      console.log('✅ Session initialized:', initData.sessionId);

      if (!initData.wsUrl || !initData.livekitToken || !initData.roomName) {
        throw new Error('Server returned incomplete session info — missing wsUrl, token, or room name.');
      }

      setSessionId(initData.sessionId);
      sessionDataRef.current = {
        sessionId: initData.sessionId,
        roomName: initData.roomName,
        wsUrl: initData.wsUrl
      };

      setStatus('connecting');
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to initialize session');
      console.error('❌ Init step failed (server session creation):', error);
      sendTelemetry(uploadToken, {
        event: 'init_failed',
        step: 'server_init',
        errorName: error.name,
        errorMessage: error.message
      });
      setError(new Error(`Could not start recording session: ${error.message}`));
      setStatus('error');
      onError?.(error);
      return;
    }

    // STEP 2: Construct the LiveKit Room
    try {
      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: { width: 1280, height: 720, frameRate: 30 },
          facingMode: 'environment' // Default to back camera for home walkthroughs
        }
      });

      roomRef.current = room;

      room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
      room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);

      // Camera watchdog: the local camera track muting mid-recording means
      // the server is receiving black video (screen lock, backgrounding, OS
      // taking the camera). Surface it and auto-stop if sustained.
      room.on(RoomEvent.TrackMuted, (pub: any, participant: any) => {
        if (participant === room!.localParticipant && pub.source === Track.Source.Camera) {
          onCameraDead();
        }
      });
      room.on(RoomEvent.TrackUnmuted, (pub: any, participant: any) => {
        if (participant === room!.localParticipant && pub.source === Track.Source.Camera) {
          onCameraAlive();
        }
      });
      room.on(RoomEvent.LocalTrackUnpublished, (pub: any) => {
        if (pub.source === Track.Source.Camera) onCameraDead();
      });

      // Live network feedback. With server-side egress, degraded uplink means
      // the RECORDING degrades (not just the preview) — tell the user so they
      // can pause walking or move toward better signal.
      room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
        if (participant === room!.localParticipant) {
          setConnectionQuality(quality);
          if (quality === ConnectionQuality.Poor && statusRef.current === 'recording') {
            sendTelemetry(uploadToken, { event: 'connection_quality_poor', durationAtEvent: durationRef.current });
          }
        }
      });
      room.on(RoomEvent.Reconnecting, () => {
        setIsReconnecting(true);
        if (reconnectStartedAtMsRef.current == null) {
          reconnectStartedAtMsRef.current = Date.now();
        }
        if (statusRef.current === 'recording') {
          sendTelemetry(uploadToken, { event: 'reconnecting_while_recording', durationAtEvent: durationRef.current });
          // Give-up cap: if the reconnect hasn't succeeded within the window,
          // treat it as a disconnect instead of letting the UI show REC
          // forever. The server-side room closes (departureTimeout) not long
          // after we vanish, so past this window there is nothing to rejoin.
          if (!reconnectGiveUpTimerRef.current) {
            reconnectGiveUpTimerRef.current = setTimeout(() => {
              reconnectGiveUpTimerRef.current = null;
              if (statusRef.current === 'recording') {
                failRecordingAsDisconnected('reconnect_timeout_while_recording');
              }
            }, RECONNECT_GIVE_UP_MS);
          }
        }
      });
      room.on(RoomEvent.Reconnected, () => {
        setIsReconnecting(false);
        if (reconnectGiveUpTimerRef.current) {
          clearTimeout(reconnectGiveUpTimerRef.current);
          reconnectGiveUpTimerRef.current = null;
        }
        // Bank the time spent reconnecting so the duration timer excludes it.
        if (reconnectStartedAtMsRef.current != null) {
          reconnectPausedMsRef.current += Date.now() - reconnectStartedAtMsRef.current;
          reconnectStartedAtMsRef.current = null;
        }
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to construct LiveKit Room');
      console.error('❌ Init step failed (Room constructor):', error);
      sendTelemetry(uploadToken, {
        event: 'init_failed',
        step: 'room_constructor',
        errorName: error.name,
        errorMessage: error.message
      });
      setError(new Error(`Your browser may not support video recording. ${error.message}`));
      setStatus('error');
      onError?.(error);
      return;
    }

    // STEP 3: Connect to LiveKit (WebSocket + WebRTC negotiation).
    // This is the most common failure point on broken webviews and old iOS:
    // RTCPeerConnection construction with iceServers throws iOS's generic
    // "string did not match the expected pattern" when WebRTC is unsupported.
    try {
      console.log('🔄 Connecting to LiveKit room:', initData.roomName);
      setInitStage('connect');
      await withTimeout(
        room.connect(initData.wsUrl, initData.livekitToken, {
          autoSubscribe: false
        }),
        20_000,
        "Couldn't reach the video service. Your network may be blocking video connections — try switching between Wi-Fi and cellular data."
      );
      console.log('✅ Connected to LiveKit room, state:', room.state);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to connect to recording service');
      console.error('❌ Init step failed (room.connect — WebRTC/WebSocket):', error);
      sendTelemetry(uploadToken, {
        event: 'init_failed',
        step: 'room_connect',
        errorName: error.name,
        errorMessage: error.message
      });
      cleanup();
      const isWebRtcUnsupported = /pattern|RTCPeerConnection|WebRTC/i.test(error.message);
      setErrorKind(isWebRtcUnsupported ? 'unsupported_browser' : 'generic');
      const friendly = isWebRtcUnsupported
        ? "Your browser doesn't fully support video recording. Please try Safari or Chrome on a recent device."
        : `Couldn't connect to the recording service: ${error.message}`;
      setError(new Error(friendly));
      setStatus('error');
      onError?.(error);
      return;
    }

    // STEP 4: Request camera + microphone permissions (this triggers the OS prompt).
    const cameraEnableStartedAt = Date.now();
    try {
      console.log('📹 Enabling camera and microphone...');
      setInitStage('camera');
      // Generous timeout: the OS permission prompt legitimately sits open
      // while the user decides. This only catches true hangs (camera held by
      // another app, getUserMedia that never resolves).
      await withTimeout(
        room.localParticipant.enableCameraAndMicrophone(),
        45_000,
        'Could not start your camera. Close any other app using the camera, then try again.'
      );
      console.log('✅ Camera and microphone enabled');
      sendTelemetry(uploadToken, { event: 'camera_granted' });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to access camera/microphone');
      console.error('❌ Init step failed (enableCameraAndMicrophone):', error);
      // Failure timing distinguishes "the user saw the prompt and denied it"
      // (recoverable via reload-and-reprompt on WebKit) from "blocked before
      // any prompt could show" (site/OS-level block — only a settings change
      // helps). An instant rejection means no human was in the loop.
      const enableElapsedMs = Date.now() - cameraEnableStartedAt;
      const promptWasShown = enableElapsedMs >= 500;
      setPermissionPromptShown(promptWasShown);
      sendTelemetry(uploadToken, {
        event: 'init_failed',
        step: 'enable_camera_mic',
        errorName: error.name,
        errorMessage: error.message,
        enableElapsedMs,
        promptShown: promptWasShown
      });
      // Disconnect so we don't leave a connected-but-camera-less participant
      // holding the room open (the egress has NOT started yet — 'ready' is
      // only set below — so nothing is recording).
      cleanup();
      // Classify by DOMException name — much more reliable than message text,
      // and each cause has a completely different fix for the user.
      const errName = (err as any)?.name || '';
      let kind: RecordingErrorKind;
      let friendly: string;
      if (errName === 'NotAllowedError' || errName === 'SecurityError' || /permission|denied/i.test(error.message)) {
        kind = 'permission_denied';
        friendly = 'Camera and microphone access was denied.';
      } else if (errName === 'NotReadableError' || errName === 'AbortError') {
        kind = 'camera_in_use';
        friendly = 'Your camera is being used by another app.';
      } else if (errName === 'NotFoundError' || errName === 'OverconstrainedError') {
        kind = 'camera_not_found';
        friendly = "We couldn't find a usable camera on this device.";
      } else {
        kind = 'generic';
        friendly = `Could not access your camera or microphone: ${error.message}`;
      }
      setErrorKind(kind);
      setError(new Error(friendly));
      setStatus('error');
      onError?.(error);
      return;
    }

    try {
      // Attach video track to preview element if available
      const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (videoTrack && videoRef.current) {
        console.log('📹 Attaching video track to preview element');
        videoTrack.attach(videoRef.current);
        setLocalVideoTrack(videoTrack);
      }

      // Keep the screen awake from the moment the camera is live — phones
      // auto-lock while the user holds the phone up without touching it,
      // and the lock kills the camera track (the root cause of black-video
      // recordings).
      acquireWakeLock();

      // ONLY NOW is the session ready to record: connected AND camera live.
      // The UI auto-starts the server-side egress on 'ready', so this
      // ordering guarantees the egress never records a camera-less room.
      console.log('✅ Camera live — transitioning to ready');
      setStatus('ready');

    } catch (err) {
      console.error('❌ Initialization failed:', err);
      const error = err instanceof Error ? err : new Error('Failed to initialize');
      cleanup();
      setError(error);
      setStatus('error');
      onError?.(error);
    }
  }, [uploadToken, handleConnectionStateChanged, handleLocalTrackPublished, onCameraDead, onCameraAlive, acquireWakeLock, cleanup, onError, failRecordingAsDisconnected]);

  // Start server-side recording (Egress)
  const startRecording = useCallback(async () => {
    // Synchronous guard - prevents double-calls even before React state updates
    if (isStartingRef.current) {
      console.log('⚠️ Start recording already in progress, ignoring duplicate call');
      return;
    }
    isStartingRef.current = true;
    setRecordingStarted(false);

    // Wrap the API call in a promise stored on a ref so stopRecording() can
    // await it. Without this, the user can tap Stop while /start-recording
    // is in flight (especially slow on first dev compile), causing /stop to
    // run before session.egressId is written → egress later starts in an
    // empty room → "Start signal not received" → 0-duration recording.
    const startPromise = (async () => {
    try {
      if (statusRef.current !== 'ready' || !sessionDataRef.current) {
        console.log('⚠️ Cannot start recording in current state:', statusRef.current);
        return;
      }

      // Belt-and-suspenders: never ask the server to start an egress unless
      // the local camera track is actually live right now. (The server has a
      // matching guard, but failing here is faster and clearer.)
      const camPub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
      if (!camPub?.track || camPub.isMuted) {
        throw new Error("Your camera isn't active yet. Please wait a moment and try again.");
      }

      setStatus('recording');

      // Tell backend to start Egress recording
      const startResponse = await withTimeout(
        fetch(`/api/self-serve/${uploadToken}/video/start-recording`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: sessionDataRef.current.sessionId,
            roomName: sessionDataRef.current.roomName
          })
        }),
        20_000,
        'Starting the recording took too long. Please check your connection and try again.'
      );

      if (!startResponse.ok) {
        const errorData = await startResponse.json();
        throw new Error(errorData.error || 'Failed to start recording');
      }

      const startData = await startResponse.json();
      console.log('✅ Recording started, egress:', startData.egressId);
      setRecordingStarted(true);
      sendTelemetry(uploadToken, { event: 'recording_started' });

      // Start duration timer. Time spent in 'Reconnecting' is excluded: no
      // footage reaches the server during a reconnect, and an inflated timer
      // is exactly what made a 105s partial capture look like an 18-minute
      // success to the user (2026-08-07 WNY Moving incident).
      const startTime = Date.now();
      reconnectPausedMsRef.current = 0;
      reconnectStartedAtMsRef.current = null;
      durationIntervalRef.current = setInterval(() => {
        const pausedMs =
          reconnectPausedMsRef.current +
          (reconnectStartedAtMsRef.current != null ? Date.now() - reconnectStartedAtMsRef.current : 0);
        const elapsed = Math.max(0, Math.floor((Date.now() - startTime - pausedMs) / 1000));
        const remaining = maxDuration - elapsed;

        setDuration(elapsed);
        setRemainingTime(Math.max(0, remaining));

        // Check for duration warnings
        let warning: 'none' | '2min' | '1min' | '30sec' | 'maxed' = 'none';
        if (remaining <= 0) {
          warning = 'maxed';
          // Auto-stop recording
          stopRecording();
        } else if (remaining <= 30) {
          warning = '30sec';
        } else if (remaining <= 60) {
          warning = '1min';
        } else if (remaining <= 120) {
          warning = '2min';
        }

        if (warning !== durationWarningRef.current) {
          setDurationWarning(warning);
          onDurationWarning?.(warning === 'maxed' ? 'none' : warning, remaining);
        }
      }, 1000);

    } catch (err) {
      console.error('❌ Start recording failed:', err);
      const error = err instanceof Error ? err : new Error('Failed to start recording');
      // The server may have started an egress before the request failed
      // client-side (e.g. a timeout after startRoomCompositeEgress). Fire a
      // best-effort /stop so it can't keep recording, then release the
      // camera — the error screen's only exit is a reload anyway.
      bestEffortStop();
      cleanup();
      setError(error);
      setStatus('error');
      onError?.(error);
    } finally {
      // Reset guard after API call completes (success or failure)
      isStartingRef.current = false;
    }
    })();
    startInFlightRef.current = startPromise;
    try {
      await startPromise;
    } finally {
      startInFlightRef.current = null;
    }
  }, [uploadToken, maxDuration, onDurationWarning, bestEffortStop, cleanup, onError]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    const currentStatus = statusRef.current;
    if (!['recording', 'ready'].includes(currentStatus) || !sessionDataRef.current) {
      console.log('⚠️ Cannot stop recording in current state:', currentStatus);
      return;
    }

    try {
      // CRITICAL race fix: if /start-recording is still in flight, wait for
      // it before sending /stop. Otherwise /stop runs before session.egressId
      // is written, the egress later starts in an empty room, and LiveKit
      // aborts it with "Start signal not received" → 0-duration recording.
      if (startInFlightRef.current) {
        console.log('⏳ Waiting for in-flight start-recording before sending stop...');
        try {
          await startInFlightRef.current;
        } catch {
          // start-recording errored; nothing to stop server-side. fall through
          // and let the existing flow handle the no-egress case.
        }
      }

      setStatus('stopping');

      // Stop duration timer
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      // Tell backend to stop Egress recording
      const stopResponse = await fetch(`/api/self-serve/${uploadToken}/video/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionDataRef.current.sessionId
        })
      });

      if (!stopResponse.ok) {
        const errorData = await stopResponse.json();
        throw new Error(errorData.error || 'Failed to stop recording');
      }

      const stopData = await stopResponse.json();
      console.log('✅ Recording stopped:', stopData);
      sendTelemetry(uploadToken, { event: 'recording_stopped', recordedDuration: durationRef.current });

      setStatus('processing');

      // Disconnect from room
      cleanup();

      // HONEST COMPLETION: poll the session until the egress_ended webhook
      // confirms a saved file (status flips to analyzing/completed) instead
      // of declaring success on a timer. Catching an upload failure HERE —
      // while the customer is still standing in their living room — turns
      // silent data loss into an immediately recoverable moment.
      const sid = sessionDataRef.current?.sessionId;
      let confirmed: boolean | null = null;
      let serverDuration: number | null = null;
      if (sid) {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          try {
            const res = await fetch(`/api/self-serve/${uploadToken}/video/status?sessionId=${encodeURIComponent(sid)}`);
            if (res.ok) {
              const data = await res.json();
              if (['analyzing', 'completed'].includes(data.status)) {
                confirmed = true;
                // Webhook-written file duration — the ground truth for how
                // much footage actually reached the server.
                serverDuration = typeof data.duration === 'number' ? data.duration : null;
                break;
              }
              if (data.status === 'failed') { confirmed = false; break; }
            }
          } catch { /* transient poll failure — keep trying until deadline */ }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      setUploadConfirmed(confirmed);
      sendTelemetry(uploadToken, { event: 'upload_confirmation', result: confirmed === null ? 'unconfirmed' : confirmed ? 'confirmed' : 'failed', recordedDuration: durationRef.current, serverDuration });

      if (confirmed === false) {
        // The server actively reported failure (no file / junk gate). Don't
        // show a success screen for a recording that doesn't exist.
        setErrorKind('upload_failed');
        setError(new Error("Your recording couldn't be saved."));
        setStatus('error');
        return;
      }

      // A confirmed file that's much shorter than what the user recorded is
      // NOT a success — it means the egress died mid-recording and the tail
      // never reached the server. Say so while they're still standing in the
      // house, with a path to record the missing part. Thresholds allow for
      // normal egress startup/finalization skew (a few seconds).
      if (
        confirmed === true &&
        serverDuration != null &&
        durationRef.current - serverDuration > 15 &&
        serverDuration < durationRef.current * 0.8
      ) {
        sendTelemetry(uploadToken, {
          event: 'partial_capture_detected',
          recordedDuration: durationRef.current,
          serverDuration
        });
        setSavedDuration(serverDuration);
        setErrorKind('partial_capture');
        setError(new Error('Only part of the recording reached the server'));
        setStatus('error');
        return;
      }

      // confirmed === true (verified) or null (still finalizing — the
      // complete screen distinguishes via uploadConfirmed).
      setStatus('complete');
      onRecordingComplete?.(sessionDataRef.current?.sessionId);

    } catch (err) {
      console.error('❌ Stop recording failed:', err);
      const error = err instanceof Error ? err : new Error('Failed to stop recording');
      // A network-level fetch failure here (Safari: "Load failed", Chrome:
      // "Failed to fetch") means the phone is offline — airplane mode or a
      // dead zone — and the /stop request never reached the server. That's a
      // disconnect, not a generic error: the server closes the room on its
      // own (departureTimeout) and finalizes what was captured, so show the
      // "first X:XX saved" recovery screen — whose auto-resume probe restarts
      // recording the moment signal returns — instead of a dead end.
      const isNetworkFailure =
        (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        err instanceof TypeError ||
        /load failed|failed to fetch|network/i.test(error.message);
      if (isNetworkFailure) {
        failRecordingAsDisconnected('stop_failed_offline');
        return;
      }
      setError(error);
      setStatus('error');
      onError?.(error);
    }
  }, [uploadToken, cleanup, onRecordingComplete, onError, failRecordingAsDisconnected]);

  // Keep the watchdog's handle on stopRecording fresh (the watchdog callbacks
  // are defined earlier in the hook and can't depend on stopRecording
  // directly without a cycle).
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  // Attach the camera track to the preview element once the recording UI is
  // actually mounted. The track publishes while status is still 'connecting'
  // — the spinner screen, where no <video> exists — so attach-at-publish
  // finds videoRef.current null and the preview would stay black even though
  // the camera (and the egress) are recording fine.
  useEffect(() => {
    if ((status === 'ready' || status === 'recording') && localVideoTrack && videoRef.current) {
      localVideoTrack.attach(videoRef.current);
    }
  }, [status, localVideoTrack]);

  // Reset out of the error state and re-run initialization in place — no
  // page reload. Used by "Check again" (permission recovery), "Record the
  // rest" (post-disconnect), and "Try again". Creates a fresh server-side
  // session; the previous session's partial footage (if any) is unaffected.
  const retryFromError = useCallback(async () => {
    sendTelemetry(uploadToken, { event: 'retry_from_error', priorErrorKind: errorKind || 'unknown' });
    cleanup();
    setError(null);
    setErrorKind(null);
    setPermissionPromptShown(null);
    setRecordingStarted(false);
    setUploadConfirmed(null);
    setDuration(0);
    setDurationWarning('none');
    setRemainingTime(maxDuration);
    setInitStage('session');
    // statusRef must be updated synchronously: initialize() reads it via the
    // ref immediately, before React flushes the setStatus render.
    statusRef.current = 'idle';
    setStatus('idle');
    await initialize();
  }, [uploadToken, errorKind, maxDuration, cleanup, initialize]);

  // Flip camera (toggle between front and back)
  const flipCamera = useCallback(async () => {
    if (!roomRef.current?.localParticipant) {
      console.log('⚠️ Cannot flip camera - no room connection');
      return;
    }

    const newFacingMode = facingMode === 'environment' ? 'user' : 'environment';
    console.log(`📷 Flipping camera to: ${newFacingMode}`);

    try {
      // Get current camera track
      const currentPublication = roomRef.current.localParticipant.getTrackPublication(Track.Source.Camera);

      if (currentPublication?.track) {
        // Stop current track
        currentPublication.track.stop();
      }

      // Re-enable camera with new facing mode
      await roomRef.current.localParticipant.setCameraEnabled(true, {
        facingMode: newFacingMode,
        resolution: { width: 1280, height: 720, frameRate: 30 }
      });

      setFacingMode(newFacingMode);

      // Update preview
      const newTrack = roomRef.current.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (newTrack && videoRef.current) {
        newTrack.attach(videoRef.current);
        setLocalVideoTrack(newTrack);
      }

      console.log(`✅ Camera flipped to: ${newFacingMode}`);
    } catch (err) {
      console.error('❌ Failed to flip camera:', err);
    }
  }, [facingMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    sessionId,
    duration,
    durationWarning,
    remainingTime,
    connectionState,
    isRecording: status === 'recording',
    recordingStarted,
    error,
    facingMode,
    initStage,
    cameraInterrupted,
    errorKind,
    permissionPromptShown,
    savedDuration,
    connectionQuality,
    isReconnecting,
    uploadConfirmed,
    room: roomRef.current,
    localVideoTrack,
    videoRef,
    initialize,
    startRecording,
    stopRecording,
    flipCamera,
    retryFromError,
    cleanup
  };
}

export default useSelfServeRecordingLiveKit;
