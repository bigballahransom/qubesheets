// lib/hooks/useSelfServeRecordingLiveKit.ts
// Hook for self-serve recording using LiveKit (server-side recording via Egress)
import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, ConnectionState, Track, LocalParticipant } from 'livekit-client';

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

  // Cleanup function
  const cleanup = useCallback(() => {
    console.log('🧹 Cleaning up LiveKit recording...');

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
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

    try {
      setStatus('initializing');
      setError(null);

      // Get device info for analytics
      const deviceInfo = {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height
      };

      // Initialize session with backend
      const initResponse = await fetch(`/api/self-serve/${uploadToken}/video/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceInfo })
      });

      if (!initResponse.ok) {
        const errorData = await initResponse.json();
        throw new Error(errorData.error || 'Failed to initialize recording session');
      }

      const initData = await initResponse.json();
      console.log('✅ Session initialized:', initData.sessionId);

      setSessionId(initData.sessionId);
      sessionDataRef.current = {
        sessionId: initData.sessionId,
        roomName: initData.roomName,
        wsUrl: initData.wsUrl
      };

      setStatus('connecting');

      // Create and connect to LiveKit room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: { width: 1280, height: 720, frameRate: 30 },
          facingMode: 'environment' // Default to back camera for home walkthroughs
        }
      });

      roomRef.current = room;

      // Set up event listeners BEFORE connecting
      room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged);
      room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);

      console.log('🔄 Connecting to LiveKit room:', initData.roomName);

      // Connect to room
      await room.connect(initData.wsUrl, initData.livekitToken, {
        autoSubscribe: false // No need to subscribe to other participants
      });

      console.log('✅ Connected to LiveKit room, state:', room.state);

      // Enable camera and microphone
      console.log('📹 Enabling camera and microphone...');
      await room.localParticipant.enableCameraAndMicrophone();
      console.log('✅ Camera and microphone enabled');

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
  }, [uploadToken, maxDuration, onDurationWarning, onError]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    const currentStatus = statusRef.current;
    if (!['recording', 'ready'].includes(currentStatus) || !sessionDataRef.current) {
      console.log('⚠️ Cannot stop recording in current state:', currentStatus);
      return;
    }

    try {
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
