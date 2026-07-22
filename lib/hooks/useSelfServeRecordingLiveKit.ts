// lib/hooks/useSelfServeRecordingLiveKit.ts
// Hook for self-serve recording using LiveKit (server-side recording via Egress)
import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, ConnectionState, Track, LocalParticipant } from 'livekit-client';
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
 * Reject if `promise` doesn't settle within `ms`. Used to cap every stage of
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
  /** True while the camera track is muted/dead during a recording (screen
   *  locked, app backgrounded, lens blocked by the OS). The UI should show a
   *  prominent "we can't see your camera" warning; the hook auto-stops the
   *  recording if this persists ~30s so we never save minutes of black video. */
  cameraInterrupted: boolean;

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

  // Keep the screen awake while the camera is live. Without this, phones
  // auto-lock mid-walkthrough (customer is holding the phone up, not
  // touching it), which kills the camera track. Released in cleanup(); the
  // OS auto-releases when the page is hidden, so we re-acquire on
  // visibilitychange. Best-effort: unsupported browsers just keep today's
  // behavior.
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
  }, []);

  // Handle connection state changes
  const handleConnectionStateChanged = useCallback((state: ConnectionState) => {
    console.log(`📡 Connection state: ${state}, current status: ${statusRef.current}`);
    setConnectionState(state);

    if (state === ConnectionState.Connected && statusRef.current === 'connecting') {
      console.log('✅ Connected to LiveKit, transitioning to ready state');
      setStatus('ready');
    } else if (state === ConnectionState.Disconnected && statusRef.current === 'recording') {
      // Unexpected disconnect during recording
      console.error('❌ Disconnected during recording');
      setError(new Error('Connection lost during recording'));
      setStatus('error');
    }
  }, []); // No dependencies needed - uses statusRef

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
        // If the camera track came back on its own, the TrackUnmuted event
        // clears the warning; if it's still muted, leave the watchdog armed.
        const camTrack = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camTrack && !camTrack.isMuted && camTrack.track) {
          onCameraAlive();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [uploadToken, onCameraDead, onCameraAlive, acquireWakeLock]);

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
      setError(error);
      setStatus('error');
      onError?.(error);
      return;
    }

    setStatus('initializing');
    setError(null);

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
      const friendly = /pattern|RTCPeerConnection|WebRTC/i.test(error.message)
        ? "Your browser doesn't fully support video recording. Please try Safari or Chrome on a recent device."
        : `Couldn't connect to the recording service: ${error.message}`;
      setError(new Error(friendly));
      setStatus('error');
      onError?.(error);
      return;
    }

    // STEP 4: Request camera + microphone permissions (this triggers the OS prompt).
    try {
      console.log('📹 Enabling camera and microphone...');
      // Generous timeout: the OS permission prompt legitimately sits open
      // while the customer decides. This only catches true hangs (camera
      // held by another app, getUserMedia that never resolves).
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
      sendTelemetry(uploadToken, {
        event: 'init_failed',
        step: 'enable_camera_mic',
        errorName: error.name,
        errorMessage: error.message
      });
      const friendly = /permission|denied|NotAllowed/i.test(error.message)
        ? 'Camera and microphone access was denied. Please allow access in your browser settings and try again.'
        : `Could not access your camera or microphone: ${error.message}`;
      setError(new Error(friendly));
      setStatus('error');
      onError?.(error);
      return;
    }

    try {

      // Manually check connection state and update if needed
      // (in case the event fired before our handler was ready)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (room.state === ConnectionState.Connected && (statusRef.current as any) === 'connecting') {
        console.log('✅ Setting status to ready (manual check)');
        setStatus('ready');
      }

      // Attach video track to preview element if available
      const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (videoTrack && videoRef.current) {
        console.log('📹 Attaching video track to preview element');
        videoTrack.attach(videoRef.current);
        setLocalVideoTrack(videoTrack);
      }

      // Keep the screen awake from the moment the camera is live — phones
      // auto-lock while the customer holds the phone up without touching it,
      // and the lock kills the camera track (the root cause of black-video
      // recordings).
      acquireWakeLock();

    } catch (err) {
      console.error('❌ Initialization failed:', err);
      const error = err instanceof Error ? err : new Error('Failed to initialize');
      setError(error);
      setStatus('error');
      onError?.(error);
    }
  }, [uploadToken, handleConnectionStateChanged, handleLocalTrackPublished, onError]);

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

      // Start duration timer
      const startTime = Date.now();
      durationIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
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
  }, [uploadToken, maxDuration, onDurationWarning, onError]);

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

      // Wait a moment then mark as complete
      // The actual video processing happens server-side via webhook
      setTimeout(() => {
        setStatus('complete');
        onRecordingComplete?.(sessionDataRef.current?.sessionId);
      }, 2000);

    } catch (err) {
      console.error('❌ Stop recording failed:', err);
      const error = err instanceof Error ? err : new Error('Failed to stop recording');
      setError(error);
      setStatus('error');
      onError?.(error);
    }
  }, [uploadToken, cleanup, onRecordingComplete, onError]);

  // Keep the watchdog's handle on stopRecording fresh (it can't depend on
  // stopRecording directly — the watchdog callbacks are defined earlier).
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

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
    cameraInterrupted,
    room: roomRef.current,
    localVideoTrack,
    videoRef,
    initialize,
    startRecording,
    stopRecording,
    flipCamera,
    cleanup
  };
}

export default useSelfServeRecordingLiveKit;
