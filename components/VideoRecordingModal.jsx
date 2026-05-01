'use client';

import { useState, useRef, useEffect } from 'react';
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Download,
  Calendar,
  Clock,
  Users,
  FileVideo,
  Loader2,
  Search,
  MessageCircle,
  FileText,
  Package,
  Quote
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Slider } from './ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { toast } from 'sonner';
import VideoCallNotes from './VideoCallNotes';
import { ToggleGoingBadge } from './ui/ToggleGoingBadge';

// Helper to group items by location/room
const groupByRoom = (items) => {
  return items.reduce((acc, item) => {
    const room = item.location || 'Unassigned';
    if (!acc[room]) acc[room] = [];
    acc[room].push(item);
    return acc;
  }, {});
};

const VideoRecordingModal = ({ recording, projectId, isOpen, onClose, inventoryItems = [], onInventoryUpdate, initialItem = null }) => {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [streamUrl, setStreamUrl] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // Auto-hide controls after inactivity
  const resetControlsTimeout = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  // Show controls when video is paused
  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!isOpen) {
      setIsPlaying(false);
      setCurrentTime(0);
      setIsLoading(true);
      setError(null);
      setStreamUrl(null);
      setAnalysisData(null);
    }
  }, [isOpen]);

  // Fetch stream URL when modal opens
  useEffect(() => {
    const fetchStreamUrl = async () => {
      if (!isOpen || !recording || !projectId) return;
      
      try {
        setIsLoading(true);
        setError(null);
        
        const response = await fetch(`/api/projects/${projectId}/video-recordings/${recording._id}/stream`);
        
        if (!response.ok) {
          throw new Error('Failed to get stream URL');
        }
        
        const data = await response.json();
        setStreamUrl(data.streamUrl);
        
      } catch (err) {
        console.error('Error fetching stream URL:', err);
        setError('Failed to load video stream. Please try again.');
        setIsLoading(false);
      }
    };
    
    fetchStreamUrl();
  }, [isOpen, recording, projectId]);

  // Fetch analysis data when modal opens
  useEffect(() => {
    const fetchAnalysisData = async () => {
      if (!isOpen || !recording || !projectId) return;

      try {
        setAnalysisLoading(true);
        const response = await fetch(`/api/projects/${projectId}/video-recordings/${recording._id}/analysis`);

        if (response.ok) {
          const data = await response.json();
          setAnalysisData(data);
        }
      } catch (err) {
        console.error('Error fetching analysis data:', err);
      } finally {
        setAnalysisLoading(false);
      }
    };

    fetchAnalysisData();
  }, [isOpen, recording, projectId]);

  // Auto-seek to initialItem's timestamp when video is ready
  useEffect(() => {
    // Find the item with timestamp from fresh inventoryItems data
    // (spreadsheet row may have stale data without videoTimestamp)
    let itemToSeek = initialItem;

    if (initialItem && inventoryItems?.length > 0) {
      // Try to find matching item by _id or inventoryItemId (spreadsheet rows use inventoryItemId)
      const matchedItem = inventoryItems.find(item =>
        (item._id === initialItem._id) ||
        (item._id?.toString() === initialItem._id?.toString()) ||
        (item._id === initialItem.inventoryItemId) ||
        (item._id?.toString() === initialItem.inventoryItemId?.toString())
      ) || inventoryItems.find(item =>
        item.name === initialItem.name &&
        item.sourceVideoRecordingId?.toString() === recording?._id?.toString()
      );

      if (matchedItem?.videoTimestamp) {
        itemToSeek = matchedItem;
      }
    }

    console.log('🎯 Auto-seek check:', {
      isOpen,
      initialItemName: initialItem?.name,
      initialItem_id: initialItem?._id,
      initialItemInventoryItemId: initialItem?.inventoryItemId,
      itemToSeekName: itemToSeek?.name,
      itemToSeek_id: itemToSeek?._id,
      hasTimestamp: itemToSeek?.videoTimestamp,
      segmentIndex: itemToSeek?.segmentIndex,
      inventoryItemsCount: inventoryItems?.length,
      streamUrl: !!streamUrl
    });

    if (!isOpen || !itemToSeek?.videoTimestamp || !streamUrl) return;

    const video = videoRef.current;
    if (!video) {
      console.log('🎯 Auto-seek: video ref not available');
      return;
    }

    const doSeek = () => {
      // Parse timestamp "MM:SS" to seconds
      const [min, sec] = itemToSeek.videoTimestamp.split(':').map(Number);
      const timestampSeconds = (min || 0) * 60 + (sec || 0);

      // Calculate absolute time: segment start + item timestamp
      const segmentDuration = 300; // 5 minutes per segment
      const segmentStart = (itemToSeek.segmentIndex || 0) * segmentDuration;

      // Calculate offset between composite recording start and customer egress start
      // Customer segments start when customer joins, but composite video starts when first participant (agent) joins
      // NOTE: Find the REAL customer using customerIdentity - egress participants (EG_*) may be misclassified as customers
      const customerParticipant = recording.customerIdentity
        ? recording.participants?.find(p => p.identity === recording.customerIdentity)
        : recording.participants?.find(p => p.type === 'customer' && !p.identity?.startsWith('EG_'));
      const compositeStartTime = recording.startedAt ? new Date(recording.startedAt).getTime() : 0;
      const customerJoinTime = customerParticipant?.joinedAt
        ? new Date(customerParticipant.joinedAt).getTime()
        : compositeStartTime;
      const offsetSeconds = Math.max(0, Math.floor((customerJoinTime - compositeStartTime) / 1000));

      // Add offset to account for time before customer joined
      const absoluteTime = offsetSeconds + segmentStart + timestampSeconds;

      console.log('🎯 Seeking to:', {
        absoluteTime,
        timestampSeconds,
        segmentStart,
        offsetSeconds,
        videoTimestamp: itemToSeek.videoTimestamp,
        segmentIndex: itemToSeek.segmentIndex
      });

      // Seek to that time (pause at timestamp, don't auto-play)
      video.currentTime = absoluteTime;

      toast.success(`Jumped to ${itemToSeek.name} at ${Math.floor(absoluteTime / 60)}:${String(Math.floor(absoluteTime % 60)).padStart(2, '0')}`);
    };

    // Check if video is already loaded (readyState >= 3 means HAVE_FUTURE_DATA)
    if (video.readyState >= 3) {
      console.log('🎯 Auto-seek: video ready, seeking immediately');
      doSeek();
    } else {
      console.log('🎯 Auto-seek: video not ready, waiting for canplay. readyState:', video.readyState);
      // Video not ready yet, wait for canplay event
      const handleCanPlay = () => {
        console.log('🎯 Auto-seek: canplay event fired');
        doSeek();
        video.removeEventListener('canplay', handleCanPlay);
      };
      video.addEventListener('canplay', handleCanPlay);
      return () => {
        video.removeEventListener('canplay', handleCanPlay);
      };
    }
  }, [isOpen, initialItem, streamUrl, inventoryItems, recording]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleError = () => {
    setError('Failed to load video. The recording may still be processing or there was an error.');
    setIsLoading(false);
    toast.error('Failed to load video');
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(handleError);
    }
  };

  const handleSeek = (value) => {
    if (!videoRef.current) return;
    const newTime = (value[0] / 100) * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeChange = (value) => {
    const newVolume = value[0] / 100;
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
    }
    setIsMuted(newVolume === 0);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    
    if (isMuted) {
      videoRef.current.volume = volume;
      setIsMuted(false);
    } else {
      videoRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    
    if (!document.fullscreenElement) {
      videoRef.current.requestFullscreen().catch(err => {
        toast.error('Failed to enter fullscreen');
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleDownload = () => {
    if (streamUrl) {
      const link = document.createElement('a');
      link.href = streamUrl;
      link.download = `recording-${recording.roomId}-${new Date(recording.createdAt).toLocaleDateString()}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Download started');
    } else {
      toast.error('Download URL not available');
    }
  };


  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return '0:00';

    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    const seconds = Math.floor(timeInSeconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Seek video to the timestamp when an item was seen
  const seekToItemTimestamp = (item) => {
    if (!videoRef.current || !item.videoTimestamp) return;

    // Parse timestamp "MM:SS" to seconds
    const [min, sec] = item.videoTimestamp.split(':').map(Number);
    const timestampSeconds = (min || 0) * 60 + (sec || 0);

    // Calculate absolute time: segment start + item timestamp
    const segmentDuration = 300; // 5 minutes per segment
    const segmentStart = (item.segmentIndex || 0) * segmentDuration;

    // Calculate offset between composite recording start and customer egress start
    // Customer segments start when customer joins, but composite video starts when first participant (agent) joins
    // NOTE: Find the REAL customer using customerIdentity - egress participants (EG_*) may be misclassified as customers
    const customerParticipant = recording.customerIdentity
      ? recording.participants?.find(p => p.identity === recording.customerIdentity)
      : recording.participants?.find(p => p.type === 'customer' && !p.identity?.startsWith('EG_'));
    const compositeStartTime = recording.startedAt ? new Date(recording.startedAt).getTime() : 0;
    const customerJoinTime = customerParticipant?.joinedAt
      ? new Date(customerParticipant.joinedAt).getTime()
      : compositeStartTime;
    const offsetSeconds = Math.max(0, Math.floor((customerJoinTime - compositeStartTime) / 1000));

    // Add offset to account for time before customer joined
    const absoluteTime = offsetSeconds + segmentStart + timestampSeconds;

    // Seek to 1 second before the timestamp and pause
    videoRef.current.currentTime = Math.max(0, absoluteTime - 1);
    videoRef.current.pause();

    toast.success(`Jumped to ${item.name} at ${formatTime(absoluteTime)}`);
  };

  if (!recording) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {recording.source === 'self_serve' ? 'Customer Recording' : 'Customer Video Call'}
          </DialogTitle>
          <DialogDescription>
            {recording.source === 'self_serve'
              ? `Self-serve recording ${recording.selfServeSessionId ? `(${recording.selfServeSessionId.substring(0, 12)})` : ''}`
              : `Video Room ID: Room ${recording.roomId.split('-').pop()}`
            }
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="watch" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="watch">Watch</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>
          
          <TabsContent value="watch" className="space-y-4 mt-4">
            {/* Video Player with YouTube-style Overlay Controls */}
            <div
              ref={containerRef}
              className="relative bg-black rounded-lg overflow-hidden aspect-video group"
              onMouseMove={resetControlsTimeout}
              onMouseEnter={() => setShowControls(true)}
              onMouseLeave={() => isPlaying && setShowControls(false)}
            >
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
                  <div className="text-center text-white">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                    <p>Loading video...</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
                  <div className="text-center text-white max-w-md px-4">
                    <FileVideo className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-red-400 mb-2">Playback Error</p>
                    <p className="text-gray-300 text-sm">{error}</p>
                  </div>
                </div>
              )}

              {streamUrl && (
                <video
                  ref={videoRef}
                  className="w-full h-full object-contain cursor-pointer"
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onError={handleError}
                  onClick={togglePlayPause}
                  preload="metadata"
                >
                  <source src={streamUrl} type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              )}

              {/* Center Play/Pause Button Overlay */}
              {!isLoading && !error && streamUrl && !isPlaying && (
                <div
                  className="absolute inset-0 flex items-center justify-center cursor-pointer z-20"
                  onClick={togglePlayPause}
                >
                  <div className="w-16 h-16 bg-black/60 rounded-full flex items-center justify-center hover:bg-black/80 transition-colors">
                    <Play className="w-8 h-8 text-white ml-1" />
                  </div>
                </div>
              )}

              {/* Bottom Controls Overlay */}
              {!error && recording.status === 'completed' && streamUrl && (
                <div
                  className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-8 transition-opacity duration-300 z-30 ${
                    showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  {/* Progress Bar */}
                  <div className="mb-2">
                    <Slider
                      value={[duration ? (currentTime / duration) * 100 : 0]}
                      onValueChange={handleSeek}
                      max={100}
                      step={0.1}
                      className="w-full [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-white/30 [&_[data-slot=slider-range]]:bg-red-500 [&_[data-slot=slider-thumb]]:w-3 [&_[data-slot=slider-thumb]]:h-3 [&_[data-slot=slider-thumb]]:bg-red-500"
                    />
                  </div>

                  {/* Control Buttons */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {/* Play/Pause */}
                      <button
                        onClick={togglePlayPause}
                        disabled={isLoading}
                        className="p-2 text-white hover:bg-white/20 rounded transition-colors"
                      >
                        {isPlaying ? (
                          <Pause className="w-5 h-5" />
                        ) : (
                          <Play className="w-5 h-5" />
                        )}
                      </button>

                      {/* Volume */}
                      <div className="flex items-center group/volume">
                        <button
                          onClick={toggleMute}
                          className="p-2 text-white hover:bg-white/20 rounded transition-colors"
                        >
                          {isMuted || volume === 0 ? (
                            <VolumeX className="w-5 h-5" />
                          ) : (
                            <Volume2 className="w-5 h-5" />
                          )}
                        </button>
                        <div className="w-0 overflow-hidden group-hover/volume:w-20 transition-all duration-200">
                          <Slider
                            value={[isMuted ? 0 : volume * 100]}
                            onValueChange={handleVolumeChange}
                            max={100}
                            step={1}
                            className="w-16 ml-1 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-white/30 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:w-3 [&_[data-slot=slider-thumb]]:h-3 [&_[data-slot=slider-thumb]]:bg-white"
                          />
                        </div>
                      </div>

                      {/* Time Display */}
                      <span className="text-white text-xs ml-2">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Download */}
                      <button
                        onClick={handleDownload}
                        className="p-2 text-white hover:bg-white/20 rounded transition-colors"
                        title="Download"
                      >
                        <Download className="w-5 h-5" />
                      </button>

                      {/* Fullscreen */}
                      <button
                        onClick={toggleFullscreen}
                        className="p-2 text-white hover:bg-white/20 rounded transition-colors"
                        title="Fullscreen"
                      >
                        <Maximize className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Inventory Items from Gemini Live */}
            {(() => {
              // Filter items that belong to this recording session
              console.log('🎬 All inventory items:', inventoryItems.map(i => ({ name: i.name, videoTimestamp: i.videoTimestamp, segmentIndex: i.segmentIndex })));
              const sessionItems = inventoryItems.filter(item => {
                // EXPLICIT EXCLUSION: Items from photos or video uploads should NOT appear
                // in video recording modals - they belong to their respective galleries
                if (item.sourceImageId) {
                  return false;
                }
                if (item.sourceVideoId) {
                  return false;
                }
                // EXPLICIT EXCLUSION: Items from stock catalog should NOT appear
                // in video recording modals - they were manually added, not detected
                if (item.stockItemId) {
                  return false;
                }

                // New proper ObjectId comparison (sourceVideoRecordingId)
                const itemRecordingId = item.sourceVideoRecordingId?._id || item.sourceVideoRecordingId;
                if (itemRecordingId && itemRecordingId.toString() === recording._id?.toString()) {
                  return true;
                }
                // Backwards compat with string egress IDs (sourceRecordingSessionId)
                // FIXED: Only check if the item actually has a sourceRecordingSessionId
                // This prevents undefined === undefined from matching all items
                if (item.sourceRecordingSessionId) {
                  return (
                    item.sourceRecordingSessionId === recording.sessionId ||
                    item.sourceRecordingSessionId === recording.egressId ||
                    item.sourceRecordingSessionId === recording.customerEgressId
                  );
                }

                return false;  // Item doesn't match this recording
              });

              if (sessionItems.length === 0) return null;

              // Group ALL session items by room first
              const roomGroups = groupByRoom(sessionItems);

              return (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <Accordion type="multiple" className="w-full">
                    {Object.entries(roomGroups).map(([room, roomItems]) => {
                      // Separate items within this room by type
                      const roomRegularItems = roomItems.filter(item =>
                        item.itemType === 'furniture' ||
                        item.itemType === 'regular_item' ||
                        (!item.itemType && item.itemType !== 'existing_box' && item.itemType !== 'packed_box' && item.itemType !== 'boxes_needed')
                      );
                      const roomExistingBoxes = roomItems.filter(item =>
                        item.itemType === 'existing_box' ||
                        item.itemType === 'packed_box'
                      );
                      const roomRecommendedBoxes = roomItems.filter(item =>
                        item.itemType === 'boxes_needed'
                      );

                      const totalCount = roomItems.reduce((sum, i) => sum + (i.quantity || 1), 0);

                      return (
                        <AccordionItem key={room} value={room}>
                          <AccordionTrigger className="py-2 text-sm font-medium">
                            {room} ({totalCount})
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3">
                              {/* Regular Items in this room */}
                              {roomRegularItems.length > 0 && (
                                <div>
                                  <h5 className="text-xs font-medium text-gray-600 mb-1">Items</h5>
                                  <div className="flex flex-wrap gap-1">
                                    {roomRegularItems.map((invItem) => {
                                      const quantity = invItem.quantity || 1;
                                      return Array.from({ length: quantity }, (_, index) => (
                                        <div key={`${invItem._id}-${index}`} className="flex items-center gap-0.5">
                                          {invItem.videoTimestamp && (
                                            <button
                                              onClick={() => seekToItemTimestamp(invItem)}
                                              className="p-0.5 hover:bg-blue-100 rounded text-blue-600 hover:text-blue-800 transition-colors"
                                              title={`Find in video`}
                                            >
                                              <Search className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                          <ToggleGoingBadge
                                            inventoryItem={invItem}
                                            quantityIndex={index}
                                            projectId={projectId}
                                            onInventoryUpdate={onInventoryUpdate}
                                            showItemName={true}
                                            className="text-xs"
                                          />
                                        </div>
                                      ));
                                    }).flat()}
                                  </div>
                                </div>
                              )}

                              {/* Existing Boxes in this room */}
                              {roomExistingBoxes.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1 mb-1">
                                    <h5 className="text-xs font-medium text-gray-600">Boxes</h5>
                                    <span className="text-[10px] font-bold text-orange-700 bg-orange-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0">
                                      B
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {roomExistingBoxes.map((invItem) => {
                                      const quantity = invItem.quantity || 1;
                                      return Array.from({ length: quantity }, (_, index) => (
                                        <div key={`${invItem._id}-${index}`} className="flex items-center gap-0.5">
                                          {invItem.videoTimestamp && (
                                            <button
                                              onClick={() => seekToItemTimestamp(invItem)}
                                              className="p-0.5 hover:bg-blue-100 rounded text-blue-600 hover:text-blue-800 transition-colors"
                                              title={`Find in video`}
                                            >
                                              <Search className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                          <ToggleGoingBadge
                                            inventoryItem={invItem}
                                            quantityIndex={index}
                                            projectId={projectId}
                                            onInventoryUpdate={onInventoryUpdate}
                                            showItemName={true}
                                            className="text-xs"
                                          />
                                        </div>
                                      ));
                                    }).flat()}
                                  </div>
                                </div>
                              )}

                              {/* Recommended Boxes in this room */}
                              {roomRecommendedBoxes.length > 0 && (
                                <div>
                                  <div className="flex items-center gap-1 mb-1">
                                    <h5 className="text-xs font-medium text-gray-600">Recommended Boxes</h5>
                                    <span className="text-[10px] font-bold text-purple-700 bg-purple-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0">
                                      R
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {roomRecommendedBoxes.map((invItem) => {
                                      const quantity = invItem.quantity || 1;
                                      return Array.from({ length: quantity }, (_, index) => (
                                        <div key={`${invItem._id}-${index}`} className="flex items-center gap-0.5">
                                          {invItem.videoTimestamp && (
                                            <button
                                              onClick={() => seekToItemTimestamp(invItem)}
                                              className="p-0.5 hover:bg-blue-100 rounded text-blue-600 hover:text-blue-800 transition-colors"
                                              title={`Find in video`}
                                            >
                                              <Search className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                          <ToggleGoingBadge
                                            inventoryItem={invItem}
                                            quantityIndex={index}
                                            projectId={projectId}
                                            onInventoryUpdate={onInventoryUpdate}
                                            showItemName={true}
                                            className="text-xs"
                                          />
                                        </div>
                                      ));
                                    }).flat()}
                                  </div>
                                </div>
                              )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </div>
              );
            })()}

            {/* AI Analysis Summary - Below inventory items */}
            {analysisData && analysisData.totalSegments > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                {/* Room Summaries */}
                {analysisData.segments?.some(seg => seg.summary) && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-gray-600" />
                      <h4 className="font-medium text-gray-800 text-sm">AI Summary</h4>
                    </div>
                    <div className="space-y-2">
                      {analysisData.segments.filter(seg => seg.summary).map((segment, idx) => (
                        <div key={idx} className="text-xs text-gray-700">
                          {segment.room && segment.room !== 'Unknown' && segment.room !== 'N/A' && (
                            <span className="font-medium text-gray-900">{segment.room}: </span>
                          )}
                          {segment.summary}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Packing Notes */}
                {analysisData.packingNotes?.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Package className="w-4 h-4 text-amber-600" />
                      <h4 className="font-medium text-amber-800 text-sm">Packing Notes</h4>
                    </div>
                    <ul className="space-y-1">
                      {analysisData.packingNotes.map((note, idx) => (
                        <li key={idx} className="text-xs text-amber-900">
                          {note.room && note.room !== 'Unknown' && note.room !== 'N/A' && (
                            <span className="font-medium">{note.room}: </span>
                          )}
                          {note.notes}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Transcript Highlights - Customer Quotes */}
                {analysisData.transcriptHighlights?.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <MessageCircle className="w-4 h-4 text-blue-600" />
                      <h4 className="font-medium text-blue-800 text-sm">Customer Statements</h4>
                    </div>
                    <div className="space-y-2">
                      {analysisData.transcriptHighlights.map((highlight, idx) => (
                        <div key={idx} className="bg-white rounded p-2 border border-blue-100">
                          <div className="flex items-start gap-2">
                            <Quote className="w-3 h-3 text-blue-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-xs text-gray-800 italic">"{highlight.text}"</p>
                              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
                                <span>{highlight.timestamp}</span>
                                {highlight.related_item && (
                                  <>
                                    <span>•</span>
                                    <span className="text-blue-600">Re: {highlight.related_item}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="notes" className="mt-4 h-[600px]">
            <div className="h-full rounded-lg border bg-white overflow-hidden">
              <VideoCallNotes
                projectId={projectId}
                recordingId={recording._id}
                roomId={recording.roomId}
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default VideoRecordingModal;