'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
  Quote,
  RotateCcw,
  RotateCw,
  Plus,
  Camera
} from 'lucide-react';
import VideoChapters, { hasVideoChapters } from './video/VideoChapters';
import { useVideoChapters, computeOffsetSeconds } from '@/lib/hooks/useVideoChapters';
import CallSegmentBar from './video/CallSegmentBar';
import { getMidCallState, getWalkthroughDuration, getContinuationDuration } from '@/lib/midCallState';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Slider } from './ui/slider';
import { toast } from 'sonner';
import VideoCallNotes from './VideoCallNotes';
import { ToggleGoingBadge } from './ui/ToggleGoingBadge';
import MediaInventoryModal from '@/components/inventory/MediaInventoryModal';
import CallPhotosPanel from './video/CallPhotosPanel';

// Timeline marker for a photo the agent snapped during the call. Hover shows
// an interactive thumbnail popover; clicking either opens the photo in the
// Photos pane (and seeks). pointerdown must be stopped or the Radix Slider
// underneath treats the click as a scrub.
const PhotoPin = ({ photo, leftPercent, timeLabel, onOpen }) => {
  const [hovered, setHovered] = useState(false);
  const closeTimerRef = useRef(null);
  const enter = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setHovered(true);
  };
  const leave = () => {
    closeTimerRef.current = setTimeout(() => setHovered(false), 150);
  };
  return (
    <div
      className="absolute -top-4 -translate-x-1/2 z-40"
      style={{ left: leftPercent }}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        title={photo.label || 'Call photo'}
        className="w-4 h-4 rounded-full bg-amber-400 border border-white shadow flex items-center justify-center hover:scale-125 transition-transform"
      >
        <Camera className="w-2.5 h-2.5 text-black/80" />
      </button>
      {hovered && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 w-44 bg-black/90 rounded-lg p-2 z-50 cursor-pointer"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {photo.streamUrl && (
            <img
              src={photo.streamUrl}
              alt={photo.label || 'Call photo'}
              className="w-full h-24 object-cover rounded-md mb-1.5"
            />
          )}
          <p className="text-white text-xs font-medium truncate">{photo.label || 'Call photo'}</p>
          {timeLabel && <p className="text-white/60 text-[10px] mt-0.5">{timeLabel}</p>}
        </div>
      )}
    </div>
  );
};

const VideoRecordingModal = ({ recording, projectId, isOpen, onClose, inventoryItems = [], onInventoryUpdate, initialItem = null, onAddStockItem = null, navigation = null }) => {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  // Resize-drag close prevention + desktop/mobile detection are owned by
  // MediaInventoryModal now. The shell wraps the whole modal in
  // preventClose (blocking outside interactions) and internally toggles
  // between panels (desktop) and stack (mobile) layouts.
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

  // Rooms shown in the per-item edit popover. Combines the canonical
  // catalog (preferred — canonical names + numbered duplicates) with any
  // locations already observed on inventory items in this recording, so
  // even legacy items whose room isn't in the catalog still resolve.
  const availableRooms = useMemo(() => {
    const set = new Set();
    for (const r of (recording?.analysisResult?.roomCatalog || [])) {
      if (r?.canonicalName) set.add(r.canonicalName);
    }
    for (const item of inventoryItems) {
      if (item?.location) set.add(item.location);
    }
    return Array.from(set).sort();
  }, [recording, inventoryItems]);

  // Tag derivations (org smart tags + project-only tags) are owned by
  // `MediaInventoryItemsColumn` now — the shell fetches once via
  // `useOrgSmartTags` and filters project tags against it. `availableRooms`
  // stays here because the recording modal enriches it with the recording's
  // `roomCatalog` (see above); we forward it via `availableRoomsOverride`.

  // Mid-call "Stop & Process": the recording prop is a snapshot from when
  // the modal opened, but a mid-call recording keeps evolving (analysis
  // lands, wrap-up gets stitched). liveDoc tracks the latest server state
  // while the recording is in flight; everything state-derived reads `rec`.
  const [liveDoc, setLiveDoc] = useState(null);
  const [analysisRefreshKey, setAnalysisRefreshKey] = useState(0);
  const lastPolledDocRef = useRef(null);
  const resumeTimeRef = useRef(null);
  const rec = liveDoc || recording;
  const midCallState = getMidCallState(rec);

  const { chapters } = useVideoChapters({
    projectId,
    recording,
    currentTime,
    enabled: isOpen,
    refreshKey: analysisRefreshKey,
  });

  // When stitched, the splice point becomes a permanent chapter alongside
  // the room chapters (scrubber divider + chapter list entry).
  const displayChapters = useMemo(() => {
    if (midCallState !== 'stitched') return chapters;
    const wt = getWalkthroughDuration(rec);
    if (!wt) return chapters;
    if (chapters.some((c) => c.room === 'Review & wrap-up')) return chapters;
    return [...chapters, { room: 'Review & wrap-up', startTime: wt, endTime: null, itemCount: 0 }];
  }, [chapters, midCallState, rec]);

  // Active chapter must be derived from displayChapters (not the hook's list)
  // so the appended Review & wrap-up chapter highlights once the playhead
  // passes the splice.
  const activeChapter = useMemo(() => {
    if (!displayChapters.length) return null;
    for (let i = displayChapters.length - 1; i >= 0; i--) {
      if (currentTime >= displayChapters[i].startTime) return displayChapters[i];
    }
    return null;
  }, [displayChapters, currentTime]);

  const seekTo = (timeSec) => {
    if (!videoRef.current) return;
    setPlayingRoom(null); // any user-initiated seek breaks an active loop
    videoRef.current.currentTime = timeSec;
    setCurrentTime(timeSec);
  };

  // ─── Call photos (snapped by the agent during the call) ──────────
  // Rendered as pins on the scrub bar + a Photos pane in the secondary tabs.
  const [callPhotos, setCallPhotos] = useState([]);
  const [focusPhotoId, setFocusPhotoId] = useState(null);
  const [paneSignal, setPaneSignal] = useState(null);

  useEffect(() => {
    if (!isOpen || !projectId || !recording?.roomId) {
      setCallPhotos([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${projectId}/call-photos?roomId=${encodeURIComponent(recording.roomId)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => {
        if (!cancelled) setCallPhotos(data.items || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, recording?.roomId, recording?.source]);

  // Offset of a photo into THIS recording. Prefer the stored
  // capturedAtSeconds: it comes from the recording's own clock (virtual:
  // server-computed from startedAt; walkthroughs: the recorder's pause-aware
  // timer — wall-clock math would drift there). Only recompute from wall
  // clock when the photo belongs to a DIFFERENT recording doc (virtual-call
  // egress auto-restart chain).
  const photoOffset = useCallback(
    (p) => {
      const belongsHere =
        !p.sourceVideoRecordingId || String(p.sourceVideoRecordingId) === String(rec?._id);
      let off = null;
      if (belongsHere && p.capturedAtSeconds != null) {
        off = p.capturedAtSeconds;
      } else if (p.capturedAt && rec?.startedAt) {
        off = (new Date(p.capturedAt).getTime() - new Date(rec.startedAt).getTime()) / 1000;
      } else if (p.capturedAtSeconds != null) {
        off = p.capturedAtSeconds;
      }
      if (off == null) return null;
      off = Math.max(0, off);
      if (duration > 0) off = Math.min(off, duration);
      return off;
    },
    [rec, duration]
  );

  const openPhotoPane = useCallback(
    (photo) => {
      const off = photoOffset(photo);
      if (off != null) seekTo(off);
      setFocusPhotoId(photo.id);
      setPaneSignal({ pane: 'photos', nonce: Date.now() });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [photoOffset]
  );

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
      setLiveDoc(null);
      lastPolledDocRef.current = null;
      resumeTimeRef.current = null;
    }
  }, [isOpen]);

  // Poll the recording doc while a mid-call recording is in flight so the
  // modal transitions live: analysis landing refreshes chapters/summary,
  // and the stitch landing swaps the video source to the full call
  // (preserving the playhead).
  useEffect(() => {
    if (!isOpen || !recording?._id || !projectId) return;
    if (!['live_analyzing', 'live_ready', 'finalizing'].includes(midCallState)) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/video-recordings/${recording._id}`);
        if (!res.ok) return;
        const doc = await res.json();
        const prevDoc = lastPolledDocRef.current || recording;
        lastPolledDocRef.current = doc;
        setLiveDoc(doc);

        // Stitch landed → reload the source at the same position
        if (doc.s3Key && prevDoc.s3Key && doc.s3Key !== prevDoc.s3Key) {
          resumeTimeRef.current = videoRef.current?.currentTime || 0;
          try {
            const streamRes = await fetch(`/api/projects/${projectId}/video-recordings/${recording._id}/stream`);
            if (streamRes.ok) {
              const streamData = await streamRes.json();
              setStreamUrl(streamData.streamUrl);
            }
          } catch (streamErr) {
            console.warn('Failed to refresh stream after stitch:', streamErr);
          }
        }

        // Analysis landed → refresh summary + chapters
        if (
          doc.analysisResult?.status === 'completed' &&
          prevDoc.analysisResult?.status !== 'completed'
        ) {
          setAnalysisRefreshKey((k) => k + 1);
        }
      } catch {
        // transient — keep polling
      }
    };

    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [isOpen, recording, projectId, midCallState]);

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
  }, [isOpen, recording, projectId, analysisRefreshKey]);

  // Auto-seek to initialItem is owned by MediaInventoryModal via the
  // shared `useAutoSeekOnInitialItem` hook — we forward videoRef, streamUrl,
  // initialItem, and a recording-specific offset callback in the `media`
  // prop below.

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
      // After a mid-call stitch swaps the source, restore the playhead
      if (resumeTimeRef.current != null) {
        videoRef.current.currentTime = resumeTimeRef.current;
        setCurrentTime(resumeTimeRef.current);
        resumeTimeRef.current = null;
      }
    }
  };

  // Per-room segment looping. When `playingRoom` is non-null we keep the
  // playhead inside that room's chapter segments, jumping to the next one
  // when the current one ends and looping back to the first after the last.
  const [playingRoom, setPlayingRoom] = useState(null);

  // Stock-inventory picker + open state are owned internally by
  // `MediaInventoryItemsColumn` now — including the `sourceVideoRecordingId`
  // attach passed via `media.sourceKey`. Nothing for this component to
  // manage directly.

  const getRoomSegments = useCallback((roomName) => {
    // The chapter builder gives the LAST chapter a zero-length range
    // (endTime === startTime, there being no next chapter), which made the
    // loop's inside-segment check always fail → a seek-back storm that froze the
    // video on the segment's first frame. Treat missing/degenerate ends as
    // open and resolve them to where room content actually stops: the splice
    // point on stitched mid-call recordings (the review portion isn't a
    // room), else the end of the video.
    const walkthroughEnd = midCallState === 'stitched' ? getWalkthroughDuration(rec) : null;
    const openEnd = walkthroughEnd || duration || Infinity;
    return chapters
      .filter((c) => c.room === roomName)
      .map((c) => ({
        startTime: c.startTime,
        endTime: c.endTime == null || c.endTime <= c.startTime ? openEnd : c.endTime,
      }));
  }, [chapters, midCallState, rec, duration]);

  const togglePlayRoom = useCallback((roomName) => {
    const segments = getRoomSegments(roomName);
    if (segments.length === 0) return;

    if (playingRoom === roomName) {
      // Already looping this room → stop loop, leave video where it is.
      setPlayingRoom(null);
      return;
    }

    setPlayingRoom(roomName);
    const video = videoRef.current;
    if (video) {
      video.currentTime = segments[0].startTime;
      video.play().catch(() => {});
    }
  }, [playingRoom, getRoomSegments]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    setCurrentTime(t);

    if (!playingRoom) return;
    const segments = getRoomSegments(playingRoom);
    if (segments.length === 0) {
      setPlayingRoom(null);
      return;
    }
    // Already inside one of the room's segments → keep playing.
    if (segments.some((s) => t >= s.startTime && t < s.endTime)) return;
    // Outside the room's segments → jump to the next start, or loop to first.
    const next = segments.find((s) => s.startTime > t);
    video.currentTime = (next ?? segments[0]).startTime;
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
    setPlayingRoom(null); // scrubbing breaks an active room loop
    const newTime = (value[0] / 100) * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const skipBy = (deltaSeconds) => {
    if (!videoRef.current) return;
    setPlayingRoom(null); // ±5s buttons break an active room loop
    const newTime = Math.max(0, Math.min(duration || videoRef.current.duration || 0, videoRef.current.currentTime + deltaSeconds));
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
    setPlayingRoom(null); // jumping to a specific item breaks an active loop

    // Parse timestamp "MM:SS" to seconds
    const [min, sec] = item.videoTimestamp.split(':').map(Number);
    const timestampSeconds = (min || 0) * 60 + (sec || 0);

    // Calculate absolute time: segment start + item timestamp + offset
    const segmentDuration = 300; // 5 minutes per segment
    const segmentStart = (item.segmentIndex || 0) * segmentDuration;
    const offsetSeconds = computeOffsetSeconds(recording);
    const absoluteTime = offsetSeconds + segmentStart + timestampSeconds;

    // Seek to 1 second before the timestamp and pause
    videoRef.current.currentTime = Math.max(0, absoluteTime - 1);
    videoRef.current.pause();

    toast.success(`Jumped to ${item.name} at ${formatTime(absoluteTime)}`);
  };

  if (!recording) return null;

  // Recording-specific filter for MediaInventoryItemsColumn. Items from
  // photos or video uploads belong to their respective galleries — never
  // show them here. Stock items belong only when explicitly attached via
  // `sourceVideoRecordingId`. Also honors backwards-compat egress IDs.
  const sessionFilter = (item) => {
    if (item.sourceImageId) return false;
    if (item.sourceVideoId) return false;
    if (item.stockItemId) {
      const stockRecId = item.sourceVideoRecordingId?._id || item.sourceVideoRecordingId;
      return stockRecId?.toString() === recording?._id?.toString();
    }
    const itemRecordingId = item.sourceVideoRecordingId?._id || item.sourceVideoRecordingId;
    if (itemRecordingId && itemRecordingId.toString() === recording._id?.toString()) {
      return true;
    }
    if (item.sourceRecordingSessionId) {
      return (
        item.sourceRecordingSessionId === recording.sessionId ||
        item.sourceRecordingSessionId === recording.egressId ||
        item.sourceRecordingSessionId === recording.customerEgressId
      );
    }
    return false;
  };

  // The player, chapters, and AI analysis blocks each fill a different
  // slot on MediaInventoryModal so the top-bottom desktop layout can put
  // the video on the top-left and chapters + AI summary on the top-right.
  // Side-by-side / stack layouts still stack all three in the same column.
  const mediaCol = (
          <>
            <div
              ref={containerRef}
              className="relative bg-black rounded-lg overflow-hidden aspect-video group"
              onMouseMove={resetControlsTimeout}
              onMouseEnter={() => setShowControls(true)}
              onMouseLeave={() => isPlaying && setShowControls(false)}
            >
              {/* Mid-call: the call is still happening while this walkthrough plays */}
              {(midCallState === 'live_analyzing' || midCallState === 'live_ready') && (
                <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 bg-emerald-600/90 text-white text-[10px] font-bold tracking-wide px-2.5 py-1 rounded-full pointer-events-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  CALL IN PROGRESS
                </div>
              )}
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
              {!error && streamUrl && (
                <div
                  className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-3 pt-8 transition-opacity duration-300 z-30 ${
                    showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  {/* Progress Bar */}
                  <div className="mb-2 relative">
                    <Slider
                      value={[duration ? (currentTime / duration) * 100 : 0]}
                      onValueChange={handleSeek}
                      max={100}
                      step={0.1}
                      className="w-full [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-white/30 [&_[data-slot=slider-range]]:bg-red-500 [&_[data-slot=slider-thumb]]:w-3 [&_[data-slot=slider-thumb]]:h-3 [&_[data-slot=slider-thumb]]:bg-red-500"
                    />
                    {/* Chapter dividers - skip the first one (always at 0%) */}
                    {duration > 0 && displayChapters.slice(1).map((chapter, idx) => (
                      <div
                        key={`${chapter.startTime}-${chapter.room}-${idx}`}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3 bg-white/90 rounded-sm pointer-events-none"
                        style={{ left: `${Math.min(100, (chapter.startTime / duration) * 100)}%` }}
                        title={chapter.room}
                      />
                    ))}
                    {/* Call-photo pins — hover for a preview, click to open in the Photos pane */}
                    {duration > 0 && callPhotos.map((photo) => {
                      const off = photoOffset(photo);
                      if (off == null) return null;
                      return (
                        <PhotoPin
                          key={photo.id}
                          photo={photo}
                          leftPercent={`${Math.min(100, (off / duration) * 100)}%`}
                          timeLabel={formatTime(off)}
                          onOpen={() => openPhotoPane(photo)}
                        />
                      );
                    })}
                  </div>

                  {/* Control Buttons */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {/* Back 5s */}
                      <button
                        onClick={() => skipBy(-5)}
                        disabled={isLoading}
                        className="relative p-2 text-white hover:bg-white/20 rounded transition-colors"
                        title="Back 5 seconds"
                      >
                        <RotateCcw className="w-5 h-5" />
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold pointer-events-none mt-0.5">5</span>
                      </button>

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

                      {/* Forward 5s */}
                      <button
                        onClick={() => skipBy(5)}
                        disabled={isLoading}
                        className="relative p-2 text-white hover:bg-white/20 rounded transition-colors"
                        title="Forward 5 seconds"
                      >
                        <RotateCw className="w-5 h-5" />
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold pointer-events-none mt-0.5">5</span>
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
                      <span className="text-white text-xs ml-2 flex items-center gap-1.5">
                        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                        {activeChapter && (
                          <>
                            <span className="text-white/40">·</span>
                            <span className="text-white/90 font-medium">{activeChapter.room}</span>
                          </>
                        )}
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

            {/* Mid-call segment bar: what exists now vs. what's coming */}
            <CallSegmentBar
              state={midCallState}
              walkthroughDuration={getWalkthroughDuration(rec)}
              continuationDuration={getContinuationDuration(rec)}
              itemsCount={rec?.analysisResult?.itemsCount}
              onSeek={seekTo}
            />
          </>
  );

  const chaptersCol = hasVideoChapters(displayChapters) ? (
    <VideoChapters
      chapters={displayChapters}
      activeChapter={activeChapter}
      onSeek={seekTo}
    />
  ) : null;

  const analysisCol = analysisData && analysisData.totalSegments > 0 ? (
              <div className="space-y-3">
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
  ) : midCallState === 'live_analyzing' ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 animate-pulse">
                <div className="flex items-center gap-2 mb-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
                  <h4 className="font-medium text-gray-700 text-sm">Analyzing the walkthrough…</h4>
                </div>
                <p className="text-xs text-gray-500 mb-0">
                  Items, boxes, and chapters will appear here in a few minutes. You can keep watching while it runs.
                </p>
              </div>
  ) : null;

  return (
    <MediaInventoryModal
      isOpen={isOpen}
      onClose={onClose}
      projectId={projectId}
      inventoryItems={inventoryItems}
      onInventoryUpdate={onInventoryUpdate}
      onAddStockItem={onAddStockItem}
      desktopLayout="panels"
      preventClose
      navigation={navigation}
      media={{
        id: recording?._id,
        sourceKey: 'sourceVideoRecordingId',
        chapters: displayChapters,
        onSeek: seekToItemTimestamp,
        initialItem,
        videoRef,
        streamUrl,
        computeOffsetSeconds: () => computeOffsetSeconds(recording),
        filter: sessionFilter,
      }}
      headerTitle={
        recording.source === 'self_serve' ? 'Customer Recording' : 'Customer Video Call'
      }
      headerSubtitle={
        recording.source === 'self_serve'
          ? `Self-serve recording ${recording.selfServeSessionId ? `(${recording.selfServeSessionId.substring(0, 12)})` : ''}`
          : `Video Room ID: Room ${recording.roomId.split('-').pop()}`
      }
      availableRoomsOverride={availableRooms}
      mediaSlot={mediaCol}
      extrasSlot={chaptersCol}
      analysisSlot={analysisCol}
      notesSlot={
        <div className="h-full rounded-lg border bg-white overflow-hidden">
          <VideoCallNotes
            projectId={projectId}
            recordingId={recording._id}
            roomId={recording.roomId}
          />
        </div>
      }
      photosSlot={
        callPhotos.length > 0 ? (
          <CallPhotosPanel
            projectId={projectId}
            roomId={recording.roomId}
            focusPhotoId={focusPhotoId}
            onPhotoSeek={(photo) => {
              const off = photoOffset(photo);
              if (off != null) seekTo(off);
            }}
            onPhotosChange={setCallPhotos}
          />
        ) : null
      }
      paneSignal={paneSignal}
      renderRoomExtras={(room) => (
        getRoomSegments(room).length > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlayRoom(room);
            }}
            className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${
              playingRoom === room
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            }`}
            title={playingRoom === room
              ? `Stop looping ${room}`
              : `Loop all video segments where ${room} appears`}
          >
            {playingRoom === room ? (
              <>
                <Pause className="w-3 h-3" />
                Stop looping
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                Loop segments
              </>
            )}
          </button>
        ) : null
      )}
    />
  );
};

export default VideoRecordingModal;