// components/VideoProcessingStatus.jsx - Simple video processing monitor (database-driven)
'use client';

import { useEffect } from 'react';
import { memo } from 'react';

// Memoized for performance - only re-renders when projectId changes  
const VideoProcessingStatus = memo(function VideoProcessingStatus({ projectId, onProcessingComplete }) {
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
            
            // Notify parent with minimal data
            if (onProcessingComplete) {
              onProcessingComplete([{
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
  }, [projectId, onProcessingComplete]);

  // This component doesn't render anything - it's just a listener
  return null;
});

VideoProcessingStatus.displayName = 'VideoProcessingStatus';

export default VideoProcessingStatus;

