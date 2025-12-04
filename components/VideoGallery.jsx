// components/VideoGallery.jsx - Display videos with playback capability
'use client';

import { useState, useEffect, useRef, memo } from 'react';
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
  Copy
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ToggleGoingBadge } from '@/components/ui/ToggleGoingBadge';

export default function VideoGallery({ projectId, onVideoSelect, refreshTrigger, onPlayingStateChange, refreshSpreadsheet, inventoryItems = [], onInventoryUpdate }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playingVideoId, setPlayingVideoId] = useState(null);
  const [streamUrls, setStreamUrls] = useState({}); // Enhanced cache for streaming URLs with TTL
  const [selectedVideo, setSelectedVideo] = useState(null); // For detail modal
  const [editingVideo, setEditingVideo] = useState(null); // For edit description modal
  const [editDescription, setEditDescription] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true); // Track page visibility for polling optimization
  const [lastInventoryFetch, setLastInventoryFetch] = useState(null); // Timestamp of last successful inventory fetch
  const [inventoryPollInterval, setInventoryPollInterval] = useState(15000); // Dynamic polling interval with exponential backoff (start at 15s)
  const [lastInventoryHash, setLastInventoryHash] = useState(null); // Hash of last inventory data to detect changes
  const [ongoingRequests, setOngoingRequests] = useState(new Set()); // Track ongoing requests to prevent duplication
  const inventoryAbortControllerRef = useRef(null); // AbortController for inventory polling
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  });
  const [deletingAll, setDeletingAll] = useState(false);
  
  // Operation states to prevent polling interference
  const [operationStates, setOperationStates] = useState({
    isDownloading: new Set(), // Track videos being downloaded by ID
    isDeleting: new Set(),    // Track videos being deleted by ID
    isMenuOpen: new Set(),    // Track which dropdown menus are open by video ID
    isPlaying: new Set(),     // Track videos currently playing by ID
  });
  
  // Ref to access current operation states without causing effect re-runs
  const operationStatesRef = useRef(operationStates);
  
  // Keep ref in sync with state
  useEffect(() => {
    operationStatesRef.current = operationStates;
  }, [operationStates]);

  // Simple hash function to detect inventory data changes
  const hashInventoryData = (items) => {
    const dataString = items.map(item => 
      `${item._id}-${item.goingQuantity || 0}-${item.updatedAt || ''}`
    ).join('|');
    return dataString;
  };

  // Enhanced cache management for stream URLs
  const STREAM_URL_TTL = 10 * 60 * 1000; // 10 minutes TTL for stream URLs
  
  const isCacheEntryValid = (cacheEntry) => {
    if (!cacheEntry || !cacheEntry.timestamp || !cacheEntry.url) return false;
    return (Date.now() - cacheEntry.timestamp) < STREAM_URL_TTL;
  };
  
  const invalidateStreamUrlCache = (videoId = null) => {
    if (videoId) {
      console.log(`🗑️ Invalidating stream URL cache for video: ${videoId}`);
      setStreamUrls(prev => {
        const updated = { ...prev };
        delete updated[videoId];
        return updated;
      });
    } else {
      console.log('🗑️ Clearing entire stream URL cache');
      setStreamUrls({});
    }
  };

  // Request deduplication helpers
  const addOngoingRequest = (requestId) => {
    setOngoingRequests(prev => new Set([...prev, requestId]));
  };
  
  const removeOngoingRequest = (requestId) => {
    setOngoingRequests(prev => {
      const updated = new Set(prev);
      updated.delete(requestId);
      return updated;
    });
  };
  
  const isRequestOngoing = (requestId) => {
    return ongoingRequests.has(requestId);
  };

  // Operation state helpers
  const addOperation = (operationType, videoId) => {
    setOperationStates(prev => ({
      ...prev,
      [operationType]: new Set([...prev[operationType], videoId])
    }));
  };

  const removeOperation = (operationType, videoId) => {
    setOperationStates(prev => {
      const updated = new Set(prev[operationType]);
      updated.delete(videoId);
      return { ...prev, [operationType]: updated };
    });
  };

  const hasActiveOperations = () => {
    const states = operationStatesRef.current;
    return states.isDownloading.size > 0 || 
           states.isDeleting.size > 0 || 
           states.isMenuOpen.size > 0 ||
           states.isPlaying.size > 0;
  };

  const getActiveOperationsList = () => {
    const states = operationStatesRef.current;
    const operations = [];
    if (states.isDownloading.size > 0) {
      operations.push(`downloading(${states.isDownloading.size})`);
    }
    if (states.isDeleting.size > 0) {
      operations.push(`deleting(${states.isDeleting.size})`);
    }
    if (states.isMenuOpen.size > 0) {
      operations.push(`menus(${states.isMenuOpen.size})`);
    }
    if (states.isPlaying.size > 0) {
      operations.push(`playing(${states.isPlaying.size})`);
    }
    return operations;
  };

  
  // Notify parent when playing state changes
  useEffect(() => {
    if (onPlayingStateChange) {
      const isPlaying = !!(playingVideoId || selectedVideo);
      onPlayingStateChange(isPlaying);
    }
  }, [playingVideoId, selectedVideo, onPlayingStateChange]);

  // Track page visibility to optimize polling
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      setIsPageVisible(isVisible);
      
      // If page becomes visible and we have videos, do an immediate inventory refresh
      // to catch any updates that happened while tab was inactive
      if (isVisible && videos.length > 0 && !playingVideoId && !selectedVideo) {
        console.log('📄 Page became visible, refreshing inventory...');
        fetchInventoryItems();
      }
    };

    // Set initial visibility state
    setIsPageVisible(!document.hidden);
    
    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [videos.length, playingVideoId, selectedVideo]);

  // Fetch inventory items for videos with smart polling optimization
  const fetchInventoryItems = async (abortSignal = null) => {
    const requestId = `inventory-${projectId}`;
    
    // Check if request is already ongoing
    if (isRequestOngoing(requestId)) {
      console.log('⏸️ Skipping inventory fetch - request already in progress');
      return;
    }
    
    // Minimum 3 seconds between fetches to prevent rapid updates
    const timeSinceLastFetch = Date.now() - (lastInventoryFetch || 0);
    if (timeSinceLastFetch < 3000) {
      console.log(`⏸️ Skipping inventory fetch - too soon (${timeSinceLastFetch}ms since last fetch)`);
      return;
    }
    
    addOngoingRequest(requestId);
    
    try {
      console.log('🔍 Fetching inventory items for project:', projectId);
      const inventoryResponse = await fetch(`/api/projects/${projectId}/inventory`, {
        signal: abortSignal || AbortSignal.timeout(20000) // 20 second timeout if no abort signal provided
      });
      if (!inventoryResponse.ok) {
        throw new Error('Failed to fetch inventory items');
      }
      
      const inventoryData = await inventoryResponse.json();
      const currentHash = hashInventoryData(inventoryData);
      const hasChanges = lastInventoryHash !== currentHash;
      
      console.log('📦 Inventory fetch result:', {
        totalItems: inventoryData.length,
        hasChanges,
        currentHash: currentHash.substring(0, 20) + '...',
        lastHash: lastInventoryHash ? lastInventoryHash.substring(0, 20) + '...' : 'null'
      });
      
      if (hasChanges) {
        console.log('✅ Inventory data changed, updating state and resetting poll interval');
        
        setLastInventoryHash(currentHash);
        setLastInventoryFetch(Date.now());
        
        // Reset polling interval to default when changes are detected
        if (inventoryPollInterval > 15000) {
          console.log('🔄 Resetting poll interval to 15s due to detected changes');
          setInventoryPollInterval(15000);
        }
        
      } else {
        console.log('⏸️ No inventory changes detected, increasing poll interval');
        
        // Implement exponential backoff (max 30 seconds)
        const newInterval = Math.min(inventoryPollInterval * 1.5, 30000);
        if (newInterval !== inventoryPollInterval) {
          console.log(`📈 Increasing poll interval from ${inventoryPollInterval}ms to ${newInterval}ms`);
          setInventoryPollInterval(newInterval);
        }
        
        setLastInventoryFetch(Date.now());
      }
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('⏸️ Inventory fetch was cancelled');
        return; // Don't treat abort as error
      }
      
      console.error('Error fetching inventory items:', error);
      
      // On error, reset to default interval
      if (inventoryPollInterval > 15000) {
        console.log('❌ Error occurred, resetting poll interval to 15s');
        setInventoryPollInterval(15000);
      }
    } finally {
      removeOngoingRequest(requestId);
    }
  };

  // Fetch videos for the project with pagination
  const fetchVideos = async (page = 1) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/videos/all?page=${page}&limit=20`, {
        signal: AbortSignal.timeout(30000) // Increased to 30 second timeout
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch videos');
      }
      
      const data = await response.json();
      console.log('🎬 VideoGallery received response:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Update videos and pagination state
      setVideos(data.videos || []);
      setPagination(data.pagination || {
        currentPage: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      });
      setCurrentPage(page);
      
      // Fetch inventory items separately (not blocking video display)
      if ((data.videos || []).length > 0) {
        setTimeout(() => fetchInventoryItems(), 100);
      }
    } catch (err) {
      console.error('Error fetching videos:', err);
      
      // Handle timeout errors specifically
      if (err.name === 'AbortError' || err.message.includes('timeout')) {
        setError('Video loading timed out. Please refresh the page or check your connection.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    fetchVideos(1);
  }, [projectId]);

  // Handle refresh trigger without interrupting playback
  useEffect(() => {
    if (!projectId || !refreshTrigger || refreshTrigger === 0) return;
    
    // Only refresh if no video is playing
    if (!playingVideoId && !selectedVideo) {
      console.log('🔄 Refresh triggered, fetching videos...');
      fetchVideos(currentPage);
    } else {
      console.log('⏸️ Skipping refresh - video is playing');
    }
  }, [refreshTrigger]);

  // Refetch inventory items periodically with smart polling
  useEffect(() => {
    const interval = setInterval(() => {
      // Only fetch if:
      // 1. Page is visible (tab is active)
      // 2. No video is currently playing (either in gallery or modal)
      // 3. No active operations (downloads, deletes, open menus)
      const activeOps = hasActiveOperations();
      if (isPageVisible && !playingVideoId && !selectedVideo && !activeOps) {
        console.log(`🔄 Smart inventory refresh (interval: ${inventoryPollInterval}ms)`);
        
        // Create new AbortController for this fetch
        const abortController = new AbortController();
        inventoryAbortControllerRef.current = abortController;
        
        fetchInventoryItems(abortController.signal).catch(error => {
          if (error.name === 'AbortError') {
            console.log('⏸️ Inventory fetch aborted due to user operation');
          } else {
            console.error('Inventory fetch error:', error);
          }
        });
      } else {
        // If we have active operations, cancel any ongoing inventory fetch
        if (inventoryAbortControllerRef.current) {
          console.log('🛑 Cancelling ongoing inventory fetch due to active operations');
          inventoryAbortControllerRef.current.abort();
          inventoryAbortControllerRef.current = null;
        }
        
        const activeOpsList = getActiveOperationsList();
        console.log('⏸️ Skipping inventory refresh:', {
          pageVisible: isPageVisible,
          playingVideoId: !!playingVideoId,
          selectedVideo: !!selectedVideo,
          activeOperations: activeOpsList.length > 0 ? activeOpsList.join(', ') : 'none',
          nextCheckIn: `${inventoryPollInterval}ms`
        });
      }
    }, inventoryPollInterval); // Use dynamic interval

    return () => {
      clearInterval(interval);
      // Clean up any ongoing fetch when component unmounts or dependencies change
      if (inventoryAbortControllerRef.current) {
        inventoryAbortControllerRef.current.abort();
        inventoryAbortControllerRef.current = null;
      }
    };
  }, [projectId, playingVideoId, selectedVideo, isPageVisible, inventoryPollInterval]);


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

  // Format date to match ImageGallery
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

  // Fetch streaming URL for S3 videos with enhanced caching and deduplication
  const getStreamUrl = async (videoId) => {
    // Defensive check for invalid videoId
    if (!videoId || typeof videoId !== 'string') {
      console.error('🎬 Invalid videoId passed to getStreamUrl:', videoId);
      return null;
    }
    
    const cacheEntry = streamUrls[videoId];
    
    // Check if we have a valid cached entry
    if (cacheEntry && isCacheEntryValid(cacheEntry)) {
      console.log(`🎬 Using cached stream URL for video ${videoId} (age: ${Math.round((Date.now() - cacheEntry.timestamp) / 1000)}s)`);
      return cacheEntry.url;
    }

    const requestId = `stream-${videoId}`;
    
    // Check if request is already ongoing
    if (isRequestOngoing(requestId)) {
      console.log(`⏸️ Stream URL request for video ${videoId} already in progress, waiting...`);
      // Wait a bit and check cache again (in case concurrent request completed)
      await new Promise(resolve => setTimeout(resolve, 500));
      const updatedCacheEntry = streamUrls[videoId];
      if (updatedCacheEntry && isCacheEntryValid(updatedCacheEntry)) {
        return updatedCacheEntry.url;
      }
      return null; // If still not available, return null
    }
    
    addOngoingRequest(requestId);

    try {
      console.log(`🎬 Fetching fresh stream URL for video ${videoId}${cacheEntry ? ' (cache expired)' : ' (not cached)'}`);
      
      // Defensive check for projectId
      if (!projectId || typeof projectId !== 'string') {
        throw new Error(`Invalid projectId: ${projectId}`);
      }
      
      const response = await fetch(`/api/projects/${projectId}/videos/${videoId}/stream`, {
        signal: AbortSignal.timeout(8000) // 8 second timeout for stream URLs
      });
      if (!response.ok) {
        throw new Error(`Failed to get stream URL: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      const url = data.streamUrl;
      
      if (!url) {
        throw new Error('Stream URL not provided in response');
      }
      
      // Cache the URL with timestamp
      const cacheEntryWithTTL = {
        url,
        timestamp: Date.now()
      };
      setStreamUrls(prev => ({ ...prev, [videoId]: cacheEntryWithTTL }));
      
      console.log(`🎬 Stream URL cached for video ${videoId} (TTL: ${STREAM_URL_TTL / 60000} minutes)`);
      return url;
    } catch (error) {
      console.error('🎬 Failed to get stream URL for video:', videoId, 'Error:', error.message);
      
      // Handle timeout errors specifically
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        console.warn('🎬 Stream URL generation timed out for video:', videoId);
      }
      
      return null;
    } finally {
      removeOngoingRequest(requestId);
    }
  };

  const handlePlayToggle = async (videoId) => {
    if (playingVideoId === videoId) {
      setPlayingVideoId(null);
      removeOperation('isPlaying', videoId);
    } else {
      // Get the streaming URL from S3
      const video = videos.find(v => v._id === videoId);
      if (video?.s3RawFile) {
        const streamUrl = await getStreamUrl(videoId);
        if (streamUrl) {
          setPlayingVideoId(videoId);
          addOperation('isPlaying', videoId);
        } else {
          console.error('🎬 Could not get streaming URL for video');
        }
      }
    }
  };

  const handleDownload = async (video) => {
    // Add operation state to prevent polling interference
    addOperation('isDownloading', video._id);
    
    // Create AbortController for this download
    const downloadAbortController = new AbortController();
    
    // Cancel any ongoing inventory poll
    if (inventoryAbortControllerRef.current) {
      console.log('🛑 Cancelling inventory poll for download operation');
      inventoryAbortControllerRef.current.abort();
      inventoryAbortControllerRef.current = null;
    }
    
    try {
      // Defensive checks and logging
      if (!projectId || typeof projectId !== 'string') {
        throw new Error(`Invalid projectId for download: ${projectId}`);
      }
      if (!video?._id || typeof video._id !== 'string') {
        throw new Error(`Invalid video._id for download: ${video._id}`);
      }

      console.log(`🎬 Downloading video: ${video.originalName} (ID: ${video._id}) from project: ${projectId}`);
      
      // For S3 videos, get the stream URL and download directly
      if (video.s3RawFile) {
        // Get or fetch the stream URL
        let streamUrl = streamUrls[video._id]?.url;
        if (!streamUrl) {
          console.log('🎬 Fetching stream URL for download...');
          streamUrl = await getStreamUrl(video._id);
        }
        
        if (!streamUrl) {
          throw new Error('Failed to get download URL');
        }
        
        console.log(`🎬 Using stream URL for download: ${streamUrl}`);
        
        // Open the S3 URL directly in a new tab for download
        // This avoids CORS issues with redirects
        const a = document.createElement('a');
        a.href = streamUrl;
        a.download = video.originalName;
        a.target = '_blank'; // Open in new tab to avoid navigation issues
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        // Fallback for non-S3 videos
        const downloadUrl = `/api/projects/${projectId}/videos/${video._id}`;
        console.log(`🎬 Download URL: ${downloadUrl}`);
        
        const response = await fetch(downloadUrl, {
          signal: downloadAbortController.signal
        });
        if (!response.ok) {
          throw new Error(`Download failed: ${response.status} ${response.statusText}`);
        }
        
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
      }
      
      console.log(`✅ Successfully downloaded: ${video.originalName}`);
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('⏸️ Download was cancelled');
        return;
      }
      console.error('🎬 Error downloading video:', error.message, 'Video:', video?.originalName);
      alert('Download failed. Please try again.');
    } finally {
      // Remove operation state when download completes or fails
      removeOperation('isDownloading', video._id);
    }
  };

  const handleDelete = async (video) => {
    if (!confirm(`Are you sure you want to delete "${video.originalName}"? This action cannot be undone.`)) {
      return;
    }

    // Add operation state to prevent polling interference
    addOperation('isDeleting', video._id);
    
    // Create AbortController for this delete
    const deleteAbortController = new AbortController();
    
    // Cancel any ongoing inventory poll
    if (inventoryAbortControllerRef.current) {
      console.log('🛑 Cancelling inventory poll for delete operation');
      inventoryAbortControllerRef.current.abort();
      inventoryAbortControllerRef.current = null;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}/videos/${video._id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Delete failed with status:', response.status, 'Error:', errorData);
        throw new Error(`Delete failed: ${response.status} ${errorData}`);
      }

      // Remove from local state
      setVideos(videos.filter(v => v._id !== video._id));
      
      // Refresh inventory items and spreadsheet to reflect cascading deletes
      if (refreshSpreadsheet) {
        try {
          // Trigger a complete refresh of inventory data to update the stat bar
          await refreshSpreadsheet();
        } catch (error) {
          console.error('Error refreshing after video delete:', error);
        }
      }
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('⏸️ Delete was cancelled or timed out');
        if (error.message && error.message.includes('timeout')) {
          alert('Delete timed out. Please check your connection and try again.');
        }
        return;
      }
      console.error('Delete failed:', error);
      alert(`Delete failed: ${error.message || 'Unknown error'}. Please try again.`);
    } finally {
      // Remove operation state when delete completes or fails
      removeOperation('isDeleting', video._id);
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
      
      alert(`Successfully deleted ${result.deletedVideos} videos and ${result.deletedInventoryItems} associated inventory items.`);
    } catch (error) {
      console.error('Bulk delete failed:', error);
      alert(`Failed to delete all videos: ${error.message}. Please try again.`);
    } finally {
      setDeletingAll(false);
    }
  };

  const handleEditDescription = (video) => {
    setEditingVideo(video);
    setEditDescription(video.description || '');
  };

  const handleSaveDescription = async () => {
    if (!editingVideo) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/videos/${editingVideo._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
        body: JSON.stringify({
          description: editDescription.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error('Update failed');
      }

      const result = await response.json();
      
      // Update the video in local state
      setVideos(videos.map(v => 
        v._id === editingVideo._id 
          ? { ...v, description: editDescription.trim() }
          : v
      ));

      // Update selectedVideo if it's the same video
      if (selectedVideo && selectedVideo._id === editingVideo._id) {
        setSelectedVideo({ ...selectedVideo, description: editDescription.trim() });
      }

      // Close the edit modal
      setEditingVideo(null);
      setEditDescription('');
      
    } catch (error) {
      console.error('Update failed:', error);
      alert('Failed to update description. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const VideoCard = memo(({ video }) => {
    const isPlaying = playingVideoId === video._id;
    const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
    const [showVideoPreview, setShowVideoPreview] = useState(false);
    
    // Only use S3 for videos
    const hasS3Video = video.s3RawFile?.key;

    // Use S3 streaming URL
    const videoUrl = hasS3Video ? streamUrls[video._id]?.url : null;
    
    // Load video thumbnail on mount
    useEffect(() => {
      const loadThumbnail = async () => {
        if (hasS3Video && !streamUrls[video._id]?.url) {
          const url = await getStreamUrl(video._id);
          if (url) {
            setShowVideoPreview(true);
          }
        } else if (streamUrls[video._id]?.url) {
          setShowVideoPreview(true);
        }
      };
      loadThumbnail();
    }, [video._id]); // Only depend on video ID, not hasS3Video to prevent re-runs
    
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow relative">
        {/* 3-dot menu */}
        <div className="absolute top-2 right-2 z-50">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="h-8 w-8 p-0 relative z-50">
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-50">
              <DropdownMenuItem onClick={async () => {
                if (video.s3RawFile && !streamUrls[video._id]?.url) {
                  await getStreamUrl(video._id);
                }
                setSelectedVideo(video);
              }}>
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
          {isPlaying && videoUrl ? (
            <video
              src={videoUrl}
              autoPlay
              loop={false}
              muted
              preload="metadata"
              controls
              className="w-full h-full object-contain"
              onError={(e) => {
                console.error('🎬 Video playback error:', e);
                setPlayingVideoId(null);
              }}
            />
          ) : (
            <>
              {showVideoPreview && videoUrl ? (
                // Show video element paused at first frame as thumbnail
                <video
                  src={videoUrl}
                  preload="metadata"
                  muted
                  className="w-full h-full object-contain"
                  onLoadedMetadata={(e) => {
                    e.target.currentTime = 0;
                    setThumbnailLoaded(true);
                  }}
                  onError={(e) => {
                    console.error('🎬 Thumbnail load error for video:', video.originalName, 'Error:', e.target?.error || 'Unknown error');
                    setShowVideoPreview(false);
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {!thumbnailLoaded && showVideoPreview ? (
                    <div className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <VideoIcon className="w-12 h-12 text-gray-400" />
                  )}
                </div>
              )}
            </>
          )}
          
          {/* Play/Pause overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <button
              onClick={() => handlePlayToggle(video._id)}
              className="bg-black bg-opacity-50 text-white p-3 rounded-full hover:bg-opacity-70 transition-all pointer-events-auto"
              disabled={!streamUrls[video._id]?.url && isPlaying}
            >
              {!streamUrls[video._id]?.url && playingVideoId === video._id ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : isPlaying ? (
                <Pause size={24} fill="white" />
              ) : (
                <Play size={24} fill="white" />
              )}
            </button>
          </div>
          
          {/* Duration badge */}
          {video.duration > 0 && (
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs">
              {formatDuration(video.duration)}
            </div>
          )}
        </div>
        
        {/* Video Info - Match ImageGallery layout */}
        <div className="p-3 cursor-pointer hover:bg-gray-50 transition-colors" onClick={() => setSelectedVideo(video)}>
          <div className="space-y-3">
            {/* Video title and date */}
            <div>
              <div className="flex items-center gap-2">
                <VideoIcon size={14} className="text-blue-500" />
                <h4 className="font-medium text-gray-900 truncate" title={video.originalName}>
                  {video.originalName}
                </h4>
              </div>
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Calendar size={12} />
                {formatDate(video.createdAt)}
              </p>
            </div>

            {/* Description */}
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

            {/* Analysis Status with badges */}
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
                  {(() => {
                    const videoInventoryItems = inventoryItems.filter(item => {
                      const videoId = item.sourceVideoId?._id || item.sourceVideoId;
                      return videoId === video._id;
                    });
                    
                    // Separate items by type
                    const regularItems = videoInventoryItems.filter(item => 
                      item.itemType === 'regular_item' || 
                      item.itemType === 'furniture' || 
                      (!item.itemType && item.itemType !== 'existing_box' && item.itemType !== 'packed_box' && item.itemType !== 'boxes_needed')
                    );
                    const existingBoxes = videoInventoryItems.filter(item => 
                      item.itemType === 'existing_box' || 
                      item.itemType === 'packed_box'
                    );
                    const recommendedBoxes = videoInventoryItems.filter(item => item.itemType === 'boxes_needed');
                    
                    const regularItemsCount = regularItems.reduce((total, item) => total + (item.quantity || 1), 0);
                    const boxesCount = existingBoxes.reduce((total, item) => total + (item.quantity || 1), 0);
                    const recommendedBoxesCount = recommendedBoxes.reduce((total, item) => total + (item.quantity || 1), 0);
                    
                    return (
                      <>
                        {regularItemsCount > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            <Package size={10} className="mr-1" />
                            {regularItemsCount} items
                          </Badge>
                        )}
                        {boxesCount > 0 && (
                          <Badge className="text-xs bg-orange-100 text-orange-800 border-orange-200">
                            {boxesCount} boxes
                          </Badge>
                        )}
                        {recommendedBoxesCount > 0 && (
                          <Badge className="text-xs bg-purple-100 text-purple-800 border-purple-200">
                            {recommendedBoxesCount} recommended
                          </Badge>
                        )}
                        {regularItemsCount === 0 && boxesCount === 0 && recommendedBoxesCount === 0 && video.analysisResult.itemsCount > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            <Package size={10} className="mr-1" />
                            {video.analysisResult.itemsCount} items
                          </Badge>
                        )}
                      </>
                    );
                  })()}
                </>
              ) : (
                <Badge variant="outline" className="text-xs">
                  <Loader2 size={10} className="mr-1 animate-spin" />
                  Analyzing...
                </Badge>
              )}
            </div>

            {/* File info */}
            <div className="text-xs text-gray-500 flex items-center justify-between">
              <span>{formatFileSize(video.size)}</span>
              {video.duration > 0 && (
                <span className="flex items-center gap-1">
                  <VideoIcon size={10} />
                  {formatDuration(video.duration)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }, (prevProps, nextProps) => {
    // Only re-render if video ID or key properties change
    return prevProps.video._id === nextProps.video._id &&
           prevProps.video.originalName === nextProps.video.originalName &&
           prevProps.video.s3RawFile?.key === nextProps.video.s3RawFile?.key;
  });
  
  VideoCard.displayName = 'VideoCard';

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
      <div>
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Project Media</h3>
              <p className="text-sm text-gray-500">
                0 videos uploaded
              </p>
            </div>
          </div>
        </div>
        <div className="border-2 border-dashed border-gray-200 bg-gray-50 rounded-lg">
          <div className="flex flex-col items-center justify-center py-12">
            <FileVideo className="h-12 w-12 text-gray-400 mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No videos yet</h4>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Project Media</h3>
            <p className="text-sm text-gray-500">
              {pagination.totalItems} {pagination.totalItems === 1 ? 'video' : 'videos'} uploaded
            </p>
          </div>
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
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {videos.map((video) => (
          <VideoCard key={video._id} video={video} />
        ))}
      </div>
      
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

      {/* Video Detail Modal */}
      <Dialog open={selectedVideo !== null} onOpenChange={async (open) => {
        if (!open) {
          setSelectedVideo(null);
        } else if (selectedVideo?.s3RawFile && !streamUrls[selectedVideo._id]?.url) {
          // Fetch streaming URL for modal video
          await getStreamUrl(selectedVideo._id);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <VideoIcon size={20} className="text-purple-500" />
              {selectedVideo?.originalName}
            </DialogTitle>
            <DialogDescription>
              Uploaded on {selectedVideo && formatDate(selectedVideo.createdAt)}
            </DialogDescription>
          </DialogHeader>
          
          {selectedVideo && (() => {
            // Use S3 for video
            const modalHasS3Video = selectedVideo.s3RawFile?.key;
            const modalVideoUrl = modalHasS3Video ? streamUrls[selectedVideo._id]?.url : null;

            return (
              <div className="space-y-4">
                {/* Video Player */}
                <div className="relative bg-gray-100 rounded-lg overflow-hidden">
                  {modalVideoUrl ? (
                    <video
                      src={modalVideoUrl}
                      controls
                      preload="metadata"
                      className="w-full h-auto max-h-96 object-contain"
                      style={{ maxHeight: '400px' }}
                      onLoadedMetadata={(e) => {
                        // Ensure video shows first frame
                        e.target.currentTime = 0;
                      }}
                    />
                  ) : (
                    <div className="w-full h-96 flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              
              {/* Items, Boxes, and Recommended Boxes from this video */}
              {(() => {
                const allItems = inventoryItems.filter(item => {
                  const videoId = item.sourceVideoId?._id || item.sourceVideoId;
                  return videoId === selectedVideo._id;
                });
                
                // Separate items by type
                const regularItems = allItems.filter(item => 
                  item.itemType === 'regular_item' || 
                  item.itemType === 'furniture' || 
                  (!item.itemType && item.itemType !== 'existing_box' && item.itemType !== 'packed_box' && item.itemType !== 'boxes_needed')
                );
                const existingBoxes = allItems.filter(item => 
                  item.itemType === 'existing_box' || 
                  item.itemType === 'packed_box'
                );
                const recommendedBoxes = allItems.filter(item => item.itemType === 'boxes_needed');
                
                if (allItems.length === 0) return null;
                
                return (
                  <div className="mb-4">
                    {/* Regular Items Section */}
                    {regularItems.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-medium text-gray-900 mb-2">Items</h4>
                        <div className="flex flex-wrap gap-1">
                          {regularItems.map((invItem) => {
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
                    )}
                    
                    {/* Existing Boxes Section */}
                    {existingBoxes.length > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-medium text-gray-900">Boxes</h4>
                          <span className="text-[10px] font-bold text-orange-700 bg-orange-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0">
                            B
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {existingBoxes.map((invItem) => {
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
                    )}
                    
                    {/* Recommended Boxes Section */}
                    {recommendedBoxes.length > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-medium text-gray-900">Recommended Boxes</h4>
                          <span className="text-[10px] font-bold text-purple-700 bg-purple-100 w-4 h-4 rounded-full inline-flex items-center justify-center flex-shrink-0">
                            R
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {recommendedBoxes.map((invItem) => {
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
                    )}
                  </div>
                );
              })()}

              {selectedVideo.analysisResult && (
                <div className="mb-4">
                  <h4 className="font-medium text-gray-900 mb-2">Analysis Results</h4>
                  <div className="space-y-2 text-sm">
                    {(() => {
                      const videoInventoryItems = inventoryItems.filter(item => {
                        const videoId = item.sourceVideoId?._id || item.sourceVideoId;
                        return videoId === selectedVideo._id;
                      });
                      
                      const regularItems = videoInventoryItems.filter(item => 
                        item.itemType === 'regular_item' || item.itemType === 'furniture'
                      );
                      
                      const boxes = videoInventoryItems.filter(item => 
                        item.itemType === 'existing_box' || item.itemType === 'packed_box'
                      );
                      
                      const recommendedBoxes = videoInventoryItems.filter(item => 
                        item.itemType === 'boxes_needed'
                      );
                      
                      const regularItemsCount = regularItems.reduce((total, item) => total + (item.quantity || 1), 0);
                      const boxesCount = boxes.reduce((total, item) => total + (item.quantity || 1), 0);
                      const recommendedBoxesCount = recommendedBoxes.reduce((total, item) => total + (item.quantity || 1), 0);
                      
                      return (
                        <>
                          {regularItemsCount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Items found:</span>
                              <span>{regularItemsCount}</span>
                            </div>
                          )}
                          {boxesCount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Boxes found:</span>
                              <span>{boxesCount}</span>
                            </div>
                          )}
                          {recommendedBoxesCount > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Recommended boxes:</span>
                              <span>{recommendedBoxesCount}</span>
                            </div>
                          )}
                          {regularItemsCount === 0 && boxesCount === 0 && recommendedBoxesCount === 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Items found:</span>
                              <span>{selectedVideo.analysisResult.itemsCount || 0}</span>
                            </div>
                          )}
                        </>
                      );
                    })()}
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

              {/* Description */}
              {selectedVideo.description && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Description</h4>
                  <p className="text-sm text-gray-600">{selectedVideo.description}</p>
                </div>
              )}
              
              {/* <div className="flex gap-2 pt-4">
                <Button onClick={() => handleDownload(selectedVideo)}>
                  <Download size={16} className="mr-2" />
                  Download
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => handleEditDescription(selectedVideo)}
                >
                  <Eye size={16} className="mr-2" />
                  Edit Description
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    handleDelete(selectedVideo);
                    setSelectedVideo(null);
                  }}
                >
                  <Trash2 size={16} className="mr-2" />
                  Delete
                </Button>
              </div> */}
            </div>
          );
          })()}
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
              onClick={handleSaveDescription}
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