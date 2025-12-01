// components/VideoGallery.jsx - Display videos with playback capability
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  Trash2,
  Eye,
  Loader2,
  Package,
  X,
  Copy,
  Edit3,
  Save
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ToggleGoingBadge } from '@/components/ui/ToggleGoingBadge';
import { toast } from 'sonner';

export default function VideoGallery({ projectId, onVideoSelect, refreshTrigger, onPlayingStateChange, refreshSpreadsheet, inventoryItems = [], onInventoryUpdate }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [editingVideo, setEditingVideo] = useState(null);
  const [editDescription, setEditDescription] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [playingVideoId, setPlayingVideoId] = useState(null);
  const [streamUrls, setStreamUrls] = useState({});
  const [loadingStreams, setLoadingStreams] = useState(new Set());
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    pageSize: 6, // Reduced for faster loading
    totalItems: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  });
  const [deletingAll, setDeletingAll] = useState(false);

  // Fetch videos for the project with pagination
  const fetchVideos = async (page = 1) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/videos/all?page=${page}&limit=6`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch videos');
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Update videos and pagination state
      setVideos(data.videos || []);
      setPagination(data.pagination || {
        currentPage: 1,
        pageSize: 6,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      });
      setCurrentPage(page);
      
    } catch (err) {
      console.error('Error fetching videos:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    fetchVideos(1);
  }, [projectId]);
  
  // Auto-load all video streams on page load
  useEffect(() => {
    if (videos.length > 0) {
      console.log('🎬 Auto-loading streams for all videos...');
      videos.forEach((video) => {
        if (video.s3RawFile?.key && !streamUrls[video._id] && !loadingStreams.has(video._id)) {
          getStreamUrl(video._id);
        }
      });
    }
  }, [videos]);

  // Handle refresh trigger
  useEffect(() => {
    if (!projectId || !refreshTrigger || refreshTrigger === 0) return;
    console.log('🔄 Refresh triggered, fetching videos...');
    fetchVideos(currentPage);
  }, [refreshTrigger]);

  // Format duration for videos
  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };


  // Get stream URL for video playback
  const getStreamUrl = async (videoId) => {
    if (streamUrls[videoId]) {
      return streamUrls[videoId];
    }
    
    try {
      setLoadingStreams(prev => new Set([...prev, videoId]));
      console.log('🎬 Fetching stream URL for video:', videoId);
      const response = await fetch(`/api/projects/${projectId}/videos/${videoId}/stream`);
      if (!response.ok) {
        throw new Error(`Failed to get video stream URL: ${response.status} ${response.statusText}`);
      }
      const { streamUrl } = await response.json();
      console.log('✅ Got stream URL for video:', videoId);
      console.log('🔗 Stream URL:', streamUrl);
      
      // Test if the URL is accessible
      try {
        const testResponse = await fetch(streamUrl, { method: 'HEAD' });
        console.log('🧪 Stream URL test response:', testResponse.status, testResponse.statusText);
      } catch (testError) {
        console.warn('⚠️ Stream URL test failed:', testError);
      }
      
      setStreamUrls(prev => ({ ...prev, [videoId]: streamUrl }));
      return streamUrl;
    } catch (error) {
      console.error('❌ Error getting stream URL:', error);
      toast.error('Failed to load video');
      return null;
    } finally {
      setLoadingStreams(prev => {
        const newSet = new Set(prev);
        newSet.delete(videoId);
        return newSet;
      });
    }
  };

  // Handle play/pause toggle
  const handlePlayToggle = async (video) => {
    if (playingVideoId === video._id) {
      // Pause/stop current video
      setPlayingVideoId(null);
      if (onPlayingStateChange) onPlayingStateChange(false);
    } else {
      // Stop any other playing video first
      if (playingVideoId) {
        setPlayingVideoId(null);
      }
      
      // Start playing this video
      const streamUrl = streamUrls[video._id] || await getStreamUrl(video._id);
      if (streamUrl) {
        setPlayingVideoId(video._id);
        if (onPlayingStateChange) onPlayingStateChange(true);
      }
    }
  };

  // Handle video streaming in new tab
  const handleStreamVideo = async (video) => {
    try {
      const streamUrl = await getStreamUrl(video._id);
      if (streamUrl) {
        window.open(streamUrl, '_blank');
        toast.success('Video opened in new tab');
      }
    } catch (error) {
      console.error('Error streaming video:', error);
      toast.error('Failed to stream video');
    }
  };

  // Delete video item
  const handleDeleteItem = async (video) => {
    if (!confirm(`Are you sure you want to delete "${video.originalName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/videos/${video._id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete video');
      }
      
      setVideos(prev => prev.filter(vid => vid._id !== video._id));
      
      // Refresh the spreadsheet to reflect cascading inventory deletes
      if (refreshSpreadsheet) {
        try {
          await refreshSpreadsheet();
        } catch (error) {
          console.error('Error refreshing spreadsheet after video delete:', error);
        }
      }
      
      toast.success('Video deleted successfully');
    } catch (error) {
      console.error('Error deleting video:', error);
      
      // Handle timeout errors specifically
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('timeout'))) {
        toast.error('Delete timed out. Please check your connection and try again.');
      } else {
        toast.error(`Failed to delete video: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  };

  const handleDeleteAll = async () => {
    const confirmMessage = `Are you sure you want to delete ALL ${pagination.totalItems} videos? This will delete videos from all pages, not just the current page. This action cannot be undone.`;
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    // Double confirmation for safety
    if (!confirm(`This will permanently delete ${pagination.totalItems} videos and all associated inventory items. Are you absolutely sure?`)) {
      return;
    }
    
    setDeletingAll(true);
    
    try {
      const response = await fetch(`/api/projects/${projectId}/videos/all`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(60000) // 60 second timeout for bulk delete
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Delete failed: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('✅ Bulk delete successful:', result);
      
      // Clear local state
      setVideos([]);
      setPagination({
        currentPage: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      });
      setCurrentPage(1);
      
      // Refresh spreadsheet if provided
      if (refreshSpreadsheet) {
        try {
          await refreshSpreadsheet();
        } catch (error) {
          console.error('Error refreshing after bulk delete:', error);
        }
      }
      
      toast.success(`Successfully deleted ${result.deletedVideos} videos and ${result.deletedInventoryItems} associated inventory items.`);
    } catch (error) {
      console.error('Bulk delete failed:', error);
      toast.error(`Failed to delete all videos: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeletingAll(false);
    }
  };

  // Download video item
  const handleDownloadItem = async (video) => {
    try {
      // Get streaming URL and download from S3
      const streamResponse = await fetch(`/api/projects/${projectId}/videos/${video._id}/stream`);
      if (!streamResponse.ok) {
        throw new Error('Failed to get video stream URL');
      }
      const { streamUrl } = await streamResponse.json();
      
      // Open in new tab for download
      const a = document.createElement('a');
      a.href = streamUrl;
      a.download = video.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      toast.success('Video download started');
    } catch (error) {
      console.error('Error downloading video:', error);
      toast.error('Failed to download video');
    }
  };

  // Update video description
  const handleUpdateDescription = async (video) => {
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/videos/${video._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description: editDescription }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update video');
      }
      
      const updatedVideo = await response.json();
      
      setVideos(prev => prev.map(vid => 
        vid._id === video._id ? { ...vid, description: updatedVideo.description } : vid
      ));
      
      setEditingVideo(null);
      setEditDescription('');
      
      toast.success('Video description updated');
    } catch (error) {
      console.error('Error updating description:', error);
      toast.error('Failed to update video');
    } finally {
      setIsUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">Loading videos...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-red-600 mb-2">Error loading videos</div>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Project Videos</h3>
          <p className="text-sm text-gray-500">
            {pagination.totalItems} {pagination.totalItems === 1 ? 'video' : 'videos'} uploaded
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pagination.totalItems > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteAll}
              disabled={deletingAll}
              className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
            >
              {deletingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting All...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete All Videos
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {videos.length === 0 ? (
        <Card className="border-2 border-dashed border-gray-200 bg-gray-50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileVideo className="h-12 w-12 text-gray-400 mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No videos yet</h4>
            <p className="text-sm text-gray-500 text-center">
              Upload videos to automatically identify and inventory items
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Video Grid - Matching ImageGallery structure */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {videos.map((video) => (
            <Card key={video._id} className="group hover:shadow-lg transition-shadow overflow-hidden p-0">
              <div className="relative aspect-video bg-gray-100 overflow-hidden rounded-t-lg">
                {/* Video player with thumbnail and inline playback */}
                {(() => {
                  const isPlaying = playingVideoId === video._id;
                  const streamUrl = streamUrls[video._id];
                  const isLoadingStream = loadingStreams.has(video._id);
                  
                  return (
                    <div className="relative w-full h-full bg-gradient-to-br from-blue-50 to-gray-100">
                      {/* Show thumbnail when not playing */}
                      {(() => {
                        console.log('🖼️ Video display state:', {
                          videoId: video._id,
                          isPlaying,
                          hasStreamUrl: !!streamUrl,
                          isLoadingStream
                        });
                        
                        // Show video with native controls
                        if (streamUrl) {
                          return (
                            <video
                              src={streamUrl}
                              className="w-full h-full object-cover"
                              muted={false} // Allow sound when playing
                              loop={false} // Don't loop by default
                              autoPlay={false} // Don't auto-play, just load frame
                              playsInline={true}
                              controls={true} // Show native video controls
                              preload="auto" // Load first few seconds for instant playback
                              onLoadedMetadata={(e) => {
                                // Video is ready, show the first frame
                                console.log('Video loaded and showing frame for:', video.originalName);
                              }}
                              onError={(e) => {
                                console.error('Video playback error for', video.originalName);
                                console.error('Error details:', e.target.error);
                              }}
                            />
                          );
                        }
                        
                        // Show loading state while getting stream URL
                        if (isLoadingStream) {
                          return (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-blue-100 to-gray-200">
                              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                              <span className="text-sm text-gray-700">Loading video...</span>
                              <span className="text-xs text-gray-500 mt-1">{video.originalName}</span>
                            </div>
                          );
                        }
                        
                        // Show placeholder while waiting for stream URL
                        return (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                            <VideoIcon className="w-12 h-12 text-gray-400 mb-2" />
                            <span className="text-sm text-gray-600">Preparing...</span>
                            <span className="text-xs text-gray-500 mt-1">{video.originalName}</span>
                          </div>
                        );
                      })()}
                      
                    </div>
                  );
                })()}
                
                {/* 3-dot menu - Matching ImageGallery exactly */}
                <div className="absolute top-2 right-2 z-20">
                  <DropdownMenu key={`dropdown-${video._id}-${selectedVideo ? 'modal-open' : 'modal-closed'}`}>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="secondary" className="h-8 w-8 p-0 relative z-20">
                        <MoreVertical size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-30">
                      <DropdownMenuItem onClick={() => setSelectedVideo(video)}>
                        <Eye size={16} className="mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        setEditingVideo(video);
                        setEditDescription(video.description || '');
                      }}>
                        <Edit3 size={16} className="mr-2" />
                        Edit Description
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDownloadItem(video)}>
                        <Download size={16} className="mr-2" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleDeleteItem(video)}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 size={16} className="mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <VideoIcon size={14} className="text-blue-500" />
                      <h4 className="font-medium text-gray-900 truncate">
                        {video.originalName}
                      </h4>
                    </div>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <Calendar size={12} />
                      {formatDate(video.createdAt)}
                    </p>
                  </div>

                  {editingVideo && editingVideo._id === video._id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="Add a description..."
                        className="text-sm"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleUpdateDescription(video)}
                          disabled={isUpdating}
                        >
                          {isUpdating ? (
                            <Loader2 size={12} className="mr-1 animate-spin" />
                          ) : (
                            <Save size={12} className="mr-1" />
                          )}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingVideo(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {video.description ? (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {video.description}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic">
                          No description
                        </p>
                      )}
                    </div>
                  )}

                  {/* Analysis Status */}
                  <div className="flex flex-wrap gap-1">
                    {video.analysisResult?.status === 'processing' ? (
                      <Badge variant="secondary" className="text-xs animate-pulse">
                        <Loader2 size={10} className="mr-1 animate-spin" />
                        Processing...
                      </Badge>
                    ) : video.analysisResult?.status === 'failed' ? (
                      <Badge variant="destructive" className="text-xs">
                        <X size={10} className="mr-1" />
                        Analysis failed
                      </Badge>
                    ) : video.analysisResult?.status === 'completed' ? (
                      <>
                        <Badge variant="secondary" className="text-xs">
                          <Package size={10} className="mr-1" />
                          {(() => {
                            const videoInventoryItems = inventoryItems.filter(invItem => {
                              const videoId = invItem.sourceVideoId?._id || invItem.sourceVideoId;
                              return videoId === video._id;
                            });
                            const totalCount = videoInventoryItems.reduce((total, invItem) => total + (invItem.quantity || 1), 0);
                            return totalCount > 0 ? `${totalCount} items` : `${video.analysisResult.itemsCount || 0} items`;
                          })()}
                        </Badge>
                        {video.analysisResult.totalBoxes && video.analysisResult.totalBoxes > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {video.analysisResult.totalBoxes} boxes
                          </Badge>
                        )}
                      </>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        <Loader2 size={10} className="mr-1 animate-spin" />
                        Analyzing...
                      </Badge>
                    )}
                  </div>

                  <div className="text-xs text-gray-500 flex items-center justify-between">
                    <span>{formatFileSize(video.size)}</span>
                    {video.duration && (
                      <span className="flex items-center gap-1">
                        <VideoIcon size={10} />
                        {formatDuration(video.duration)}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      {/* Pagination Controls */}
      {pagination.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchVideos(currentPage - 1)}
            disabled={!pagination.hasPrevPage || loading}
          >
            Previous
          </Button>
          
          <div className="flex items-center gap-1 text-sm text-gray-600">
            <span>Page {pagination.currentPage} of {pagination.totalPages}</span>
            <span className="text-gray-400">•</span>
            <span>{pagination.totalItems} total videos</span>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchVideos(currentPage + 1)}
            disabled={!pagination.hasNextPage || loading}
          >
            Next
          </Button>
        </div>
      )}

      {/* Video Detail Dialog */}
      <Dialog open={!!selectedVideo} onOpenChange={(open) => {
        if (!open) {
          setSelectedVideo(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileVideo size={20} className="text-blue-500" />
              {selectedVideo?.originalName}
            </DialogTitle>
            <DialogDescription>
              Uploaded on {selectedVideo && formatDate(selectedVideo.createdAt)}
            </DialogDescription>
          </DialogHeader>
          
          {selectedVideo && (
            <div className="space-y-4">
              {/* Video preview area */}
              <div className="relative bg-gray-100 rounded-lg overflow-hidden aspect-video">
                {(() => {
                  const streamUrl = streamUrls[selectedVideo._id];
                  
                  if (streamUrl) {
                    return (
                      <video
                        src={streamUrl}
                        controls
                        className="w-full h-full object-contain"
                        preload="metadata"
                      />
                    );
                  }
                  
                  return (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center text-gray-500">
                        <VideoIcon className="w-16 h-16 mx-auto mb-4" />
                        <p className="mb-4">Loading video...</p>
                        <Button 
                          onClick={() => getStreamUrl(selectedVideo._id)}
                          disabled={loadingStreams.has(selectedVideo._id)}
                        >
                          {loadingStreams.has(selectedVideo._id) ? (
                            <Loader2 size={16} className="mr-2 animate-spin" />
                          ) : (
                            <Play size={16} className="mr-2" />
                          )}
                          Load Video
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
              
              {/* Inventory Items from this video */}
              {(() => {
                const items = inventoryItems.filter(item => {
                  const videoId = item.sourceVideoId?._id || item.sourceVideoId;
                  return videoId === selectedVideo._id;
                });
                
                if (items.length > 0) {
                  return (
                    <div className="mb-4">
                      <h4 className="font-medium text-gray-900 mb-2">Inventory Items</h4>
                      <div className="flex flex-wrap gap-1">
                        {items.map((invItem) => {
                          const quantity = invItem.quantity || 1;
                          return Array.from({ length: quantity }, (_, index) => (
                            <ToggleGoingBadge 
                              key={`${invItem._id}-${index}`}
                              inventoryItem={invItem}
                              quantityIndex={index}
                              projectId={projectId}
                              onInventoryUpdate={onInventoryUpdate}
                              showItemName={true}
                            />
                          ));
                        }).flat()}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">File size:</span>
                      <span>{formatFileSize(selectedVideo.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Type:</span>
                      <span>{selectedVideo.mimeType}</span>
                    </div>
                    {selectedVideo.duration && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Duration:</span>
                        <span>{formatDuration(selectedVideo.duration)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-500">Uploaded:</span>
                      <span>{formatDate(selectedVideo.createdAt)}</span>
                    </div>
                  </div>
                </div>
                
                {selectedVideo.analysisResult && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Analysis Results</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Items found:</span>
                        <span>{(() => {
                          const videoInventoryItems = inventoryItems.filter(invItem => {
                            const videoId = invItem.sourceVideoId?._id || invItem.sourceVideoId;
                            return videoId === selectedVideo._id;
                          });
                          const totalCount = videoInventoryItems.reduce((total, invItem) => total + (invItem.quantity || 1), 0);
                          return totalCount > 0 ? totalCount : selectedVideo.analysisResult.itemsCount;
                        })()}</span>
                      </div>
                      {selectedVideo.analysisResult.totalBoxes && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Boxes needed:</span>
                          <span>{selectedVideo.analysisResult.totalBoxes}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-500">Status:</span>
                        <span className={`inline-block px-2 py-1 text-xs rounded ${
                          selectedVideo.analysisResult.status === 'completed' ? 'bg-green-100 text-green-800' :
                          selectedVideo.analysisResult.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                          selectedVideo.analysisResult.status === 'failed' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {selectedVideo.analysisResult.status || 'pending'}
                        </span>
                      </div>
                      {selectedVideo.analysisResult.summary && (
                        <div>
                          <span className="text-gray-500 block mb-1">Summary:</span>
                          <p className="text-gray-900">{selectedVideo.analysisResult.summary}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              {selectedVideo.description && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Description</h4>
                  <p className="text-sm text-gray-600">{selectedVideo.description}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Description Modal */}
      <Dialog open={editingVideo !== null} onOpenChange={(open) => {
        if (!open) {
          setEditingVideo(null);
          setEditDescription('');
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Video Description</DialogTitle>
            <DialogDescription>
              {editingVideo?.originalName}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="video-description">Description</Label>
              <Textarea
                id="video-description"
                placeholder="Add a description for this video..."
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={4}
                className="mt-1"
              />
            </div>
          </div>
          
          <div className="flex gap-2 pt-4">
            <Button 
              onClick={() => editingVideo && handleUpdateDescription(editingVideo)}
              disabled={isUpdating}
              className="flex-1"
            >
              {isUpdating ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Description'
              )}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => {
                setEditingVideo(null);
                setEditDescription('');
              }}
              disabled={isUpdating}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}