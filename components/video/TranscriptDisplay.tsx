// components/video/TranscriptDisplay.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Mic, MicOff, User, Headphones } from 'lucide-react';

export interface TranscriptSegment {
  _id: string;
  text: string;
  speaker: 'agent' | 'customer';
  speakerName?: string;
  startTime: number;
  endTime: number;
  segmentIndex: number;
  createdAt?: string;
}

interface TranscriptDisplayProps {
  projectId: string;
  roomId: string;
  videoRecordingId?: string;
  isLive: boolean;
  // For real-time updates from AudioProcessor
  liveSegments?: TranscriptSegment[];
}

// Format milliseconds to MM:SS
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Polling interval for fetching new transcripts (5 seconds)
const POLL_INTERVAL = 5000;

export default function TranscriptDisplay({
  projectId,
  roomId,
  videoRecordingId,
  isLive,
  liveSegments = [],
}: TranscriptDisplayProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lastTimestampRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Merge live segments with fetched segments
  const allSegments = useCallback(() => {
    const combined = [...segments];

    // Add any live segments that aren't already in the list
    for (const liveSeg of liveSegments) {
      const exists = combined.some(s => s._id === liveSeg._id);
      if (!exists) {
        combined.push(liveSeg);
      }
    }

    // Sort by startTime
    return combined.sort((a, b) => a.startTime - b.startTime);
  }, [segments, liveSegments]);

  // Fetch transcripts from API
  const fetchTranscripts = useCallback(async (incremental: boolean = false) => {
    try {
      const params = new URLSearchParams();

      if (videoRecordingId) {
        params.set('videoRecordingId', videoRecordingId);
      } else {
        params.set('roomId', roomId);
      }

      if (incremental && lastTimestampRef.current) {
        params.set('since', lastTimestampRef.current);
      }

      const response = await fetch(`/api/projects/${projectId}/transcripts?${params}`);

      if (!response.ok) {
        throw new Error('Failed to fetch transcripts');
      }

      const data = await response.json();

      if (data.segments && data.segments.length > 0) {
        if (incremental) {
          // Add new segments to existing ones
          setSegments(prev => {
            const newSegments = data.segments.filter(
              (newSeg: TranscriptSegment) => !prev.some(s => s._id === newSeg._id)
            );
            return [...prev, ...newSegments].sort((a, b) => a.startTime - b.startTime);
          });
        } else {
          setSegments(data.segments);
        }

        if (data.lastTimestamp) {
          lastTimestampRef.current = data.lastTimestamp;
        }
      }

      setError(null);
    } catch (err: any) {
      console.error('Error fetching transcripts:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, roomId, videoRecordingId]);

  // Initial fetch
  useEffect(() => {
    fetchTranscripts(false);
  }, [fetchTranscripts]);

  // Polling for live calls
  useEffect(() => {
    if (!isLive) return;

    const pollInterval = setInterval(() => {
      fetchTranscripts(true);
    }, POLL_INTERVAL);

    return () => clearInterval(pollInterval);
  }, [isLive, fetchTranscripts]);

  // Auto-scroll to bottom when new segments arrive
  useEffect(() => {
    if (autoScrollRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [segments, liveSegments]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    autoScrollRef.current = isAtBottom;
  }, []);

  const displaySegments = allSegments();

  if (loading && segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-4">
        <Loader2 className="w-6 h-6 animate-spin mb-2" />
        <p className="text-sm">Loading transcript...</p>
      </div>
    );
  }

  if (error && segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-4">
        <MicOff className="w-8 h-8 mb-2 text-red-400" />
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (displaySegments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-4">
        <Mic className="w-8 h-8 mb-2" />
        <p className="text-sm text-center">
          {isLive
            ? 'Transcript will appear here as you speak...'
            : 'No transcript available for this recording'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium text-gray-300">Transcript</span>
        </div>
        {isLive && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Transcript content */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {displaySegments.map((segment) => (
          <div
            key={segment._id}
            className={`flex flex-col ${
              segment.speaker === 'agent' ? 'items-start' : 'items-end'
            }`}
          >
            {/* Speaker label and timestamp */}
            <div className={`flex items-center gap-2 mb-1 ${
              segment.speaker === 'agent' ? 'flex-row' : 'flex-row-reverse'
            }`}>
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                segment.speaker === 'agent'
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'bg-green-500/20 text-green-300'
              }`}>
                {segment.speaker === 'agent' ? (
                  <Headphones className="w-3 h-3" />
                ) : (
                  <User className="w-3 h-3" />
                )}
                <span>{segment.speakerName || (segment.speaker === 'agent' ? 'Agent' : 'Customer')}</span>
              </div>
              <span className="text-xs text-gray-500">
                {formatTimestamp(segment.startTime)}
              </span>
            </div>

            {/* Message bubble */}
            <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
              segment.speaker === 'agent'
                ? 'bg-blue-500/10 text-gray-200 rounded-tl-none'
                : 'bg-green-500/10 text-gray-200 rounded-tr-none'
            }`}>
              {segment.text}
            </div>
          </div>
        ))}
      </div>

      {/* Segment count */}
      <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 text-center">
        {displaySegments.length} segment{displaySegments.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
