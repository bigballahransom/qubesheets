// components/video/VideoCallInventory.tsx
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
} from '@livekit/components-react';
import { Track, Room, LocalVideoTrack } from 'livekit-client';
import '@livekit/components-styles';
import { 
  Camera, 
  Package, 
  Eye, 
  EyeOff, 
  Loader2, 
  Play,
  Pause,
  RotateCcw,
  Menu,
  X,
  Home,
  CheckCircle,
  SwitchCamera,
  FlipHorizontal
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

// Camera switching hook
function useCameraSwitching() {
  const { localParticipant } = useLocalParticipant();
  const [currentFacingMode, setCurrentFacingMode] = useState<'user' | 'environment'>('user');
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);

  // Get available cameras
  useEffect(() => {
    const getAvailableCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === 'videoinput');
        setAvailableCameras(cameras);
        
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

  const switchCamera = async () => {
    if (!localParticipant || isSwitching || availableCameras.length < 2) return;

    setIsSwitching(true);
    
    try {
      // Get current video track
      const currentVideoPublication = localParticipant.videoTrackPublications.values().next().value;
      
      if (!currentVideoPublication?.track) {
        console.error('No current video track found');
        return;
      }

      // Determine target facing mode
      const targetFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
      
      // Create LiveKit-compatible video capture options
      const videoCaptureOptions = {
        facingMode: targetFacingMode as 'user' | 'environment',
        resolution: {
          width: 1280,
          height: 720
        }
      };

      // Try to find a specific camera device if we have multiple cameras
      if (availableCameras.length > 1) {
        const currentTrack = currentVideoPublication.track as LocalVideoTrack;
        const currentDeviceId = currentTrack.mediaStreamTrack?.getSettings().deviceId;
        
        // Find a different camera
        const otherCamera = availableCameras.find(camera => 
          camera.deviceId !== currentDeviceId && camera.deviceId !== ''
        );
        
        if (otherCamera) {
          // Use device ID instead of facing mode for more reliable switching
          const deviceOptions = {
            deviceId: otherCamera.deviceId,
            resolution: {
              width: 1280,
              height: 720
            }
          };
          
          // Disable current camera and enable with new device
          await localParticipant.setCameraEnabled(false);
          await new Promise(resolve => setTimeout(resolve, 200));
          await localParticipant.setCameraEnabled(true, deviceOptions);
        } else {
          // Fallback to facing mode
          await localParticipant.setCameraEnabled(false);
          await new Promise(resolve => setTimeout(resolve, 200));
          await localParticipant.setCameraEnabled(true, videoCaptureOptions);
        }
      } else {
        // Single camera switching by facing mode
        await localParticipant.setCameraEnabled(false);
        await new Promise(resolve => setTimeout(resolve, 200));
        await localParticipant.setCameraEnabled(true, videoCaptureOptions);
      }

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
  };

  const hasMultipleCameras = availableCameras.length > 1;
  
  return {
    switchCamera,
    currentFacingMode,
    hasMultipleCameras,
    isSwitching,
    availableCameras
  };
}

// Mobile-friendly room selector component
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

  if (isMobile) {
    return (
      <select
        value={currentRoom}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
      >
        {rooms.map(room => (
          <option key={room} value={room}>{room}</option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {rooms.map(room => (
        <button
          key={room}
          onClick={() => onChange(room)}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            currentRoom === room
              ? 'bg-green-500 text-white shadow-md'
              : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          {room}
        </button>
      ))}
    </div>
  );
}

// Create a separate component for the room content
function RoomContent({ 
  projectId, 
  detectedItems, 
  setDetectedItems, 
  showInventory, 
  setShowInventory,
  currentRoom,
  setCurrentRoom,
  isProcessing,
  setIsProcessing,
  captureCount,
  setCaptureCount,
  handleSaveItems
}: {
  projectId: string;
  detectedItems: DetectedItem[];
  setDetectedItems: React.Dispatch<React.SetStateAction<DetectedItem[]>>;
  showInventory: boolean;
  setShowInventory: React.Dispatch<React.SetStateAction<boolean>>;
  currentRoom: string;
  setCurrentRoom: React.Dispatch<React.SetStateAction<string>>;
  isProcessing: boolean;
  setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  captureCount: number;
  setCaptureCount: React.Dispatch<React.SetStateAction<number>>;
  handleSaveItems: (items: DetectedItem[]) => Promise<void>;
}) {
  const [isInventoryActive, setIsInventoryActive] = useState(false);
  const [captureMode, setCaptureMode] = useState<'auto' | 'manual' | 'paused'>('paused');
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const room = useRoomContext();
  
  // Camera switching functionality
  const { switchCamera, currentFacingMode, hasMultipleCameras, isSwitching } = useCameraSwitching();

  // Get tracks for the video grid
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
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
                  setShowInventory(!showInventory);
                  setShowMobileMenu(false);
                }}
                className="w-full px-4 py-3 bg-gray-300 hover:bg-gray-200 rounded-lg font-medium flex items-center justify-center gap-2 text-blue-600"
              >
                {showInventory ? <EyeOff size={16} /> : <Eye size={16} />}
                {showInventory ? 'Hide' : 'Show'} Items ({detectedItems.length})
              </button>
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
          {/* Video Grid */}
          <div className="flex-1 relative bg-gray-900 rounded-lg m-2 md:m-4 overflow-hidden">
            <GridLayout tracks={tracks}>
              <ParticipantTile />
            </GridLayout>
            
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

        {/* Frame Processor Component */}
        {isInventoryActive && (
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
  const [showInventory, setShowInventory] = useState(false);
  const [currentRoom, setCurrentRoom] = useState('Living Room');
  const [isProcessing, setIsProcessing] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);

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
    try {
      const response = await fetch(`/api/projects/${projectId}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      });

      if (!response.ok) {
        throw new Error('Failed to save items');
      }

      toast.success(`Saved ${items.length} items to inventory`);
      setDetectedItems([]);
    } catch (error) {
      console.error('Error saving items:', error);
      toast.error('Failed to save items');
    }
  };

  // Handle room disconnection
  const handleDisconnect = useCallback(() => {
    if (onCallEnd) {
      onCallEnd();
    }
  }, [onCallEnd]);

  if (isConnecting) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-green-500" />
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
            className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium transition-colors"
          >
            <RotateCcw className="inline-block w-4 h-4 mr-2" />
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-50">
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={serverUrl}
        onDisconnected={handleDisconnect}
        data-lk-theme="default"
        className="h-full"
        options={{
          publishDefaults: {
            videoCodec: 'h264',
          }
        }}
      >
        <RoomContent
          projectId={projectId}
          detectedItems={detectedItems}
          setDetectedItems={setDetectedItems}
          showInventory={showInventory}
          setShowInventory={setShowInventory}
          currentRoom={currentRoom}
          setCurrentRoom={setCurrentRoom}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
          captureCount={captureCount}
          setCaptureCount={setCaptureCount}
          handleSaveItems={handleSaveItems}
        />
      </LiveKitRoom>
    </div>
  );
}