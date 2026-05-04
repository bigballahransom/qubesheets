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
function sendTelemetry(uploadToken: string, payload: Record<string, unknown>) {
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

      // Attach to video element for preview
      if (videoRef.current) {
        track.attach(videoRef.current);
      }
    }
  }, []);

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

      const initResponse = await fetch(`/api/self-serve/${uploadToken}/video/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceInfo })
      });

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
      await room.connect(initData.wsUrl, initData.livekitToken, {
        autoSubscribe: false
      });
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
      await room.localParticipant.enableCameraAndMicrophone();
      console.log('✅ Camera and microphone enabled');
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
      const startResponse = await fetch(`/api/self-serve/${uploadToken}/video/start-recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionDataRef.current.sessionId,
          roomName: sessionDataRef.current.roomName
        })
      });

      if (!startResponse.ok) {
        const errorData = await startResponse.json();
        throw new Error(errorData.error || 'Failed to start recording');
      }

      const startData = await startResponse.json();
      console.log('✅ Recording started, egress:', startData.egressId);
      setRecordingStarted(true);

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
