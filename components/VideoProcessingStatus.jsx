// components/VideoProcessingStatus.jsx - Real-time video processing status
'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Video, 
  Loader2, 
  CheckCircle, 
  AlertCircle, 
  Clock,
  Zap,
  FileVideo,
  Layers
} from 'lucide-react';

export default function VideoProcessingStatus({ projectId, onProcessingComplete }) {
  const [processingVideos, setProcessingVideos] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;

    console.log('📡 Establishing SSE connection for project:', projectId);

    // Create EventSource for real-time updates
    eventSourceRef.current = new EventSource(`/api/video/processing-status?projectId=${projectId}`);

    eventSourceRef.current.onopen = () => {
      console.log('📡 SSE connection opened');
      setIsConnected(true);
      setConnectionError(null);
    };

    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('📡 SSE message received:', data);

        switch (data.type) {
          case 'connected':
            setIsConnected(true);
            break;
            
          case 'video_updates':
            setProcessingVideos(data.videos || []);
            break;
            
          case 'processing_completed':
            if (data.completedVideos && data.completedVideos.length > 0) {
              console.log('🎬 Videos completed processing:', data.completedVideos);
              
              // Remove completed videos from processing list after a delay
              setTimeout(() => {
                setProcessingVideos(prev => 
                  prev.filter(video => 
                    !data.completedVideos.some(completed => completed.videoId === video.videoId)
                  )
                );
              }, 3000); // Keep success message for 3 seconds
              
              // Notify parent component about completion
              if (onProcessingComplete) {
                onProcessingComplete(data.completedVideos);
              }
            }
            break;
            
          case 'error':
            console.error('📡 SSE error message:', data.message);
            setConnectionError(data.message);
            break;
        }
      } catch (error) {
        console.error('📡 Failed to parse SSE message:', error);
      }
    };

    eventSourceRef.current.onerror = (error) => {
      console.error('📡 SSE connection error:', error);
      setIsConnected(false);
      setConnectionError('Connection lost - retrying...');
      
      // Attempt to reconnect after a delay
      setTimeout(() => {
        if (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.CLOSED) {
          console.log('📡 Attempting to reconnect SSE...');
          // This will be handled by the useEffect cleanup and restart
        }
      }, 3000);
    };

    // Cleanup function
    return () => {
      if (eventSourceRef.current) {
        console.log('📡 Closing SSE connection');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [projectId, onProcessingComplete]);

  // Don't render if no processing videos
  if (!processingVideos || processingVideos.length === 0) {
    return null;
  }

  const getStatusIcon = (status, progress) => {
    if (progress === -1) {
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    }
    
    if (progress === 100) {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    
    return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
  };

  const getStatusText = (status, progress) => {
    if (progress === -1) return 'Processing failed';
    if (progress === 100) return 'Processing complete';
    
    switch (status) {
      case 'queued_for_railway':
        return 'Queued for processing...';
      case 'processing_on_railway':
        return 'Extracting frames...';
      case 'extracting_frames':
        return 'Extracting frames...';
      case 'processing':
        return 'Analyzing frames...';
      default:
        return 'Processing...';
    }
  };

  const getProgressColor = (progress) => {
    if (progress === -1) return 'bg-red-500';
    if (progress === 100) return 'bg-green-500';
    return 'bg-blue-500';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Video className="w-5 h-5 text-blue-600" />
            <h3 className="font-medium text-gray-900">Video Processing</h3>
            <span className="text-sm text-gray-500">({processingVideos.length})</span>
          </div>
          
          <div className="flex items-center gap-2">
            {isConnected ? (
              <div className="flex items-center gap-1 text-xs text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                Live
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs text-red-600">
                <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                Disconnected
              </div>
            )}
          </div>
        </div>
        
        {connectionError && (
          <div className="mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
            {connectionError}
          </div>
        )}
      </div>

      {/* Processing Videos */}
      <div className="divide-y divide-gray-100">
        {processingVideos.map((video) => (
          <div key={video.videoId} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                {getStatusIcon(video.status, video.progress)}
              </div>
              
              <div className="flex-1 min-w-0">
                {/* Video Name */}
                <p className="text-sm font-medium text-gray-900 truncate" title={video.name}>
                  {video.name}
                </p>
                
                {/* Status */}
                <p className="text-xs text-gray-600 mt-1">
                  {getStatusText(video.status, video.progress)}
                </p>
                
                {/* Progress Bar */}
                {video.progress > 0 && video.progress !== 100 && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div 
                        className={`h-1.5 rounded-full transition-all duration-300 ${getProgressColor(video.progress)}`}
                        style={{ width: `${Math.max(video.progress, 10)}%` }}
                      />
                    </div>
                  </div>
                )}
                
                {/* Additional Info */}
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                  {video.framesExtracted > 0 && (
                    <div className="flex items-center gap-1">
                      <Layers className="w-3 h-3" />
                      <span>{video.framesExtracted} frames</span>
                    </div>
                  )}
                  
                  {video.estimatedCompletion && video.progress < 100 && (
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>~{Math.round((new Date(video.estimatedCompletion) - new Date()) / 1000 / 60)}m</span>
                    </div>
                  )}
                  
                  {video.error && (
                    <div className="text-red-600">
                      Error: {video.error.substring(0, 50)}...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Footer with Railway indicator */}
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            <span>Powered by Railway</span>
          </div>
          <div>
            Updates every 2s
          </div>
        </div>
      </div>
    </div>
  );
}