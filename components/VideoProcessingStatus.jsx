// components/VideoProcessingStatus.jsx - Simple video processing monitor (database-driven)
'use client';

import { useEffect, useRef } from 'react';
import { memo } from 'react';

// Memoized for performance - only re-renders when projectId changes
const VideoProcessingStatus = memo(function VideoProcessingStatus({ projectId, onProcessingComplete }) {
  // Keep the latest callback in a ref so the SSE effect depends ONLY on projectId.
  // The parent passes a fresh inline arrow each render; including it in the effect
  // deps tore down + reopened the EventSource on every render, leaking connections
  // (the climbing "EventSource created. Total active: N" in the console).
  const onCompleteRef = useRef(onProcessingComplete);
  onCompleteRef.current = onProcessingComplete;

  useEffect(() => {
    if (!projectId) return;

    console.log('🎬 VideoProcessingStatus: Setting up simple completion listener for project:', projectId);

    let eventSource = null;

    const connectSSE = () => {
      // Listen to the simple processing-complete endpoint
      eventSource = new EventSource(`/api/processing-complete-simple?projectId=${projectId}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Only care about video processing completion
          if (data.type === 'processing-complete' && data.itemType === 'video') {
            console.log('🎬 Video processing completed:', data.itemId);
            
            // Notify parent with minimal data (via ref — see note above)
            if (onCompleteRef.current) {
              onCompleteRef.current([{
                videoId: data.itemId,
                itemsProcessed: 1 // Simple assumption
              }]);
            }
          }
        } catch (error) {
          console.error('VideoProcessingStatus: Parse error:', error);
        }
      };

      eventSource.onerror = () => {
        console.log('🎬 VideoProcessingStatus: SSE connection closed');
        eventSource?.close();
      };
    };

    connectSSE();

    // Cleanup
    return () => {
      eventSource?.close();
    };
  }, [projectId]); // only re-run when the project changes, NOT on every render

  // This component doesn't render anything - it's just a listener
  return null;
});

VideoProcessingStatus.displayName = 'VideoProcessingStatus';

export default VideoProcessingStatus;

