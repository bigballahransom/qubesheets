// components/VideoGallery.jsx - Display videos with Google Cloud Video Intelligence analysis
'use client';

import { useState, useEffect } from 'react';
import { 
  Clock, 
  MoreVertical,
  Download,
  Trash2,
  Bot,
  Loader2,
  AlertCircle,
  Package,
  Eye
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function VideoGallery({ projectId }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);

  // Fetch videos for the project
  useEffect(() => {
    if (!projectId) return;
    
    const fetchVideos = async () => {
      try {
        setLoading(true);
        console.log(`🎬 Fetching videos for project: ${projectId}`);
        
        const response = await fetch(`/api/projects/${projectId}/videos`, {
          cache: 'no-store'
        });
        
        if (!response.ok) {
          if (response.status === 404) {
            console.log('🎬 No videos found for this project');
            setVideos([]);
            return;
          }
          throw new Error(`Failed to fetch videos: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`🎬 VideoGallery received ${data.length} videos:`, data);
        setVideos(data);
      } catch (err) {
        console.error('Error fetching videos:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    
    fetchVideos();
  }, [projectId]);

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleDownload = async (video) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/videos/${video._id}`);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = video.originalName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      alert('Download failed. Please try again.');
    }
  };

  const handleDelete = async (video) => {
    if (!confirm(`Are you sure you want to delete "${video.originalName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/videos/${video._id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Delete failed');
      }

      // Remove from local state
      setVideos(videos.filter(v => v._id !== video._id));
      
      // Close modal if this video was selected
      if (selectedVideo?._id === video._id) {
        setSelectedVideo(null);
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed. Please try again.');
    }
  };

  // Get analysis status badge
  const getAnalysisStatusBadge = (analysisResult) => {
    const status = analysisResult?.status || 'pending';
    
    const statusConfig = {
      'pending': { color: 'bg-yellow-100 text-yellow-800', icon: Clock, text: 'Pending' },
      'processing': { color: 'bg-blue-100 text-blue-800', icon: Loader2, text: 'Processing' },
      'completed': { color: 'bg-green-100 text-green-800', icon: Bot, text: 'Analyzed' },
      'failed': { color: 'bg-red-100 text-red-800', icon: AlertCircle, text: 'Failed' }
    };

    const config = statusConfig[status] || statusConfig.pending;
    const IconComponent = config.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.color}`}>
        <IconComponent className={`w-3 h-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
        {config.text}
      </span>
    );
  };

  const VideoDetailModal = ({ video, onClose }) => {
    if (!video) return null;
    
    const videoUrl = `/api/projects/${projectId}/videos/${video._id}`;
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="text-lg font-semibold truncate">{video.originalName}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1"
            >
              ✕
            </button>
          </div>
          
          {/* Content */}
          <div className="p-4 overflow-y-auto max-h-[calc(90vh-120px)]">
            {/* Video Player */}
            <div className="mb-6">
              <video 
                src={videoUrl}
                className="w-full h-auto max-h-96 bg-black rounded"
                controls
                preload="metadata"
                playsInline
              />
              <p className="text-xs text-gray-500 mt-1">
                Uploaded on {new Date(video.createdAt).toLocaleString()}
              </p>
            </div>
            
            {/* Details and Analysis in two columns */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Details */}
              <div>
                <h3 className="font-semibold mb-3">Details</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>File size:</span>
                    <span>{formatFileSize(video.size)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Type:</span>
                    <span>{video.mimeType || 'video/mp4'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Duration:</span>
                    <span>{formatDuration(video.duration)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Uploaded:</span>
                    <span>{new Date(video.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
              
              {/* Analysis Results */}
              <div>
                <h3 className="font-semibold mb-3">Analysis Results</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Items found:</span>
                    <span className="font-semibold text-green-600">
                      {video.analysisResult?.itemsCount || 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Boxes needed:</span>
                    <span className="font-semibold text-blue-600">
                      {video.analysisResult?.totalBoxes || 0}
                    </span>
                  </div>
                  
                  {/* Status */}
                  <div className="mt-3">
                    {getAnalysisStatusBadge(video.analysisResult)}
                  </div>
                </div>
                
                {/* AI Summary */}
                {video.analysisResult?.summary && (
                  <div className="mt-4">
                    <h4 className="font-medium mb-2">Summary</h4>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {video.analysisResult.summary}
                    </p>
                  </div>
                )}
                
                {/* Error */}
                {video.analysisResult?.error && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
                    <p className="text-sm text-red-700">{video.analysisResult.error}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Footer Actions */}
          <div className="flex items-center justify-between p-4 border-t bg-gray-50">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handleDownload(video)}
                variant="outline"
                size="sm"
              >
                <Download size={16} className="mr-2" />
                Download
              </Button>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handleDelete(video)}
                variant="destructive"
                size="sm"
              >
                <Trash2 size={16} className="mr-2" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const VideoCard = ({ video }) => {
    const videoUrl = `/api/projects/${projectId}/videos/${video._id}`;
    
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow relative">
        {/* 3-dot menu */}
        <div className="absolute top-2 right-2 z-20">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="h-8 w-8 p-0 relative z-20">
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-30">
              <DropdownMenuItem onClick={() => setSelectedVideo(video)}>
                <Eye size={16} className="mr-2" />
                View
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload(video)}>
                <Download size={16} className="mr-2" />
                Download
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => handleDelete(video)}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 size={16} className="mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Video Preview Area */}
        <div className="aspect-video bg-gray-100 flex items-center justify-center relative">
          <video 
            src={videoUrl}
            className="w-full h-full object-contain"
            controls
            preload="metadata"
            playsInline
            onLoadedMetadata={(e) => {
              console.log('🎬 Video metadata loaded:', {
                duration: e.target.duration,
                videoWidth: e.target.videoWidth,
                videoHeight: e.target.videoHeight
              });
              // Seek to 1 second to show a preview frame
              setTimeout(() => {
                e.target.currentTime = 1;
              }, 100);
            }}
            onError={(e) => {
              console.error('🎬 Video load error:', e.target.error);
            }}
          />
          
          {/* Duration badge */}
          {video.duration > 0 && (
            <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
              {formatDuration(video.duration)}
            </div>
          )}
          
          {/* Analysis status badge */}
          <div className="absolute top-2 left-2">
            {getAnalysisStatusBadge(video.analysisResult)}
          </div>
        </div>
        
        {/* Video Info */}
        <div className="p-3">
          <h4 className="font-medium text-gray-900 truncate" title={video.originalName}>
            {video.originalName}
          </h4>
          <div className="mt-1 text-xs text-gray-500 space-y-1">
            <div className="flex items-center justify-between">
              <span>Size: {formatFileSize(video.size)}</span>
              <span>{new Date(video.createdAt).toLocaleDateString()}</span>
            </div>
            
            {/* Analysis Results */}
            {video.analysisResult?.itemsCount > 0 && (
              <div className="flex items-center gap-1 text-green-600">
                <Package className="w-3 h-3" />
                <span>{video.analysisResult.itemsCount} items detected</span>
              </div>
            )}
            
            {video.analysisResult?.totalBoxes > 0 && (
              <div className="text-blue-600">
                {video.analysisResult.totalBoxes} boxes recommended
              </div>
            )}
            
            {video.analysisResult?.error && (
              <div className="text-red-600">
                Error: {video.analysisResult.error}
              </div>
            )}
            
            {/* Source */}
            <div className="text-gray-400">
              Source: {video.source || 'video-upload'}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
          <p className="text-gray-600">Loading videos...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-600 mb-2">Error loading videos</div>
        <p className="text-gray-600">{error}</p>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl flex items-center justify-center mb-6">
          <Eye className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No videos yet</h3>
        <p className="text-gray-600 text-center max-w-md mb-6">
          Upload videos to automatically analyze inventory items using Google Cloud Video Intelligence API.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md">
          <div className="flex items-start gap-3">
            <Bot className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <p className="text-blue-800 text-sm font-medium mb-1">AI-Powered Analysis</p>
              <p className="text-blue-600 text-xs">
                Videos are processed with Google Cloud Video Intelligence to automatically detect and catalog inventory items.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            Project Videos
          </h3>
          <p className="text-sm text-gray-600">({videos.length}) videos uploaded</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {videos.map((video) => (
          <VideoCard key={video._id} video={video} />
        ))}
      </div>
      
      {/* Video Detail Modal */}
      {selectedVideo && (
        <VideoDetailModal 
          video={selectedVideo} 
          onClose={() => setSelectedVideo(null)} 
        />
      )}
    </div>
  );
}