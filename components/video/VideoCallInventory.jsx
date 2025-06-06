
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
} from '@livekit/components-react';
import { Track, LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';
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
  Scan,
  Plus,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  ChevronLeft,
  Home,
  Edit2,
  Trash2,
  Save
} from 'lucide-react';
import { toast } from 'sonner';
import FrameProcessor from './FrameProcessor';

// Modern glassmorphism utility class
const glassStyle = "backdrop-blur-xl bg-white/10 border border-white/20 shadow-2xl";
const darkGlassStyle = "backdrop-blur-xl bg-black/20 border border-white/10 shadow-2xl";

// Enhanced camera switching with mobile-first approach
// components/video/VideoCallInventory.jsx
function useAdvancedCameraSwitching() {
  const { localParticipant } = useLocalParticipant();
  const [currentFacingMode, setCurrentFacingMode] = useState(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const isAgent = typeof window !== 'undefined' && 
      window.location.search.includes('name=') && 
      window.location.search.toLowerCase().includes('agent');
    return (isMobile && isAgent) ? 'user' : 'environment';
  });
  const [availableCameras, setAvailableCameras] = useState([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const [hasBackCamera, setHasBackCamera] = useState(false);
  const [hasFrontCamera, setHasFrontCamera] = useState(false);

  // Detect iOS device
  const isIOS = useMemo(() => {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }, []);

  useEffect(() => {
    const detectCameras = async () => {
      try {
        // Request camera permissions
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setAvailableCameras(videoDevices);

        let backCameraFound = false;
        let frontCameraFound = false;

        // Check for camera labels
        for (const device of videoDevices) {
          const label = device.label.toLowerCase();
          if (label.includes('back') || label.includes('rear') || label.includes('environment')) {
            backCameraFound = true;
          }
          if (label.includes('front') || label.includes('user') || label.includes('face')) {
            frontCameraFound = true;
          }
        }

        // Fallback for iOS: Try accessing cameras with facingMode
        if (!backCameraFound || !frontCameraFound) {
          try {
            const backStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment' }
            });
            backStream.getTracks().forEach(track => track.stop());
            backCameraFound = true;
          } catch (e) {
            console.log('📹 No back camera detected via facingMode:', e);
          }

          try {
            const frontStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'user' }
            });
            frontStream.getTracks().forEach(track => track.stop());
            frontCameraFound = true;
          } catch (e) {
            console.log('📹 No front camera detected via facingMode:', e);
          }
        }

        // Assume multiple cameras if enumeration shows multiple devices
        if (videoDevices.length >= 2) {
          backCameraFound = true;
          frontCameraFound = true;
        }

        setHasBackCamera(backCameraFound);
        setHasFrontCamera(frontCameraFound);

      } catch (error) {
        console.error('📹 Error detecting cameras:', error);
        toast.error('Failed to detect cameras');
      }
    };

    detectCameras();
  }, []);

  const switchCamera = useCallback(async () => {
    if (!localParticipant || isSwitching || (!hasBackCamera && !hasFrontCamera)) {
      toast.error('Camera switching not available');
      return;
    }

    setIsSwitching(true);
    const targetFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      // Stop all existing video tracks
      const videoTracks = localParticipant.videoTrackPublications;
      for (const [, publication] of videoTracks) {
        if (publication.track) {
          await publication.track.stop();
          await localParticipant.unpublishTrack(publication.track);
        }
      }

      // Wait for tracks to fully stop
      await new Promise(resolve => setTimeout(resolve, isIOS ? 1000 : 500));

      // Request new camera with specific deviceId if available, otherwise use facingMode
      const videoDevices = await navigator.mediaDevices.enumerateDevices();
      const targetDevice = videoDevices.find(device => {
        const label = device.label.toLowerCase();
        return device.kind === 'videoinput' && (
          (targetFacingMode === 'environment' && (label.includes('back') || label.includes('rear') || label.includes('environment'))) ||
          (targetFacingMode === 'user' && (label.includes('front') || label.includes('user') || label.includes('face')))
        );
      });

      const constraints = {
        video: {
          facingMode: { ideal: targetFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(targetDevice ? { deviceId: { exact: targetDevice.deviceId } } : {}),
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoTrack = stream.getVideoTracks()[0];
      const localVideoTrack = new LocalVideoTrack(videoTrack);

      await localParticipant.publishTrack(localVideoTrack);

      setCurrentFacingMode(targetFacingMode);
      toast.success(`📹 Switched to ${targetFacingMode === 'user' ? 'front' : 'back'} camera`);

      // Clean up the temporary stream
      stream.getTracks().forEach(track => track.stop());

    } catch (error) {
      console.error('📹 Camera switch failed:', error);
      toast.error('Failed to switch camera');

      // Attempt to restore the previous camera
      try {
        await localParticipant.setCameraEnabled(true, {
          facingMode: currentFacingMode,
          resolution: { width: 1280, height: 720 }
        });
      } catch (restoreError) {
        console.error('📹 Failed to restore camera:', restoreError);
        toast.error('Failed to restore camera');
      }
    } finally {
      setIsSwitching(false);
    }
  }, [localParticipant, isSwitching, currentFacingMode, hasBackCamera, hasFrontCamera, isIOS]);

  const canSwitchCamera = (hasBackCamera && hasFrontCamera) || availableCameras.length > 1;

  return {
    switchCamera,
    currentFacingMode,
    canSwitchCamera,
    isSwitching,
    availableCameras,
    hasBackCamera,
    hasFrontCamera
  };
}

// Helper functions
async function extractFrameFromRemoteTrack(track) {
  try {
    const videoElement = document.createElement('video');
    videoElement.srcObject = new MediaStream([track.mediaStreamTrack]);
    videoElement.muted = true;
    videoElement.playsInline = true;
    
    await new Promise((resolve, reject) => {
      videoElement.onloadedmetadata = resolve;
      videoElement.onerror = reject;
      videoElement.play().catch(reject);
    });

    await new Promise(resolve => setTimeout(resolve, 500));

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
function RoomSelector({ currentRoom, onChange, isMobile }) {
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

// Ultra Modern Customer View - Fixed with proper video display and bottom controls
const CustomerView = React.memo(({ onCallEnd }) => {
  const [showControls, setShowControls] = useState(true);
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  
  const { 
    switchCamera, 
    currentFacingMode, 
    canSwitchCamera, 
    isSwitching 
  } = useAdvancedCameraSwitching();
  
  // Auto-hide controls after 6 seconds of inactivity
  useEffect(() => {
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
  }, []);

  // Get all video tracks to display
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const hasAgent = remoteParticipants.some(p => isAgent(p.identity));
  const agentName = remoteParticipants.find(p => isAgent(p.identity))?.name || 'Moving Agent';

  return (
    <div className="h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 flex flex-col relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/30 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/30 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '4s' }}></div>
      </div>

      {/* Video area - Full screen for both participants */}
      <div className="absolute inset-0 z-10">
        <GridLayout 
          tracks={tracks}
          style={{ height: '100%', width: '100%' }}
        >
          <ParticipantTile style={{ borderRadius: '0px', overflow: 'hidden' }} />
        </GridLayout>
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

      {/* Camera Switch Button - Top Right */}
      {canSwitchCamera && showControls && (
        <div className="absolute top-24 right-6 z-30">
          <div className="relative group">
            <button
              onClick={switchCamera}
              disabled={isSwitching}
              className={`relative overflow-hidden bg-gradient-to-br ${
                currentFacingMode === 'environment' 
                  ? 'from-green-400 to-emerald-600 shadow-green-500/50' 
                  : 'from-blue-400 to-purple-600 shadow-blue-500/50'
              } text-white p-4 rounded-2xl shadow-2xl disabled:opacity-50 transition-all duration-300 transform hover:scale-110 active:scale-95 border border-white/30`}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              {isSwitching ? (
                <Loader2 size={24} className="animate-spin relative z-10" />
              ) : (
                <SwitchCamera size={24} className="relative z-10" />
              )}
              {currentFacingMode === 'environment' && (
                <div className="absolute inset-0 rounded-2xl border-2 border-green-400 animate-ping opacity-75"></div>
              )}
            </button>
            
            <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 px-3 py-1 rounded-xl bg-black/90 text-white text-xs font-bold border border-white/30 whitespace-nowrap backdrop-blur-xl">
              {currentFacingMode === 'user' ? (
                <div className="flex items-center gap-2">
                  <span>🤳</span>
                  <span>Front Camera</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span>📱</span>
                  <span>Back Camera</span>
                  <CheckCircle className="w-4 h-4 text-green-400" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Control Bar - Using LiveKit's ControlBar */}
      <div className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-300 ${showControls ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="bg-gradient-to-t from-black/60 to-transparent p-8 pb-safe-or-8">
          <ControlBar 
            variation="minimal"
            controls={{
              microphone: true,
              camera: true,
              chat: false,
              screenShare: false,
              leave: true,
            }}
            onLeave={onCallEnd}
          />
        </div>
      </div>

      {/* Tap hint */}
      {!showControls && (
        <div className="absolute bottom-safe-or-6 left-1/2 transform -translate-x-1/2 z-10">
          <div className={`px-6 py-3 rounded-2xl text-white text-sm font-medium ${glassStyle} border border-white/30 animate-pulse`}>
            Tap anywhere to show controls
          </div>
        </div>
      )}

      <RoomAudioRenderer />
    </div>
  );
});

const AgentView = React.memo(({ 
  projectId, 
  detectedItems, 
  setDetectedItems, 
  currentRoom,
  setCurrentRoom,
  handleSaveItems
}) => {
  const [isMobile, setIsMobile] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [isInventoryActive, setIsInventoryActive] = useState(false);
  const [captureMode, setCaptureMode] = useState('paused');
  const [captureCount, setCaptureCount] = useState(0);
  
  const remoteParticipants = useRemoteParticipants();
  const { switchCamera, currentFacingMode, canSwitchCamera, isSwitching } = useAdvancedCameraSwitching();

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile && !showInventory) setShowInventory(true);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [showInventory]);

  // Auto-hide controls on mobile after inactivity
  useEffect(() => {
    if (!isMobile) return;
    
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
  }, [isMobile]);

  const handleItemsDetected = useCallback((items) => {
    const newItems = items.map(item => ({
      ...item,
      id: `${Date.now()}-${Math.random()}`,
      location: currentRoom,
      detectedAt: new Date().toISOString(),
      frameId: `frame-${Date.now()}`,
    }));

    setDetectedItems(prev => {
      const filtered = newItems.filter(newItem =>
        !prev.some(existing =>
          existing.name.toLowerCase() === newItem.name.toLowerCase() &&
          existing.location === newItem.location
        )
      );
      return [...prev, ...filtered];
    });

    if (newItems.length > 0) {
      toast.success(`✨ Discovered ${newItems.length} new items!`);
    }
  }, [currentRoom, setDetectedItems]);

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

  const takeScreenshot = async () => {
    if (isProcessing) {
      toast.warning('⏳ Please wait for current analysis to complete');
      return;
    }

    const customerTrack = remoteParticipants.find(participant => 
      !isAgent(participant.identity) && participant.videoTrackPublications.size > 0
    )?.videoTrackPublications.values().next().value?.track;

    if (!customerTrack || !(customerTrack instanceof RemoteVideoTrack)) {
      toast.error('📹 No customer video feed available');
      return;
    }

    setIsProcessing(true);
    
    try {
      const frameBlob = await extractFrameFromRemoteTrack(customerTrack);
      
      if (!frameBlob) {
        throw new Error('Failed to capture video frame');
      }

      const formData = new FormData();
      formData.append('image', frameBlob, `ai-capture-${Date.now()}.jpg`);
      formData.append('projectId', projectId);
      formData.append('roomLabel', currentRoom);
      formData.append('existingItems', JSON.stringify(
        detectedItems.map(item => ({ name: item.name, location: item.location }))
      ));

      const response = await fetch('/api/analyze-video-frame', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to analyze capture');
      }

      const result = await response.json();
      
      if (result.items && result.items.length > 0) {
        const newItems = result.items.map((item) => ({
          ...item,
          id: `${Date.now()}-${Math.random()}`,
          location: currentRoom,
          detectedAt: new Date().toISOString(),
          frameId: `ai-capture-${Date.now()}`,
        }));

        setDetectedItems(prev => {
          const filtered = newItems.filter(newItem =>
            !prev.some(existing =>
              existing.name.toLowerCase() === newItem.name.toLowerCase() &&
              existing.location === newItem.location
            )
          );
          return [...prev, ...filtered];
        });

        if (newItems.length > 0) {
          toast.success(`🎯 AI found ${newItems.length} new items!`);
        } else {
          toast.info('📸 Capture analyzed - no new items detected');
        }
      } else {
        toast.info('📸 Frame captured and analyzed');
      }

    } catch (error) {
      console.error('Error taking screenshot:', error);
      toast.error('❌ Failed to analyze frame');
    } finally {
      setIsProcessing(false);
    }
  };

  const hasCustomer = remoteParticipants.some(p => !isAgent(p.identity));

  // Mobile view - full screen with overlays
  if (isMobile) {
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
                <div className={`px-4 py-2 rounded-2xl ${glassStyle} flex items-center gap-2 ${captureMode === 'auto' ? 'bg-green-500/20 border-green-400/50' : 'bg-gray-500/20 border-gray-400/50'}`}>
                  <Activity className="w-4 h-4 text-white" />
                  <span className="text-white text-sm font-bold">
                    {captureMode === 'auto' ? 'SCANNING' : 'PAUSED'}
                  </span>
                </div>
              )}
            </div>

            {/* Room Selector */}
            <div className="mb-3">
              <RoomSelector 
                currentRoom={currentRoom} 
                onChange={setCurrentRoom}
                isMobile={true}
              />
            </div>

            {/* Stats Row - Simplified */}
            {isInventoryActive && detectedItems.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <div className={`px-3 py-2 rounded-2xl ${glassStyle} text-center`}>
                  <p className="text-white/70 text-xs">Items</p>
                  <p className="text-white font-bold">{detectedItems.length}</p>
                </div>
                <div className={`px-3 py-2 rounded-2xl ${glassStyle} text-center`}>
                  <p className="text-white/70 text-xs">Captures</p>
                  <p className="text-white font-bold">{captureCount}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Floating Action Buttons - Right Side */}
        {showControls && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-3">
            {/* Camera Switch */}
            {canSwitchCamera && (
              <button
                onClick={switchCamera}
                disabled={isSwitching}
                className={`p-4 rounded-2xl ${glassStyle} ${
                  currentFacingMode === 'environment' 
                    ? 'bg-green-500/30 border-green-400/50' 
                    : 'bg-blue-500/30 border-blue-400/50'
                } text-white shadow-2xl disabled:opacity-50 transition-all duration-300 transform hover:scale-110 active:scale-95`}
              >
                {isSwitching ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : (
                  <SwitchCamera size={24} />
                )}
              </button>
            )}

            {/* AI Capture - Updated Icon */}
            {hasCustomer && (
              <button
                onClick={takeScreenshot}
                disabled={isProcessing}
                className={`p-4 rounded-2xl ${glassStyle} bg-purple-600/30 border-purple-400/50 text-white shadow-2xl disabled:opacity-50 transition-all duration-300 transform hover:scale-110 active:scale-95`}
              >
                {isProcessing ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : (
                  <Camera size={24} />
                )}
              </button>
            )}

            {/* Inventory Toggle */}
            <button
              onClick={toggleSidebar}
              className={`relative p-4 rounded-2xl ${glassStyle} bg-indigo-600/30 border-indigo-400/50 text-white shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95`}
            >
              {showInventory ? <EyeOff size={24} /> : <Package size={24} />}
              {!showInventory && detectedItems.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold animate-pulse shadow-lg">
                  {detectedItems.length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Bottom Control Bar */}
        <div className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-300 ${showControls ? 'translate-y-0' : 'translate-y-full'}`}>
          <div className="bg-gradient-to-t from-black/60 to-transparent p-6 pb-safe-or-6">
            <ControlBar 
              variation="minimal"
              controls={{
                microphone: true,
                camera: true,
                chat: false,
                screenShare: false,
                leave: true,
              }}
            />
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

        {/* Frame Processor */}
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

        {/* Inventory Sidebar */}
        {showInventory && (
          <div className="fixed inset-0 z-50">
            <div 
              className="absolute inset-0 bg-black/50 backdrop-blur-sm z-40"
              onClick={() => setShowInventory(false)}
            />
            
            <div className="absolute right-0 top-0 bottom-0 w-80 bg-white/95 backdrop-blur-xl z-50 transform transition-transform duration-300 ease-in-out shadow-2xl">
              <InventorySidebar
                items={detectedItems}
                onRemoveItem={(id) => setDetectedItems(prev => prev.filter(item => item.id !== id))}
                onSaveItems={() => handleSaveItems(detectedItems)}
                onClose={() => setShowInventory(false)}
              />
            </div>
          </div>
        )}

        <RoomAudioRenderer />
      </div>
    );
  }

  // Desktop view remains unchanged
  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Ultra Modern Header */}
      <div className="bg-white/80 backdrop-blur-xl shadow-xl border-b border-white/20">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              {/* Main title with gradient */}
              <div className="flex items-center gap-3">
                <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-lg">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                    AI Inventory Assistant
                  </h2>
                  <p className="text-sm text-gray-500 font-medium">Powered by Computer Vision</p>
                </div>
              </div>
              
              {/* Status badges */}
              <div className="flex gap-3">
                {isInventoryActive && (
                  <div className="px-4 py-2 bg-gradient-to-r from-green-400 to-emerald-500 text-white text-sm font-bold rounded-2xl shadow-lg flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    <span>ACTIVE</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Desktop controls */}
            <div className="flex items-center gap-3">
              {/* Camera switch */}
              {/* {canSwitchCamera && (
                <button
                  onClick={switchCamera}
                  disabled={isSwitching}
                  className="px-4 py-3 bg-gradient-to-r from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 text-gray-700 rounded-2xl font-bold flex items-center gap-3 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 shadow-lg"
                >
                  {isSwitching ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <SwitchCamera size={20} />
                  )}
                  <span className="hidden sm:inline">
                    {currentFacingMode === 'user' ? 'Switch to Back' : 'Switch to Front'}
                  </span>
                </button>
              )} */}

              {/* Main action buttons */}
              {!isInventoryActive ? (
                <button
                  onClick={startInventory}
                  className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-2xl font-bold flex items-center gap-3 transition-all duration-300 transform hover:scale-105 shadow-lg"
                >
                  <Zap size={20} />
                  Start AI Scanning
                </button>
              ) : (
                <div className="flex gap-2">
                  {captureMode === 'paused' ? (
                    <button
                      onClick={resumeInventory}
                      className="px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-2xl font-bold flex items-center gap-2 transition-all duration-300 transform hover:scale-105 shadow-lg"
                    >
                      <Play size={18} />
                      Resume
                    </button>
                  ) : (
                    <button
                      onClick={pauseInventory}
                      className="px-4 py-3 bg-gradient-to-r from-yellow-500 to-orange-600 hover:from-yellow-600 hover:to-orange-700 text-white rounded-2xl font-bold flex items-center gap-2 transition-all duration-300 transform hover:scale-105 shadow-lg"
                    >
                      <Pause size={18} />
                      Pause
                    </button>
                  )}
                  <button
                    onClick={stopInventory}
                    className="px-4 py-3 bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 text-white rounded-2xl font-bold flex items-center gap-2 transition-all duration-300 transform hover:scale-105 shadow-lg"
                  >
                    <X size={18} />
                    Stop
                  </button>
                </div>
              )}
              
              {/* AI Capture button */}
              <button
                onClick={takeScreenshot}
                disabled={isProcessing || !hasCustomer}
                className="px-6 py-3 bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 disabled:from-gray-300 disabled:to-gray-400 text-white rounded-2xl font-bold flex items-center gap-3 transition-all duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    AI Analyzing...
                  </>
                ) : (
                  <>
                    <Target size={20} />
                    AI Capture
                  </>
                )}
              </button>
              
              {/* Inventory toggle */}
              <button
                onClick={toggleSidebar}
                className="relative p-3 hover:bg-gray-100 rounded-2xl transition-all duration-200"
                title={showInventory ? 'Hide inventory' : 'Show inventory'}
              >
                {showInventory ? <EyeOff size={24} /> : <Layers size={24} />}
                {!showInventory && detectedItems.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold animate-pulse shadow-lg">
                    {detectedItems.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Enhanced Room selector and stats */}
          {isInventoryActive && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <Scan className="w-4 h-4" />
                  Current Room
                </label>
                <RoomSelector 
                  currentRoom={currentRoom} 
                  onChange={setCurrentRoom}
                  isMobile={isMobile}
                />
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gradient-to-r from-blue-100 to-indigo-100 p-4 rounded-2xl border border-blue-200/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500 rounded-xl">
                      <Camera className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Captures</p>
                      <p className="text-xl font-bold text-blue-600">{captureCount}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-gradient-to-r from-green-100 to-emerald-100 p-4 rounded-2xl border border-green-200/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-500 rounded-xl">
                      <Package className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Items</p>
                      <p className="text-xl font-bold text-green-600">{detectedItems.length}</p>
                    </div>
                  </div>
                </div>
                {/* <div className="bg-gradient-to-r from-purple-100 to-violet-100 p-4 rounded-2xl border border-purple-200/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500 rounded-xl">
                      <SwitchCamera className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">Camera</p>
                      <p className="text-lg font-bold text-purple-600">
                        {currentFacingMode === 'user' ? 'Front' : 'Back'}
                      </p>
                    </div>
                  </div>
                </div> */}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Enhanced Video Grid */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <div className="flex-1 flex flex-col">
          <div className="flex-1 relative bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900 rounded-3xl m-4 overflow-hidden shadow-2xl border border-gray-700/50">
            <div className="w-full h-full">
              <GridLayout 
                tracks={tracks}
                style={{ 
                  height: '100%', 
                  width: '100%',
                  backgroundColor: 'transparent'
                }}
              >
                <ParticipantTile 
                  style={{ 
                    borderRadius: '24px',
                    overflow: 'hidden',
                    backgroundColor: '#1e293b',
                    border: '1px solid rgba(255,255,255,0.1)'
                  }}
                />
              </GridLayout>
            </div>
            
            {/* Enhanced Status Indicators */}
            {isInventoryActive && (
              <div className="absolute top-6 left-6 right-6 flex flex-wrap gap-3 z-10">
                {isProcessing && (
                  <div className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-4 py-3 rounded-2xl flex items-center gap-3 shadow-2xl text-sm font-bold border border-yellow-400/30">
                    <Loader2 size={16} className="animate-spin" />
                    AI Analyzing Frame...
                  </div>
                )}

                {captureMode === 'auto' && !isProcessing && (
                  <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white px-4 py-3 rounded-2xl flex items-center gap-3 shadow-2xl text-sm font-bold border border-green-400/30">
                    <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
                    AI Scanning Active
                  </div>
                )}

                {captureMode === 'paused' && (
                  <div className="bg-gradient-to-r from-gray-600 to-slate-600 text-white px-4 py-3 rounded-2xl flex items-center gap-3 shadow-2xl text-sm font-bold border border-gray-500/30">
                    <Pause size={16} />
                    Scanning Paused
                  </div>
                )}

                <div className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-4 py-3 rounded-2xl flex items-center gap-3 shadow-2xl text-sm font-bold border border-blue-400/30">
                  <Camera size={16} />
                  {currentFacingMode === 'user' ? 'Front Camera' : 'Back Camera'}
                </div>
              </div>
            )}

            {/* Enhanced Customer Connection Status */}
            {!hasCustomer && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                <div className="bg-white/95 backdrop-blur-xl p-8 rounded-3xl text-center max-w-md shadow-2xl border border-white/20">
                  <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <Users size={40} className="text-blue-500" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-3 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                    Waiting for Customer
                  </h3>
                  <p className="text-gray-600 leading-relaxed">
                    Share the video call link with your customer to begin the AI-powered inventory session.
                  </p>
                  <div className="mt-6 flex items-center justify-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Enhanced Control Bar */}
          <div className="p-4">
            <div className="bg-white/80 backdrop-blur-xl rounded-3xl p-4 shadow-2xl border border-white/20">
              <ControlBar 
                variation={isMobile ? "minimal" : "verbose"}
                controls={{
                  microphone: true,
                  camera: true,
                  chat: false,
                  screenShare: !isMobile,
                  leave: true,
                }}
              />
            </div>
          </div>
        </div>

        {/* Enhanced Frame Processor - only when active */}
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

        {/* Enhanced Inventory Sidebar */}
        {showInventory && (
          <div className={`${
            isMobile 
              ? 'fixed inset-0 z-50' 
              : 'w-96 flex-shrink-0'
          }`}>
            {isMobile && (
              <div 
                className="absolute inset-0 bg-black/50 backdrop-blur-sm z-40"
                onClick={() => setShowInventory(false)}
              />
            )}
            
            <div className={`${
              isMobile 
                ? 'absolute right-0 top-0 bottom-0 w-80 bg-white/95 backdrop-blur-xl z-50 transform transition-transform duration-300 ease-in-out shadow-2xl' 
                : 'w-full h-full bg-white/80 backdrop-blur-xl border-l border-white/20'
            }`}>
              <InventorySidebar
                items={detectedItems}
                onRemoveItem={(id) => setDetectedItems(prev => prev.filter(item => item.id !== id))}
                onSaveItems={() => handleSaveItems(detectedItems)}
                onClose={() => setShowInventory(false)}
              />
            </div>
          </div>
        )}
      </div>

      <RoomAudioRenderer />
    </div>
  );
});

// Enhanced InventorySidebar component (unchanged)
const InventorySidebar = ({ items, onRemoveItem, onSaveItems, onClose }) => {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
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
    <div className="h-full flex flex-col bg-gradient-to-br from-white via-blue-50 to-indigo-100">
      {/* Enhanced Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
        <div className="p-4 md:p-6 border-b border-blue-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              {isMobile && (
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/20 rounded-xl transition-all duration-200"
                >
                  <ChevronLeft size={24} />
                </button>
              )}
              <div className="flex items-center gap-3">
                <div className="p-2 md:p-3 bg-white/20 rounded-xl md:rounded-2xl backdrop-blur-sm">
                  <Package className="text-white w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg md:text-xl">AI Detected Items</h3>
                  <p className="text-blue-100 text-xs md:text-sm">Automatically cataloged</p>
                </div>
              </div>
              <div className="px-3 md:px-4 py-1 md:py-2 bg-white/20 text-white rounded-xl md:rounded-2xl backdrop-blur-sm font-bold">
                {items.length}
              </div>
            </div>
            {!isMobile && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/20 rounded-xl transition-all duration-200"
              >
                <X size={24} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Enhanced Totals */}
      <div className="bg-gradient-to-r from-indigo-50 to-blue-50 p-4 md:p-6 border-b border-blue-200/50">
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <div className="bg-white rounded-xl md:rounded-2xl p-3 md:p-4 text-center shadow-lg border border-blue-100">
            <div className="w-10 md:w-12 h-10 md:h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl md:rounded-2xl flex items-center justify-center mx-auto mb-2 md:mb-3">
              <Package className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <p className="text-xs md:text-sm font-medium text-gray-600 mb-1">Total Items</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">{totals.items}</p>
          </div>
          <div className="bg-white rounded-xl md:rounded-2xl p-3 md:p-4 text-center shadow-lg border border-green-100">
            <div className="w-10 md:w-12 h-10 md:h-12 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl md:rounded-2xl flex items-center justify-center mx-auto mb-2 md:mb-3">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <p className="text-xs md:text-sm font-medium text-gray-600 mb-1">Volume</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">{totals.cuft.toFixed(1)}</p>
            <p className="text-xs text-gray-500">cu ft</p>
          </div>
          <div className="bg-white rounded-xl md:rounded-2xl p-3 md:p-4 text-center shadow-lg border border-purple-100">
            <div className="w-10 md:w-12 h-10 md:h-12 bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl md:rounded-2xl flex items-center justify-center mx-auto mb-2 md:mb-3">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16l3-3m-3 3l-3-3" />
              </svg>
            </div>
            <p className="text-xs md:text-sm font-medium text-gray-600 mb-1">Weight</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">{totals.weight.toFixed(0)}</p>
            <p className="text-xs text-gray-500">lbs</p>
          </div>
        </div>
      </div>

      {/* Enhanced Items List */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8">
            <div className="w-20 md:w-24 h-20 md:h-24 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl md:rounded-3xl flex items-center justify-center mb-4 md:mb-6">
              <Package size={40} className="text-blue-400 md:w-12 md:h-12" />
            </div>
            <h4 className="text-lg md:text-xl font-bold text-gray-900 mb-2 md:mb-3">No Items Detected Yet</h4>
            <p className="text-sm md:text-base text-gray-600 text-center leading-relaxed max-w-sm">
              Start the AI inventory scan to automatically detect and catalog items in each room
            </p>
            <div className="mt-4 md:mt-6 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
          </div>
        ) : (
          <div className="p-3 md:p-4 space-y-3 md:space-y-4">
            {Object.entries(groupedItems).map(([location, locationItems]) => (
              <div key={location} className="bg-white rounded-2xl md:rounded-3xl shadow-lg overflow-hidden border border-gray-100">
                <div className="bg-gradient-to-r from-gray-50 to-blue-50 px-4 md:px-6 py-3 md:py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 md:gap-3">
                      <span className="text-xl md:text-2xl">{getRoomIcon(location)}</span>
                      <div>
                        <h4 className="font-bold text-gray-900 text-base md:text-lg">{location}</h4>
                        <p className="text-xs md:text-sm text-gray-600">{locationItems.length} items detected</p>
                      </div>
                    </div>
                    <div className="px-2 md:px-3 py-1 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl md:rounded-2xl text-xs md:text-sm font-bold">
                      {locationItems.length}
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-gray-100">
                  {locationItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 md:p-4 hover:bg-gray-50 transition-colors duration-200"
                    >
                      {editingId === item.id ? (
                        // Enhanced Edit Mode
                        <div className="space-y-3 md:space-y-4">
                          <input
                            type="text"
                            value={editForm.name || ''}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full text-black px-3 md:px-4 py-2 md:py-3 border border-gray-300 rounded-xl md:rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium text-sm md:text-base"
                            placeholder="Item name"
                          />
                          <div className="grid grid-cols-3 gap-2 md:gap-3">
                            <div>
                              <label className="text-xs font-medium text-gray-600 mb-1 block">Quantity</label>
                              <input
                                type="number"
                                value={editForm.quantity || ''}
                                onChange={(e) => setEditForm({ ...editForm, quantity: parseInt(e.target.value) || 1 })}
                                className="w-full text-black px-2 md:px-3 py-1 md:py-2 border border-gray-300 rounded-lg md:rounded-xl text-xs md:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-600 mb-1 block">Cu ft</label>
                              <input
                                type="number"
                                value={editForm.cuft || ''}
                                onChange={(e) => setEditForm({ ...editForm, cuft: parseFloat(e.target.value) || 0 })}
                                className="w-full text-black px-2 md:px-3 py-1 md:py-2 border border-gray-300 rounded-lg md:rounded-xl text-xs md:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-gray-600 mb-1 block">Weight</label>
                              <input
                                type="number"
                                value={editForm.weight || ''}
                                onChange={(e) => setEditForm({ ...editForm, weight: parseFloat(e.target.value) || 0 })}
                                className="w-full text-black px-2 md:px-3 py-1 md:py-2 border border-gray-300 rounded-lg md:rounded-xl text-xs md:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 md:gap-3">
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 md:px-4 py-1.5 md:py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg md:rounded-xl transition-all duration-200"
                            >
                              <X size={16} className="md:w-5 md:h-5" />
                            </button>
                            <button
                              onClick={() => {
                                // Save logic would go here
                                setEditingId(null);
                              }}
                              className="px-3 md:px-4 py-1.5 md:py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:from-green-600 hover:to-emerald-700 rounded-lg md:rounded-xl transition-all duration-200"
                            >
                              <CheckCircle size={16} className="md:w-5 md:h-5" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        // Enhanced View Mode
                        <div>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <h5 className="font-bold text-gray-900 text-base md:text-lg mb-1 md:mb-2">{item.name}</h5>
                              <div className="flex flex-wrap gap-1.5 md:gap-2">
                                <span className="inline-flex items-center px-2 md:px-3 py-0.5 md:py-1 rounded-xl md:rounded-2xl text-xs md:text-sm font-bold bg-gradient-to-r from-blue-100 to-indigo-100 text-blue-700">
                                  {item.quantity || 1}x
                                </span>
                                {item.category && (
                                  <span className="inline-flex items-center px-2 md:px-3 py-0.5 md:py-1 rounded-xl md:rounded-2xl text-xs md:text-sm font-medium bg-gradient-to-r from-gray-100 to-slate-100 text-gray-700">
                                    {item.category}
                                  </span>
                                )}
                                {item.cuft && (
                                  <span className="inline-flex items-center px-2 md:px-3 py-0.5 md:py-1 rounded-xl md:rounded-2xl text-xs md:text-sm font-medium bg-gradient-to-r from-green-100 to-emerald-100 text-green-700">
                                    {item.cuft} cu ft
                                  </span>
                                )}
                                {item.weight && (
                                  <span className="inline-flex items-center px-2 md:px-3 py-0.5 md:py-1 rounded-xl md:rounded-2xl text-xs md:text-sm font-medium bg-gradient-to-r from-yellow-100 to-orange-100 text-orange-700">
                                    {item.weight} lbs
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 md:gap-2 ml-2 md:ml-3">
                              <button
                                onClick={() => {
                                  setEditingId(item.id);
                                  setEditForm({
                                    name: item.name,
                                    quantity: item.quantity,
                                    cuft: item.cuft,
                                    weight: item.weight,
                                  });
                                }}
                                className="p-1.5 md:p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg md:rounded-xl transition-all duration-200"
                              >
                                <Edit2 size={14} className="md:w-4 md:h-4" />
                              </button>
                              <button
                                onClick={() => onRemoveItem(item.id)}
                                className="p-1.5 md:p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg md:rounded-xl transition-all duration-200"
                              >
                                <Trash2 size={14} className="md:w-4 md:h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Enhanced Save Button */}
      {items.length > 0 && (
        <div className="bg-white border-t border-gray-200 p-4 md:p-6">
          <button
            onClick={() => onSaveItems(items)}
            className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white py-3 md:py-4 rounded-2xl md:rounded-3xl font-bold flex items-center justify-center gap-2 md:gap-3 transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-2xl text-base md:text-lg"
          >
            <Save className="w-5 h-5 md:w-6 md:h-6" />
            Save {items.length} Items to Inventory
          </button>
          {isMobile && (
            <button
              onClick={onClose}
              className="w-full mt-3 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-2xl font-medium transition-colors duration-200"
            >
              Continue Scanning
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Main VideoCallInventory component
export default function VideoCallInventory({
  projectId,
  roomId,
  participantName,
  onCallEnd,
}) {
  const [token, setToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [isConnecting, setIsConnecting] = useState(true);
  const [detectedItems, setDetectedItems] = useState([]);
  const [currentRoom, setCurrentRoom] = useState('Living Room');

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
  }, [roomId, participantName]);

  // Save items to inventory
  const handleSaveItems = async (items) => {
    if (!items || items.length === 0) {
      toast.error('No items to save');
      return;
    }

    try {
      const inventoryItems = items.map(item => ({
        name: item.name,
        description: `AI detected via video inventory in ${item.location}`,
        category: item.category,
        quantity: item.quantity || 1,
        location: item.location,
        cuft: item.cuft || 3,
        weight: item.weight || 21,
        fragile: false,
        special_handling: "",
      }));

      const response = await fetch(`/api/projects/${projectId}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inventoryItems),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save items to inventory');
      }

      toast.success(`🎉 Successfully saved ${items.length} items to inventory!`);
      setDetectedItems([]);

    } catch (error) {
      console.error('Error saving video inventory items:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save items to inventory');
    }
  };

  const handleDisconnect = useCallback(() => {
    if (onCallEnd) {
      onCallEnd();
    }
  }, [onCallEnd]);

  // Enhanced LiveKit room options with mobile camera optimization
  const roomOptions = {
    publishDefaults: {
      videoCodec: 'h264',
      videoResolution: {
        width: 1280,
        height: 720
      },
      videoSimulcast: false,
      frameRate: 30, // Add explicit frame rate for better mobile performance
    },
    adaptiveStream: true, // Enable adaptive streaming for mobile
    dynacast: true, // Enable dynamic casting for better bandwidth management
    autoSubscribe: true,
    disconnectOnPageLeave: true,
    reconnectPolicy: {
      nextRetryDelayInMs: (context) => Math.min((context.retryCount || 0) * 2000, 10000)
    },
    videoCaptureDefaults: {
      facingMode: (() => {
        const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
        const isAgent = participantName.toLowerCase().includes('agent');
        return (isMobile && isAgent) ? 'user' : 'environment';
      })(),
      resolution: {
        width: 1280,
        height: 720
      },
      frameRate: 30, // Add frame rate constraint
    }
  };

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
    <div className="h-screen">
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={serverUrl}
        onDisconnected={handleDisconnect}
        data-lk-theme="default"
        className="h-full"
        options={roomOptions}
        onError={(error) => {
          console.error('LiveKit room error:', error);
          toast.error('🚨 Video call error occurred');
        }}
        onConnected={() => {
          console.log('✅ Connected to LiveKit room');
          toast.success('🎉 Connected to AI video call!');
        }}
      >
        {/* Render different views based on participant type */}
        {isAgent(participantName) ? (
          <AgentView
            projectId={projectId}
            detectedItems={detectedItems}
            setDetectedItems={setDetectedItems}
            currentRoom={currentRoom}
            setCurrentRoom={setCurrentRoom}
            handleSaveItems={handleSaveItems}
          />
        ) : (
          <CustomerView onCallEnd={onCallEnd} />
        )}
      </LiveKitRoom>
    </div>
  );
}