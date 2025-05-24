// components/video/FrameProcessor.tsx
'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { extractFrameFromTrack, CAPTURE_INTERVAL } from '@/lib/livekit';

interface FrameProcessorProps {
  projectId: string;
  captureMode: 'auto' | 'manual' | 'paused';
  currentRoom: string;
  existingItems: any[];
  onItemsDetected: (items: any[]) => void;
  onProcessingChange: (processing: boolean) => void;
  onCaptureCountChange: (count: number) => void;
}

export default function FrameProcessor({
  projectId,
  captureMode,
  currentRoom,
  existingItems,
  onItemsDetected,
  onProcessingChange,
  onCaptureCountChange,
}: FrameProcessorProps) {
  const { localParticipant } = useLocalParticipant();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const captureCountRef = useRef(0);
  const processingRef = useRef(false);

  // Process a single frame
  const processFrame = useCallback(async () => {
    if (!localParticipant || processingRef.current) {
      return;
    }

    // Find the local video track
    const videoTrack = localParticipant.videoTrackPublications.values().next().value;
    
    if (!videoTrack || !videoTrack.track) {
      console.log('No video track available');
      return;
    }

    processingRef.current = true;
    onProcessingChange(true);

    try {
      // Extract frame from video track
      const frameBlob = await extractFrameFromTrack(videoTrack.track);
      
      if (!frameBlob) {
        console.error('Failed to extract frame');
        return;
      }

      // Prepare form data
      const formData = new FormData();
      formData.append('image', frameBlob, 'frame.jpg');
      formData.append('projectId', projectId);
      formData.append('roomLabel', currentRoom);
      formData.append('existingItems', JSON.stringify(
        existingItems.map(item => ({ name: item.name, location: item.location }))
      ));

      // Send to API
      const response = await fetch('/api/analyze-video-frame', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.items && result.items.length > 0 && !result.fromCache) {
          onItemsDetected(result.items);
          
          // Update capture count
          captureCountRef.current += 1;
          onCaptureCountChange(captureCountRef.current);
        }
      } else {
        console.error('Failed to analyze frame:', await response.text());
      }
    } catch (error) {
      console.error('Error processing frame:', error);
    } finally {
      processingRef.current = false;
      onProcessingChange(false);
    }
  }, [localParticipant, projectId, currentRoom, existingItems, onItemsDetected, onProcessingChange, onCaptureCountChange]);

  // Set up auto-capture interval
  useEffect(() => {
    if (captureMode === 'auto' && localParticipant) {
      // Clear existing interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      // Wait a bit for the video to stabilize
      const startDelay = setTimeout(() => {
        // Process immediately
        processFrame();

        // Set up interval
        intervalRef.current = setInterval(() => {
          processFrame();
        }, CAPTURE_INTERVAL);
      }, 2000); // Wait 2 seconds before starting

      return () => {
        clearTimeout(startDelay);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    } else {
      // Clear interval if not in auto mode
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [captureMode, localParticipant, processFrame]);

  // Handle manual capture
  useEffect(() => {
    if (captureMode === 'manual') {
      const handleKeyPress = (e: KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          processFrame();
        }
      };

      window.addEventListener('keypress', handleKeyPress);
      return () => window.removeEventListener('keypress', handleKeyPress);
    }
  }, [captureMode, processFrame]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return null; // This is a logic-only component
}