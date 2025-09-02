// components/VideoGallery.jsx - Display videos with playback capability
'use client';

import { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Clock, 
  Video as VideoIcon,
  User,
  Calendar,
  FileVideo,
  MoreVertical,
  Download,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function VideoGallery({ projectId, onVideoSelect }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playingVideoId, setPlayingVideoId] = useState(null);

  // Fetch videos for the project
  useEffect(() => {
    if (!projectId) return;
    
    const fetchVideos = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/projects/${projectId}/videos`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch videos');
        }
        
        const data = await response.json();
        console.log('🎬 VideoGallery received videos:', data);
        // Log individual video data to debug URL issues
        data.forEach((video, index) => {
          console.log(`🎬 Video ${index}:`, {
            _id: video._id,
            originalName: video.originalName,
            cloudinaryPublicId: video.cloudinaryPublicId,
            cloudinaryUrl: video.cloudinaryUrl,
            cloudinarySecureUrl: video.cloudinarySecureUrl
          });
        });
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

  const handlePlayToggle = (videoId) => {
    if (playingVideoId === videoId) {
      setPlayingVideoId(null);
    } else {
      setPlayingVideoId(videoId);
    }
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
      setOpenMenuId(null);
      
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed. Please try again.');
    }
  };

  const VideoCard = ({ video }) => {
    const isPlaying = playingVideoId === video._id;
    
    // Generate preview thumbnail URL from Cloudinary or fallback
    const thumbnailUrl = video.cloudinaryPublicId 
      ? `https://res.cloudinary.com/dpyxaszqt/video/upload/so_2,w_400,h_300,c_fill,q_auto:good/${video.cloudinaryPublicId}.jpg`
      : null;

    // Use MongoDB API for video preview (short clips)
    const previewUrl = `https://res.cloudinary.com/dpyxaszqt/video/upload/so_0,eo_3,w_400,h_300,c_fill,q_auto:low/${video.cloudinaryPublicId}.mp4`;
    
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
          {isPlaying && video.cloudinaryPublicId ? (
            <video
              src={previewUrl}
              autoPlay
              loop
              muted
              preload="metadata"
              className="w-full h-full object-cover"
              onError={(e) => {
                console.error('🎬 Preview video error:', e);
                setPlayingVideoId(null);
              }}
            />
          ) : (
            <>
              {thumbnailUrl ? (
                <img 
                  src={thumbnailUrl}
                  alt={video.originalName}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <VideoIcon className="w-12 h-12 text-gray-400" />
                </div>
              )}
              
              {/* Fallback icon (hidden by default, shown when thumbnail fails) */}
              <div className="absolute inset-0 w-full h-full flex items-center justify-center" style={{ display: thumbnailUrl ? 'none' : 'flex' }}>
                <VideoIcon className="w-12 h-12 text-gray-400" />
              </div>
            </>
          )}
          
          {/* Play/Pause overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={() => handlePlayToggle(video._id)}
              className="bg-black bg-opacity-50 text-white p-3 rounded-full hover:bg-opacity-70 transition-all"
            >
              {isPlaying ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
            </button>
          </div>
          
          {/* Duration badge */}
          {video.duration > 0 && (
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
              {formatDuration(video.duration)}
            </div>
          )}
        </div>
        
        {/* Video Info */}
        <div className="p-3">
          <h4 className="font-medium text-gray-900 truncate" title={video.originalName}>
            {video.originalName}
          </h4>
          <div className="mt-1 text-xs text-gray-500 space-y-1">
            <p>Size: {formatFileSize(video.size)}</p>
            <p>Uploaded: {new Date(video.createdAt).toLocaleDateString()}</p>
            {video.extractedFrames && video.extractedFrames.length > 0 && (
              <p className="text-blue-600">{video.extractedFrames.length} frames extracted</p>
            )}
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
      <div className="p-8 text-center">
        <VideoIcon className="mx-auto h-12 w-12 text-gray-400 mb-2" />
        <p className="text-gray-600">No videos uploaded yet</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <VideoIcon className="w-5 h-5" />
          Videos ({videos.length})
        </h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {videos.map((video) => (
          <VideoCard key={video._id} video={video} />
        ))}
      </div>
    </div>
  );
}