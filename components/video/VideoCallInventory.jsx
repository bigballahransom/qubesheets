
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
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import FrameProcessor from './FrameProcessor';
import Logo from '../../public/logo';
import { Button } from '../ui/button';
import { ToggleGoingBadge } from '../ui/ToggleGoingBadge';

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

const CustomerView = React.memo(({ onCallEnd }) => {
  const [showControls, setShowControls] = useState(true);
  const [isMobile, setIsMobile] = useState(true); // Default to true to avoid flash of content
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();

  // Detect if the user is on a mobile device
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Auto-enable video track on mount with retry logic
  useEffect(() => {
    if (!isMobile || !localParticipant) return;

    const enableCamera = async () => {
      try {
        if (!localParticipant.isCameraEnabled) {
          console.log('📹 Attempting to enable camera for local participant...');
          await localParticipant.setCameraEnabled(true, {
            resolution: { width: 1280, height: 720 }
          });
          console.log('📹 Camera enabled successfully:', localParticipant.isCameraEnabled);
        } else {
          console.log('📹 Camera already enabled:', localParticipant.isCameraEnabled);
        }
      } catch (error) {
        console.error('📹 Failed to enable camera:', error);
        toast.error('Failed to start camera. Please enable it manually.');
        // Retry after a short delay
        setTimeout(() => {
          if (!localParticipant.isCameraEnabled) {
            console.log('📹 Retrying to enable camera...');
            enableCamera();
          }
        }, 2000);
      }
    };

    enableCamera();
  }, [localParticipant, isMobile]);

  // Sync video track state with ControlBar
  useEffect(() => {
    if (!localParticipant) return;

    const checkAndSyncVideo = async () => {
      const videoTrack = localParticipant.getTrack(Track.Source.Camera);
      if (videoTrack && videoTrack.isEnabled && !videoTrack.isMuted) {
        console.log('📹 Video track is active and unmuted, syncing with ControlBar');
      } else if (localParticipant.isCameraEnabled && (!videoTrack || videoTrack.isMuted)) {
        console.log('📹 Video track out of sync, attempting to fix...');
        try {
          await localParticipant.setCameraEnabled(true, {
            resolution: { width: 1280, height: 720 }
          });
          console.log('📹 Video track synced:', localParticipant.isCameraEnabled);
        } catch (error) {
          console.error('📹 Failed to sync video track:', error);
        }
      }
    };

    checkAndSyncVideo();
    const interval = setInterval(checkAndSyncVideo, 1000); // Check every second
    return () => clearInterval(interval);
  }, [localParticipant]);

  // Auto-hide controls after 6 seconds of inactivity (only if on mobile)
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
    window.addEventListener('mousemove', handleActivity);
    
    return () => {
      clearTimeout(hideTimer);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('mousemove', handleActivity);
    };
  }, [isMobile]);

  // Get all video tracks to display (only if on mobile)
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const hasAgent = remoteParticipants.some(p => isAgent(p.identity));
  const agentName = remoteParticipants.find(p => isAgent(p.identity))?.name || 'Moving Agent';

  // Render "Desktop not supported" message if not on mobile
  if (!isMobile) {
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
            Desktop not supported
          </h3>
          <p className="text-white/80 leading-relaxed">
            Thanks for coming! Please join with a mobile device, you'll need to give us a tour of your home.
          </p>
        </div>
      </div>
    );
  }

  // Render the video call interface if on mobile
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

      {/* Control Bar - Using LiveKit's ControlBar for camera control */}
      <div className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-300 ${showControls ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="bg-gradient-to-t from-black/60 to-transparent p-6 pb-safe-or-6">
          <ControlBar 
            variation="minimal"
            controls={{
              microphone: true,
              camera: true, // Rely on ControlBar for camera toggle and switching
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
  setCurrentRoom
}) => {
  const [isMobile, setIsMobile] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [isInventoryActive, setIsInventoryActive] = useState(false);
  const [captureMode, setCaptureMode] = useState('paused');
  const [captureCount, setCaptureCount] = useState(0);
  
  // SSE for real-time inventory updates
  const sseRef = useRef(null);
  const sseRetryTimeoutRef = useRef(null);
  
  // Real inventory data (replaces detectedItems)
  const [inventoryItems, setInventoryItems] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [capturedImages, setCapturedImages] = useState([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  
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
    
    // Load inventory when sidebar opens
    if (!showInventory && inventoryItems.length === 0) {
      fetchInventoryItems();
      fetchCapturedImages();
    }
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
      // Revert local state on error
      await fetchInventoryItems();
    }
  }, [projectId]);

  // Fetch real inventory items from database
  const fetchInventoryItems = async () => {
    setInventoryLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/inventory`);
      if (response.ok) {
        const items = await response.json();
        setInventoryItems(items);
        console.log(`📦 Loaded ${items.length} inventory items for video call`);
      } else {
        console.error('Failed to fetch inventory items');
      }
    } catch (error) {
      console.error('Error fetching inventory items:', error);
    } finally {
      setInventoryLoading(false);
    }
  };

  // Fetch all project images from database
  const fetchCapturedImages = async (force = false) => {
    if (!force) setImagesLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/images`);
      if (response.ok) {
        const images = await response.json();
        // Show all project images, sorted by most recent
        const allImages = images.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        // Only update state if data actually changed (prevent unnecessary re-renders)
        setCapturedImages(prevImages => {
          const hasChanged = JSON.stringify(prevImages) !== JSON.stringify(allImages);
          if (hasChanged) {
            console.log(`📸 Updated ${allImages.length} project images for video call`);
            return allImages;
          }
          console.log('📸 No changes in images, skipping update');
          return prevImages;
        });
      } else {
        console.error('Failed to fetch project images');
      }
    } catch (error) {
      console.error('Error fetching project images:', error);
    } finally {
      if (!force) setImagesLoading(false);
    }
  };
  
  // Load images and inventory on mount
  useEffect(() => {
    if (projectId) {
      fetchInventoryItems();
      fetchCapturedImages();
    }
  }, [projectId]);

  // Refresh images when SSE updates occur (not on timer to avoid glitching)
  // Removed periodic refresh to prevent UI glitching

  // SSE setup for real-time updates
  useEffect(() => {
    if (!projectId) return;

    console.log('🔌 Setting up Video Call SSE connection for project:', projectId);
    
    const setupSSE = () => {
      const eventSource = new EventSource(`/api/processing-complete?projectId=${projectId}`);
      sseRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('📡 Video Call SSE connection established');
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 Video Call SSE message received:', data);
          
          // Refresh both images and inventory on updates
          fetchCapturedImages();
          
          if (data.success && data.itemsProcessed > 0) {
            toast.success(`🎯 AI Analysis Complete! Found ${data.itemsProcessed} items${data.totalBoxes > 0 ? ` (${data.totalBoxes} boxes recommended)` : ''}`);
            fetchInventoryItems();
          }
        } catch (error) {
          console.error('❌ Error parsing Video Call SSE message:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('❌ Video Call SSE connection error:', error);
      };

      return eventSource;
    };

    const eventSource = setupSSE();

    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        console.log('🔌 Video Call SSE connection closed');
      }
    };
  }, [projectId]);

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

      // STEP 1: Upload raw file to S3 for backup
      const s3FormData = new FormData();
      s3FormData.append('file', frameBlob, `video-capture-${currentRoom}-${Date.now()}.jpg`);
      s3FormData.append('projectId', projectId);
      s3FormData.append('fileIndex', '0');

      const s3Response = await fetch('/api/upload-to-s3', {
        method: 'POST',
        body: s3FormData,
      });

      if (!s3Response.ok) {
        console.warn('S3 upload failed, but continuing with analysis');
        // Continue even if S3 fails - we have the image in MongoDB
      }

      // STEP 2: Save image and queue for analysis using SQS
      const sqsResponse = await fetch('/api/projects/' + projectId + '/save-image-metadata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: `video-capture-${currentRoom}-${Date.now()}.jpg`,
          fileSize: frameBlob.size,
          fileType: 'image/jpeg',
          cloudinaryResult: null,
          userName: 'Video Call Agent',
          imageBuffer: await blobToBase64(frameBlob),
          s3RawFile: s3Response.ok ? (await s3Response.json()).s3Result : null
        }),
      });

      if (!sqsResponse.ok) {
        throw new Error('Failed to save and queue image for analysis');
      }

      const savedImageResult = await sqsResponse.json();
      console.log(`✅ Video capture saved and queued: ${savedImageResult.imageId}`);

      setCaptureCount(prev => prev + 1);
      toast.success(`📸 Frame captured from ${currentRoom}! Processing with AI...`);
      
      // Refresh captured images list immediately
      fetchCapturedImages();
      
      // The SSE connection will handle real-time updates when analysis completes

    } catch (error) {
      console.error('Screenshot error:', error);
      toast.error('❌ Failed to capture frame: ' + error.message);
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
                <div className={`px-4 py-2 rounded-2xl ${glassStyle} flex items-center gap-2 bg-blue-500/20 border-blue-400/50`}>
                  <Activity className="w-4 h-4 text-white" />
                  <span className="text-white text-sm font-bold">
                    MANUAL MODE
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
            {isInventoryActive && inventoryItems.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <div className={`px-3 py-2 rounded-2xl ${glassStyle} text-center`}>
                  <p className="text-white/70 text-xs">Items</p>
                  <p className="text-white font-bold">{inventoryItems.length}</p>
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
              {!showInventory && inventoryItems.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold animate-pulse shadow-lg">
                  {inventoryItems.length}
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
                capturedImages={capturedImages}
                imagesLoading={imagesLoading}
                projectId={projectId}
                fetchCapturedImages={fetchCapturedImages}
                onInventoryUpdate={handleInventoryUpdate}
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
    <div className="h-screen max-h-screen flex flex-col bg-gray-50 overflow-hidden">
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
            {/* AI Capture button */}
            <button
              onClick={takeScreenshot}
              disabled={isProcessing || !hasCustomer}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Target size={16} />
                  AI Capture
                </>
              )}
            </button>
            
            
            {/* Room selector */}
            {isInventoryActive && (
              <RoomSelector 
                currentRoom={currentRoom} 
                onChange={setCurrentRoom}
                isMobile={false}
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
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden">
        {/* Video Area with integrated controls */}
        <div className="flex-1 flex flex-col bg-gray-900">
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
            <div className="flex justify-center">
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
              capturedImages={capturedImages}
              imagesLoading={imagesLoading}
              projectId={projectId}
              fetchCapturedImages={fetchCapturedImages}
              onInventoryUpdate={handleInventoryUpdate}
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
const InventorySidebar = ({ items, loading, onRemoveItem, onSaveItems, onClose, capturedImages, imagesLoading, projectId, onInventoryUpdate }) => {
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
    <div className="h-screen max-h-screen flex flex-col bg-white">
      {/* Enhanced Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="p-4 md:p-6 border-b border-blue-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              {isMobile && (
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
              <div className="px-3 md:px-4 py-1 md:py-2 bg-blue-500 text-white rounded-xl md:rounded-2xl font-bold">
                {capturedImages.length}
              </div>
            </div>
            {!isMobile && (
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

      {/* Photo Stats */}
      <div className="bg-gray-50 p-4 md:p-6 border-b border-gray-200">
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <div className="bg-white rounded-xl md:rounded-2xl p-3 md:p-4 text-center shadow-lg border border-blue-100">
            <div className="w-10 md:w-12 h-10 md:h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl md:rounded-2xl flex items-center justify-center mx-auto mb-2 md:mb-3">
              <Camera className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <p className="text-xs md:text-sm font-medium text-gray-600 mb-1">Total Photos</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">{capturedImages.length}</p>
          </div>
          <div className="bg-white rounded-xl md:rounded-2xl p-3 md:p-4 text-center shadow-lg border border-green-100">
            <div className="w-10 md:w-12 h-10 md:h-12 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl md:rounded-2xl flex items-center justify-center mx-auto mb-2 md:mb-3">
              <CheckCircle className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <p className="text-xs md:text-sm font-medium text-gray-600 mb-1">Analyzed</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">
              {capturedImages.filter(img => img.analysisResult?.status === 'completed').length}
            </p>
          </div>
          <div className="bg-white rounded-xl md:rounded-2xl p-3 md:p-4 text-center shadow-lg border border-purple-100">
            <div className="w-10 md:w-12 h-10 md:h-12 bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl md:rounded-2xl flex items-center justify-center mx-auto mb-2 md:mb-3">
              <Loader2 className="w-5 h-5 md:w-6 md:h-6 text-white" />
            </div>
            <p className="text-xs md:text-sm font-medium text-gray-600 mb-1">Processing</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900">
              {capturedImages.filter(img => img.analysisResult?.status === 'processing' || !img.analysisResult?.status).length}
            </p>
          </div>
        </div>
      </div>

      {/* Inventory Items Section */}
      {items.length > 0 && (
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
                  {/* Create ToggleGoingBadge for each quantity */}
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
      )}

      {/* Photos Gallery - Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50">
        {imagesLoading ? (
          <div className="flex flex-col items-center justify-center h-full p-8">
            <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
            <p className="text-gray-600">Loading captured photos...</p>
          </div>
        ) : capturedImages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8">
            <div className="w-20 md:w-24 h-20 md:h-24 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-2xl md:rounded-3xl flex items-center justify-center mb-4 md:mb-6">
              <Camera size={40} className="text-blue-400 md:w-12 md:h-12" />
            </div>
            <h4 className="text-lg md:text-xl font-bold text-gray-900 mb-2 md:mb-3">No Photos Captured Yet</h4>
            <p className="text-sm md:text-base text-gray-600 text-center leading-relaxed max-w-sm">
              Use the 'AI Capture' button to take photos during the video call
            </p>
            <div className="mt-4 md:mt-6 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
          </div>
        ) : (
          <div className="p-3 md:p-4 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {capturedImages.map((image) => (
              <div key={image._id} className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
                {/* Image Preview */}
                <div className="relative aspect-video bg-gray-100">
                  <img
                    src={`/api/projects/${projectId}/images/${image._id}`}
                    alt={image.originalName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // If image fails to load, show a placeholder
                      e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiB2aWV3Qm94PSIwIDAgMjQgMjQiPjxwYXRoIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgc3Ryb2tlLXdpZHRoPSIyIiBkPSJtOSAxMiAyIDIgNC00bTYgMkE1IDUgMCAxIDEgOS43IDJhNS4xIDUuMSAwIDAgMSAyIDEwWiIvPjwvc3ZnPg==';
                      e.target.className = 'w-full h-full object-contain p-8 opacity-50';
                    }}
                  />
                  {/* Status Overlay */}
                  <div className="absolute top-2 right-2">
                    {image.analysisResult?.status === 'processing' ? (
                      <div className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-medium rounded-lg flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" />
                        Processing
                      </div>
                    ) : image.analysisResult?.status === 'completed' ? (
                      <div className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-lg flex items-center gap-1">
                        <CheckCircle size={12} />
                        Analyzed
                      </div>
                    ) : image.analysisResult?.status === 'failed' ? (
                      <div className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-lg flex items-center gap-1">
                        <AlertCircle size={12} />
                        Failed
                      </div>
                    ) : (
                      <div className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-lg flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" />
                        Analyzing
                      </div>
                    )}
                  </div>
                </div>

                {/* Image Details */}
                <div className="p-3 md:p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h5 className="font-medium text-gray-900 text-sm md:text-base truncate">
                      {image.originalName || image.name}
                    </h5>
                    <span className="text-xs text-gray-500 ml-2">
                      {new Date(image.createdAt).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Analysis Results */}
                  {image.analysisResult?.status === 'completed' && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {image.analysisResult.itemsCount > 0 && (
                        <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium bg-blue-100 text-blue-800">
                          <Package size={10} className="mr-1" />
                          {image.analysisResult.itemsCount} items
                        </span>
                      )}
                      {image.analysisResult.totalBoxes > 0 && (
                        <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium bg-green-100 text-green-800">
                          📦 {image.analysisResult.totalBoxes} boxes
                        </span>
                      )}
                    </div>
                  )}

                  {/* Summary */}
                  {image.analysisResult?.summary && (
                    <p className="text-xs text-gray-600 line-clamp-2">
                      {image.analysisResult.summary}
                    </p>
                  )}

                  {/* Inventory Items from this image */}
                  {(() => {
                    const imageInventoryItems = items.filter(item => {
                      const imageId = item.sourceImageId?._id || item.sourceImageId;
                      return imageId === image._id;
                    });
                    
                    if (imageInventoryItems.length > 0) {
                      return (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-gray-700 mb-1">Items from this photo:</p>
                          <div className="flex flex-wrap gap-1">
                            {imageInventoryItems.map((invItem) => {
                              const quantity = invItem.quantity || 1;
                              return Array.from({ length: quantity }, (_, index) => (
                                <ToggleGoingBadge 
                                  key={`${invItem._id}-${index}`}
                                  inventoryItem={invItem}
                                  quantityIndex={index}
                                  projectId={projectId}
                                  onInventoryUpdate={onInventoryUpdate}
                                  showItemName={true}
                                  className="text-xs"
                                />
                              ));
                            }).flat()}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                  
                  {/* File Size */}
                  <div className="mt-2 text-xs text-gray-500">
                    {(image.size / (1024 * 1024)).toFixed(1)}MB
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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
}) {
  const [token, setToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [isConnecting, setIsConnecting] = useState(true);
  // Removed detectedItems - now using real inventory data via Railway system
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
  // Items are now saved automatically via Railway system - no manual save needed

  const handleDisconnect = useCallback(() => {
    if (onCallEnd) {
      onCallEnd();
    }
  }, [onCallEnd]);

  // Enhanced LiveKit room options with mobile camera optimization and better permissions
  const roomOptions = {
    publishDefaults: {
      videoCodec: 'h264',
      videoResolution: {
        width: 1280,
        height: 720
      },
      videoSimulcast: false,
      frameRate: 30,
    },
    adaptiveStream: true,
    dynacast: true,
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
      frameRate: 30,
    },
    // Improve mobile permissions handling
    e2eeOptions: undefined, // Disable E2EE for better mobile compatibility
    expWebAudioMix: false, // Disable experimental features that might cause issues
  };
  
  // Pre-request camera permissions before LiveKit connection
  useEffect(() => {
    const requestPermissions = async () => {
      try {
        console.log('🎥 Requesting camera and microphone permissions...');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: {
            facingMode: roomOptions.videoCaptureDefaults.facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          }, 
          audio: true 
        });
        console.log('✅ Camera and microphone permissions granted');
        // Stop the test stream immediately
        stream.getTracks().forEach(track => track.stop());
      } catch (error) {
        console.error('❌ Failed to get media permissions:', error);
        toast.error('Camera/microphone access required for video calls');
      }
    };
    
    // Only request permissions once when component mounts
    if (token && serverUrl) {
      requestPermissions();
    }
  }, [token, serverUrl]);

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
        video={true}
        audio={true}
        token={token}
        serverUrl={serverUrl}
        onDisconnected={handleDisconnect}
        data-lk-theme="default"
        className="h-full"
        options={roomOptions}
        connect={true}
        onError={(error) => {
          console.error('LiveKit room error:', error.message || error);
          if (error.message && error.message.includes('camera')) {
            toast.error('Camera access denied. Please enable camera permissions.');
          } else if (error.message && error.message.includes('microphone')) {
            toast.error('Microphone access denied. Please enable microphone permissions.');
          } else {
            toast.error('Connection failed. Please check your internet connection.');
          }
        }}
        onConnected={() => {
          console.log('✅ Successfully connected to LiveKit room');
          toast.success('Connected to video call!');
        }}
        onMediaDeviceFailure={(failure) => {
          console.error('Media device failure:', failure);
          toast.error(`${failure.kind} device failed. Please check your permissions.`);
        }}
      >
        {/* Render different views based on participant type */}
        {isAgent(participantName) ? (
          <AgentView
            projectId={projectId}
            currentRoom={currentRoom}
            setCurrentRoom={setCurrentRoom}
          />
        ) : (
          <CustomerView onCallEnd={onCallEnd} />
        )}
      </LiveKitRoom>
    </div>
  );
}