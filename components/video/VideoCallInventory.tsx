// components/video/VideoCallInventory.tsx - Fixed with customer camera switching
'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  ControlBar,
  RoomAudioRenderer,
  useTracks,
  useRoomContext,
  useLocalParticipant,
  useRemoteParticipants,
} from '@livekit/components-react';
import { Track, Room, LocalVideoTrack, RemoteVideoTrack, RemoteParticipant } from 'livekit-client';
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
  CheckCircle,
  SwitchCamera,
  Users,
  CameraIcon,
  Home,
  MapPin,
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Play,
  Pause
} from 'lucide-react';
import { toast } from 'sonner';
import InventorySidebar from './InventorySidebar';
import FrameProcessor from './FrameProcessor';

interface VideoCallInventoryProps {
  projectId: string;
  roomId: string;
  participantName: string;
  onCallEnd?: () => void;
}

interface DetectedItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  location: string;
  cuft?: number;
  weight?: number;
  confidence?: number;
  detectedAt: string;
  frameId: string;
}

// Helper function to extract frame from remote video track
async function extractFrameFromRemoteTrack(track: RemoteVideoTrack): Promise<Blob | null> {
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
    
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    canvas.width = videoElement.videoWidth || 640;
    canvas.height = videoElement.videoHeight || 480;
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

    // Clean up
    videoElement.remove();

    return new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8);
    });
  } catch (error) {
    console.error('Error extracting frame from remote track:', error);
    return null;
  }
}

// Room selector component
function RoomSelector({ 
  currentRoom, 
  onChange, 
  isMobile 
}: { 
  currentRoom: string; 
  onChange: (room: string) => void;
  isMobile: boolean;
}) {
  const rooms = [
    'Living Room',
    'Bedroom',
    'Master Bedroom', 
    'Kitchen',
    'Dining Room',
    'Office',
    'Garage',
    'Basement',
    'Attic',
    'Bathroom',
    'Other'
  ];

  return (
    <select
      value={currentRoom}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
        isMobile ? 'text-sm' : 'text-sm'
      }`}
    >
      {rooms.map(room => (
        <option key={room} value={room}>{room}</option>
      ))}
    </select>
  );
}

// Helper function to check if participant is an agent
function isAgent(participantName: string): boolean {
  return participantName.toLowerCase().includes('agent');
}

// Enhanced camera switching hook with better iPhone support and stability
function useCameraSwitching() {
  const { localParticipant } = useLocalParticipant();
  const [currentFacingMode, setCurrentFacingMode] = useState<'user' | 'environment'>('environment'); // Start with back camera
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);

  // Get available cameras and detect current camera
  useEffect(() => {
    const getAvailableCameras = async () => {
      try {
        // Request permissions first
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop()); // Clean up test stream
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === 'videoinput');
        setAvailableCameras(cameras);
        console.log('📹 Available cameras:', cameras.length, cameras.map(c => c.label));
        
        // Detect current facing mode from active track
        setTimeout(() => {
          const videoTrack = localParticipant?.videoTrackPublications.values().next().value?.track;
          if (videoTrack instanceof LocalVideoTrack) {
            const settings = videoTrack.mediaStreamTrack?.getSettings();
            console.log('📹 Current camera settings:', settings);
            if (settings?.facingMode) {
              const detectedMode = settings.facingMode === 'user' ? 'user' : 'environment';
              setCurrentFacingMode(detectedMode);
              console.log('📹 Detected camera mode:', detectedMode);
            }
          }
        }, 1000);
      } catch (error) {
        console.error('Error getting available cameras:', error);
      }
    };

    if (localParticipant) {
      getAvailableCameras();
    }
  }, [localParticipant]);

  const switchCamera = useCallback(async () => {
    if (!localParticipant || isSwitching) {
      console.log('🚫 Cannot switch camera:', { 
        hasParticipant: !!localParticipant, 
        isSwitching
      });
      return;
    }

    setIsSwitching(true);
    
    try {
      console.log('🔄 Starting camera switch...');
      
      const targetFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
      console.log(`📹 Switching from ${currentFacingMode} to ${targetFacingMode}`);
      
      // iPhone-optimized approach: Use getUserMedia directly first
      let success = false;
      
      // Approach 1: Direct getUserMedia with facingMode (best for iPhone)
      if (!success) {
        try {
          console.log('📹 Trying direct getUserMedia approach for iPhone...');
          
          // Stop current camera gracefully
          await localParticipant.setCameraEnabled(false);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Try to get media with specific facing mode
          const constraints: MediaStreamConstraints = {
            video: {
              facingMode: targetFacingMode,
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 }
            }
          };
          
          console.log('📹 getUserMedia constraints:', constraints);
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          
          // Verify we got the right camera
          const videoTrack = stream.getVideoTracks()[0];
          const settings = videoTrack.getSettings();
          console.log('📹 New camera settings:', settings);
          
          // Stop the test stream and use LiveKit to publish
          stream.getTracks().forEach(track => track.stop());
          
          // Now enable camera through LiveKit with simpler constraints
          await localParticipant.setCameraEnabled(true, {
            facingMode: targetFacingMode,
            resolution: { width: 1280, height: 720 }
          });
          
          success = true;
          console.log('✅ Camera switched using direct getUserMedia approach');
        } catch (error) {
          console.log('❌ Direct getUserMedia approach failed:', error);
        }
      }

      // Approach 2: LiveKit native switching
      if (!success) {
        try {
          console.log('📹 Trying LiveKit native approach...');
          
          await localParticipant.setCameraEnabled(false);
          await new Promise(resolve => setTimeout(resolve, 800));
          
          await localParticipant.setCameraEnabled(true, {
            facingMode: targetFacingMode,
            resolution: { width: 1280, height: 720 }
          });
          
          success = true;
          console.log('✅ Camera switched using LiveKit native approach');
        } catch (error) {
          console.log('❌ LiveKit native approach failed:', error);
        }
      }

      // Approach 3: Device ID switching for multi-camera devices
      if (!success && availableCameras.length > 1) {
        try {
          console.log('📹 Trying device ID switching...');
          
          const currentTrack = localParticipant.videoTrackPublications.values().next().value?.track;
          const currentSettings = currentTrack?.mediaStreamTrack?.getSettings();
          const currentDeviceId = currentSettings?.deviceId;
          
          // Find a different camera
          const otherCamera = availableCameras.find(camera => 
            camera.deviceId !== currentDeviceId && 
            camera.deviceId !== '' &&
            camera.deviceId !== 'default'
          );
          
          if (otherCamera) {
            await localParticipant.setCameraEnabled(false);
            await new Promise(resolve => setTimeout(resolve, 500));
            
            await localParticipant.setCameraEnabled(true, {
              deviceId: otherCamera.deviceId,
              resolution: { width: 1280, height: 720 }
            });
            
            success = true;
            console.log('✅ Camera switched using device ID');
          }
        } catch (error) {
          console.log('❌ Device ID switching failed:', error);
        }
      }

      // Approach 4: Fallback with basic constraints
      if (!success) {
        try {
          console.log('📹 Trying fallback approach...');
          
          await localParticipant.setCameraEnabled(false);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          await localParticipant.setCameraEnabled(true, {
            facingMode: targetFacingMode
          });
          
          success = true;
          console.log('✅ Camera enabled with fallback approach');
        } catch (error) {
          console.log('❌ Fallback approach failed:', error);
        }
      }

      if (success) {
        setCurrentFacingMode(targetFacingMode);
        toast.success(`📹 Switched to ${targetFacingMode === 'user' ? 'front' : 'back'} camera`);
        
        // Verify the switch worked by checking settings after a delay
        setTimeout(async () => {
          try {
            const videoTrack = localParticipant.videoTrackPublications.values().next().value?.track;
            if (videoTrack instanceof LocalVideoTrack) {
              const settings = videoTrack.mediaStreamTrack?.getSettings();
              console.log('📹 Verified camera settings:', settings);
              
              if (settings?.facingMode && settings.facingMode !== targetFacingMode) {
                console.log('⚠️ Camera switch verification failed, actual mode:', settings.facingMode);
                setCurrentFacingMode(settings.facingMode === 'user' ? 'user' : 'environment');
              }
            }
          } catch (error) {
            console.log('Warning: Could not verify camera switch:', error);
          }
        }, 2000);
        
      } else {
        throw new Error('All camera switch attempts failed');
      }
      
    } catch (error) {
      console.error('❌ Error switching camera:', error);
      toast.error('Failed to switch camera. This may be a device limitation.');
      
      // Try to restore camera with original mode
      try {
        console.log('🔄 Attempting to restore camera...');
        await localParticipant.setCameraEnabled(true);
        console.log('✅ Camera restored');
      } catch (e) {
        console.error('❌ Failed to restore camera:', e);
        toast.error('Camera may need to be manually re-enabled');
      }
    } finally {
      setIsSwitching(false);
    }
  }, [localParticipant, isSwitching, currentFacingMode, availableCameras]);

  // Enhanced camera availability detection
  const canSwitchCamera = availableCameras.length > 1 || 
    (typeof navigator !== 'undefined' && 
     navigator.userAgent.includes('iPhone') && 
     availableCameras.length >= 1); // iPhone often has multiple cameras but may only enumerate one
  
  return {
    switchCamera,
    currentFacingMode,
    canSwitchCamera,
    isSwitching,
    availableCameras
  };
}

// Enhanced customer view with prominent camera switching - Memoized for stability
const CustomerView = React.memo(({ onCallEnd }: { onCallEnd?: () => void }) => {
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [showInstructions, setShowInstructions] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  
  // Camera switching for customers - THIS IS THE KEY FIX
  const { switchCamera, currentFacingMode, canSwitchCamera, isSwitching } = useCameraSwitching();
  
  // Auto-hide instructions after 15 seconds (longer for camera switch explanation)
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowInstructions(false);
    }, 15000); // 15 seconds

    return () => clearTimeout(timer);
  }, []);

  // Auto-hide controls after 5 seconds of inactivity, show on tap
  useEffect(() => {
    let hideTimer: NodeJS.Timeout;
    
    const resetHideTimer = () => {
      setShowControls(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        setShowControls(false);
      }, 5000);
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

  // Get tracks for video rendering with stability optimizations
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { 
      onlySubscribed: false
    }
  );

  const hasAgent = remoteParticipants.some(p => isAgent(p.identity));
  const agentName = remoteParticipants.find(p => isAgent(p.identity))?.identity || 'Moving Agent';

  const toggleMic = async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setMicrophoneEnabled(!micEnabled);
      setMicEnabled(!micEnabled);
    } catch (error) {
      console.error('Error toggling microphone:', error);
      toast.error('Failed to toggle microphone');
    }
  };

  const toggleCamera = async () => {
    if (!localParticipant) return;
    try {
      await localParticipant.setCameraEnabled(!cameraEnabled);
      setCameraEnabled(!cameraEnabled);
    } catch (error) {
      console.error('Error toggling camera:', error);
      toast.error('Failed to toggle camera');
    }
  };

  const endCall = () => {
    if (onCallEnd) {
      onCallEnd();
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-black flex flex-col relative overflow-hidden">
      {/* Video area - Stabilized with better track handling */}
      <div className="absolute inset-0">
        <div className="w-full h-full">
          <GridLayout 
            tracks={tracks}
            style={{ height: '100%', width: '100%' }}
          >
            <ParticipantTile 
              style={{ 
                borderRadius: '0px',
                overflow: 'hidden'
              }}
            />
          </GridLayout>
        </div>
      </div>

      {/* Top overlay with call info - Only show when controls are visible */}
      {showControls && (
        <div className="absolute top-safe-or-8 left-4 right-4 z-20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 bg-black/60 backdrop-blur-md rounded-2xl px-4 py-2">
              <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                <span className="text-xs font-bold text-white">
                  {agentName.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <p className="text-white font-medium text-sm">
                  {hasAgent ? agentName : 'Connecting...'}
                </p>
                <p className="text-white/80 text-xs">Moving Inventory</p>
              </div>
            </div>
            
            {/* Call status */}
            <div className="bg-black/60 backdrop-blur-md rounded-2xl px-3 py-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${hasAgent ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
                <span className="text-white text-xs font-medium">
                  {hasAgent ? 'LIVE' : 'Connecting...'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PROMINENT CAMERA SWITCH BUTTON - Always visible when available */}
      {canSwitchCamera && (
        <div className="absolute top-20 right-4 z-30">
          <button
            onClick={switchCamera}
            disabled={isSwitching}
            className="bg-black/70 backdrop-blur-md text-white p-5 rounded-2xl shadow-2xl disabled:opacity-50 transition-all border-2 border-white/30 hover:border-white/50"
            style={{ minWidth: '60px', minHeight: '60px' }}
          >
            {isSwitching ? (
              <Loader2 size={28} className="animate-spin" />
            ) : (
              <SwitchCamera size={28} />
            )}
          </button>
          
          {/* Camera mode indicator */}
          <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 bg-black/90 text-white text-xs px-3 py-1 rounded-full border border-white/30">
            {currentFacingMode === 'user' ? '🤳 Front' : '📱 Back'}
          </div>
        </div>
      )}

      {/* Center instruction banner - Enhanced with camera switching info */}
      {showInstructions && (
        <div className="absolute top-1/2 left-4 right-4 transform -translate-y-1/2 z-20">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 text-center border border-white/20 relative">
            {/* Close button */}
            <button
              onClick={() => setShowInstructions(false)}
              className="absolute top-3 right-3 text-white/70 hover:text-white bg-black/30 rounded-full p-1"
            >
              <X size={16} />
            </button>
            
            <div className="text-3xl mb-3">📱</div>
            <h2 className="text-white text-lg font-bold mb-2">Video Inventory Walk-Through</h2>
            <p className="text-white/90 text-sm leading-relaxed mb-4">
              Show your items to the camera as you walk through your home. 
              Your moving agent will identify and catalog everything.
            </p>
            
            {/* Camera switching instructions */}
            {canSwitchCamera && (
              <div className="bg-blue-500/20 rounded-lg p-4 mb-4 border border-blue-400/30">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <SwitchCamera size={20} className="text-blue-300" />
                  <span className="text-blue-100 font-medium">Camera Tip</span>
                </div>
                <p className="text-blue-100 text-sm">
                  Use the large switch button (top-right) to change between front and back cameras. 
                  <strong> Use the back camera</strong> to show your items clearly!
                </p>
              </div>
            )}
            
            {!hasAgent && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span className="text-white text-sm">Waiting for your moving agent...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Control bar at bottom - Show/hide with tap */}
      {showControls && (
        <div className="absolute bottom-safe-or-8 left-1/2 transform -translate-x-1/2 z-20">
          <div className="flex items-center gap-4 bg-black/60 backdrop-blur-md rounded-2xl px-6 py-3 border border-white/20">
            {/* Microphone */}
            <button 
              onClick={toggleMic}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
                micEnabled 
                  ? 'bg-white/20 text-white hover:bg-white/30' 
                  : 'bg-red-500 text-white hover:bg-red-600'
              }`}
            >
              {micEnabled ? <Mic size={20} /> : <MicOff size={20} />}
            </button>

            {/* End call */}
            <button 
              onClick={endCall}
              className="w-16 h-16 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white transition-all duration-200 shadow-lg"
            >
              <PhoneOff size={24} />
            </button>

            {/* Camera */}
            <button 
              onClick={toggleCamera}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
                cameraEnabled 
                  ? 'bg-white/20 text-white hover:bg-white/30' 
                  : 'bg-red-500 text-white hover:bg-red-600'
              }`}
            >
              {cameraEnabled ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
          </div>
        </div>
      )}

      {/* Additional floating camera switch button for easier access */}
      {canSwitchCamera && !showControls && (
        <div className="absolute bottom-20 right-4 z-20">
          <button
            onClick={switchCamera}
            disabled={isSwitching}
            className="bg-blue-500/80 backdrop-blur-md text-white p-4 rounded-full shadow-xl disabled:opacity-50 transition-all border border-white/30"
          >
            {isSwitching ? (
              <Loader2 size={24} className="animate-spin" />
            ) : (
              <SwitchCamera size={24} />
            )}
          </button>
          <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded-full whitespace-nowrap">
            {currentFacingMode === 'user' ? 'Front' : 'Back'}
          </div>
        </div>
      )}

      {/* Tap to show controls hint */}
      {!showControls && (
        <div className="absolute bottom-safe-or-4 left-1/2 transform -translate-x-1/2 z-10">
          <div className="bg-black/40 backdrop-blur-md text-white text-xs px-3 py-1 rounded-full">
            Tap screen to show controls
          </div>
        </div>
      )}

      <RoomAudioRenderer />
    </div>
  );
});

// Agent view component with better mobile sidebar management - Memoized for stability
const AgentView = React.memo(({ 
  projectId, 
  detectedItems, 
  setDetectedItems, 
  currentRoom,
  setCurrentRoom,
  handleSaveItems
}: {
  projectId: string;
  detectedItems: DetectedItem[];
  setDetectedItems: React.Dispatch<React.SetStateAction<DetectedItem[]>>;
  currentRoom: string;
  setCurrentRoom: React.Dispatch<React.SetStateAction<string>>;
  handleSaveItems: (items: DetectedItem[]) => Promise<void>;
}) => {
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [showInventory, setShowInventory] = useState(false);
  const [isInventoryActive, setIsInventoryActive] = useState(false);
  const [captureMode, setCaptureMode] = useState<'auto' | 'manual' | 'paused'>('paused');
  const [captureCount, setCaptureCount] = useState(0);
  
  const remoteParticipants = useRemoteParticipants();

  // Camera switching functionality for agents
  const { switchCamera, currentFacingMode, canSwitchCamera, isSwitching } = useCameraSwitching();

  // Get tracks for the video grid with stability optimizations  
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { 
      onlySubscribed: false
    }
  );

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      
      if (!mobile && !showInventory) {
        setShowInventory(true);
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [showInventory]);

  // Handle new detected items
  const handleItemsDetected = useCallback((items: any[]) => {
    const newItems: DetectedItem[] = items.map(item => ({
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
      toast.success(`Found ${newItems.length} new items`);
      
      if (isMobile && !showInventory) {
        toast.info(`${detectedItems.length + newItems.length} items detected. Tap to view inventory.`);
      }
    }
  }, [currentRoom, setDetectedItems, isMobile, showInventory, detectedItems.length]);

  // Inventory control functions
  const startInventory = () => {
    setIsInventoryActive(true);
    setCaptureMode('auto');
    toast.success('Inventory scanning started');
  };

  const pauseInventory = () => {
    setCaptureMode('paused');
    toast.info('Inventory scanning paused');
  };

  const resumeInventory = () => {
    setCaptureMode('auto');
    toast.success('Inventory scanning resumed');
  };

  const stopInventory = () => {
    setIsInventoryActive(false);
    setCaptureMode('paused');
    toast.info('Inventory scanning stopped');
  };

  const toggleSidebar = () => {
    setShowInventory(!showInventory);
    if (isMobile && showMobileMenu) {
      setShowMobileMenu(false);
    }
  };

  // Screenshot function
  const takeScreenshot = async () => {
    if (isProcessing) {
      toast.warning('Please wait for the previous screenshot to finish processing');
      return;
    }

    const customerTrack = remoteParticipants.find(participant => 
      !isAgent(participant.identity) && participant.videoTrackPublications.size > 0
    )?.videoTrackPublications.values().next().value?.track;

    if (!customerTrack || !(customerTrack instanceof RemoteVideoTrack)) {
      toast.error('No customer video feed available for screenshot');
      return;
    }

    setIsProcessing(true);
    
    try {
      console.log('📸 Taking screenshot of customer video...');
      
      const frameBlob = await extractFrameFromRemoteTrack(customerTrack);
      
      if (!frameBlob) {
        throw new Error('Failed to capture video frame');
      }

      console.log('🖼️ Frame captured, analyzing...');

      const formData = new FormData();
      formData.append('image', frameBlob, `screenshot-${Date.now()}.jpg`);
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
        throw new Error('Failed to analyze screenshot');
      }

      const result = await response.json();
      console.log('✅ Analysis result:', result);
      
      if (result.items && result.items.length > 0) {
        const newItems: DetectedItem[] = result.items.map((item: any) => ({
          ...item,
          id: `${Date.now()}-${Math.random()}`,
          location: currentRoom,
          detectedAt: new Date().toISOString(),
          frameId: `screenshot-${Date.now()}`,
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

        setScreenshotCount(prev => prev + 1);
        
        if (newItems.length > 0) {
          toast.success(`📸 Found ${newItems.length} new items!`);
        } else {
          toast.info('📸 Screenshot captured! No new items detected');
        }
      } else {
        setScreenshotCount(prev => prev + 1);
        toast.info('📸 Screenshot captured! No items detected');
      }

    } catch (error) {
      console.error('Error taking screenshot:', error);
      toast.error('Failed to take screenshot');
    } finally {
      setIsProcessing(false);
    }
  };

  const hasCustomer = remoteParticipants.some(p => !isAgent(p.identity));
  const customerName = remoteParticipants.find(p => !isAgent(p.identity))?.identity || 'Customer';

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header - Mobile Optimized */}
      <div className="bg-white shadow-sm">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg md:text-xl font-semibold text-gray-900">
                Virtual Inventory
              </h2>
              {isInventoryActive && (
                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                  Active
                </span>
              )}
              {/* Mobile: Show item count if sidebar is hidden */}
              {isMobile && !showInventory && detectedItems.length > 0 && (
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                  {detectedItems.length} items
                </span>
              )}
            </div>
            
            {/* Mobile menu button */}
            {isMobile && (
              <div className="flex items-center gap-2">
                {/* Quick sidebar toggle for mobile */}
                <button
                  onClick={toggleSidebar}
                  className="p-2 hover:bg-gray-100 rounded-lg relative"
                  title={showInventory ? 'Hide inventory' : 'Show inventory'}
                >
                  {showInventory ? <EyeOff size={20} /> : <Eye size={20} />}
                  {!showInventory && detectedItems.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                      {detectedItems.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setShowMobileMenu(!showMobileMenu)}
                  className="text-black p-2 hover:bg-gray-100 rounded-lg"
                >
                  {showMobileMenu ? <X size={20} /> : <Menu size={20} />}
                </button>
              </div>
            )}

            {/* Desktop controls */}
            {!isMobile && (
              <div className="flex items-center gap-2">
                {/* Camera switch button for desktop */}
                {canSwitchCamera && (
                  <button
                    onClick={switchCamera}
                    disabled={isSwitching}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                    title={`Switch to ${currentFacingMode === 'user' ? 'back' : 'front'} camera`}
                  >
                    {isSwitching ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <SwitchCamera size={16} />
                    )}
                    <span className="hidden sm:inline">
                      {currentFacingMode === 'user' ? 'Back' : 'Front'}
                    </span>
                  </button>
                )}

                {!isInventoryActive ? (
                  <button
                    onClick={startInventory}
                    className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
                  >
                    <Play size={16} />
                    Start Inventory
                  </button>
                ) : (
                  <>
                    {captureMode === 'paused' ? (
                      <button
                        onClick={resumeInventory}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
                      >
                        <Play size={16} />
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={pauseInventory}
                        className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
                      >
                        <Pause size={16} />
                        Pause
                      </button>
                    )}
                    <button
                      onClick={stopInventory}
                      className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
                    >
                      <X size={16} />
                      Stop
                    </button>
                  </>
                )}
                
                <button
                  onClick={takeScreenshot}
                  disabled={isProcessing || !hasCustomer}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CameraIcon size={16} />
                      Screenshot
                    </>
                  )}
                </button>
                
                <button
                  onClick={toggleSidebar}
                  className="p-2 hover:bg-gray-100 rounded-lg relative"
                  title={showInventory ? 'Hide inventory' : 'Show inventory'}
                >
                  {showInventory ? <EyeOff size={20} /> : <Eye size={20} />}
                  {!showInventory && detectedItems.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                      {detectedItems.length}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Mobile menu */}
          {isMobile && showMobileMenu && (
            <div className="border-t pt-3 space-y-2">
              {/* Camera switch button for mobile */}
              {canSwitchCamera && (
                <button
                  onClick={() => {
                    switchCamera();
                    setShowMobileMenu(false);
                  }}
                  disabled={isSwitching}
                  className="w-full px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSwitching ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <SwitchCamera size={16} />
                  )}
                  Switch to {currentFacingMode === 'user' ? 'Back' : 'Front'} Camera
                </button>
              )}

              {!isInventoryActive ? (
                <button
                  onClick={() => {
                    startInventory();
                    setShowMobileMenu(false);
                  }}
                  className="w-full px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                >
                  <Play size={16} />
                  Start Inventory Scan
                </button>
              ) : (
                <div className="space-y-2">
                  {captureMode === 'paused' ? (
                    <button
                      onClick={() => {
                        resumeInventory();
                        setShowMobileMenu(false);
                      }}
                      className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                    >
                      <Play size={16} />
                      Resume Scanning
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        pauseInventory();
                        setShowMobileMenu(false);
                      }}
                      className="w-full px-4 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                    >
                      <Pause size={16} />
                      Pause Scanning
                    </button>
                  )}
                  <button
                    onClick={() => {
                      stopInventory();
                      setShowMobileMenu(false);
                    }}
                    className="w-full px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                  >
                    <X size={16} />
                    Stop Inventory
                  </button>
                </div>
              )}
              
              <button
                onClick={() => {
                  takeScreenshot();
                  setShowMobileMenu(false);
                }}
                disabled={isProcessing || !hasCustomer}
                className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg font-medium flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CameraIcon size={16} />
                    Take Screenshot
                  </>
                )}
              </button>
              
              {/* View items button */}
              {detectedItems.length > 0 && (
                <button
                  onClick={() => {
                    toggleSidebar();
                    setShowMobileMenu(false);
                  }}
                  className="w-full px-4 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                >
                  <Package size={16} />
                  {showInventory ? 'Hide' : 'View'} Items ({detectedItems.length})
                </button>
              )}
            </div>
          )}

          {/* Room selector and stats */}
          {isInventoryActive && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Room
                </label>
                <RoomSelector 
                  currentRoom={currentRoom} 
                  onChange={setCurrentRoom}
                  isMobile={isMobile}
                />
              </div>
              
              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Camera className="text-gray-400" size={16} />
                  <span className="text-gray-600">Captures: <strong>{captureCount}</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <Package className="text-gray-400" size={16} />
                  <span className="text-gray-600">Items: <strong>{detectedItems.length}</strong></span>
                </div>
                {canSwitchCamera && (
                  <div className="flex items-center gap-2">
                    <SwitchCamera className="text-gray-400" size={16} />
                    <span className="text-gray-600">
                      <strong>{currentFacingMode === 'user' ? 'Front' : 'Back'}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Video Grid and Controls */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <div className="flex-1 flex flex-col">
          {/* Video Grid - Stabilized with better error boundaries */}
          <div className="flex-1 relative bg-gray-900 rounded-lg m-2 md:m-4 overflow-hidden">
            <div className="w-full h-full">
              <GridLayout 
                tracks={tracks}
                style={{ 
                  height: '100%', 
                  width: '100%',
                  backgroundColor: '#1f2937'
                }}
              >
                <ParticipantTile 
                  style={{ 
                    borderRadius: '8px',
                    overflow: 'hidden',
                    backgroundColor: '#374151'
                  }}
                />
              </GridLayout>
            </div>
            
            {/* Status Indicators */}
            {isInventoryActive && (
              <div className="absolute top-4 left-4 right-4 flex flex-wrap gap-2">
                {isProcessing && (
                  <div className="bg-yellow-500 text-white px-3 py-2 rounded-full flex items-center gap-2 shadow-lg text-sm">
                    <Loader2 size={14} className="animate-spin" />
                    Analyzing...
                  </div>
                )}

                {captureMode === 'auto' && !isProcessing && (
                  <div className="bg-green-500 text-white px-3 py-2 rounded-full flex items-center gap-2 shadow-lg text-sm">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    Scanning
                  </div>
                )}

                {captureMode === 'paused' && (
                  <div className="bg-gray-700 text-white px-3 py-2 rounded-full flex items-center gap-2 shadow-lg text-sm">
                    <Pause size={14} />
                    Paused
                  </div>
                )}

                {/* Camera indicator */}
                <div className="bg-blue-500 text-white px-3 py-2 rounded-full flex items-center gap-2 shadow-lg text-sm">
                  <Camera size={14} />
                  {currentFacingMode === 'user' ? 'Front' : 'Back'} Camera
                </div>
              </div>
            )}

            {/* Mobile inventory toggle floating button - Enhanced */}
            {isMobile && !showMobileMenu && (
              <div className="absolute bottom-4 right-4 flex flex-col gap-2">
                {/* Camera switch button */}
                {canSwitchCamera && (
                  <button
                    onClick={switchCamera}
                    disabled={isSwitching}
                    className="bg-black bg-opacity-50 text-white p-3 rounded-full shadow-lg disabled:opacity-50 transition-all"
                    title={`Switch to ${currentFacingMode === 'user' ? 'back' : 'front'} camera`}
                  >
                    {isSwitching ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <SwitchCamera size={20} />
                    )}
                  </button>
                )}

                {/* Inventory toggle button */}
                <button
                  onClick={toggleSidebar}
                  className="bg-blue-500 text-white p-3 rounded-full shadow-lg relative transition-all"
                  title={showInventory ? 'Hide inventory' : 'Show inventory'}
                >
                  {showInventory ? <EyeOff size={20} /> : <Package size={20} />}
                  {!showInventory && detectedItems.length > 0 && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold">
                      {detectedItems.length}
                    </span>
                  )}
                </button>

                {/* Quick screenshot button */}
                {!showInventory && hasCustomer && (
                  <button
                    onClick={takeScreenshot}
                    disabled={isProcessing}
                    className="bg-green-500 text-white p-3 rounded-full shadow-lg disabled:opacity-50 transition-all"
                    title="Take screenshot"
                  >
                    {isProcessing ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : (
                      <CameraIcon size={20} />
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Customer connection status */}
            {!hasCustomer && (
              <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                <div className="bg-white p-6 rounded-lg text-center max-w-md">
                  <Users size={48} className="mx-auto mb-4 text-gray-400" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Waiting for Customer</h3>
                  <p className="text-gray-600">Share the video call link with your customer to start the inventory session.</p>
                </div>
              </div>
            )}
          </div>

          {/* Control Bar */}
          <div className="p-2 md:p-4">
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

        {/* Frame Processor Component - only when auto mode is active */}
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

        {/* Inventory Sidebar - Enhanced Mobile Support */}
        {showInventory && (
          <div className={`${
            isMobile 
              ? 'fixed inset-0 z-50 bg-white' 
              : 'w-96 border-l bg-white flex-shrink-0'
          }`}>
            {/* Mobile overlay backdrop */}
            {isMobile && (
              <div 
                className="absolute inset-0 bg-black bg-opacity-50 z-40"
                onClick={() => setShowInventory(false)}
              />
            )}
            
            {/* Sidebar content */}
            <div className={`${
              isMobile 
                ? 'absolute right-0 top-0 bottom-0 w-80 bg-white z-50 transform transition-transform duration-300 ease-in-out' 
                : 'w-full h-full'
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

      {/* Audio Renderer */}
      <RoomAudioRenderer />
    </div>
  );
});

// Main VideoCallInventory component
export default function VideoCallInventory({
  projectId,
  roomId,
  participantName,
  onCallEnd,
}: VideoCallInventoryProps) {
  const [token, setToken] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(true);
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([]);
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
  const handleSaveItems = async (items: DetectedItem[]) => {
    if (!items || items.length === 0) {
      toast.error('No items to save');
      return;
    }

    try {
      console.log('🔄 Saving video inventory items:', items);

      const inventoryItems = items.map(item => ({
        name: item.name,
        description: `Detected via video inventory in ${item.location}`,
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
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inventoryItems),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save items to inventory');
      }

      toast.success(`Successfully saved ${items.length} items to inventory!`);
      setDetectedItems([]);

    } catch (error) {
      console.error('❌ Error saving video inventory items:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save items to inventory');
    }
  };

  const handleDisconnect = useCallback(() => {
    if (onCallEnd) {
      onCallEnd();
    }
  }, [onCallEnd]);

  // Enhanced LiveKit room options for better stability
  const roomOptions = {
    publishDefaults: {
      videoCodec: 'h264' as const,
      videoResolution: {
        width: 1280,
        height: 720
      },
      videoSimulcast: false,
    },
    adaptiveStream: false,
    dynacast: false,
    autoSubscribe: true,
    disconnectOnPageLeave: true,
    reconnectPolicy: {
      nextRetryDelayInMs: (context: any) => Math.min((context.retryCount || 0) * 2000, 10000)
    }
  };

  if (isConnecting) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-500" />
          <p className="text-gray-600">Connecting to video call...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Connection Failed</h3>
          <p className="text-gray-600 mb-4">Unable to connect to the video call. Please check your connection and try again.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium transition-colors"
          >
            <RotateCcw className="inline-block w-4 h-4 mr-2" />
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
          toast.error('Video call error occurred');
        }}
        onConnected={() => {
          console.log('✅ Connected to LiveKit room');
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