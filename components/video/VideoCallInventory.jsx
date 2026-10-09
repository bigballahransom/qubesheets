
// components/video/VideoCallInventory.jsx - Ultra Modern & Sleek UI with Mobile-First Agent View
'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  ControlBar,
  RoomAudioRenderer,
  StartAudio,
  useTracks,
  useLocalParticipant,
  useRemoteParticipants,
  useConnectionState,
  useRoomContext,
  VideoTrack,
  AudioTrack,
  TrackRefContext,
  useTrackRefContext,
  useMaybeTrackRefContext,
  ParticipantContext,
  useParticipantContext,
  FocusLayout,
  CarouselLayout,
} from '@livekit/components-react';
import { Track, LocalVideoTrack, RemoteVideoTrack, createLocalVideoTrack, ConnectionState, DisconnectReason, RoomEvent, facingModeFromLocalTrack } from 'livekit-client';
import '@livekit/components-styles';
import { 
  Camera, 
  Package, 
  Eye, 
  EyeOff, 
  Loader2, 
  RotateCcw,
  Menu,
  X,
  SwitchCamera,
  Users,
  CameraIcon,
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Play,
  Pause,
  Sparkles,
  Zap,
  Target,
  Layers,
  Activity,
  Plus,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  ChevronLeft,
  Home,
  Edit2,
  Trash2,
  Save,
  MessageSquare,
  Radio,
  FileText,
  Monitor,
} from 'lucide-react';
import { toast } from 'sonner';
import FrameProcessor from './FrameProcessor';
import TranscriptDisplay from './TranscriptDisplay';
import Logo from '../../public/logo';
import { Button } from '../ui/button';
import { buildBackgroundConfig } from '../../lib/backgroundProcessor';
import { useMediaRecovery } from '../../lib/hooks/useMicRecovery';
import { useCallHealth, useRemoteVideoWatchdog } from '../../lib/hooks/useCallHealth';
import { useLiveKitCameraControls } from '../../lib/hooks/useLiveKitCameraControls';
// Client-side recording removed - using LiveKit Egress (server-side) recording

// Remount GridLayout whenever tile membership changes (participant
// joins/leaves, or a camera placeholder swaps for a real track). Works around
// a known @livekit/components-react bug where GridLayout's pagination keeps
// last render's tile list and throws "Element not part of the array" when an
// old tile is no longer present.
const gridMembershipKey = (tracks) =>
  tracks
    .map((t) =>
      t.publication?.trackSid
        ? `${t.participant?.identity}_${t.source}_${t.publication.trackSid}`
        : `${t.participant?.identity}_${t.source}_placeholder`
    )
    .join('|');
import { ToggleGoingBadge } from '../ui/ToggleGoingBadge';
import VideoCallNotes from '../VideoCallNotes';
import CallPhotosPanel from './CallPhotosPanel';
import { getDeviceInfo, getRecommendedCodec, getVideoConstraintLevels, getOptimizedRoomOptions } from '@/lib/webrtc-compatibility';
import { reportClientError } from '@/lib/client-error-reporting';
import { reportCallEvent } from '@/lib/call-telemetry';

// Modern glassmorphism utility class
const glassStyle = "backdrop-blur-xl bg-white/10 border border-white/20 shadow-2xl";
const darkGlassStyle = "backdrop-blur-xl bg-black/20 border border-white/10 shadow-2xl";

// FALLBACK path for applying background effects. The primary path attaches
// the processor at track creation via roomOptions.videoCaptureDefaults
// (see pendingProcessor in VideoCallInventory) so no raw frame is ever
// published. This component only attaches a processor if the published track
// somehow has none (e.g. the pre-build timed out).
const BackgroundApplier = React.memo(({ backgroundSettings }) => {
  const { localParticipant } = useLocalParticipant();
  const processorRef = useRef(null);
  const [isApplied, setIsApplied] = useState(false);

  useEffect(() => {
    if (!localParticipant) return;
    const processorConfig = buildBackgroundConfig(backgroundSettings);
    if (!processorConfig) return;

    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 30; // 30 attempts × 100ms = 3 seconds max

    const applyBackground = async () => {
      try {
        const { BackgroundProcessor, supportsBackgroundProcessors } = await import('@livekit/track-processors');

        if (!supportsBackgroundProcessors || !supportsBackgroundProcessors()) {
          console.log('Background processors not supported');
          return;
        }

        // Poll for video track with small intervals
        const checkAndApply = async () => {
          if (cancelled) return;

          const videoTrack = localParticipant.getTrackPublication(Track.Source.Camera)?.track;

          if (videoTrack && videoTrack instanceof LocalVideoTrack) {
            if (videoTrack.getProcessor()) {
              // Already processed at creation via videoCaptureDefaults —
              // nothing to do.
              setIsApplied(true);
              return;
            }
            console.log('Applying background to call (fallback path):', processorConfig);
            processorRef.current = BackgroundProcessor(processorConfig);
            await videoTrack.setProcessor(processorRef.current);
            setIsApplied(true);
            console.log('Background applied successfully');
          } else if (retryCount < maxRetries) {
            // Track not ready yet - retry after short delay
            retryCount++;
            setTimeout(checkAndApply, 100); // Check every 100ms
          } else {
            console.log('Could not find video track after max retries');
          }
        };

        checkAndApply();
      } catch (error) {
        console.error('Failed to apply background:', error);
      }
    };

    applyBackground();

    return () => {
      cancelled = true;
    };
  }, [backgroundSettings, localParticipant]);

  return null;
});

// Tap-to-reconnect pill shown when automatic media recovery needs a user
// gesture (iOS requires one for a fresh getUserMedia after the OS seized the
// mic/camera during a phone-call interruption).
const MediaRecoveryBanner = ({ visible, label, onRecover }) => {
  if (!visible) return null;
  return (
    <div className="absolute top-safe-or-4 left-1/2 -translate-x-1/2 z-50">
      <button
        onClick={onRecover}
        className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-semibold shadow-2xl transition-all duration-200 active:scale-95 animate-pulse"
      >
        {label === 'Microphone' ? <MicOff className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        {label || 'Media'} disconnected — tap to reconnect
      </button>
    </div>
  );
};

// Persistent banner for a camera/mic that failed to start AFTER the room
// connected. Historically this failure was silently swallowed (the
// connection-succeeded gate suppresses all media toasts), producing the
// "we both joined but can't see each other" calls with no visible cause.
const CaptureFailureBanner = ({ failure, onRetry, onDismiss }) => {
  const [retrying, setRetrying] = useState(false);
  if (!failure) return null;
  const label =
    failure.kinds.length === 2
      ? 'Camera & microphone'
      : failure.kinds[0] === 'camera'
        ? 'Camera'
        : 'Microphone';
  return (
    <div className="absolute top-safe-or-4 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md">
      <div className="rounded-2xl bg-red-500/95 text-white shadow-2xl px-4 py-3">
        <p className="text-sm font-semibold mb-2">
          {label} didn&apos;t start — others can&apos;t {failure.kinds.includes('camera') ? 'see' : 'hear'} you
        </p>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              setRetrying(true);
              try { await onRetry(); } finally { setRetrying(false); }
            }}
            disabled={retrying}
            className="flex-1 px-3 py-2 rounded-xl bg-white text-red-600 text-sm font-semibold active:scale-95 transition-all disabled:opacity-60 flex items-center justify-center gap-1.5"
          >
            {retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Retry
          </button>
          <button
            onClick={onDismiss}
            className="px-3 py-2 rounded-xl bg-white/20 text-white text-sm font-semibold active:scale-95 transition-all"
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
};

// "Low bandwidth" chip: adaptiveStream paused the remote video (streamState
// Paused) — without this, the other side just looks black/frozen with no
// explanation.
const LowBandwidthChip = ({ visible }) => {
  if (!visible) return null;
  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/90 text-white text-xs font-semibold shadow-lg">
        <Activity className="w-3.5 h-3.5" />
        Low bandwidth — video paused
      </div>
    </div>
  );
};

// ── Consultant → customer control messages (LiveKit data channel) ──────────
// Both roles' tokens grant canPublishData, so the agent can nudge the customer
// in real time. Keep the payload tiny and tolerant of unknown message types so
// it's forward-compatible.
const QS_DATA_TOPIC = 'qs-control';
const FLIP_CAMERA_REQUEST = 'flip_camera_request';

function encodeControl(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}
function decodeControl(payload) {
  try {
    return JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
}

// The agent-side action: ask the customer to flip their camera. Fire-and-forget
// (reliable delivery); returns true if the message was published.
function sendFlipCameraRequest(room) {
  try {
    if (!room?.localParticipant) return false;
    room.localParticipant.publishData(
      encodeControl({ type: FLIP_CAMERA_REQUEST }),
      { reliable: true, topic: QS_DATA_TOPIC }
    );
    return true;
  } catch (e) {
    console.warn('Failed to send flip-camera request:', e);
    return false;
  }
}

// Customer-side: listen for the consultant's flip-camera nudge and surface it
// with a sound + vibration + a tap-to-flip prompt (styled like the self-survey
// tip). Auto-dismisses so a missed nudge doesn't linger.
function useFlipCameraRequest(roomId) {
  const room = useRoomContext();
  const [promptVisible, setPromptVisible] = useState(false);
  const hideTimerRef = useRef(null);

  const dismiss = useCallback(() => {
    setPromptVisible(false);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  useEffect(() => {
    if (!room) return;
    const onData = (payload, _participant, _kind, topic) => {
      if (topic && topic !== QS_DATA_TOPIC) return;
      const msg = decodeControl(payload);
      if (msg?.type !== FLIP_CAMERA_REQUEST) return;

      setPromptVisible(true);
      // Audio is unblocked by the join tap on mobile; swallow if still blocked.
      try { new Audio('/happy-bell-alert.wav').play().catch(() => {}); } catch {}
      try { navigator.vibrate?.([120, 60, 120]); } catch {}
      if (roomId) reportCallEvent(roomId, 'customer', 'flip_camera_prompt_shown');

      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setPromptVisible(false), 15000);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [room, roomId]);

  return { promptVisible, dismiss };
}

// The customer-facing prompt. Big, attention-grabbing, one obvious action.
const FlipCameraPrompt = ({ visible, onFlip, onDismiss, switching }) => {
  if (!visible) return null;
  return (
    <div className="absolute inset-x-0 top-20 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-xs bg-black/70 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-500/30 border border-indigo-300/40 flex items-center justify-center flex-shrink-0">
            <SwitchCamera className="w-5 h-5 text-indigo-200" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold leading-snug">Your consultant asked you to flip your camera</p>
            <p className="text-white/70 text-xs mt-0.5">Switch cameras so they can see the room.</p>
          </div>
          <button onClick={onDismiss} aria-label="Dismiss" className="text-white/60 hover:text-white p-0.5 -mt-0.5 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={onFlip}
          disabled={switching}
          className="mt-3 w-full py-3 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-600 hover:to-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {switching ? <Loader2 className="w-4 h-4 animate-spin" /> : <SwitchCamera className="w-4 h-4" />}
          Flip camera
        </button>
      </div>
    </div>
  );
};

// Hook for manual recording control (agent only)
function useRecordingControl(projectId, roomId) {
  const [recordingStatus, setRecordingStatus] = useState('idle'); // 'idle' | 'starting' | 'recording' | 'stopping'
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [error, setError] = useState(null);

  // Start recording
  const startRecording = useCallback(async () => {
    if (recordingStatus !== 'idle') return;

    setRecordingStatus('starting');
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/video-recordings/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setRecordingStatus('recording');
        setStartTime(new Date());
        toast.success('Recording started');
      } else {
        setRecordingStatus('idle');
        setError(data.error || 'Failed to start recording');
        toast.error(data.error || 'Failed to start recording');
      }
    } catch (err) {
      setRecordingStatus('idle');
      setError('Failed to start recording');
      toast.error('Failed to start recording');
    }
  }, [projectId, roomId, recordingStatus]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    if (recordingStatus !== 'recording') return;

    setRecordingStatus('stopping');

    try {
      const response = await fetch(`/api/projects/${projectId}/video-recordings/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });

      const data = await response.json();

      if (response.ok) {
        setRecordingStatus('idle');
        setRecordingDuration(0);
        setStartTime(null);
        toast.success('Recording stopped');
      } else {
        setRecordingStatus('recording'); // Revert
        toast.error(data.error || 'Failed to stop recording');
      }
    } catch (err) {
      setRecordingStatus('recording'); // Revert
      toast.error('Failed to stop recording');
    }
  }, [projectId, roomId, recordingStatus]);

  // Update duration timer
  useEffect(() => {
    if (recordingStatus === 'recording' && startTime) {
      const interval = setInterval(() => {
        const now = new Date();
        const duration = Math.floor((now - startTime) / 1000);
        setRecordingDuration(duration);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [recordingStatus, startTime]);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    recordingStatus,
    recordingDuration,
    formattedDuration: formatDuration(recordingDuration),
    startRecording,
    stopRecording,
    error,
    isRecording: recordingStatus === 'recording',
    isStarting: recordingStatus === 'starting',
    isStopping: recordingStatus === 'stopping',
  };
}

// Recording Button Component (agent only)
const RecordingButton = React.memo(({
  isRecording,
  isStarting,
  isStopping,
  formattedDuration,
  onStart,
  onStop
}) => {
  if (isRecording) {
    return (
      <button
        onClick={onStop}
        disabled={isStopping}
        className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
      >
        <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
        <span className="text-sm font-medium">
          {isStopping ? 'Stopping...' : formattedDuration}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={onStart}
      disabled={isStarting}
      className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50"
    >
      <div className="w-3 h-3 bg-red-500 rounded-full" />
      <span className="text-sm font-medium">
        {isStarting ? 'Starting...' : 'Record'}
      </span>
    </button>
  );
});

// Recording Status Indicator Component (legacy - kept for reference)
const RecordingIndicator = React.memo(({ recordingStatus, formattedDuration, className = "" }) => {
  const getStatusDisplay = () => {
    switch (recordingStatus) {
      case 'starting':
        return {
          text: 'Starting Recording...',
          bgColor: 'bg-yellow-500',
          pulse: true,
          icon: <Loader2 className="w-4 h-4 animate-spin" />
        };
      case 'recording':
        return {
          text: `REC ${formattedDuration}`,
          bgColor: 'bg-red-500',
          pulse: true,
          icon: <Radio className="w-4 h-4" />
        };
      case 'stopping':
        return {
          text: 'Stopping...',
          bgColor: 'bg-orange-500',
          pulse: false,
          icon: <Loader2 className="w-4 h-4 animate-spin" />
        };
      default:
        return null;
    }
  };

  const statusDisplay = getStatusDisplay();
  if (!statusDisplay) return null;

  return (
    <div className={`fixed top-4 left-4 z-50 ${className}`}>
      <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-bold shadow-lg border border-white/20 ${statusDisplay.bgColor} ${statusDisplay.pulse ? 'animate-pulse' : ''}`}>
        {statusDisplay.icon}
        {statusDisplay.text}
      </div>
    </div>
  );
});

// Enhanced camera switching with responsive approach
// components/video/VideoCallInventory.jsx
function useAdvancedCameraSwitching() {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [isSwitching, setIsSwitching] = useState(false);
  // Always show camera flip on mobile - be optimistic, handle failures gracefully
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const [canSwitchCamera, setCanSwitchCamera] = useState(isMobile); // Show on mobile by default

  // Detect camera switching capability on mount (but stay optimistic on mobile)
  useEffect(() => {
    const detectCameras = async () => {
      try {
        // Check if facingMode constraint is supported
        const supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.();
        const supportsFacingMode = supportedConstraints?.facingMode ?? false;

        // Try to count cameras
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');

        // Can switch if: supports facingMode OR has multiple cameras OR is mobile (be optimistic)
        const canSwitch = supportsFacingMode || videoDevices.length > 1 || isMobile;
        setCanSwitchCamera(canSwitch);
        console.log(`📹 Camera switch support: facingMode=${supportsFacingMode}, devices=${videoDevices.length}, isMobile=${isMobile}, canSwitch=${canSwitch}`);
      } catch (e) {
        console.warn('📹 Could not detect camera capabilities:', e);
        // On mobile, still allow camera flip attempt even if detection fails
        setCanSwitchCamera(isMobile);
      }
    };
    detectCameras();
  }, [isMobile]);

  // Track current facing mode
  const [currentFacingMode, setCurrentFacingMode] = useState('user');

  const switchCamera = useCallback(async () => {
    if (!localParticipant || isSwitching) {
      console.log('📹 Camera switching not available');
      return;
    }

    setIsSwitching(true);
    const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    console.log('📹 Switching camera from', currentFacingMode, 'to', newFacingMode);

    try {
      // Get current camera track
      const currentPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      const currentTrack = currentPublication?.track;

      // Stop current track completely
      if (currentTrack) {
        console.log('📹 Stopping current track');
        currentTrack.stop();
        await localParticipant.unpublishTrack(currentTrack);
      }

      // Wait for Android to release camera (500ms - critical for Android)
      console.log('📹 Waiting 500ms for camera release');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Try progressive constraint levels (like pre-join does)
      const constraints = [
        { facingMode: newFacingMode, resolution: { width: 640, height: 480 } },
        { facingMode: newFacingMode, resolution: { width: 480, height: 360 } },
        { facingMode: newFacingMode, resolution: { width: 320, height: 240 } },
        { facingMode: newFacingMode }, // Unconstrained - last resort
      ];

      let newTrack = null;
      for (const constraint of constraints) {
        try {
          console.log('📹 Trying constraint:', constraint);
          newTrack = await createLocalVideoTrack(constraint);
          console.log('📹 Success with constraint:', constraint);
          break; // Success - exit loop
        } catch (e) {
          console.log('📹 Constraint failed:', constraint, e.message);
          // Continue to next constraint
        }
      }

      if (newTrack) {
        await localParticipant.publishTrack(newTrack);
        setCurrentFacingMode(newFacingMode);
        console.log('📹 Camera switched successfully to', newFacingMode);
      } else {
        throw new Error('All camera constraints failed');
      }

    } catch (error) {
      console.error('📹 Camera switch failed:', error);
      toast.error('Could not switch camera. Try again.');

      // Try to restore camera if switch failed
      try {
        console.log('📹 Attempting to restore original camera');
        const restoreTrack = await createLocalVideoTrack({
          facingMode: currentFacingMode,
        });
        await localParticipant.publishTrack(restoreTrack);
        console.log('📹 Camera restored');
      } catch (restoreError) {
        console.error('📹 Failed to restore camera:', restoreError);
        toast.error('Camera error. Please rejoin the call.');
      }
    } finally {
      setIsSwitching(false);
    }
  }, [localParticipant, isSwitching, currentFacingMode]);

  return {
    switchCamera,
    isSwitching,
    canSwitchCamera,
  };
}

// Helper functions
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function extractFrameFromRemoteTrack(track) {
  try {
    const videoElement = document.createElement('video');
    videoElement.srcObject = new MediaStream([track.mediaStreamTrack]);
    videoElement.muted = true;
    videoElement.playsInline = true;
    
    // Android compatibility attributes
    videoElement.setAttribute('playsinline', 'true');
    videoElement.setAttribute('webkit-playsinline', 'true');
    videoElement.setAttribute('muted', 'true');
    videoElement.setAttribute('autoplay', 'false');
    
    // Additional Android-specific attributes
    videoElement.setAttribute('x5-video-player-type', 'h5');
    videoElement.setAttribute('x5-video-player-fullscreen', 'true');
    
    await new Promise((resolve, reject) => {
      videoElement.onloadedmetadata = () => {
        // Wait for at least one frame to be available
        videoElement.requestVideoFrameCallback ? 
          videoElement.requestVideoFrameCallback(resolve) : 
          setTimeout(resolve, 100); // Much shorter fallback delay
      };
      videoElement.onerror = reject;
      videoElement.play().catch(reject);
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) throw new Error('Could not get canvas context');

    canvas.width = videoElement.videoWidth || 640;
    canvas.height = videoElement.videoHeight || 480;
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    videoElement.remove();

    return new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8);
    });
  } catch (error) {
    console.error('Error extracting frame from remote track:', error);
    return null;
  }
}

// Modern Room Selector with sleek design
function RoomSelector({ currentRoom, onChange, isSmallScreen }) {
  const [isOpen, setIsOpen] = useState(false);
  const rooms = [
    { value: 'Living Room', icon: '🛋️', color: 'from-blue-500 to-purple-600' },
    { value: 'Bedroom', icon: '🛏️', color: 'from-purple-500 to-pink-600' },
    { value: 'Master Bedroom', icon: '🏠', color: 'from-pink-500 to-red-600' },
    { value: 'Kitchen', icon: '🍳', color: 'from-orange-500 to-yellow-600' },
    { value: 'Dining Room', icon: '🍽️', color: 'from-yellow-500 to-green-600' },
    { value: 'Office', icon: '💼', color: 'from-green-500 to-blue-600' },
    { value: 'Garage', icon: '🚗', color: 'from-gray-500 to-blue-600' },
    { value: 'Basement', icon: '🏚️', color: 'from-stone-500 to-gray-600' },
    { value: 'Attic', icon: '🏠', color: 'from-amber-500 to-orange-600' },
    { value: 'Bathroom', icon: '🚿', color: 'from-cyan-500 to-blue-600' },
    { value: 'Other', icon: '📦', color: 'from-gray-500 to-slate-600' }
  ];

  const currentRoomData = rooms.find(room => room.value === currentRoom) || rooms[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-white font-medium transition-all duration-300 transform hover:scale-[1.02] active:scale-98 ${glassStyle} bg-gradient-to-r ${currentRoomData.color}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{currentRoomData.icon}</span>
          <span className="font-semibold">{currentRoom}</span>
        </div>
        <div className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      
      {isOpen && (
        <div className={`absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl overflow-hidden ${glassStyle} max-h-80 overflow-y-auto`}>
          {rooms.map((room) => (
            <button
              key={room.value}
              onClick={() => {
                onChange(room.value);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-200 hover:bg-white/20 ${
                room.value === currentRoom ? 'bg-white/30 text-white' : 'text-white/90'
              }`}
            >
              <span className="text-xl">{room.icon}</span>
              <span className="font-medium">{room.value}</span>
              {room.value === currentRoom && (
                <CheckCircle className="w-4 h-4 ml-auto text-green-400" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function isAgent(participantName) {
  return participantName.toLowerCase().includes('agent');
}

// Wraps LiveKit's ParticipantTile so the agent can snap a photo of any
// remote (non-agent) feed into the Media Vault. GridLayout renders this once
// per track inside a TrackRefContext.Provider; children must NOT be passed
// to ParticipantTile itself (they would replace its internal template).
function SnapableTile({ tileStyle, onSnap, flashSid, isSmallScreen }) {
  const trackRef = useMaybeTrackRefContext();
  const participant = trackRef?.participant;
  const publication = trackRef?.publication;
  // Shows a spinner from tap until the photo has saved (and the Photos
  // panel refresh has been triggered) so the delay reads as "working".
  const [snapping, setSnapping] = useState(false);
  const snappable = !!(
    participant &&
    !participant.isLocal &&
    !isAgent(participant.name || participant.identity || '') &&
    publication?.track?.mediaStreamTrack &&
    !publication.isMuted
  );
  const flashing = snappable && flashSid && flashSid === participant?.sid;
  return (
    <div className="relative w-full h-full group/tile">
      <ParticipantTile style={tileStyle} />
      {snappable && (
        <button
          onClick={async (e) => {
            e.stopPropagation();
            if (snapping) return;
            setSnapping(true);
            try {
              await onSnap(trackRef);
            } finally {
              setSnapping(false);
            }
          }}
          title="Snap photo"
          className={`absolute z-20 rounded-full text-white transition-opacity ${
            isSmallScreen
              ? 'bottom-2 right-2 p-2 bg-black/35 opacity-80'
              : `top-2 right-2 p-2 bg-black/50 ${snapping ? 'opacity-100' : 'opacity-0 group-hover/tile:opacity-100'}`
          }`}
        >
          {snapping ? (
            <Loader2 size={isSmallScreen ? 14 : 16} className="animate-spin" />
          ) : (
            <Camera size={isSmallScreen ? 14 : 16} />
          )}
        </button>
      )}
      {flashing && (
        <div className="absolute inset-0 z-30 bg-white pointer-events-none animate-snapflash" />
      )}
    </div>
  );
}

const CustomerView = React.memo(({ onCallEnd, roomId, onRetryConnection, mediaDefaults, onCameraOn }) => {
  const [showControls, setShowControls] = useState(true);
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants().filter(
    (p) => !p.identity?.startsWith('EG_')
  );
  const connectionState = useConnectionState();
  const {
    needsManualRecovery: mediaNeedsRecovery,
    failedLabel: mediaFailedLabel,
    recover: recoverMedia,
    setEnabledRobust,
  } = useMediaRecovery({ roomId, side: 'customer', defaults: mediaDefaults });
  const { captureFailure, retryCapture, dismissCaptureFailure } = useCallHealth({ roomId, side: 'customer' });
  const { remoteVideoStalled, remotePaused, retryRemoteVideo } = useRemoteVideoWatchdog({ roomId, side: 'customer' });

  // Watchdog: the Connecting/Reconnecting spinner must not run forever. After
  // 30s of continuous connecting, offer a retry instead of spinning.
  const [connectingTimedOut, setConnectingTimedOut] = useState(false);

  // Custom control states
  const [isMicEnabled, setIsMicEnabled] = useState(mediaDefaults?.microphone ?? true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(mediaDefaults?.camera ?? true);
  const [isLeaving, setIsLeaving] = useState(false);
  const { switchCamera, isSwitching: isCameraSwitching, canSwitchCamera } = useAdvancedCameraSwitching();

  // Consultant can nudge the customer to flip their camera (sound + prompt).
  const { promptVisible: flipPromptVisible, dismiss: dismissFlipPrompt } = useFlipCameraRequest(roomId);
  const handleFlipFromPrompt = useCallback(async () => {
    try {
      await switchCamera();
      if (roomId) reportCallEvent(roomId, 'customer', 'flip_camera_done');
    } catch (e) {
      console.error('Flip camera failed:', e);
    } finally {
      dismissFlipPrompt();
    }
  }, [switchCamera, dismissFlipPrompt, roomId]);

  // Show loading screen while connecting
  const isConnecting = connectionState === ConnectionState.Connecting || connectionState === ConnectionState.Reconnecting;

  useEffect(() => {
    if (!isConnecting) {
      setConnectingTimedOut(false);
      return;
    }
    const t = setTimeout(() => setConnectingTimedOut(true), 30000);
    return () => clearTimeout(t);
  }, [isConnecting]);

  // Detect mobile device immediately via user agent (no useEffect delay)
  const isMobileDevice = useMemo(() => {
    if (typeof window === 'undefined') return true;
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    console.log('📱 Mobile device detection:', { mobile, userAgent: navigator.userAgent.substring(0, 50) });
    return mobile;
  }, []);

  // Detect Android specifically for certain fixes
  const isAndroid = useMemo(() => {
    return /Android/i.test(navigator.userAgent);
  }, []);

  // Detect iOS (incl. iPadOS, which reports as Mac + touch). iOS Safari is the
  // one that delivers a black first frame from getUserMedia at join.
  const isIOS = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return (
      /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)
    );
  }, []);

  // Track screen width for dynamic changes (but mobile devices always use mobile layout)
  const [screenWidth, setScreenWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 375
  );

  useEffect(() => {
    const handleResize = () => setScreenWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Final mobile check: mobile device user agent OR small screen width
  // This ensures iOS/Android always get mobile layout, plus tablets/small windows
  const isSmallScreen = isMobileDevice || screenWidth < 768;

  // Android debugging - track component state
  useEffect(() => {
    if (isAndroid) {
      console.log('🤖 CustomerView mounted');
      console.log('🤖 Initial state:', { 
        isSmallScreen, 
        hasLocalParticipant: !!localParticipant, 
        remoteParticipantsCount: remoteParticipants.length 
      });
      
      return () => {
        console.log('🤖 CustomerView unmounting');
      };
    }
  }, [isAndroid, isSmallScreen, localParticipant, remoteParticipants.length]);


  // Camera is managed by LiveKit via roomOptions.videoCaptureDefaults
  // No need for manual camera management here

  // Controls are always visible - no auto-hide behavior

  // Get all video tracks to display
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  ).filter((t) => !t.participant?.identity?.startsWith('EG_'));

  // Check if local camera track is ready (not just a placeholder)
  const localCameraTrack = tracks.find(
    t => t.participant?.isLocal && t.source === Track.Source.Camera && t.publication?.track
  );
  const isCameraReady = !!localCameraTrack?.publication?.track;

  // Track whether the camera was ever live, so the "your camera is off"
  // placeholder shows only for a real off-state (audio-only join, or the user
  // toggled off after being on) and NOT during the initial ~1s of camera
  // acquisition on a normal join (where it would flash the wrong message).
  const cameraEverReadyRef = useRef(false);
  if (isCameraReady) cameraEverReadyRef.current = true;
  const showCameraOff =
    !isCameraEnabled && (mediaDefaults?.camera === false || cameraEverReadyRef.current);

  // Get remote video track (agent's camera)
  const remoteCameraTrack = tracks.find(
    t => !t.participant?.isLocal && t.source === Track.Source.Camera && t.publication?.track
  );

  // Remote screen share (the consultant presenting their screen). When present
  // it becomes the main feed so the customer can actually see what's being
  // shown — the mobile layout bypasses GridLayout, so without this a shared
  // screen never appears on the customer's phone at all.
  const remoteScreenShareTrack = tracks.find(
    t => !t.participant?.isLocal && t.source === Track.Source.ScreenShare && t.publication?.track
  );
  const isRemoteScreenSharing = !!remoteScreenShareTrack?.publication?.track;

  // Native zoom + torch (flash) for the customer's own camera — same controls
  // as the self-survey, driven off the LiveKit track's MediaStreamTrack.
  const cameraControls = useLiveKitCameraControls(
    localCameraTrack?.publication?.track?.mediaStreamTrack
  );

  // Refs for manual video elements (Android only)
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const screenShareVideoRef = useRef(null);

  // Detect mobile for camera flip button
  const isMobile = isSmallScreen;

  // Manual track attachment for mobile - bypasses GridLayout issues.
  // isRemoteScreenSharing is a dep because the self-view <video> element is
  // swapped out when a shared screen takes over the main feed — the track must
  // re-attach to whichever element is currently mounted.
  useEffect(() => {
    if (!isSmallScreen) return;

    const localTrack = localCameraTrack?.publication?.track;
    const videoElement = localVideoRef.current;

    if (localTrack && videoElement) {
      console.log('📱 Attaching local track to video element');
      localTrack.attach(videoElement);
      return () => {
        console.log('📱 Detaching local track');
        localTrack.detach(videoElement);
      };
    }
  }, [isSmallScreen, localCameraTrack?.publication?.track, isRemoteScreenSharing]);

  // Manual screen-share attachment for mobile (the consultant's shared screen).
  useEffect(() => {
    if (!isSmallScreen) return;
    const ssTrack = remoteScreenShareTrack?.publication?.track;
    const videoElement = screenShareVideoRef.current;
    if (ssTrack && videoElement) {
      ssTrack.attach(videoElement);
      return () => {
        ssTrack.detach(videoElement);
      };
    }
  }, [isSmallScreen, remoteScreenShareTrack?.publication?.track]);

  // iOS Safari frequently paints the customer's OWN self-view <video> black on
  // join even though the camera is live and the consultant receives frames
  // fine — a known Safari repaint bug, NOT a capture problem. Flipping the
  // camera fixes it only as a side effect of re-attaching a track to the
  // element. So once the local track is up, force the element to repaint by
  // re-attaching it (detach → attach resets srcObject) and replaying. iOS only;
  // a couple of attempts since the first can land before frames flow.
  const iosNudgedTrackRef = useRef(null);
  useEffect(() => {
    if (!isIOS || !isSmallScreen) return;
    const track = localCameraTrack?.publication?.track;
    if (!track || iosNudgedTrackRef.current === track) return;
    iosNudgedTrackRef.current = track;
    const repaint = () => {
      const el = localVideoRef.current;
      if (!el || !track) return;
      try {
        track.detach(el);
        track.attach(el);
        el.play?.().catch(() => {});
      } catch (e) {
        console.warn('[ios-selfview-repaint] failed:', e);
      }
    };
    const timers = [500, 1400, 2800].map((d) => setTimeout(repaint, d));
    return () => timers.forEach(clearTimeout);
  }, [isIOS, isSmallScreen, localCameraTrack?.publication?.track]);

  // Manual remote track attachment for mobile
  useEffect(() => {
    if (!isSmallScreen) return;

    const remoteTrack = remoteCameraTrack?.publication?.track;
    const videoElement = remoteVideoRef.current;

    if (remoteTrack && videoElement) {
      console.log('📱 Attaching remote track to video element');
      remoteTrack.attach(videoElement);
      return () => {
        console.log('📱 Detaching remote track');
        remoteTrack.detach(videoElement);
      };
    }
  }, [isSmallScreen, remoteCameraTrack?.publication?.track]);

  // Sync control states with localParticipant
  useEffect(() => {
    if (!localParticipant) return;
    setIsMicEnabled(localParticipant.isMicrophoneEnabled);
    setIsCameraEnabled(localParticipant.isCameraEnabled);
  }, [localParticipant?.isMicrophoneEnabled, localParticipant?.isCameraEnabled]);

  // Toggle mic — robust ladder with user feedback: after a phone-call
  // interruption the SDK auto-mutes a seized mic, and a plain
  // setMicrophoneEnabled(true) can throw (mic still held) — previously that
  // error was swallowed and the button just snapped back to muted.
  const toggleMic = useCallback(async () => {
    if (!localParticipant) return;
    const next = !isMicEnabled;
    setIsMicEnabled(next); // optimistic; reverted on failure
    const ok = await setEnabledRobust('microphone', next);
    if (!ok) setIsMicEnabled(localParticipant.isMicrophoneEnabled);
  }, [localParticipant, isMicEnabled, setEnabledRobust]);

  // Toggle camera
  const toggleCamera = useCallback(async () => {
    if (!localParticipant) return;
    const next = !isCameraEnabled;
    setIsCameraEnabled(next); // optimistic; reverted on failure
    const ok = await setEnabledRobust('camera', next);
    if (!ok) setIsCameraEnabled(localParticipant.isCameraEnabled);
    // An audio-only customer who turns their camera on: clear the stale
    // audio-only flag upstream so an auto-rejoin remount keeps video on
    // instead of silently dropping it back to audio-only.
    else if (next) onCameraOn?.();
  }, [localParticipant, isCameraEnabled, setEnabledRobust, onCameraOn]);

  // Leave call with loading state
  const leaveCall = useCallback(() => {
    setIsLeaving(true);
    if (onCallEnd) {
      onCallEnd();
    }
  }, [onCallEnd]);

  const hasAgent = remoteParticipants.some(p => isAgent(p.identity));
  const agentName = remoteParticipants.find(p => isAgent(p.identity))?.name || 'Moving Agent';

  // Show loading screen while connecting
  if (isConnecting) {
    return (
      <div className="h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        </div>

        <div className={`p-8 rounded-3xl text-center max-w-md ${glassStyle} z-10`}>
          {connectingTimedOut ? (
            <>
              <AlertCircle className="w-12 h-12 text-amber-300 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-white mb-2">Having trouble connecting</h3>
              <p className="text-white/70 mb-5">
                This is taking longer than it should. Check your connection and try again.
              </p>
              <button
                onClick={() => {
                  setConnectingTimedOut(false);
                  onRetryConnection?.();
                }}
                className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-colors flex items-center gap-2 mx-auto"
              >
                <RotateCcw className="w-5 h-5" />
                Try again
              </button>
            </>
          ) : (
            <>
              <Loader2 className="w-12 h-12 animate-spin text-white mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-white mb-2">Connecting...</h3>
              <p className="text-white/70">Setting up your video call</p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Render message for large screens
  if (!isSmallScreen) {
    return (
      <div className="h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '4s' }}></div>
        </div>

        {/* Message */}
        <div className={`p-8 rounded-3xl text-center max-w-md ${glassStyle} z-10`}>
          <h3 className="text-2xl font-bold text-white mb-3">
            Screen too large
          </h3>
          <p className="text-white/80 leading-relaxed">
            Thanks for coming! Please use a smaller screen or resize your browser window to continue. You'll need to give us a tour of your home.
          </p>
        </div>
      </div>
    );
  }

  // Render the video call interface for small screens
  return (
    <div
      className={`h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex flex-col relative overflow-hidden ${isAndroid ? 'android-video-fix' : ''}`}
      style={{
        ...(isAndroid && {
          minHeight: '100vh',
          minHeight: '100dvh', // Dynamic viewport height for Android
          WebkitOverflowScrolling: 'touch'
        })
      }}
    >
      <MediaRecoveryBanner visible={mediaNeedsRecovery} label={mediaFailedLabel} onRecover={recoverMedia} />
      <CaptureFailureBanner failure={captureFailure} onRetry={retryCapture} onDismiss={dismissCaptureFailure} />
      <LowBandwidthChip visible={remotePaused} />
      <FlipCameraPrompt visible={flipPromptVisible} onFlip={handleFlipFromPrompt} onDismiss={dismissFlipPrompt} switching={isCameraSwitching} />
      {/* Recording Indicator - Hidden
      <RecordingIndicator 
        recordingStatus={recordingStatus.recordingStatus}
        formattedDuration={recordingStatus.formattedDuration}
      /> */}
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '4s' }}></div>
      </div>

      {/* Video area - Full screen for both participants */}
      <div className="absolute inset-0 z-10">
        {isSmallScreen ? (
          // Mobile: Bypass GridLayout entirely - use manual video elements for better compatibility
          // Customer-side layout: customer's own camera is the large feed (so they can
          // see what they're showing), agent appears in the PiP corner.
          <div className="absolute inset-0 flex flex-col bg-black">
            {/* Main feed. Normally the customer's own camera (so they see what
                they're showing). When the consultant shares their screen, that
                becomes the main feed instead — shown with object-contain on a
                black mat so the whole screen is visible, never cropped. */}
            <div className="flex-1 relative">
              {isRemoteScreenSharing ? (
                <>
                  <video
                    ref={screenShareVideoRef}
                    autoPlay
                    playsInline
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                  />
                  <div className="absolute top-safe-or-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-sm border border-white/15">
                    <Monitor className="w-3.5 h-3.5 text-white/80" />
                    <span className="text-white/90 text-xs font-medium">{agentName} is sharing their screen</span>
                  </div>
                </>
              ) : localCameraTrack?.publication?.track ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : showCameraOff ? (
                // Audio-only join (or camera toggled off): a spinner here
                // would look like a hang — show an honest camera-off state.
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900">
                  <div className="text-center px-6">
                    <VideoOff className="w-12 h-12 text-white/70 mx-auto mb-4" />
                    <p className="text-white/80 font-medium">Your camera is off</p>
                    <p className="text-white/50 text-sm mt-1">Tap the camera button below to turn it on</p>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900">
                  <div className="text-center">
                    <Loader2 className="w-12 h-12 animate-spin text-white mx-auto mb-4" />
                    <p className="text-white/80">Starting your camera...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Remote video (agent) - small overlay in corner */}
            {remoteCameraTrack?.publication?.track ? (
              <div
                className="absolute bottom-44 right-4 w-28 h-40 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/30 z-30 bg-black"
              >
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
            ) : remoteVideoStalled ? (
              <button
                onClick={retryRemoteVideo}
                className="absolute bottom-44 right-4 w-28 h-40 rounded-2xl overflow-hidden shadow-2xl border-2 border-amber-400/70 z-30 bg-black flex items-center justify-center active:scale-95 transition-all"
              >
                <div className="text-center px-2">
                  <RotateCcw className="w-5 h-5 text-amber-300 mx-auto mb-1" />
                  <p className="text-amber-200 text-[10px] leading-tight">Consultant&apos;s video is stuck — tap to retry</p>
                </div>
              </button>
            ) : (
              <div className="absolute bottom-44 right-4 w-28 h-40 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/30 z-30 bg-black flex items-center justify-center">
                <div className="text-center px-2">
                  <Loader2 className="w-5 h-5 animate-spin text-white/70 mx-auto mb-1" />
                  <p className="text-white/70 text-[10px] leading-tight">Connecting consultant…</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          // Desktop: use GridLayout for side-by-side view
          <>
            <GridLayout
              key={gridMembershipKey(tracks)}
              tracks={tracks}
              style={{ height: '100%', width: '100%' }}
            >
              <ParticipantTile style={{ borderRadius: '0px', overflow: 'hidden' }} />
            </GridLayout>

            {/* Self-view overlay for desktop */}
            {localCameraTrack && isCameraReady && (
              <div
                className="absolute bottom-32 right-4 w-28 h-40 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/30 z-30"
              >
                <VideoTrack
                  trackRef={localCameraTrack}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </>
        )}

        {/* Loading overlay when camera isn't ready. Gated on isCameraEnabled:
            an audio-only join (or camera-off) must not sit behind a full-screen
            "Starting Camera..." curtain — and when capture fails silently the
            capture-failure banner handles it instead of this spinner. */}
        {!isCameraReady && isCameraEnabled && !captureFailure && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-900/90 via-purple-900/90 to-pink-900/90 backdrop-blur-sm">
            <div className={`p-8 rounded-3xl text-center ${glassStyle}`}>
              <Loader2 className="w-12 h-12 animate-spin text-white mx-auto mb-4" />
              <h3 className="text-xl font-bold text-white mb-2">Starting Camera...</h3>
              <p className="text-white/70 text-sm">Please wait while we set up your video</p>
            </div>
          </div>
        )}
      </div>

      {/* Top overlay - Agent info and connection status */}
      {showControls && (
        <div className="absolute top-safe-or-6 left-4 right-4 z-20">
          <div className="flex items-center justify-between">
            {/* Agent info card */}
            <div className={`flex items-center gap-4 px-6 py-4 rounded-3xl ${glassStyle} transform transition-all duration-500 hover:scale-105`}>
              <div className="relative">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white bg-gradient-to-br ${hasAgent ? 'from-green-400 to-emerald-600' : 'from-gray-400 to-gray-600'} shadow-lg`}>
                  {agentName.charAt(0).toUpperCase()}
                </div>
                {hasAgent && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse"></div>
                )}
              </div>
              <div>
                <p className="text-white font-bold text-lg">{hasAgent ? agentName : 'Connecting...'}</p>
                <p className="text-white/80 text-sm font-medium">Moving Inventory Specialist</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Camera controls — zoom presets + flashlight for the customer's OWN
          camera, matching the self-survey. Phones only, only while their camera
          is the visible feed (not during a screen share / camera-off), and only
          for what THIS lens actually supports: multi-lens phones expose .5×/zoom
          presets; most back cameras expose a torch, front cameras neither (so
          they auto-hide). Camera-app style, centered just above the controls. */}
      {isSmallScreen && isCameraReady && !isRemoteScreenSharing && showControls && (() => {
        const range = cameraControls.zoomRange;
        const presets = range
          ? [0.5, 1, 2, 3].filter((z) => z >= range.min - 0.01 && z <= range.max + 0.01)
          : [];
        const showZoom = presets.length >= 2;
        if (!showZoom && !cameraControls.torchAvailable) return null;
        const nearest = presets.reduce(
          (best, z) =>
            Math.abs(z - cameraControls.currentZoom) < Math.abs(best - cameraControls.currentZoom) ? z : best,
          presets[0] ?? 1
        );
        return (
          <div
            className="absolute left-0 right-0 z-30 flex items-center justify-center gap-3 pointer-events-none"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 118px)' }}
          >
            {showZoom && (
              <div className="pointer-events-auto flex items-center gap-1 bg-white/10 backdrop-blur-2xl border border-white/20 rounded-full px-2 py-1 shadow-lg">
                {presets.map((z) => (
                  <button
                    key={z}
                    onClick={() => {
                      cameraControls.setCameraZoom(z);
                      if (roomId) reportCallEvent(roomId, 'customer', 'zoom_changed');
                    }}
                    className={`min-w-[38px] h-[34px] px-2 rounded-full text-sm font-semibold transition-colors ${
                      nearest === z ? 'bg-white/90 text-black shadow' : 'text-white/95'
                    }`}
                    aria-label={`Zoom ${z}x`}
                  >
                    {z === 0.5 ? '.5' : `${z}`}
                    <span className="text-[10px] align-top">×</span>
                  </button>
                ))}
              </div>
            )}
            {cameraControls.torchAvailable && (
              <button
                onClick={() => {
                  cameraControls.toggleTorch();
                  if (roomId) reportCallEvent(roomId, 'customer', 'torch_toggled');
                }}
                className={`pointer-events-auto w-[42px] h-[42px] rounded-full flex items-center justify-center backdrop-blur-2xl border shadow-lg ${
                  cameraControls.torchOn
                    ? 'bg-yellow-400/90 border-yellow-200/50 text-black'
                    : 'bg-white/10 border-white/20 text-white'
                }`}
                aria-label={cameraControls.torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </button>
            )}
          </div>
        );
      })()}

      {/* Custom Mobile-Friendly Controls */}
      <div className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-300 ${showControls ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="bg-gradient-to-t from-black/80 to-transparent p-6 pb-safe-or-8">
          <div className="flex items-center justify-center gap-5">
            {/* Mic Toggle */}
            <button
              onClick={toggleMic}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
                isMicEnabled
                  ? 'bg-white/20 backdrop-blur-lg border border-white/30'
                  : 'bg-red-500/80 backdrop-blur-lg border border-red-400/50'
              }`}
            >
              {isMicEnabled ? (
                <Mic className="w-7 h-7 text-white" />
              ) : (
                <MicOff className="w-7 h-7 text-white" />
              )}
            </button>

            {/* Camera Toggle */}
            <button
              onClick={toggleCamera}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
                isCameraEnabled
                  ? 'bg-white/20 backdrop-blur-lg border border-white/30'
                  : 'bg-red-500/80 backdrop-blur-lg border border-red-400/50'
              }`}
            >
              {isCameraEnabled ? (
                <Video className="w-7 h-7 text-white" />
              ) : (
                <VideoOff className="w-7 h-7 text-white" />
              )}
            </button>

            {/* End Call - Larger and prominent with loading state */}
            <button
              onClick={leaveCall}
              disabled={isLeaving}
              className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 disabled:bg-red-400 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all duration-200 active:scale-95 disabled:scale-100"
            >
              {isLeaving ? (
                <Loader2 className="w-9 h-9 text-white animate-spin" />
              ) : (
                <PhoneOff className="w-9 h-9 text-white" />
              )}
            </button>

            {/* Camera Flip - always show on mobile */}
            {isMobile && (
              <button
                onClick={switchCamera}
                disabled={isCameraSwitching}
                className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-lg border border-white/20 flex items-center justify-center transition-all duration-200 active:scale-95 disabled:opacity-50"
              >
                {isCameraSwitching ? (
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                ) : (
                  <SwitchCamera className="w-6 h-6 text-white" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <RoomAudioRenderer />
      {/* Autoplay unlock: mobile browsers can block remote audio until a tap
          (especially after an automatic rejoin remount, which recreates the
          audio elements without a user gesture). StartAudio renders only
          while playback is blocked and hides itself once audio starts. */}
      <div className="absolute bottom-52 left-1/2 -translate-x-1/2 z-40">
        <StartAudio
          label="Tap to enable sound"
          className="flex items-center gap-2 px-5 py-3 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold shadow-2xl transition-all duration-200 active:scale-95"
        />
      </div>
    </div>
  );
});


const AgentView = React.memo(({
  projectId,
  currentRoom,
  setCurrentRoom,
  participantName,
  roomId,
  onCallEnd
}) => {
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [isInventoryActive, setIsInventoryActive] = useState(false);
  const [captureMode, setCaptureMode] = useState('paused');
  const [captureCount, setCaptureCount] = useState(0);

  // Real inventory data (replaces detectedItems)
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  // Custom control states for mobile
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);

  // Get participant identity for audio processor
  const { localParticipant } = useLocalParticipant();
  const participantIdentity = localParticipant?.identity || '';
  const agentRoom = useRoomContext();

  // Ask the customer to flip their camera (sound + prompt on their phone).
  // Briefly disabled after a send so a double-tap doesn't spam them.
  const [flipRequestCooling, setFlipRequestCooling] = useState(false);
  const requestFlipCamera = useCallback(() => {
    if (flipRequestCooling) return;
    if (sendFlipCameraRequest(agentRoom)) {
      toast.success('Asked your customer to flip their camera');
      if (roomId) reportCallEvent(roomId, 'agent', 'flip_camera_requested');
      setFlipRequestCooling(true);
      setTimeout(() => setFlipRequestCooling(false), 4000);
    } else {
      toast.error("Couldn't send the request — check your connection.");
    }
  }, [agentRoom, flipRequestCooling, roomId]);
  const {
    needsManualRecovery: mediaNeedsRecovery,
    failedLabel: mediaFailedLabel,
    recover: recoverMedia,
    setEnabledRobust,
  } = useMediaRecovery({ roomId, side: 'agent' });
  const { captureFailure, retryCapture, dismissCaptureFailure } = useCallHealth({ roomId, side: 'agent' });
  const { remotePaused } = useRemoteVideoWatchdog({ roomId, side: 'agent' });

  // Handler for when a new transcript segment is received
  const handleTranscriptReceived = useCallback((segment) => {
    setLiveTranscriptSegments(prev => {
      // Check if segment already exists
      const exists = prev.some(s => s._id === segment._id);
      if (exists) return prev;
      // Add new segment and sort by startTime
      return [...prev, segment].sort((a, b) => a.startTime - b.startTime);
    });
  }, []);

  const remoteParticipants = useRemoteParticipants().filter(
    (p) => !p.identity?.startsWith('EG_')
  );
  const { switchCamera, isSwitching, canSwitchCamera: canSwitchCameraCustomer } = useAdvancedCameraSwitching();

  // Sync control states with localParticipant
  useEffect(() => {
    if (!localParticipant) return;
    setIsMicEnabled(localParticipant.isMicrophoneEnabled);
    setIsCameraEnabled(localParticipant.isCameraEnabled);
  }, [localParticipant?.isMicrophoneEnabled, localParticipant?.isCameraEnabled]);

  // Toggle mic — robust ladder with user feedback (see CustomerView note).
  const toggleMic = useCallback(async () => {
    if (!localParticipant) return;
    const next = !isMicEnabled;
    setIsMicEnabled(next); // optimistic; reverted on failure
    const ok = await setEnabledRobust('microphone', next);
    if (!ok) setIsMicEnabled(localParticipant.isMicrophoneEnabled);
  }, [localParticipant, isMicEnabled, setEnabledRobust]);

  // Toggle camera
  const toggleCamera = useCallback(async () => {
    if (!localParticipant) return;
    const next = !isCameraEnabled;
    setIsCameraEnabled(next); // optimistic; reverted on failure
    const ok = await setEnabledRobust('camera', next);
    if (!ok) setIsCameraEnabled(localParticipant.isCameraEnabled);
  }, [localParticipant, isCameraEnabled, setEnabledRobust]);

  // Leave call with loading state
  const leaveCall = useCallback(() => {
    setIsLeaving(true);
    if (onCallEnd) {
      onCallEnd();
    }
  }, [onCallEnd]);

  // Mid-call "Stop & Process": one-shot button that stops the walkthrough
  // recording and sends it for AI analysis while the call stays live. The
  // rest of the call keeps recording (appended to the video at call end).
  const [processState, setProcessState] = useState('idle'); // idle | confirming | starting | processing | done | failed
  const [processRecordingId, setProcessRecordingId] = useState(null);
  const [processedItemCount, setProcessedItemCount] = useState(0);

  const startInventoryProcessing = useCallback(async () => {
    setProcessState('starting');
    try {
      const response = await fetch(`/api/calls/${roomId}/process-inventory`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Could not start processing');
      }
      if (data.warning) toast.warning(data.warning);
      setProcessRecordingId(data.recordingId);
      setProcessState('processing');
      toast.success('Walkthrough sent for analysis — the call keeps recording');
    } catch (error) {
      console.error('Failed to start inventory processing:', error);
      toast.error(error.message || 'Could not start processing — the call is still being recorded');
      setProcessState('idle');
    }
  }, [roomId]);

  // Call-photo snaps: grab a JPEG frame from a customer's video track and
  // store it in the Media Vault, linked to this call (roomId + recording
  // offset stamped server-side). Flash fires immediately for feedback.
  const [flashSid, setFlashSid] = useState(null);
  const [photosRefreshKey, setPhotosRefreshKey] = useState(0);

  const snapFromTrackRef = useCallback(async (trackRef) => {
    const track = trackRef?.publication?.track;
    const participant = trackRef?.participant;
    if (!track?.mediaStreamTrack) return;
    setFlashSid(participant?.sid || null);
    setTimeout(() => setFlashSid(null), 300);
    try {
      const blob = await extractFrameFromRemoteTrack(track);
      if (!blob) {
        toast.error('Could not capture a frame from that video');
        return;
      }
      const formData = new FormData();
      formData.append(
        'file',
        new File([blob], `call-photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
      );
      formData.append('participantName', participant?.name || participant?.identity || '');
      const response = await fetch(`/api/calls/${roomId}/snap-photo`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to save photo');
      }
      setPhotosRefreshKey((k) => k + 1);
    } catch (error) {
      console.error('Failed to snap call photo:', error);
      toast.error(error.message || 'Photo could not be saved');
    }
  }, [roomId]);

  // Poll analysis status while processing
  useEffect(() => {
    if (processState !== 'processing' || !processRecordingId || !projectId) return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/video-recordings/${processRecordingId}`);
        if (!response.ok) return;
        const recording = await response.json();
        if (cancelled) return;
        const status = recording?.analysisResult?.status;
        if (status === 'completed') {
          setProcessedItemCount(recording.analysisResult?.itemsCount || 0);
          setProcessState('done');
        } else if (status === 'failed') {
          setProcessState('failed');
        }
      } catch (e) {
        // transient poll error — keep polling
      }
    };
    const interval = setInterval(check, 5000);
    check();
    return () => { cancelled = true; clearInterval(interval); };
  }, [processState, processRecordingId, projectId]);

  const renderProcessStatusChip = (dark) => {
    if (processState === 'starting' || processState === 'processing') {
      return dark ? (
        <div className={`px-4 py-2 rounded-2xl ${glassStyle} flex items-center gap-2 bg-amber-500/20 border-amber-400/50`}>
          <Loader2 className="w-4 h-4 text-white animate-spin" />
          <span className="text-white text-sm font-bold">ANALYZING…</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm font-medium">
          <Loader2 className="w-4 h-4 animate-spin" />
          Analyzing walkthrough…
        </div>
      );
    }
    if (processState === 'done') {
      // Success + jump-off to review the inventory. Opens in a new tab so the
      // agent never leaves the live call.
      const openProject = () => window.open(`/projects/${projectId}`, '_blank', 'noopener');
      return dark ? (
        <button
          onClick={openProject}
          className={`px-4 py-2 rounded-2xl ${glassStyle} flex items-center gap-2 bg-green-500/20 border-green-400/50 transition-all duration-200 active:scale-95 hover:bg-green-500/30`}
        >
          <CheckCircle className="w-4 h-4 text-white" />
          <span className="text-white text-sm font-bold">INVENTORY READY</span>
          <span className="text-white/90 text-sm font-bold flex items-center gap-1">
            · OPEN PROJECT <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </button>
      ) : (
        <button
          onClick={openProject}
          className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-white text-sm font-medium transition-colors"
        >
          <CheckCircle className="w-4 h-4" />
          Inventory ready
          <span className="flex items-center gap-1 font-semibold">
            · Open project <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </button>
      );
    }
    if (processState === 'failed') {
      return dark ? (
        <div className={`px-4 py-2 rounded-2xl ${glassStyle} flex items-center gap-2 bg-red-500/20 border-red-400/50`}>
          <AlertCircle className="w-4 h-4 text-white" />
          <span className="text-white text-sm font-bold">ANALYSIS FAILED</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-medium">
          <AlertCircle className="w-4 h-4" />
          Analysis failed — reprocess after the call
        </div>
      );
    }
    return null;
  };

  const processConfirmDialog = processState === 'confirming' && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Process inventory now?</h3>
        <p className="text-sm text-gray-600 mb-5">
          This ends the walkthrough capture and starts AI analysis while you stay on the call.
          The rest of the call keeps recording and is added to the video afterward.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setProcessState('idle')}
            className="px-4 py-2 rounded-lg text-gray-700 hover:bg-gray-100 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={startInventoryProcessing}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
          >
            Process now
          </button>
        </div>
      </div>
    </div>
  );

  // Recording is now automatic - starts when both join, stops when either leaves
  // No manual recording control needed

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  ).filter((t) => !t.participant?.identity?.startsWith('EG_'));

  // Featured customer feed for the header/FAB snap button — prefer a screen
  // share over a camera; each tile also has its own per-feed snap button.
  const featuredCustomerTrack = useMemo(() => {
    const remote = tracks.filter(
      (t) =>
        t.participant &&
        !t.participant.isLocal &&
        !isAgent(t.participant.name || t.participant.identity || '') &&
        t.publication?.track?.mediaStreamTrack
    );
    return (
      remote.find((t) => t.source === Track.Source.ScreenShare) ||
      remote.find((t) => t.source === Track.Source.Camera) ||
      null
    );
  }, [tracks]);

  // The agent's own camera — shown as a small self-view PiP on the desktop
  // stage, so the customer's feed can be the large centered feature.
  const localAgentTrack = useMemo(
    () =>
      tracks.find(
        (t) => t.participant?.isLocal && t.source === Track.Source.Camera && t.publication?.track
      ) || null,
    [tracks]
  );

  useEffect(() => {
    const checkScreenSize = () => {
      const smallScreen = window.innerWidth < 768;
      setIsSmallScreen(smallScreen);
      if (!smallScreen && !showInventory) setShowInventory(true);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, [showInventory]);

  // Controls are always visible - no auto-hide behavior

  // handleItemsDetected removed - items now saved directly to database via Railway

  const startInventory = () => {
    setIsInventoryActive(true);
    setCaptureMode('auto');
    toast.success('🚀 AI Inventory scanning activated!');
  };

  const pauseInventory = () => {
    setCaptureMode('paused');
    toast.info('⏸️ Scanning paused');
  };

  const resumeInventory = () => {
    setCaptureMode('auto');
    toast.success('▶️ Scanning resumed');
  };

  const stopInventory = () => {
    setIsInventoryActive(false);
    setCaptureMode('paused');
    toast.info('⏹️ Inventory session completed');
  };

  const toggleSidebar = () => {
    setShowInventory(!showInventory);
  };
  
  // Centralized inventory update function - matches InventoryManager pattern
  const handleInventoryUpdate = useCallback(async (inventoryItemId, newGoingQuantity) => {
    // Update local state immediately for responsive UI
    setInventoryItems(prev => prev.map(item => {
      if (item._id === inventoryItemId) {
        const quantity = item.quantity || 1;
        const going = newGoingQuantity === 0 ? 'not going' : 
                      newGoingQuantity === quantity ? 'going' : 'partial';
        return { ...item, goingQuantity: newGoingQuantity, going };
      }
      return item;
    }));

    // Persist to server
    try {
      const response = await fetch(`/api/projects/${projectId}/inventory/${inventoryItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goingQuantity: newGoingQuantity }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update inventory item');
      }
      
      console.log(`📦 Video call inventory item updated: ${inventoryItemId} -> goingQuantity: ${newGoingQuantity}`);
    } catch (error) {
      console.error('Error persisting inventory update:', error);
    }
  }, [projectId]);

  const hasCustomer = remoteParticipants.some(p => !isAgent(p.identity));

  // Small screen view - full screen with overlays
  if (isSmallScreen) {
    return (
      <div className="h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 relative overflow-hidden">
        <MediaRecoveryBanner visible={mediaNeedsRecovery} label={mediaFailedLabel} onRecover={recoverMedia} />
        <CaptureFailureBanner failure={captureFailure} onRetry={retryCapture} onDismiss={dismissCaptureFailure} />
        <LowBandwidthChip visible={remotePaused} />
        {/* Video area - Full screen */}
        <div className="absolute inset-0 z-10">
          <GridLayout
            key={gridMembershipKey(tracks)}
            tracks={tracks}
            style={{ height: '100%', width: '100%' }}
          >
            <SnapableTile
              tileStyle={{ borderRadius: '0px', overflow: 'hidden' }}
              onSnap={snapFromTrackRef}
              flashSid={flashSid}
              isSmallScreen={true}
            />
          </GridLayout>
        </div>

        {/* Top overlay - Status and info */}
        {showControls && (
          <div className={`absolute top-safe-or-4 left-4 right-4 z-20 transition-all duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
            {/* Connection Status & Active Session */}
            <div className="flex items-center justify-between mb-3">
              <div className={`px-4 py-2 rounded-2xl ${glassStyle} flex items-center gap-3`}>
                <div className={`w-3 h-3 rounded-full ${hasCustomer ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'} shadow-lg`}></div>
                <span className="text-white text-sm font-bold">
                  {hasCustomer ? 'CUSTOMER CONNECTED' : 'WAITING...'}
                </span>
              </div>
              
              {isInventoryActive && (
                <div className={`px-4 py-2 rounded-2xl ${glassStyle} flex items-center gap-2 bg-blue-500/20 border-blue-400/50`}>
                  <Activity className="w-4 h-4 text-white" />
                  <span className="text-white text-sm font-bold">
                    MANUAL MODE
                  </span>
                </div>
              )}

              {renderProcessStatusChip(true)}
            </div>

          </div>
        )}

        {/* Floating Action Buttons - Right Side */}
        {showControls && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-3">

            {/* Snap photo of the customer's feed */}
            {featuredCustomerTrack && (
              <button
                onClick={() => snapFromTrackRef(featuredCustomerTrack)}
                title="Snap photo"
                className={`relative p-4 rounded-2xl ${glassStyle} bg-indigo-600/30 border-indigo-400/50 text-white shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95`}
              >
                <Camera size={24} />
              </button>
            )}

            {/* Ask the customer to flip their camera (sound + prompt on their phone) */}
            <button
              onClick={requestFlipCamera}
              disabled={flipRequestCooling}
              title="Ask customer to flip their camera"
              className={`relative p-4 rounded-2xl ${glassStyle} bg-purple-600/30 border-purple-400/50 text-white shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95 disabled:opacity-50 disabled:scale-100`}
            >
              <SwitchCamera size={24} />
            </button>

            {/* Mid-call Stop & Process trigger (one-shot) */}
            {processState === 'idle' && (
              <button
                onClick={() => setProcessState('confirming')}
                title="Process inventory now"
                className={`relative p-4 rounded-2xl ${glassStyle} bg-emerald-600/30 border-emerald-400/50 text-white shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95`}
              >
                <Sparkles size={24} />
              </button>
            )}

            {/* Notes Toggle */}
            <button
              onClick={toggleSidebar}
              className={`relative p-4 rounded-2xl ${glassStyle} bg-indigo-600/30 border-indigo-400/50 text-white shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95`}
            >
              {showInventory ? <EyeOff size={24} /> : <MessageSquare size={24} />}
            </button>
          </div>
        )}

        {processConfirmDialog}

        {/* Custom Mobile Controls - Same as Customer View */}
        <div className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-300 ${showControls ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="bg-gradient-to-t from-black/80 to-transparent p-6 pb-safe-or-8">
            <div className="flex items-center justify-center gap-5">
              {/* Mic Toggle */}
              <button
                onClick={toggleMic}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
                  isMicEnabled
                    ? 'bg-white/20 backdrop-blur-lg border border-white/30'
                    : 'bg-red-500/80 backdrop-blur-lg border border-red-400/50'
                }`}
              >
                {isMicEnabled ? (
                  <Mic className="w-7 h-7 text-white" />
                ) : (
                  <MicOff className="w-7 h-7 text-white" />
                )}
              </button>

              {/* Camera Toggle */}
              <button
                onClick={toggleCamera}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
                  isCameraEnabled
                    ? 'bg-white/20 backdrop-blur-lg border border-white/30'
                    : 'bg-red-500/80 backdrop-blur-lg border border-red-400/50'
                }`}
              >
                {isCameraEnabled ? (
                  <Video className="w-7 h-7 text-white" />
                ) : (
                  <VideoOff className="w-7 h-7 text-white" />
                )}
              </button>

              {/* End Call - Larger and prominent with loading state */}
              <button
                onClick={leaveCall}
                disabled={isLeaving}
                className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 disabled:bg-red-400 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all duration-200 active:scale-95 disabled:scale-100"
              >
                {isLeaving ? (
                  <Loader2 className="w-9 h-9 text-white animate-spin" />
                ) : (
                  <PhoneOff className="w-9 h-9 text-white" />
                )}
              </button>

              {/* Camera Flip - only show if device supports it */}
              {canSwitchCameraCustomer && (
                <button
                  onClick={switchCamera}
                  disabled={isSwitching}
                  className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-lg border border-white/20 flex items-center justify-center transition-all duration-200 active:scale-95 disabled:opacity-50"
                >
                  {isSwitching ? (
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  ) : (
                    <SwitchCamera className="w-6 h-6 text-white" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Customer Not Connected Overlay */}
        {!hasCustomer && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-40">
            <div className={`p-8 rounded-3xl text-center max-w-md ${glassStyle}`}>
              <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Users size={40} className="text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">
                Waiting for Customer
              </h3>
              <p className="text-white/80 leading-relaxed">
                Share the video call link with your customer to begin the AI-powered inventory session.
              </p>
              <Button 
                onClick={() => window.location.href = `/projects/${projectId}`}
                className="mt-6 px-6 py-3 bg-white/20 hover:bg-white/30 text-white border border-white/30 rounded-2xl font-medium transition-all duration-300 flex items-center gap-2 mx-auto"
              >
                <Home size={18} />
                Return to Project
              </Button>
              <div className="mt-6 flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-white rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}

        {/* Frame Processor - COMMENTED OUT FOR RAILWAY INTEGRATION */}
        {/*
        {isInventoryActive && captureMode === 'auto' && (
          <FrameProcessor
            projectId={projectId}
            captureMode={captureMode}
            currentRoom={currentRoom}
            existingItems={detectedItems}
            onItemsDetected={handleItemsDetected}
            onProcessingChange={setIsProcessing}
            onCaptureCountChange={setCaptureCount}
          />
        )}
        */}

        {/* Inventory Sidebar */}
        {showInventory && (
          <div className="fixed inset-0 z-50">
            <div 
              className="absolute inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setShowInventory(false)}
            />
            
            <div className="absolute right-0 top-0 bottom-0 w-80 bg-white/95 backdrop-blur-xl z-50 transform transition-transform duration-300 ease-in-out shadow-2xl">
              <InventorySidebar
                items={inventoryItems}
                loading={inventoryLoading}
                projectId={projectId}
                onInventoryUpdate={handleInventoryUpdate}
                participantName={participantName}
                roomId={roomId}
                photosRefreshKey={photosRefreshKey}
                onRemoveItem={async (id) => {
                  // Remove from database via API
                  try {
                    const response = await fetch(`/api/projects/${projectId}/inventory/${id}`, {
                      method: 'DELETE'
                    });
                    if (response.ok) {
                      setInventoryItems(prev => prev.filter(item => item._id !== id));
                      toast.success('Item removed');
                    }
                  } catch (error) {
                    toast.error('Failed to remove item');
                  }
                }}
                onSaveItems={() => {
                  // Items are automatically saved via Railway system
                  toast.info('Items saved automatically');
                }}
                onClose={() => setShowInventory(false)}
              />
            </div>
          </div>
        )}

        <RoomAudioRenderer />
        {/* Autoplay unlock — see CustomerView note. */}
        <div className="absolute bottom-40 left-1/2 -translate-x-1/2 z-40">
          <StartAudio
            label="Tap to enable sound"
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold shadow-2xl transition-all duration-200 active:scale-95"
          />
        </div>
      </div>
    );
  }

  // Desktop view - Compact layout with controls
  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden relative">
      <MediaRecoveryBanner visible={mediaNeedsRecovery} label={mediaFailedLabel} onRecover={recoverMedia} />
      <CaptureFailureBanner failure={captureFailure} onRetry={retryCapture} onDismiss={dismissCaptureFailure} />
      <LowBandwidthChip visible={remotePaused} />
      {/* Recording Indicator - Hidden
      <RecordingIndicator 
        recordingStatus={recordingStatus.recordingStatus}
        formattedDuration={recordingStatus.formattedDuration}
        className="fixed top-4 right-4"
      /> */}
      {/* Compact Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            {isInventoryActive && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <Activity className="w-3 h-3" />
                <span>Active - {captureCount} captures, {inventoryItems.length} items</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* Snap a photo of the customer's feed into the Media Vault */}
            <button
              onClick={() => featuredCustomerTrack && snapFromTrackRef(featuredCustomerTrack)}
              disabled={!featuredCustomerTrack}
              title="Snap a photo of the customer's video — saved to the Media Vault"
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Camera size={16} />
              Snap photo
            </button>
            {/* Ask the customer to flip their camera (sound + prompt on their phone) */}
            <button
              onClick={requestFlipCamera}
              disabled={flipRequestCooling}
              title="Ask the customer to flip their camera — plays a sound and shows a prompt on their phone"
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              <SwitchCamera size={16} />
              Flip their camera
            </button>
            {/* Mid-call Stop & Process (one-shot) */}
            {processState === 'idle' && (
              <button
                onClick={() => setProcessState('confirming')}
                title="Stop the walkthrough and analyze inventory now — the call keeps recording"
                className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Sparkles size={16} />
                Process inventory
              </button>
            )}
            {renderProcessStatusChip(false)}

            {/* Room selector */}
            {isInventoryActive && (
              <RoomSelector
                currentRoom={currentRoom}
                onChange={setCurrentRoom}
                isSmallScreen={false}
              />
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 h-full flex flex-row min-h-0 overflow-hidden">
        {/* Video Area with integrated controls */}
        <div className="flex-1 h-full flex flex-col bg-gray-900">
          {/* Video stage: the CUSTOMER is the large, centered feature (that's
              what a survey is about); the agent's own camera is a small PiP.
              The customer video sizes to its NATURAL aspect ratio bounded by
              the stage — so it fills the available space, stays centered,
              scales with the agent's window, and shows the ENTIRE frame in any
              orientation (portrait → tall, landscape → wide; no cropping,
              nothing lost when the customer rotates their phone). */}
          <div className="flex-1 flex items-center justify-center p-4 lg:p-6 min-h-0">
            <div className="relative w-full h-full flex items-center justify-center">
              {featuredCustomerTrack?.publication?.track ? (
                <VideoTrack
                  trackRef={featuredCustomerTrack}
                  className="qs-customer-stage"
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-gray-400 text-center">
                  <Users className="w-14 h-14 mb-3 opacity-40" />
                  <p className="text-sm font-medium">Waiting for your customer&apos;s video…</p>
                </div>
              )}

              {/* Agent self-view — small PiP, bottom-right. The box is always
                  rendered the moment the agent is in the call, so they can see
                  where they'll appear instead of wondering "where am I?". It
                  shows a spinner while the local camera is still coming up (the
                  first few seconds after joining), their live video once it's
                  publishing, or a camera-off state if they've turned it off. */}
              <div
                className="absolute bottom-3 right-3 w-36 xl:w-48 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl bg-black z-10 flex items-center justify-center"
                style={{ aspectRatio: '16 / 9' }}
              >
                {localAgentTrack?.publication?.track ? (
                  <VideoTrack
                    trackRef={localAgentTrack}
                    className="w-full h-full"
                    style={{ objectFit: 'cover' }}
                  />
                ) : isCameraEnabled ? (
                  <div className="flex flex-col items-center justify-center gap-1.5 text-white/70">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-[11px] font-medium">Starting camera…</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-1.5 text-white/50">
                    <VideoOff className="w-5 h-5" />
                    <span className="text-[11px] font-medium">Camera off</span>
                  </div>
                )}
              </div>

              {/* Snap flash — brief white blink over the stage so the agent sees
                  the photo was taken (fires for 300ms whenever snapFromTrackRef
                  sets flashSid). */}
              {flashSid && (
                <div className="absolute inset-0 z-30 bg-white pointer-events-none animate-snapflash" />
              )}
            </div>
          </div>
          
          {/* Video Controls Bar - Right under video frames (no top border: the
              gray-800 bar already separates it from the gray-900 stage, and a
              rule read as an extra/redundant line). */}
          <div className="bg-gray-800 p-2 flex-shrink-0">
            <div className="flex justify-center items-center gap-4">
              {/* Recording is now automatic - starts when both join, stops when either leaves */}
              <ControlBar />
            </div>
          </div>
        </div>
        
        {/* Desktop Sidebar - Always visible */}
        {showInventory && (
          <div className="w-96 h-full flex-shrink-0 border-l border-gray-200 bg-white">
            <InventorySidebar
              items={inventoryItems}
              loading={inventoryLoading}
              projectId={projectId}
              onInventoryUpdate={handleInventoryUpdate}
              participantName={participantName}
              roomId={roomId}
              photosRefreshKey={photosRefreshKey}
              onRemoveItem={async (id) => {
                // Remove from database via API
                try {
                  const response = await fetch(`/api/projects/${projectId}/inventory/${id}`, {
                    method: 'DELETE'
                  });
                  if (response.ok) {
                    setInventoryItems(prev => prev.filter(item => item._id !== id));
                    toast.success('Item removed');
                  }
                } catch (error) {
                  toast.error('Failed to remove item');
                }
              }}
              onSaveItems={() => {
                // Items are automatically saved via Railway system
                toast.info('Items saved automatically');
              }}
              onClose={() => {}} // No close on desktop - always visible
            />
          </div>
        )}
      </div>

        {/* Enhanced Frame Processor - COMMENTED OUT FOR RAILWAY INTEGRATION */}
        {/*
        {isInventoryActive && captureMode === 'auto' && (
          <FrameProcessor
            projectId={projectId}
            captureMode={captureMode}
            currentRoom={currentRoom}
            existingItems={detectedItems}
            onItemsDetected={handleItemsDetected}
            onProcessingChange={setIsProcessing}
            onCaptureCountChange={setCaptureCount}
          />
        )}
        */}

        {/* Enhanced Inventory Sidebar */}
      {processConfirmDialog}
      <RoomAudioRenderer />
      {/* Autoplay unlock — see CustomerView note. */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-40">
        <StartAudio
          label="Click to enable sound"
          className="flex items-center gap-2 px-5 py-3 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold shadow-2xl transition-all duration-200 active:scale-95"
        />
      </div>
    </div>
  );
});

// Enhanced InventorySidebar component - Updated for real database items
const InventorySidebar = ({
  items,
  loading,
  onRemoveItem,
  onSaveItems,
  onClose,
  projectId,
  onInventoryUpdate,
  participantName,
  roomId,
  photosRefreshKey = 0,
}) => {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [activeTab, setActiveTab] = useState('notes');
  

  useEffect(() => {
    const checkScreenSize = () => setIsSmallScreen(window.innerWidth < 768);
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  const groupedItems = useMemo(() => {
    const groups = {};
    items.forEach(item => {
      if (!groups[item.location]) groups[item.location] = [];
      groups[item.location].push(item);
    });
    return groups;
  }, [items]);

  const totals = useMemo(() => {
    return items.reduce(
      (acc, item) => ({
        items: acc.items + (item.quantity || 1),
        cuft: acc.cuft + ((item.cuft || 0) * (item.quantity || 1)),
        weight: acc.weight + ((item.weight || 0) * (item.quantity || 1)),
      }),
      { items: 0, cuft: 0, weight: 0 }
    );
  }, [items]);

  const getRoomIcon = (location) => {
    const icons = {
      'Living Room': '🛋️',
      'Bedroom': '🛏️',
      'Master Bedroom': '🏠',
      'Kitchen': '🍳',
      'Dining Room': '🍽️',
      'Office': '💼',
      'Garage': '🚗',
      'Basement': '🏚️',
      'Attic': '🏠',
      'Bathroom': '🚿',
      'Other': '📦'
    };
    return icons[location] || '📦';
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header — mobile only. On desktop this sidebar is a permanent column,
          so the qube-sheets logo and close (X) chrome are redundant; the
          Notes/Photos tabs sit at the top of the panel instead. On mobile the
          header keeps the back button (to collapse the drawer) and the logo. */}
      {isSmallScreen && (
        <div className="bg-white border-b border-gray-200">
          <div className="p-4 md:p-6 border-b border-blue-500/30">
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700"
              >
                <ChevronLeft size={24} />
              </button>
              <Logo />
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation - Responsive Design */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="flex">
          <button
            onClick={() => setActiveTab('notes')}
            className={`flex-1 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium transition-all duration-200 flex items-center justify-center gap-1 sm:gap-2 ${
              activeTab === 'notes'
                ? 'text-blue-600 bg-white border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Notes</span>
            <span className="sm:hidden">Notes</span>
          </button>
          <button
            onClick={() => setActiveTab('photos')}
            className={`flex-1 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium transition-all duration-200 flex items-center justify-center gap-1 sm:gap-2 ${
              activeTab === 'photos'
                ? 'text-blue-600 bg-white border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <Camera className="w-4 h-4" />
            <span>Photos</span>
          </button>
        </div>
      </div>

      {/* Inventory Items Section */}
      {/* {activeTab === 'inventory' && (
        items.length > 0 ? (
          <div className="bg-white border-b border-gray-200 p-4 md:p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Package size={20} />
              Inventory Items ({items.reduce((total, item) => total + (item.quantity || 1), 0)})
            </h3>
            <div className="space-y-3 max-h-48 overflow-y-auto">
              {items.map((item) => (
                <div key={item._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-sm text-gray-500 flex items-center gap-1">
                      {getRoomIcon(item.location)} {item.location}
                      {item.quantity > 1 && <span>• Qty: {item.quantity}</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1 ml-3">
                    {Array.from({ length: item.quantity || 1 }, (_, index) => (
                      <ToggleGoingBadge 
                        key={`${item._id}-${index}`}
                        inventoryItem={item}
                        quantityIndex={index}
                        projectId={projectId}
                        onInventoryUpdate={onInventoryUpdate}
                        showItemName={false}
                        className="text-xs"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="w-16 h-16 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl flex items-center justify-center mb-4">
              <Package size={32} className="text-gray-400" />
            </div>
            <h4 className="text-lg font-bold text-gray-900 mb-2">No Items Yet</h4>
            <p className="text-sm text-gray-600 text-center leading-relaxed max-w-sm">
              Inventory items will appear here as photos are analyzed during the video call.
            </p>
          </div>
        )
      )} */}

      {/* Notes Section - Video Call Specific UI */}
      <div className={`flex-1 min-h-0 overflow-y-auto bg-white ${activeTab === 'notes' ? '' : 'hidden'}`}>
        <VideoCallNotes
          projectId={projectId}
          roomId={roomId}
        />
      </div>

      {/* Call Photos Section - snapped during this call */}
      <div className={`flex-1 min-h-0 overflow-y-auto bg-white ${activeTab === 'photos' ? '' : 'hidden'}`}>
        <CallPhotosPanel
          projectId={projectId}
          roomId={roomId}
          refreshKey={photosRefreshKey}
        />
      </div>

    </div>
  );
};

// Main VideoCallInventory component
export default function VideoCallInventory({
  projectId,
  roomId,
  participantName,
  onCallEnd,
  isAgentUser = false, // Explicitly indicates if user is an agent (from pre-join)
  backgroundSettings = null, // { mode: 'none' | 'blur' | 'virtual', blurRadius?: number, imageUrl?: string }
  customerSettings = null, // { videoEnabled: boolean, audioEnabled: boolean, facingMode: 'user' | 'environment' }
  onCustomerCameraOn = () => {}, // Called when an audio-only customer enables their camera in-call (clears the stale audio-only flag so a rejoin remount keeps video on)
}) {
  // Determine if current user is agent - either by explicit prop or legacy name check
  const isCurrentUserAgent = isAgentUser || participantName.toLowerCase().includes('agent');
  // Stable identity so the memoized CustomerView doesn't re-render on every
  // root render; seeds the media-recovery intent model with join-time state.
  const customerMediaDefaults = useMemo(
    () => ({
      microphone: customerSettings?.audioEnabled ?? true,
      camera: customerSettings?.videoEnabled ?? true,
    }),
    [customerSettings?.audioEnabled, customerSettings?.videoEnabled]
  );
  const [token, setToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [isConnecting, setIsConnecting] = useState(true);
  // Removed detectedItems - now using real inventory data via Railway system
  const [currentRoom, setCurrentRoom] = useState('Living Room');

  // Ref to track last error toast for debouncing
  const lastErrorToast = useRef(null);

  // Refs for connection state tracking - to suppress transient errors
  const connectionSucceeded = useRef(false);
  const pendingErrors = useRef([]);

  // Helper to show error toast with debouncing (prevents duplicate toasts)
  const showErrorToast = (message) => {
    const now = Date.now();
    if (lastErrorToast.current && now - lastErrorToast.current.time < 3000 &&
        lastErrorToast.current.message === message) {
      return; // Skip duplicate toast within 3 seconds
    }
    lastErrorToast.current = { message, time: now };
    toast.error(message);
  };

  // Clean up pending error timeouts on unmount
  useEffect(() => {
    return () => {
      pendingErrors.current.forEach(clearTimeout);
    };
  }, []);

  // Fetch LiveKit token on mount. Each attempt is capped at 10s — a request
  // that hangs (e.g. dev server mid-compile, flaky mobile network) used to
  // leave this screen on the "Connecting…" loader forever because a
  // never-resolving fetch neither succeeds nor throws. Retries twice with
  // backoff; on final failure token stays empty → the Connection Failed
  // screen with its Retry button renders.
  useEffect(() => {
    let cancelled = false;

    const fetchToken = async () => {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await fetch('/api/livekit/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomName: roomId,
              participantName,
              isAgent: isAgentUser,  // Pass explicit agent status for correct identity
            }),
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
              ? AbortSignal.timeout(10000)
              : undefined,
          });

          if (!response.ok) {
            throw new Error('Failed to get token');
          }

          const data = await response.json();
          if (cancelled) return;
          setToken(data.token);
          setServerUrl(data.url);
          setIsConnecting(false);
          return;
        } catch (error) {
          if (cancelled) return;
          console.warn(`Token fetch attempt ${attempt}/${maxAttempts} failed:`, error);
          if (attempt === maxAttempts) {
            reportClientError({
              message: `LiveKit token fetch failed after ${maxAttempts} attempts (room=${roomId}, agent=${isAgentUser}): ${error?.message || error}`,
              source: 'video-call:token-fetch',
            });
            toast.error('Failed to connect to video call');
            setIsConnecting(false);
            return;
          }
          await new Promise((r) => setTimeout(r, attempt * 1000));
          if (cancelled) return;
        }
      }
    };

    fetchToken();
    return () => { cancelled = true; };
  }, [roomId, participantName, isAgentUser]);

  // Save items to inventory
  // Items are now saved automatically via Railway system - no manual save needed

  // ---- Rejoin-in-place on unexpected disconnect ----
  // A dropped connection used to fire onDisconnected → navigate away (agent to
  // the project page, customer to /call-complete). The agent would then start
  // a brand-new room, orphaning the link the customer was texted. Instead:
  // stay on this page, remount LiveKitRoom (same token — TTL is 4h) with
  // backoff, and only give up into a manual Rejoin screen.
  const MAX_AUTO_REJOINS = 3;
  const [reconnectPhase, setReconnectPhase] = useState(null); // null | 'reconnecting' | 'failed'
  const reconnectPhaseRef = useRef(null);
  reconnectPhaseRef.current = reconnectPhase;
  const [roomMountKey, setRoomMountKey] = useState(0);
  const rejoinAttemptsRef = useRef(0);
  const intentionalLeaveRef = useRef(false);
  const rejoinTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(rejoinTimerRef.current), []);

  const scheduleRejoin = useCallback(() => {
    rejoinAttemptsRef.current += 1;
    if (rejoinAttemptsRef.current > MAX_AUTO_REJOINS) {
      setReconnectPhase('failed');
      return;
    }
    setReconnectPhase('reconnecting');
    const delay = Math.min(1000 * 2 ** (rejoinAttemptsRef.current - 1), 5000);
    clearTimeout(rejoinTimerRef.current);
    rejoinTimerRef.current = setTimeout(() => {
      setRoomMountKey((k) => k + 1);
    }, delay);
  }, []);

  const handleManualRejoin = useCallback(() => {
    rejoinAttemptsRef.current = 0;
    setReconnectPhase('reconnecting');
    setRoomMountKey((k) => k + 1);
  }, []);

  // Views call this for user-initiated Leave/End so the disconnect that
  // follows isn't mistaken for a network drop.
  const handleIntentionalCallEnd = useCallback(() => {
    intentionalLeaveRef.current = true;
    if (onCallEnd) {
      onCallEnd();
    }
  }, [onCallEnd]);

  const handleDisconnect = useCallback(
    (reason) => {
      // Reasons that genuinely end the call: our own leave, the agent deleting
      // the room (End Call for everyone), the room closing after everyone left,
      // being removed, or this identity joining from another tab.
      const callOver =
        intentionalLeaveRef.current ||
        reason === DisconnectReason.CLIENT_INITIATED ||
        reason === DisconnectReason.ROOM_DELETED ||
        reason === DisconnectReason.ROOM_CLOSED ||
        reason === DisconnectReason.PARTICIPANT_REMOVED ||
        reason === DisconnectReason.DUPLICATE_IDENTITY;

      if (callOver) {
        if (onCallEnd) {
          onCallEnd();
        }
        return;
      }

      // Network drop / signal close / server hiccup — rejoin in place.
      console.warn(`LiveKit disconnected unexpectedly (reason=${reason}) — attempting rejoin`);
      reportClientError({
        message: `LiveKit unexpected disconnect (reason=${reason}, room=${roomId}, agent=${isCurrentUserAgent}, rejoinAttempt=${rejoinAttemptsRef.current + 1})`,
        source: 'video-call:unexpected-disconnect',
      });
      scheduleRejoin();
    },
    [onCallEnd, scheduleRejoin, roomId, isCurrentUserAgent]
  );

  // Get device info for Android/compatibility optimizations
  const deviceInfo = useMemo(() => getDeviceInfo(), []);

  // Enhanced LiveKit room options with mobile camera optimization, Android compatibility, and better permissions
  // Pre-build the background processor BEFORE connecting so the camera track
  // is created with it already attached (videoCaptureDefaults.processor) — no
  // raw frame of the agent's real background is ever published. State:
  // undefined = still building (hold the room mount), null = no processing
  // needed or unavailable, object = ready.
  const [pendingProcessor, setPendingProcessor] = useState(() =>
    buildBackgroundConfig(backgroundSettings) ? undefined : null
  );

  useEffect(() => {
    const config = buildBackgroundConfig(backgroundSettings);
    if (!config) {
      setPendingProcessor(null);
      return;
    }
    let cancelled = false;
    let timedOut = false;
    // Never block joining the call on background init — after 3s join anyway
    // and let the post-publish BackgroundApplier fallback attach the effect.
    const timeout = setTimeout(() => {
      timedOut = true;
      console.warn('Background processor pre-build timed out — joining without it');
      setPendingProcessor(null);
    }, 3000);
    (async () => {
      try {
        const { BackgroundProcessor, supportsBackgroundProcessors } = await import('@livekit/track-processors');
        if (cancelled || timedOut) return;
        if (!supportsBackgroundProcessors || !supportsBackgroundProcessors()) {
          console.log('Background processors not supported — joining without background');
          setPendingProcessor(null);
          return;
        }
        setPendingProcessor(BackgroundProcessor(config));
      } catch (err) {
        console.error('Failed to pre-build background processor:', err);
        if (!cancelled && !timedOut) setPendingProcessor(null);
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [backgroundSettings]);

  // Watchdog independent of the processor-build effect: the mount gate below
  // may never be held longer than this, no matter what happens inside the
  // build effect. Joining without the background beats never joining.
  const [processorGateExpired, setProcessorGateExpired] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setProcessorGateExpired(true), 4000);
    return () => clearTimeout(t);
  }, []);

  const roomOptions = useMemo(() => {
    const isSmallScreen = typeof window !== 'undefined' && window.innerWidth <= 768;
    const optimizedOptions = getOptimizedRoomOptions(deviceInfo);
    const codec = getRecommendedCodec(deviceInfo);
    const constraints = getVideoConstraintLevels(deviceInfo);
    const recommended = constraints[0];

    // Log device-specific configuration
    if (deviceInfo.isAndroid) {
      console.log('[VideoCallInventory] Android device configuration:', {
        version: deviceInfo.androidVersion,
        isLegacy: deviceInfo.isLegacyAndroid,
        codec,
        resolution: `${recommended.width}x${recommended.height}`,
        simulcast: !deviceInfo.isLegacyAndroid,
      });
    }

    // Determine facing mode
    let facingMode = 'user'; // Default to front camera
    if (customerSettings?.facingMode) {
      facingMode = customerSettings.facingMode;
    } else if (!isSmallScreen && isCurrentUserAgent) {
      facingMode = 'environment'; // Desktop agents use back camera
    }

    return {
      publishDefaults: {
        videoCodec: codec, // Dynamic: VP8 for legacy Android, H.264 for modern
        // Multi-codec safety net (flag-gated, default off): publish a VP8
        // backup alongside the primary codec so a subscriber that can't
        // decode the forced H.264 still gets video instead of a black tile.
        // Covers subscriber-decode mismatch only — NOT a broken publisher
        // encoder. Flip NEXT_PUBLIC_LIVEKIT_BACKUP_CODEC=1 to enable.
        ...(process.env.NEXT_PUBLIC_LIVEKIT_BACKUP_CODEC === '1' && codec !== 'vp8'
          ? { backupCodec: { codec: 'vp8' } }
          : {}),
        videoSimulcast: !deviceInfo.isLegacyAndroid, // Disable simulcast on legacy Android
        videoEncoding: {
          maxBitrate: deviceInfo.isLegacyAndroid ? 800_000 : 1_500_000,
          maxFramerate: deviceInfo.isLegacyAndroid ? 20 : 30,
        },
        videoSimulcastLayers: deviceInfo.isLegacyAndroid
          ? [
              // Single low layer for legacy Android
              { width: 320, height: 180, encoding: { maxBitrate: 100_000, maxFramerate: 12 } },
            ]
          : [
              { width: 640, height: 360, encoding: { maxBitrate: 500_000, maxFramerate: 20 } },
              { width: 320, height: 180, encoding: { maxBitrate: 150_000, maxFramerate: 15 } },
            ],
        // Audio settings optimized for Android
        audioPreset: deviceInfo.isAndroid ? 'speech' : 'music',
        dtx: true, // Discontinuous transmission - saves bandwidth when not speaking
        red: !deviceInfo.isLegacyAndroid, // Redundant encoding for packet loss resilience
      },
      adaptiveStream: true,
      dynacast: true,
      autoSubscribe: true,
      disconnectOnPageLeave: true,
      // Bounded: give up after ~8 attempts (~60s) so a wedged connection
      // surfaces as a Disconnected event (→ our rejoin-in-place flow) instead
      // of spinning "Reconnecting…" forever. Returning null stops retrying.
      reconnectPolicy: {
        nextRetryDelayInMs: (context) => {
          const attempt = context.retryCount || 0;
          if (attempt >= 8) return null;
          return Math.min(attempt * 2000, 10000);
        }
      },
      videoCaptureDefaults: {
        facingMode,
        resolution: isSmallScreen
          ? { width: recommended.width || 640, height: recommended.height || 480 }
          : { width: 1280, height: 720 },
        frameRate: isSmallScreen ? (recommended.frameRate || 24) : 30,
        // Attach the pre-built background processor at track creation so the
        // first published frame is already blurred/replaced.
        ...(pendingProcessor ? { processor: pendingProcessor } : {}),
      },
      // Audio capture defaults optimized for Android
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: !deviceInfo.isLegacyAndroid, // Disable on legacy Android
        autoGainControl: true,
        // Force mono for Android to avoid stereo issues
        channelCount: deviceInfo.isAndroid ? 1 : undefined,
      },
      // Improve permissions handling
      e2eeOptions: undefined, // Disable E2EE for better compatibility
      expWebAudioMix: false, // Disable experimental features that might cause issues
    };
  }, [deviceInfo, customerSettings, isCurrentUserAgent, pendingProcessor]);
  
  // Note: We removed the pre-request camera permissions useEffect because:
  // 1. LiveKit handles permission requests internally when connecting
  // 2. The duplicate request was causing confusing error toast sequences
  // 3. Permissions are already requested in the AgentPreJoin screen if using it

  // Hold the room mount while the background processor pre-builds (typically
  // <300ms — assets are browser-cached from pre-join; hard 3s cap above, plus
  // the independent 4s watchdog) so the camera track is born processed.
  if (isConnecting || (pendingProcessor === undefined && !processorGateExpired)) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="text-center bg-white/80 backdrop-blur-xl p-12 rounded-3xl shadow-2xl border border-white/20">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Loader2 className="w-10 h-10 animate-spin text-white" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-3 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Connecting to AI Video Call
          </h3>
          <p className="text-gray-600 leading-relaxed">
            Initializing your intelligent inventory session...
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50">
        <div className="bg-white/80 backdrop-blur-xl p-12 rounded-3xl shadow-2xl text-center max-w-md border border-white/20">
          <div className="w-20 h-20 bg-gradient-to-br from-red-500 to-pink-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-3 bg-gradient-to-r from-red-600 to-pink-600 bg-clip-text text-transparent">
            Connection Failed
          </h3>
          <p className="text-gray-600 mb-6 leading-relaxed">
            Unable to establish connection to the video call. Please check your network and try again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-2xl hover:from-blue-600 hover:to-indigo-700 font-bold transition-all duration-300 transform hover:scale-105 shadow-lg flex items-center gap-3 mx-auto"
          >
            <RotateCcw className="w-5 h-5" />
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // Auto-rejoin exhausted — manual choice, but never silently navigate away.
  if (reconnectPhase === 'failed') {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-2xl text-center max-w-md">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h3 className="text-2xl font-bold text-white mb-2">Connection lost</h3>
          <p className="text-white/70 mb-6">
            We couldn&apos;t reconnect you automatically. Check your internet connection and
            rejoin — the call is still open.
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleManualRejoin}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-5 h-5" />
              Rejoin call
            </button>
            <button
              onClick={handleIntentionalCallEnd}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold transition-colors"
            >
              Leave call
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      {/* Reconnect overlay: shown while we remount the room after an
          unexpected disconnect. Sits above the (re)connecting call UI. */}
      {reconnectPhase === 'reconnecting' && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-sm">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-white" />
            <h3 className="text-xl font-bold text-white mb-1">Connection lost</h3>
            <p className="text-white/70">Rejoining the call…</p>
          </div>
        </div>
      )}

      {/* Custom CSS for better desktop video layout */}
      <style jsx>{`
        @media (min-width: 768px) {
          :global(.lk-grid-layout > div) {
            min-height: 300px !important;
            height: 50vh !important;
            max-width: 500px !important;
            border-radius: 16px !important;
            overflow: hidden !important;
            margin: 1rem !important;
          }
          :global(.lk-grid-layout video) {
            object-fit: cover !important;
            width: 100% !important;
            height: 100% !important;
          }
          /* The customer is on a phone (portrait). Show their ENTIRE frame,
             never cropped, so the moving consultant sees the whole room
             instead of a cropped center strip. Only the remote (customer)
             tile — the agent's own landscape webcam still fills its tile. */
          :global(.lk-grid-layout .lk-participant-tile[data-lk-local-participant="false"] video) {
            object-fit: contain !important;
            background: #0b0910 !important;
          }
          /* Shape the customer's cell portrait so a phone video fills it with
             minimal letterboxing (the whole frame still shows via contain
             above — if they rotate to landscape it simply letterboxes top/
             bottom instead). Keeps the agent's own cell landscape. */
          :global(.lk-grid-layout > div:has(.lk-participant-tile[data-lk-local-participant="false"])) {
            aspect-ratio: 9 / 16 !important;
            height: min(78vh, 680px) !important;
            max-height: 82vh !important;
            max-width: none !important;
            width: auto !important;
          }
        }
        /* Desktop agent stage: the customer video fills the stage (scaling UP,
           not just down) while object-fit:contain preserves its aspect ratio
           and shows the ENTIRE frame — big, centered, scales with the agent's
           window, and never cropped in any orientation (portrait tall /
           landscape wide, so nothing is lost when the customer rotates their
           phone). !important beats VideoTrack's internal styling. */
        :global(.qs-customer-stage) {
          width: 100% !important;
          height: 100% !important;
          object-fit: contain !important;
          border-radius: 16px !important;
          background: #000 !important;
        }
        /* No divider line above the agent's control bar — the gray-800 bar
           already separates it from the stage; LiveKit's ControlBar ships its
           own top border which read as an extra/redundant line. */
        :global(.lk-control-bar) {
          border-top: none !important;
        }
      `}</style>
      
      <LiveKitRoom
        key={roomMountKey}
        video={customerSettings?.videoEnabled ?? true}
        audio={customerSettings?.audioEnabled ?? true}
        token={token}
        serverUrl={serverUrl}
        onDisconnected={handleDisconnect}
        data-lk-theme="default"
        className="h-full"
        options={roomOptions}
        connect={true}
        onError={(error) => {
          const errorMsg = error.message || String(error);

          // Transient device-acquisition interruption (iOS aborts camera/mic
          // acquisition during the join handoff or a phone call). The media
          // recovery watchdog restores the track — don't surface an error.
          if (error?.name === 'AbortError' ||
              errorMsg.toLowerCase().includes('operation was aborted')) {
            console.warn('LiveKit room error (transient, recovery will handle):', errorMsg);
            return;
          }

          // A rejoin attempt whose connect fails outright emits onError but no
          // onDisconnected — keep the rejoin state machine moving so the
          // overlay can't hang forever.
          if (reconnectPhaseRef.current === 'reconnecting') {
            console.warn('Rejoin attempt failed to connect:', errorMsg);
            scheduleRejoin();
            return;
          }

          console.error('LiveKit room error:', errorMsg);
          reportClientError({
            message: `LiveKit room error (room=${roomId}, agent=${isCurrentUserAgent}): ${errorMsg}`,
            stack: error?.stack,
            source: 'video-call:livekit-error',
          });

          // Skip permission errors - handled by onMediaDeviceFailure
          if (errorMsg.toLowerCase().includes('permission') ||
              errorMsg.toLowerCase().includes('notallowed') ||
              errorMsg.toLowerCase().includes('not allowed')) {
            return;
          }

          // Queue non-permission errors - only show if connection doesn't succeed
          const errorTimeout = setTimeout(() => {
            if (connectionSucceeded.current) return;

            if (errorMsg.includes('camera')) {
              showErrorToast('Camera access denied.');
            } else if (errorMsg.includes('microphone')) {
              showErrorToast('Microphone access denied.');
            } else {
              showErrorToast('Connection failed. Please check your internet connection.');
            }
          }, 5000);

          pendingErrors.current.push(errorTimeout);
        }}
        onConnected={() => {
          console.log('✅ Successfully connected to LiveKit room');
          connectionSucceeded.current = true;
          // A successful (re)connect resets the rejoin state machine.
          rejoinAttemptsRef.current = 0;
          setReconnectPhase(null);
          // Clear any pending error timeouts
          pendingErrors.current.forEach(clearTimeout);
          pendingErrors.current = [];
        }}
        onMediaDeviceFailure={(failure) => {
          console.error('Media device failure:', failure);

          // Always report — historically these were invisible whenever the
          // room connect succeeded, which is exactly the "joined but no
          // camera/mic" case. The in-call banner (useCallHealth) handles the
          // user-facing side post-connect; this is the telemetry side.
          reportClientError({
            message: `Media device failure (room=${roomId}, agent=${isCurrentUserAgent}): ${typeof failure === 'string' ? failure : (failure?.message || failure?.kind || JSON.stringify(failure))}`,
            source: 'video-call:media-device-failure',
          });

          // Queue error - only show if connection doesn't succeed in 5 seconds
          const errorTimeout = setTimeout(() => {
            if (connectionSucceeded.current) return;

            const failureStr = typeof failure === 'string' ? failure : (failure?.message || failure?.kind || '');
            if (failureStr.toLowerCase().includes('permission')) {
              showErrorToast('Camera/microphone permission denied. Please enable permissions.');
            } else {
              const deviceType = failure?.kind || 'Media';
              showErrorToast(`${deviceType} device failed. Please check your permissions.`);
            }
          }, 5000);

          pendingErrors.current.push(errorTimeout);
        }}
      >
        {/* Apply background effects if settings provided */}
        {backgroundSettings && <BackgroundApplier backgroundSettings={backgroundSettings} />}

        {/* Render different views based on participant type. Views get the
            intentional-leave wrapper so user-initiated Leave/End is never
            mistaken for a network drop by the rejoin logic. */}
        {isCurrentUserAgent ? (
          <AgentView
            projectId={projectId}
            currentRoom={currentRoom}
            setCurrentRoom={setCurrentRoom}
            participantName={participantName}
            roomId={roomId}
            onCallEnd={handleIntentionalCallEnd}
          />
        ) : (
          <CustomerView
            onCallEnd={handleIntentionalCallEnd}
            roomId={roomId}
            onRetryConnection={handleManualRejoin}
            mediaDefaults={customerMediaDefaults}
            onCameraOn={onCustomerCameraOn}
          />
        )}
      </LiveKitRoom>
    </div>
  );
}