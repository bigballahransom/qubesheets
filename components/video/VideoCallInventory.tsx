// components/video/VideoCallInventory.tsx - Fixed version
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

// Updated camera switching hook with better mobile support
function useCameraSwitching() {
  const { localParticipant } = useLocalParticipant();
  const [currentFacingMode, setCurrentFacingMode] = useState<'user' | 'environment'>('environment'); // Start with back camera for customers
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);

  // Get available cameras
  useEffect(() => {
    const getAvailableCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === 'videoinput');
        setAvailableCameras(cameras);
        console.log('Available cameras:', cameras.length);
        
        // Detect current facing mode if we have a video track
        const videoTrack = localParticipant?.videoTrackPublications.values().next().value?.track;
        if (videoTrack instanceof LocalVideoTrack) {
          const settings = videoTrack.mediaStreamTrack?.getSettings();
          if (settings?.facingMode) {
            setCurrentFacingMode(settings.facingMode === 'user' ? 'user' : 'environment');
          }
        }
      } catch (error) {
        console.error('Error getting available cameras:', error);
      }
    };

    getAvailableCameras();
  }, [localParticipant]);

  const switchCamera = useCallback(async () => {
    if (!localParticipant || isSwitching || availableCameras.length < 2) {
      console.log('Cannot switch camera:', { 
        hasParticipant: !!localParticipant, 
        isSwitching, 
        cameraCount: availableCameras.length 
      });
      return;
    }

    setIsSwitching(true);
    
    try {
      // Determine target facing mode
      const targetFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
      console.log('Switching camera from', currentFacingMode, 'to', targetFacingMode);
      
      // Stop current camera
      await localParticipant.setCameraEnabled(false);
      
      // Wait a bit for the camera to fully stop
      await new Promise(resolve => setTimeout(resolve, 500));

      // Start camera with new facing mode
      const videoCaptureOptions = {
        facingMode: targetFacingMode as 'user' | 'environment',
        resolution: {
          width: 1280,
          height: 720
        }
      };

      await localParticipant.setCameraEnabled(true, videoCaptureOptions);
      setCurrentFacingMode(targetFacingMode);
      
      toast.success(`Switched to ${targetFacingMode === 'user' ? 'front' : 'back'} camera`);
      
    } catch (error) {
      console.error('Error switching camera:', error);
      toast.error('Failed to switch camera. Please try again.');
      
      // Try to re-enable the camera if switching failed
      try {
        await localParticipant.setCameraEnabled(true);
      } catch (e) {
        console.error('Failed to re-enable camera:', e);
      }
    } finally {
      setIsSwitching(false);
    }
  }, [localParticipant, isSwitching, availableCameras.length, currentFacingMode]);

  const hasMultipleCameras = availableCameras.length > 1;
  
  return {
    switchCamera,
    currentFacingMode,
    hasMultipleCameras,
    isSwitching,
    availableCameras
  };
}

// Updated customer view with camera switching and auto-hiding modal
function CustomerView({ onCallEnd }: { onCallEnd?: () => void }) {
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [showInstructions, setShowInstructions] = useState(true);
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  
  // Camera switching for customers
  const { switchCamera, currentFacingMode, hasMultipleCameras, isSwitching } = useCameraSwitching();
  
  // Auto-hide instructions after 10 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowInstructions(false);
    }, 10000); // 10 seconds

    return () => clearTimeout(timer);
  }, []);

  // Get tracks for video rendering with more specific filtering to prevent glitches
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
      {/* Video area - Stabilized grid layout */}
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

      {/* Top overlay with call info */}
      <div className="absolute top-safe-or-8 left-4 right-4 z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md rounded-2xl px-6 py-3">
            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
              <span className="text-sm font-bold text-white">
                {agentName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-white font-semibold text-base">
                {hasAgent ? agentName : 'Connecting...'}
              </p>
              <p className="text-white/80 text-sm">Moving Inventory Session</p>
            </div>
          </div>
          
          {/* Call duration / status */}
          <div className="bg-black/40 backdrop-blur-md rounded-2xl px-4 py-2">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${hasAgent ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
              <span className="text-white text-sm font-medium">
                {hasAgent ? 'LIVE' : 'Connecting...'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Camera switch button for customers */}
      {hasMultipleCameras && (
        <div className="absolute top-safe-or-24 right-4 z-20">
          <button
            onClick={switchCamera}
            disabled={isSwitching}
            className="bg-black/40 backdrop-blur-md text-white p-3 rounded-2xl shadow-lg disabled:opacity-50 transition-all"
            title={`Switch to ${currentFacingMode === 'user' ? 'back' : 'front'} camera`}
          >
            {isSwitching ? (
              <Loader2 size={24} className="animate-spin" />
            ) : (
              <SwitchCamera size={24} />
            )}
          </button>
        </div>
      )}

      {/* Center instruction banner - Auto-hiding */}
      {showInstructions && (
        <div className="absolute top-1/2 left-4 right-4 transform -translate-y-1/2 z-20">
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 text-center border border-white/20 relative">
            {/* Close button */}
            <button
              onClick={() => setShowInstructions(false)}
              className="absolute top-4 right-4 text-white/70 hover:text-white"
            >
              <X size={20} />
            </button>
            
            <div className="text-4xl mb-4">📱</div>
            <h2 className="text-white text-xl font-bold mb-2">Video Inventory Walk-Through</h2>
            <p className="text-white/90 text-base leading-relaxed mb-4">
              Show your items to the camera as you walk through your home. 
              Your moving agent will identify and catalog everything for your inventory.
            </p>
            {hasMultipleCameras && (
              <p className="text-white/80 text-sm">
                💡 Tip: Use the camera switch button to switch between front and back cameras
              </p>
            )}
            {!hasAgent && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-white" />
                <span className="text-white">Waiting for your moving agent...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Control bar at bottom */}
      <div className="absolute bottom-safe-or-8 left-1/2 transform -translate-x-1/2 z-20">
        <div className="flex items-center gap-6 bg-black/50 backdrop-blur-md rounded-2xl px-8 py-4">
          {/* Microphone */}
          <button 
            onClick={toggleMic}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 ${
              micEnabled 
                ? 'bg-white/20 text-white hover:bg-white/30' 
                : 'bg-red-500 text-white hover:bg-red-600'
            }`}
          >
            {micEnabled ? <Mic size={28} /> : <MicOff size={28} />}
          </button>

          {/* End call */}
          <button 
            onClick={endCall}
            className="w-20 h-20 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white transition-all duration-200 shadow-lg"
          >
            <PhoneOff size={32} />
          </button>

          {/* Camera */}
          <button 
            onClick={toggleCamera}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 ${
              cameraEnabled 
                ? 'bg-white/20 text-white hover:bg-white/30' 
                : 'bg-red-500 text-white hover:bg-red-600'
            }`}
          >
            {cameraEnabled ? <Video size={28} /> : <VideoOff size={28} />}
          </button>
        </div>
      </div>

      {/* Self-view pip in corner - only show if camera is enabled */}
      {cameraEnabled && (
        <div className="absolute bottom-40 right-6 w-32 h-40 bg-black/60 rounded-2xl overflow-hidden border-2 border-white/30 z-20">
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-2">
                <span className="text-white font-bold text-xs">You</span>
              </div>
              <p className="text-white/80 text-xs">
                {currentFacingMode === 'user' ? 'Front' : 'Back'} Camera
              </p>
            </div>
          </div>
        </div>
      )}

      <RoomAudioRenderer />
    </div>
  );
}

// Agent view component with stabilized video rendering
function AgentView({ 
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
}) {
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
  const { switchCamera, currentFacingMode, hasMultipleCameras, isSwitching } = useCameraSwitching();

  // Get tracks for the video grid with stable rendering
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
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Show sidebar by default on desktop
  useEffect(() => {
    if (!isMobile) {
      setShowInventory(true);
    }
  }, [isMobile]);

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
    }
  }, [currentRoom, setDetectedItems]);

  // Start inventory scanning
  const startInventory = () => {
    setIsInventoryActive(true);
    setCaptureMode('auto');
    toast.success('Inventory scanning started');
  };

  // Pause inventory scanning
  const pauseInventory = () => {
    setCaptureMode('paused');
    toast.info('Inventory scanning paused');
  };

  // Resume inventory scanning
  const resumeInventory = () => {
    setCaptureMode('auto');
    toast.success('Inventory scanning resumed');
  };

  // Stop inventory scanning
  const stopInventory = () => {
    setIsInventoryActive(false);
    setCaptureMode('paused');
    toast.info('Inventory scanning stopped');
  };

  // Function to take screenshot of customer's video
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
            </div>
            
            {/* Mobile menu button */}
            {isMobile && (
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="text-black p-2 hover:bg-gray-100 rounded-lg"
              >
                {showMobileMenu ? <X size={20} /> : <Menu size={20} />}
              </button>
            )}

            {/* Desktop controls */}
            {!isMobile && (
              <div className="flex items-center gap-2">
                {/* Camera switch button for desktop */}
                {hasMultipleCameras && (
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
                  onClick={() => setShowInventory(!showInventory)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  {showInventory ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            )}
          </div>

          {/* Mobile menu */}
          {isMobile && showMobileMenu && (
            <div className="border-t pt-3 space-y-2">
              {/* Camera switch button for mobile */}
              {hasMultipleCameras && (
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
                    setShowInventory(true);
                    setShowMobileMenu(false);
                  }}
                  className="w-full px-4 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                >
                  <Package size={16} />
                  View Items ({detectedItems.length})
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
                {hasMultipleCameras && (
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
          {/* Video Grid - Stabilized rendering */}
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

            {/* Mobile camera switch floating button */}
            {isMobile && hasMultipleCameras && !showMobileMenu && (
              <button
                onClick={switchCamera}
                disabled={isSwitching}
                className="absolute top-4 right-4 bg-black bg-opacity-50 text-white p-3 rounded-full shadow-lg disabled:opacity-50"
                title={`Switch to ${currentFacingMode === 'user' ? 'back' : 'front'} camera`}
              >
                {isSwitching ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <SwitchCamera size={20} />
                )}
              </button>
            )}

            {/* Mobile inventory button */}
            {isMobile && !showInventory && detectedItems.length > 0 && (
              <button
                onClick={() => setShowInventory(true)}
                className="absolute bottom-4 right-4 bg-blue-500 text-white p-3 rounded-full shadow-lg"
              >
                <Package size={20} />
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center">
                  {detectedItems.length}
                </span>
              </button>
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

        {/* Inventory Sidebar - Responsive */}
        {showInventory && (
          <div className={`${
            isMobile 
              ? 'fixed inset-0 z-50 bg-white' 
              : 'w-96 border-l bg-white'
          }`}>
            <InventorySidebar
              items={detectedItems}
              onRemoveItem={(id) => setDetectedItems(prev => prev.filter(item => item.id !== id))}
              onSaveItems={() => handleSaveItems(detectedItems)}
              onClose={() => setShowInventory(false)}
            />
          </div>
        )}
      </div>

      {/* Audio Renderer */}
      <RoomAudioRenderer />
    </div>
  );
}

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
      videoSimulcast: false, // Disable simulcast to reduce complexity
    },
    adaptiveStream: false, // Disable adaptive streaming to prevent glitches
    dynacast: false, // Disable dynacast for stability
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