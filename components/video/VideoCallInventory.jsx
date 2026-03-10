
// components/video/VideoCallInventory.jsx - Ultra Modern & Sleek UI with Mobile-First Agent View
'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  ControlBar,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  useRemoteParticipants,
  useConnectionState,
  useRoomContext,
  VideoTrack,
  AudioTrack,
  TrackRefContext,
  useTrackRefContext,
  ParticipantContext,
  useParticipantContext,
  FocusLayout,
  CarouselLayout,
} from '@livekit/components-react';
import { Track, LocalVideoTrack, RemoteVideoTrack, createLocalVideoTrack, ConnectionState, facingModeFromLocalTrack } from 'livekit-client';
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
} from 'lucide-react';
import { toast } from 'sonner';
import FrameProcessor from './FrameProcessor';
import TranscriptDisplay from './TranscriptDisplay';
import Logo from '../../public/logo';
import { Button } from '../ui/button';
// Client-side recording removed - using LiveKit Egress (server-side) recording
import { ToggleGoingBadge } from '../ui/ToggleGoingBadge';
import VideoCallNotes from '../VideoCallNotes';
import { getDeviceInfo, getRecommendedCodec, getVideoConstraintLevels, getOptimizedRoomOptions } from '@/lib/webrtc-compatibility';

// Modern glassmorphism utility class
const glassStyle = "backdrop-blur-xl bg-white/10 border border-white/20 shadow-2xl";
const darkGlassStyle = "backdrop-blur-xl bg-black/20 border border-white/10 shadow-2xl";

// Helper function to flip an image horizontally
// This is used for virtual backgrounds so text appears correct in the agent's mirrored selfie view
async function flipImageHorizontally(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      // Flip horizontally
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);

      // Convert to blob URL for better performance
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          // Fallback to data URL
          resolve(canvas.toDataURL('image/png'));
        }
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
}

// Component to apply background effects to local video track
const BackgroundApplier = React.memo(({ backgroundSettings }) => {
  const { localParticipant } = useLocalParticipant();
  const processorRef = useRef(null);
  const [isApplied, setIsApplied] = useState(false);

  useEffect(() => {
    if (!backgroundSettings || backgroundSettings.mode === 'none') return;
    if (!localParticipant) return;

    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 30; // 30 attempts × 100ms = 3 seconds max
    let flippedImageUrl = null;

    const applyBackground = async () => {
      try {
        const { BackgroundProcessor, supportsBackgroundProcessors } = await import('@livekit/track-processors');

        if (!supportsBackgroundProcessors || !supportsBackgroundProcessors()) {
          console.log('Background processors not supported');
          return;
        }

        // Pre-flip the virtual background image so text reads correctly in mirrored view
        if (backgroundSettings.mode === 'virtual' && backgroundSettings.imageUrl) {
          try {
            console.log('Flipping background image for mirrored view...');
            flippedImageUrl = await flipImageHorizontally(backgroundSettings.imageUrl);
            console.log('Background image flipped successfully');
          } catch (err) {
            console.warn('Could not flip image, using original:', err);
            flippedImageUrl = backgroundSettings.imageUrl;
          }
        }

        // Poll for video track with small intervals
        const checkAndApply = async () => {
          if (cancelled) return;

          const videoTrack = localParticipant.getTrackPublication(Track.Source.Camera)?.track;

          if (videoTrack && videoTrack instanceof LocalVideoTrack) {
            // Track is ready - apply processor
            let processorConfig;
            if (backgroundSettings.mode === 'blur') {
              processorConfig = {
                mode: 'background-blur',
                blurRadius: backgroundSettings.blurRadius || 10
              };
            } else if (backgroundSettings.mode === 'virtual' && flippedImageUrl) {
              processorConfig = {
                mode: 'virtual-background',
                imagePath: flippedImageUrl
              };
            } else {
              return;
            }

            console.log('Applying background to call:', processorConfig);
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
      // Clean up blob URL if created
      if (flippedImageUrl && flippedImageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(flippedImageUrl);
      }
    };
  }, [backgroundSettings, localParticipant]);

  return null;
});

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
    if (!localParticipant || !room || isSwitching) {
      console.log('📹 Camera switching not available');
      return;
    }

    setIsSwitching(true);

    try {
      // Get current camera track
      const currentPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      const currentTrack = currentPublication?.track;

      // Determine new facing mode (toggle between front and back)
      const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
      console.log('📹 Switching camera from', currentFacingMode, 'to', newFacingMode);

      // Stop current track first
      if (currentTrack) {
        currentTrack.stop();
        await localParticipant.unpublishTrack(currentTrack);
      }

      // Small delay for Android to release camera
      await new Promise(resolve => setTimeout(resolve, 300));

      // Create new track with opposite facing mode
      const newTrack = await createLocalVideoTrack({
        facingMode: newFacingMode,
        resolution: { width: 640, height: 480 },
      });

      // Publish new track
      await localParticipant.publishTrack(newTrack);

      setCurrentFacingMode(newFacingMode);
      console.log('📹 Camera switched successfully to', newFacingMode);

    } catch (error) {
      console.error('📹 Camera switch failed:', error);
      toast.error('Could not switch camera. Try again.');

      // Try to restore camera if switch failed
      try {
        const restoreTrack = await createLocalVideoTrack({
          facingMode: currentFacingMode,
          resolution: { width: 640, height: 480 },
        });
        await localParticipant.publishTrack(restoreTrack);
      } catch (restoreError) {
        console.error('📹 Failed to restore camera:', restoreError);
      }
    } finally {
      setIsSwitching(false);
    }
  }, [localParticipant, room, isSwitching, currentFacingMode]);

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

const CustomerView = React.memo(({ onCallEnd, roomId }) => {
  const [showControls, setShowControls] = useState(true);
  const [isSmallScreen, setIsSmallScreen] = useState(true); // Default to true to avoid flash of content
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const connectionState = useConnectionState();

  // Custom control states
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const { switchCamera, isSwitching: isCameraSwitching, canSwitchCamera } = useAdvancedCameraSwitching();

  // Show loading screen while connecting
  const isConnecting = connectionState === ConnectionState.Connecting || connectionState === ConnectionState.Reconnecting;

  // Detect Android for specific fixes
  const isAndroid = useMemo(() => {
    const androidDetected = /Android/i.test(navigator.userAgent);
    if (androidDetected) {
      console.log('🤖 Android device detected:', navigator.userAgent);
      console.log('🤖 Screen dimensions:', window.innerWidth, 'x', window.innerHeight);
      console.log('🤖 Viewport dimensions:', window.visualViewport?.width, 'x', window.visualViewport?.height);
    }
    return androidDetected;
  }, []);

  // Detect if the screen is small (mobile-sized)
  useEffect(() => {
    const checkScreenSize = () => {
      const smallScreen = window.innerWidth < 768;
      setIsSmallScreen(smallScreen);
      if (isAndroid) {
        console.log('🤖 Screen size check:', { smallScreen, width: window.innerWidth });
      }
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, [isAndroid]);

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

  // Auto-hide controls after 6 seconds of inactivity (only if on small screen)
  useEffect(() => {
    if (!isSmallScreen) return;

    let hideTimer;
    
    const resetHideTimer = () => {
      setShowControls(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setShowControls(false), 6000);
    };

    resetHideTimer();

    const handleActivity = () => resetHideTimer();
    
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('mousemove', handleActivity);
    
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('mousemove', handleActivity);
    };
  }, [isSmallScreen]);

  // Get all video tracks to display
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  // Check if local camera track is ready (not just a placeholder)
  const localCameraTrack = tracks.find(
    t => t.participant?.isLocal && t.source === Track.Source.Camera && t.publication?.track
  );
  const isCameraReady = !!localCameraTrack?.publication?.track;

  // Sync control states with localParticipant
  useEffect(() => {
    if (!localParticipant) return;
    setIsMicEnabled(localParticipant.isMicrophoneEnabled);
    setIsCameraEnabled(localParticipant.isCameraEnabled);
  }, [localParticipant?.isMicrophoneEnabled, localParticipant?.isCameraEnabled]);

  // Toggle mic
  const toggleMic = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setMicrophoneEnabled(!isMicEnabled);
      setIsMicEnabled(!isMicEnabled);
    } catch (error) {
      console.error('Failed to toggle microphone:', error);
    }
  }, [localParticipant, isMicEnabled]);

  // Toggle camera
  const toggleCamera = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
      setIsCameraEnabled(!isCameraEnabled);
    } catch (error) {
      console.error('Failed to toggle camera:', error);
    }
  }, [localParticipant, isCameraEnabled]);

  // Leave call
  const leaveCall = useCallback(() => {
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
          <Loader2 className="w-12 h-12 animate-spin text-white mx-auto mb-4" />
          <h3 className="text-2xl font-bold text-white mb-2">Connecting...</h3>
          <p className="text-white/70">Setting up your video call</p>
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
      <div
        className="absolute inset-0 z-10"
        style={{
          // Fix for Android where GridLayout doesn't fill properly
          ...(isAndroid && {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            height: '100vh',
            height: '100dvh',
          })
        }}
      >
        <GridLayout
          tracks={tracks}
          style={{
            height: '100%',
            width: '100%',
            // Force minimum height on Android
            ...(isAndroid && { minHeight: '100vh', minHeight: '100dvh' })
          }}
        >
          <ParticipantTile style={{ borderRadius: '0px', overflow: 'hidden' }} />
        </GridLayout>

        {/* Explicit self-view for mobile customers - fixes Android rendering issues */}
        {localCameraTrack && isCameraReady && (
          <div
            className="absolute bottom-32 right-4 w-28 h-40 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/30 z-30"
            style={{ transform: 'scaleX(-1)' }}
          >
            <VideoTrack
              trackRef={localCameraTrack}
              className={`w-full h-full object-cover ${isAndroid ? 'android-video-fix' : ''}`}
            />
          </div>
        )}

        {/* Loading overlay when camera isn't ready */}
        {!isCameraReady && (
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
            
            {/* Connection status */}
            <div className={`px-4 py-3 rounded-2xl ${glassStyle} flex items-center gap-3`}>
              <div className={`w-3 h-3 rounded-full ${hasAgent ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'} shadow-lg`}></div>
              <span className="text-white text-sm font-bold tracking-wider">
                {hasAgent ? 'LIVE SESSION' : 'CONNECTING...'}
              </span>
            </div>
          </div>
        </div>
      )}

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

            {/* End Call - Larger and prominent */}
            <button
              onClick={leaveCall}
              className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all duration-200 active:scale-95"
            >
              <PhoneOff className="w-9 h-9 text-white" />
            </button>

            {/* Camera Flip - only show if device supports it */}
            {canSwitchCamera && (
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

      {/* Tap hint */}
      {!showControls && (
        <div className="absolute bottom-safe-or-6 left-1/2 transform -translate-x-1/2 z-10">
          <div className={`px-6 py-3 rounded-2xl text-center text-white text-sm font-medium ${glassStyle} border border-white/30 animate-pulse`}>
            Tap to show controls
          </div>
        </div>
      )}

      <RoomAudioRenderer />
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

  // Get participant identity for audio processor
  const { localParticipant } = useLocalParticipant();
  const participantIdentity = localParticipant?.identity || '';

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

  const remoteParticipants = useRemoteParticipants();
  const { switchCamera, isSwitching, canSwitchCamera: canSwitchCameraCustomer } = useAdvancedCameraSwitching();

  // Sync control states with localParticipant
  useEffect(() => {
    if (!localParticipant) return;
    setIsMicEnabled(localParticipant.isMicrophoneEnabled);
    setIsCameraEnabled(localParticipant.isCameraEnabled);
  }, [localParticipant?.isMicrophoneEnabled, localParticipant?.isCameraEnabled]);

  // Toggle mic
  const toggleMic = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setMicrophoneEnabled(!isMicEnabled);
      setIsMicEnabled(!isMicEnabled);
    } catch (error) {
      console.error('Failed to toggle microphone:', error);
    }
  }, [localParticipant, isMicEnabled]);

  // Toggle camera
  const toggleCamera = useCallback(async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
      setIsCameraEnabled(!isCameraEnabled);
    } catch (error) {
      console.error('Failed to toggle camera:', error);
    }
  }, [localParticipant, isCameraEnabled]);

  // Leave call
  const leaveCall = useCallback(() => {
    if (onCallEnd) {
      onCallEnd();
    }
  }, [onCallEnd]);

  // Recording is now automatic - starts when both join, stops when either leaves
  // No manual recording control needed

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
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

  // Auto-hide controls on small screens after inactivity
  useEffect(() => {
    if (!isSmallScreen) return;
    
    let hideTimer;
    
    const resetHideTimer = () => {
      setShowControls(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setShowControls(false), 6000);
    };

    resetHideTimer();

    const handleActivity = () => resetHideTimer();
    
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('click', handleActivity);
    
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('click', handleActivity);
    };
  }, [isSmallScreen]);

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
        {/* Video area - Full screen */}
        <div className="absolute inset-0 z-10">
          <GridLayout 
            tracks={tracks}
            style={{ height: '100%', width: '100%' }}
          >
            <ParticipantTile style={{ borderRadius: '0px', overflow: 'hidden' }} />
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
            </div>

          </div>
        )}

        {/* Floating Action Buttons - Right Side */}
        {showControls && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-3">

            {/* Notes Toggle */}
            <button
              onClick={toggleSidebar}
              className={`relative p-4 rounded-2xl ${glassStyle} bg-indigo-600/30 border-indigo-400/50 text-white shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95`}
            >
              {showInventory ? <EyeOff size={24} /> : <MessageSquare size={24} />}
            </button>
          </div>
        )}

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

              {/* End Call - Larger and prominent */}
              <button
                onClick={leaveCall}
                className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg shadow-red-500/30 transition-all duration-200 active:scale-95"
              >
                <PhoneOff className="w-9 h-9 text-white" />
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

        {/* Tap hint */}
        {!showControls && (
          <div className="absolute bottom-safe-or-6 left-1/2 transform -translate-x-1/2 z-10">
            <div className={`px-6 py-3 rounded-2xl text-white text-sm font-medium ${glassStyle} border border-white/30 animate-pulse`}>
              Tap to show controls
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
      </div>
    );
  }

  // Desktop view - Compact layout with controls
  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
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
            {/* Room selector */}
            {isInventoryActive && (
              <RoomSelector 
                currentRoom={currentRoom} 
                onChange={setCurrentRoom}
                isSmallScreen={false}
              />
            )}
            
            {/* Inventory toggle */}
            <button
              onClick={toggleSidebar}
              className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title={showInventory ? 'Hide inventory' : 'Show inventory'}
            >
              {showInventory ? <EyeOff size={20} /> : <Layers size={20} />}
              {!showInventory && inventoryItems.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                  {inventoryItems.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 h-full flex flex-row min-h-0 overflow-hidden">
        {/* Video Area with integrated controls */}
        <div className="flex-1 h-full flex flex-col bg-gray-900">
          {/* Video Grid */}
          <div className="flex-1 flex items-center justify-center p-4 min-h-0">
            <div className="w-full h-full flex items-center justify-center">
              <GridLayout 
                tracks={tracks}
                style={{ 
                  height: '100%', 
                  width: '100%',
                  backgroundColor: 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ParticipantTile 
                  style={{ 
                    borderRadius: '16px',
                    overflow: 'hidden',
                    backgroundColor: '#374151',
                    border: '1px solid rgba(255,255,255,0.1)'
                  }}
                />
              </GridLayout>
            </div>
          </div>
          
          {/* Video Controls Bar - Right under video frames */}
          <div className="bg-gray-800 p-2 border-t border-gray-700 flex-shrink-0">
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
      <RoomAudioRenderer />
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
      {/* Enhanced Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="p-4 md:p-6 border-b border-blue-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              {isSmallScreen && (
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700"
                >
                  <ChevronLeft size={24} />
                </button>
              )}
              <div className="flex items-center gap-3">
                <Logo />
              </div>
              {/* <div className="px-3 md:px-4 py-1 md:py-2 bg-purple-500 text-white rounded-xl md:rounded-2xl font-bold">
                {items.reduce((total, item) => total + (item.quantity || 1), 0)}
              </div> */}
            </div>
            {!isSmallScreen && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-xl transition-all duration-200 text-gray-700"
              >
                <X size={24} />
              </button>
            )}
          </div>
        </div>
      </div>

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
}) {
  // Determine if current user is agent - either by explicit prop or legacy name check
  const isCurrentUserAgent = isAgentUser || participantName.toLowerCase().includes('agent');
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

  // Fetch LiveKit token on mount
  useEffect(() => {
    const fetchToken = async () => {
      try {
        const response = await fetch('/api/livekit/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomName: roomId,
            participantName,
            isAgent: isAgentUser,  // Pass explicit agent status for correct identity
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to get token');
        }

        const data = await response.json();
        setToken(data.token);
        setServerUrl(data.url);
        setIsConnecting(false);
      } catch (error) {
        console.error('Error fetching token:', error);
        toast.error('Failed to connect to video call');
        setIsConnecting(false);
      }
    };

    fetchToken();
  }, [roomId, participantName, isAgentUser]);

  // Save items to inventory
  // Items are now saved automatically via Railway system - no manual save needed

  const handleDisconnect = useCallback(() => {
    if (onCallEnd) {
      onCallEnd();
    }
  }, [onCallEnd]);

  // Get device info for Android/compatibility optimizations
  const deviceInfo = useMemo(() => getDeviceInfo(), []);

  // Enhanced LiveKit room options with mobile camera optimization, Android compatibility, and better permissions
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
      reconnectPolicy: {
        nextRetryDelayInMs: (context) => Math.min((context.retryCount || 0) * 2000, 10000)
      },
      videoCaptureDefaults: {
        facingMode,
        resolution: isSmallScreen
          ? { width: recommended.width || 640, height: recommended.height || 480 }
          : { width: 1280, height: 720 },
        frameRate: isSmallScreen ? (recommended.frameRate || 24) : 30,
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
  }, [deviceInfo, customerSettings, isCurrentUserAgent]);
  
  // Note: We removed the pre-request camera permissions useEffect because:
  // 1. LiveKit handles permission requests internally when connecting
  // 2. The duplicate request was causing confusing error toast sequences
  // 3. Permissions are already requested in the AgentPreJoin screen if using it

  if (isConnecting) {
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

  return (
    <div className="fixed inset-0 overflow-hidden">
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
        }
      `}</style>
      
      <LiveKitRoom
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
          console.error('LiveKit room error:', errorMsg);

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
          // Clear any pending error timeouts
          pendingErrors.current.forEach(clearTimeout);
          pendingErrors.current = [];
        }}
        onMediaDeviceFailure={(failure) => {
          console.error('Media device failure:', failure);

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

        {/* Render different views based on participant type */}
        {isCurrentUserAgent ? (
          <AgentView
            projectId={projectId}
            currentRoom={currentRoom}
            setCurrentRoom={setCurrentRoom}
            participantName={participantName}
            roomId={roomId}
            onCallEnd={onCallEnd}
          />
        ) : (
          <CustomerView onCallEnd={onCallEnd} roomId={roomId} />
        )}
      </LiveKitRoom>
    </div>
  );
}