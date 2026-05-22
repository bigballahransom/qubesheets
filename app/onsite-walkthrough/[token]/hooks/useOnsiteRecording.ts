'use client';

// app/onsite-walkthrough/[token]/hooks/useOnsiteRecording.ts
//
// Recording state machine + LiveKit client orchestration for the onsite
// walkthrough mobile recorder.
//
// Written fresh for the onsite flow (not a copy of the self-serve hook),
// but deliberately preserves the same hard-won patterns from
// useSelfServeRecordingLiveKit.ts:
//   - in-app-browser fail-fast (Instagram/Messenger/TikTok WebViews lack WebRTC)
//   - synchronous isStarting guard against double-clicks
//   - startInFlightRef awaited by stopRecording (race fix that prevents the
//     "Start signal not received" 0-duration recording)
//   - explicit local-track .stop() on cleanup so iOS Safari releases the
//     camera/mic indicator
//   - friendly error messages for WebRTC / permission failures
//
// Telemetry is intentionally omitted in this rev — the mover is a known
// employee on a known device, so we don't need anonymous device fingerprints
// the way the self-serve flow does.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, ConnectionState, Track, LocalParticipant } from 'livekit-client';
import { detectInAppBrowser } from '@/lib/deviceDetection';

export type OnsiteRecordingStatus =
  | 'idle'
  | 'initializing'
  | 'connecting'
  | 'ready'
  | 'recording'
  | 'stopping'
  | 'processing'
  | 'complete'
  | 'error';

export interface UseOnsiteRecordingOptions {
  uploadToken: string;
  maxDuration?: number; // seconds
  onComplete?: (sessionId?: string) => void;
  onError?: (error: Error) => void;
}

export interface UseOnsiteRecordingReturn {
  status: OnsiteRecordingStatus;
  sessionId: string | null;
  duration: number;            // seconds elapsed since startRecording succeeded
  remainingTime: number;       // seconds until auto-stop
  connectionState: ConnectionState;
  isRecording: boolean;
  /** True once /start-recording has returned successfully. Gate the Stop
   *  button on this — see startInFlightRef comment below. */
  recordingStarted: boolean;
  error: Error | null;
  facingMode: 'environment' | 'user';
  videoRef: React.RefObject<HTMLVideoElement | null>;
  localVideoTrack: Track | null;

  initialize: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  flipCamera: () => Promise<void>;
  cleanup: () => void;
}

export function useOnsiteRecording({
  uploadToken,
  maxDuration = 1200,
  onComplete,
  onError,
}: UseOnsiteRecordingOptions): UseOnsiteRecordingReturn {
  const [status, setStatus] = useState<OnsiteRecordingStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [remainingTime, setRemainingTime] = useState(maxDuration);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected
  );
  const [error, setError] = useState<Error | null>(null);
  const [localVideoTrack, setLocalVideoTrack] = useState<Track | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [recordingStarted, setRecordingStarted] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const statusRef = useRef<OnsiteRecordingStatus>('idle');
  const sessionDataRef = useRef<{
    sessionId: string;
    roomName: string;
    wsUrl: string;
  } | null>(null);
  const isStartingRef = useRef<boolean>(false);
  const startInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Release camera/mic + LiveKit connection. Explicit track .stop() + detach
  // is needed on iOS Safari to actually clear the camera indicator.
  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (roomRef.current) {
      try {
        roomRef.current.localParticipant.trackPublications.forEach(pub => {
          try { pub.track?.stop(); } catch { /* noop */ }
          try {
            pub.track?.detach().forEach(el => {
              (el as HTMLMediaElement).srcObject = null;
            });
          } catch { /* noop */ }
        });
      } catch { /* noop */ }
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      } catch { /* noop */ }
    }
    setLocalVideoTrack(null);
  }, []);

  const handleConnectionStateChanged = useCallback((state: ConnectionState) => {
    setConnectionState(state);
    if (state === ConnectionState.Connected && statusRef.current === 'connecting') {
      setStatus('ready');
    } else if (state === ConnectionState.Disconnected && statusRef.current === 'recording') {
      setError(new Error('Connection lost during recording'));
      setStatus('error');
    }
  }, []);

  const handleLocalTrackPublished = useCallback(
    (publication: { track?: Track | null }, _participant: LocalParticipant) => {
      const track = publication.track;
      if (track && track.kind === Track.Kind.Video) {
        setLocalVideoTrack(track);
        if (videoRef.current) {
          track.attach(videoRef.current);
        }
      }
    },
    []
  );

  const initialize = useCallback(async () => {
    if (statusRef.current !== 'idle') return;

    // Fail-fast on broken in-app WebViews.
    const inAppBrowser = detectInAppBrowser();
    if (inAppBrowser) {
      const err = new Error(
        `Recording isn't supported inside the ${inAppBrowser} browser. Open this link in Safari or Chrome.`
      );
      setError(err);
      setStatus('error');
      onError?.(err);
      return;
    }

    setStatus('initializing');
    setError(null);

    let initData: {
      sessionId: string;
      roomName: string;
      livekitToken: string;
      wsUrl: string;
    };

    try {
      const res = await fetch(`/api/onsite-walkthrough/${uploadToken}/video/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Init failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (!data.wsUrl || !data.livekitToken || !data.roomName) {
        throw new Error('Server returned incomplete session info.');
      }
      initData = data;
      setSessionId(data.sessionId);
      sessionDataRef.current = {
        sessionId: data.sessionId,
        roomName: data.roomName,
        wsUrl: data.wsUrl,
      };
      setStatus('connecting');
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Init failed');
      setError(new Error(`Could not start recording session: ${err.message}`));
      setStatus('error');
      onError?.(err);
      return;
    }

    let room: Room;
    try {
      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: { width: 1280, height: 720, frameRate: 30 },
          facingMode: 'environment',
        },
      });
      roomRef.current = room;
      room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
      room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    } catch (e) {
      const err = e instanceof Error ? e : new Error('LiveKit Room construct failed');
      setError(new Error(`Your browser may not support video recording. ${err.message}`));
      setStatus('error');
      onError?.(err);
      return;
    }

    try {
      await room.connect(initData.wsUrl, initData.livekitToken, { autoSubscribe: false });
    } catch (e) {
      const err = e instanceof Error ? e : new Error('LiveKit connect failed');
      const friendly = /pattern|RTCPeerConnection|WebRTC/i.test(err.message)
        ? "Your browser doesn't fully support video recording. Try Safari or Chrome on a recent device."
        : `Couldn't connect to the recording service: ${err.message}`;
      setError(new Error(friendly));
      setStatus('error');
      onError?.(err);
      return;
    }

    try {
      await room.localParticipant.enableCameraAndMicrophone();
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Camera/mic enable failed');
      const friendly = /permission|denied|NotAllowed/i.test(err.message)
        ? 'Camera and microphone access was denied. Allow access in browser settings and reload.'
        : `Could not access your camera or microphone: ${err.message}`;
      setError(new Error(friendly));
      setStatus('error');
      onError?.(err);
      return;
    }

    // Connection event may fire before our handler is registered — re-check.
    // Cast needed: TS narrows statusRef.current to 'idle' from the early-return
    // check above; at runtime the ref may have advanced via setStatus calls.
    if (
      room.state === ConnectionState.Connected &&
      (statusRef.current as OnsiteRecordingStatus) === 'connecting'
    ) {
      setStatus('ready');
    }

    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (videoTrack && videoRef.current) {
      videoTrack.attach(videoRef.current);
      setLocalVideoTrack(videoTrack);
    }
  }, [uploadToken, handleConnectionStateChanged, handleLocalTrackPublished, onError]);

  const stopRecording = useCallback(async () => {
    const current = statusRef.current;
    if (!['recording', 'ready'].includes(current) || !sessionDataRef.current) return;

    try {
      // Race fix: if /start-recording is still in flight, wait for it before
      // calling /stop. Otherwise /stop runs before egressId is persisted,
      // the egress eventually starts in an empty room, and LiveKit aborts
      // with "Start signal not received" -> 0-byte recording.
      if (startInFlightRef.current) {
        try {
          await startInFlightRef.current;
        } catch { /* fall through */ }
      }

      setStatus('stopping');

      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      const res = await fetch(`/api/onsite-walkthrough/${uploadToken}/video/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Stop failed (HTTP ${res.status})`);
      }

      setStatus('processing');
      cleanup();

      setTimeout(() => {
        setStatus('complete');
        onComplete?.(sessionDataRef.current?.sessionId);
      }, 1500);
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Stop recording failed');
      setError(err);
      setStatus('error');
      onError?.(err);
    }
  }, [uploadToken, cleanup, onComplete, onError]);

  const startRecording = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setRecordingStarted(false);

    const startPromise = (async () => {
      try {
        if (statusRef.current !== 'ready' || !sessionDataRef.current) return;

        setStatus('recording');

        const res = await fetch(
          `/api/onsite-walkthrough/${uploadToken}/video/start-recording`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Start failed (HTTP ${res.status})`);
        }
        setRecordingStarted(true);

        const startTime = Date.now();
        durationIntervalRef.current = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const remaining = maxDuration - elapsed;
          setDuration(elapsed);
          setRemainingTime(Math.max(0, remaining));
          if (remaining <= 0) {
            stopRecording();
          }
        }, 1000);
      } catch (e) {
        const err = e instanceof Error ? e : new Error('Start recording failed');
        setError(err);
        setStatus('error');
        onError?.(err);
      } finally {
        isStartingRef.current = false;
      }
    })();
    startInFlightRef.current = startPromise;
    try {
      await startPromise;
    } finally {
      startInFlightRef.current = null;
    }
  }, [uploadToken, maxDuration, onError, stopRecording]);

  const flipCamera = useCallback(async () => {
    if (!roomRef.current?.localParticipant) return;
    const newFacing: 'environment' | 'user' = facingMode === 'environment' ? 'user' : 'environment';
    try {
      const currentPub = roomRef.current.localParticipant.getTrackPublication(Track.Source.Camera);
      currentPub?.track?.stop();
      await roomRef.current.localParticipant.setCameraEnabled(true, {
        facingMode: newFacing,
        resolution: { width: 1280, height: 720, frameRate: 30 },
      });
      setFacingMode(newFacing);
      const newTrack = roomRef.current.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (newTrack && videoRef.current) {
        newTrack.attach(videoRef.current);
        setLocalVideoTrack(newTrack);
      }
    } catch (e) {
      console.error('[onsite-walkthrough] flipCamera failed:', e);
    }
  }, [facingMode]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    sessionId,
    duration,
    remainingTime,
    connectionState,
    isRecording: status === 'recording',
    recordingStarted,
    error,
    facingMode,
    videoRef,
    localVideoTrack,
    initialize,
    startRecording,
    stopRecording,
    flipCamera,
    cleanup,
  };
}

export default useOnsiteRecording;
