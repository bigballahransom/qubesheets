'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Video,
  Play,
  Download,
  Calendar,
  Clock,
  Users,
  Loader2,
  AlertCircle,
  FileVideo,
  CheckCircle2,
  XCircle,
  Pause,
  MoreVertical,
  TrendingUp,
  Package,
  Target,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import VideoRecordingModal from './VideoRecordingModal';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const VideoRecordingsTab = ({ projectId, projectName, refreshTrigger = 0, refreshSpreadsheet }) => {
  const [recordings, setRecordings] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedRecording, setSelectedRecording] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    totalCount: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  });
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const recordingsRef = useRef(recordings);

  // Group inventory items by recording ID (ObjectId) and session ID (string) for lookup
  const inventoryByRecordingId = useMemo(() => {
    const map = {};
    inventoryItems.forEach(item => {
      // Group by ObjectId (primary link from video analysis pipeline)
      // Handle both populated objects (._id) and unpopulated ObjectIds
      if (item.sourceVideoRecordingId) {
        const id = (item.sourceVideoRecordingId._id || item.sourceVideoRecordingId).toString();
        if (!map[id]) map[id] = [];
        map[id].push(item);
      }
      // Also group by session ID (backwards compatibility with older items)
      if (item.sourceRecordingSessionId) {
        if (!map[item.sourceRecordingSessionId]) {
          map[item.sourceRecordingSessionId] = [];
        }
        map[item.sourceRecordingSessionId].push(item);
      }
    });
    return map;
  }, [inventoryItems]);

  // Fetch inventory items for this project
  const fetchInventoryItems = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/inventory`);
      if (response.ok) {
        const items = await response.json();
        setInventoryItems(items);
      }
    } catch (err) {
      console.error('Error fetching inventory items:', err);
    }
  }, [projectId]);

  // Filter out superseded recordings (partial recordings that were stitched)
  // Users should only see ONE video per call session
  const visibleRecordings = useMemo(() => {
    return recordings.filter(r => r.status !== 'superseded');
  }, [recordings]);

  // Calculate statistics (only for visible/non-superseded recordings)
  const recordingStats = useMemo(() => {
    const completed = visibleRecordings.filter(r => r.status === 'completed').length;
    const processing = visibleRecordings.filter(r => r.status === 'processing').length;
    const failed = visibleRecordings.filter(r => r.status === 'failed').length;
    const totalDuration = visibleRecordings
      .filter(r => r.duration && r.status === 'completed')
      .reduce((sum, r) => sum + r.duration, 0);

    return {
      total: visibleRecordings.length,
      completed,
      processing,
      failed,
      totalDuration: Math.round(totalDuration / 60) // Convert to minutes
    };
  }, [visibleRecordings]);

  const handleOpenModal = (recording) => {
    setSelectedRecording(recording);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    // Small delay before clearing recording to allow modal animation to complete
    setTimeout(() => setSelectedRecording(null), 100);
  };

  const fetchRecordings = useCallback(async (page = 1, silentUpdate = false) => {
    try {
      if (!silentUpdate) {
        setLoading(true);
        setError(null);
      }
      
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString(),
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      const response = await fetch(
        `/api/projects/${projectId}/video-recordings?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch video recordings');
      }

      const data = await response.json();
      
      // Check for status changes if this is a silent update
      if (silentUpdate && recordingsRef.current.length > 0) {
        const prevRecordings = new Map(recordingsRef.current.map(r => [r._id, {
          status: r.status,
          analysisStatus: r.analysisResult?.status
        }]));

        let shouldRefetchInventory = false;

        data.recordings?.forEach(recording => {
          const prev = prevRecordings.get(recording._id);

          // Check if recording status changed to completed
          if (prev?.status && prev.status !== 'completed' && recording.status === 'completed') {
            toast.success(`Recording ${recording.roomId.split('-').pop()} is ready to view!`);
            shouldRefetchInventory = true;
          }

          // Check if analysis status changed to completed (inventory items now exist)
          if (prev?.analysisStatus &&
              prev.analysisStatus !== 'completed' &&
              recording.analysisResult?.status === 'completed') {
            shouldRefetchInventory = true;
          }
        });

        // Refetch inventory if any recording or analysis completed
        if (shouldRefetchInventory) {
          fetchInventoryItems();
        }
      }
      
      setRecordings(data.recordings || []);
      setPagination(data.pagination || {});
      
    } catch (err) {
      console.error('Error fetching recordings:', err);
      if (!silentUpdate) {
        setError('Failed to load video recordings. Please try again.');
        toast.error('Failed to load video recordings');
      }
    } finally {
      if (!silentUpdate) {
        setLoading(false);
      }
    }
  }, [projectId, pagination.limit]);

  // Update recordings ref when recordings change
  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  useEffect(() => {
    if (projectId) {
      fetchRecordings(1);
      fetchInventoryItems();
    }
  }, [projectId, fetchInventoryItems]);

  // Respond to refresh trigger from parent (InventoryManager)
  useEffect(() => {
    if (refreshTrigger > 0 && projectId) {
      console.log('🔄 VideoRecordingsTab: Refresh triggered by parent');
      fetchRecordings(pagination.page, true); // Silent update
      fetchInventoryItems();
    }
  }, [refreshTrigger]);

  // Auto-refresh effect for processing recordings
  useEffect(() => {
    // Check if we have any processing recordings (including analysis in progress)
    const hasProcessing = recordings.some(r =>
      r.status === 'starting' || r.status === 'recording' || r.status === 'processing' ||
      r.analysisResult?.status === 'processing' || r.analysisResult?.status === 'queued'
    );
    
    if (!hasProcessing || !projectId) {
      setIsPolling(false);
      return;
    }

    // Start polling
    setIsPolling(true);
    
    // Set up polling interval
    const pollInterval = setInterval(() => {
      // Only poll if the page is visible
      if (document.visibilityState === 'visible') {
        fetchRecordings(pagination.page, true);
      }
    }, 5000); // Poll every 5 seconds

    // Clean up interval on unmount or when conditions change
    return () => {
      clearInterval(pollInterval);
      setIsPolling(false);
    };
  }, [recordings, projectId, pagination.page, fetchRecordings]);

  // Visibility change listener to immediately check when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isPolling) {
        // Immediately fetch when tab becomes visible
        fetchRecordings(pagination.page, true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isPolling, pagination.page, fetchRecordings]);

  const handleDownload = async (recording) => {
    try {
      toast('Preparing download...', { duration: 2000 });
      
      // Fetch signed download URL
      const response = await fetch(`/api/projects/${projectId}/video-recordings/${recording._id}/stream`);
      
      if (!response.ok) {
        throw new Error('Failed to get download URL');
      }
      
      const data = await response.json();
      
      const link = document.createElement('a');
      link.href = data.streamUrl;
      link.download = `recording-${recording.roomId}-${new Date(recording.createdAt).toLocaleDateString()}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Download started');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download recording');
    }
  };

  const handleDownloadAll = async () => {
    const completedRecordings = visibleRecordings.filter(r => r.status === 'completed');

    if (completedRecordings.length === 0) {
      toast.error('No completed recordings to download');
      return;
    }

    setDownloadingAll(true);

    try {
      // Dynamic import to avoid SSR issues with buffer polyfill
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      toast(`Preparing ${completedRecordings.length} recordings for download...`);

      // Fetch each recording and add to zip
      for (const recording of completedRecordings) {
        try {
          const response = await fetch(`/api/projects/${projectId}/video-recordings/${recording._id}/stream`);
          if (response.ok) {
            const data = await response.json();
            const videoResponse = await fetch(data.streamUrl);
            if (videoResponse.ok) {
              const blob = await videoResponse.blob();
              const filename = `recording-${recording.roomId.split('-').pop()}-${new Date(recording.createdAt).toLocaleDateString().replace(/\//g, '-')}.mp4`;
              zip.file(filename, blob);
            }
          }
        } catch (err) {
          console.error(`Failed to add recording:`, err);
        }
      }

      // Generate and download zip
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName || 'project'}-video-calls-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(`Downloaded ${completedRecordings.length} recordings as zip`);
    } catch (error) {
      console.error('Download all failed:', error);
      toast.error('Failed to download recordings');
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleDelete = async (recording) => {
    const meetingName = formatMeetingName(recording.participants);
    if (!confirm(`Are you sure you want to delete "${meetingName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      toast('Deleting recording...', { duration: 2000 });

      const response = await fetch(
        `/api/projects/${projectId}/video-recordings/${recording._id}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete recording');
      }

      // Remove from local state
      setRecordings(recordings.filter(r => r._id !== recording._id));
      toast.success('Recording deleted successfully');

      // Refresh spreadsheet to update inventory items
      if (refreshSpreadsheet) {
        try {
          await refreshSpreadsheet();
        } catch (error) {
          console.error('Error refreshing after recording delete:', error);
        }
      }
    } catch (error) {
      console.error('Delete failed:', error);
      toast.error(`Delete failed: ${error.message}`);
    }
  };

  const handleDeleteAll = async () => {
    const confirmMessage = `Are you sure you want to delete ALL ${pagination.totalCount} video call recordings? This action cannot be undone.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    // Double confirmation for safety
    if (!confirm(`This will permanently delete ${pagination.totalCount} recordings. Are you absolutely sure?`)) {
      return;
    }

    setDeletingAll(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/video-recordings/all`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete recordings');
      }

      const result = await response.json();
      console.log('✅ Bulk delete successful:', result);

      // Clear local state
      setRecordings([]);
      setPagination({
        page: 1,
        limit: 20,
        totalCount: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      });

      toast.success(`Deleted all video call recordings`);

      // Refresh spreadsheet to update inventory items
      if (refreshSpreadsheet) {
        try {
          await refreshSpreadsheet();
        } catch (error) {
          console.error('Error refreshing after bulk delete:', error);
        }
      }
    } catch (error) {
      console.error('Delete all failed:', error);
      toast.error(`Delete failed: ${error.message}`);
    } finally {
      setDeletingAll(false);
    }
  };

  // Determine display status based on recording and analysis state
  const getDisplayStatus = (recording) => {
    // Recording still in progress (egress running)
    if (['waiting', 'starting', 'recording'].includes(recording.status)) {
      return recording.status;
    }

    // Recording completed - check analysis status
    if (recording.status === 'completed') {
      // Analysis in progress (queued, processing, or pipeline processing)
      if (recording.analysisResult?.status === 'queued' ||
          recording.analysisResult?.status === 'processing' ||
          recording.processingPipeline?.status === 'processing') {
        return 'analysis_in_progress';
      }

      // Analysis completed successfully
      if (recording.analysisResult?.status === 'completed' ||
          recording.processingPipeline?.status === 'completed') {
        return 'completed';
      }

      // Analysis failed
      if (recording.analysisResult?.status === 'failed' ||
          recording.processingPipeline?.status === 'failed') {
        return 'analysis_failed';
      }

      // Legacy: customerVideoS3Key exists but no analysis status (old recordings)
      if (recording.customerVideoS3Key && !recording.analysisResult?.status) {
        return 'analysis_failed';
      }

      // Video ready, no analysis triggered yet
      return 'completed';
    }

    return recording.status;
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'recording':
        return <Pause className="w-4 h-4 text-blue-500" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />;
      case 'failed':
      case 'analysis_failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'analysis_in_progress':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      completed: {
        className: 'bg-green-100 text-green-800 border-green-200',
        icon: <CheckCircle2 className="w-3 h-3" />
      },
      recording: {
        className: 'bg-blue-100 text-blue-800 border-blue-200',
        icon: <Pause className="w-3 h-3" />
      },
      processing: {
        className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        icon: <Loader2 className="w-3 h-3 animate-spin" />
      },
      failed: {
        className: 'bg-red-100 text-red-800 border-red-200',
        icon: <XCircle className="w-3 h-3" />
      },
      analysis_failed: {
        className: 'bg-red-100 text-red-800 border-red-200',
        icon: <XCircle className="w-3 h-3" />
      },
      analysis_in_progress: {
        className: 'bg-blue-100 text-blue-800 border-blue-200',
        icon: <Loader2 className="w-3 h-3 animate-spin" />
      },
      starting: {
        className: 'bg-gray-100 text-gray-800 border-gray-200',
        icon: <Clock className="w-3 h-3" />
      }
    };

    const config = statusConfig[status] || statusConfig.starting;

    // Custom text for different statuses
    let statusText;
    if (status === 'processing') {
      statusText = 'Getting your call ready to view';
    } else if (status === 'analysis_failed') {
      statusText = 'Analysis Failed';
    } else if (status === 'analysis_in_progress') {
      statusText = 'Analyzing...';
    } else {
      statusText = status.charAt(0).toUpperCase() + status.slice(1);
    }

    return (
      <Badge className={cn("inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border", config.className)}>
        {config.icon}
        {statusText}
      </Badge>
    );
  };

  const formatMeetingName = (participants) => {
    if (!participants || participants.length === 0) return projectName || 'Video Call';

    const agent = participants.find(p => p.type === 'agent');
    const agentName = agent?.name || 'Agent';

    // Use project name instead of customer name for cleaner display
    return `${agentName} <> ${projectName || 'Customer'}`;
  };

  const formatRelativeDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    // Compare dates only (ignore time)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const recordDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today - recordDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return days[date.getDay()];
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">Loading video calls...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="w-8 h-8 text-red-500 mb-4" />
        <p className="text-red-600 mb-4">{error}</p>
        <Button onClick={() => fetchRecordings(1)} variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Customer Video Calls</h3>
          <p className="text-sm text-gray-600 mt-1">
            {pagination.totalCount} recording{pagination.totalCount !== 1 ? 's' : ''} found
          </p>
        </div>
        {visibleRecordings.length > 0 && (
          <div className="flex items-center gap-2">
            {visibleRecordings.filter(r => r.status === 'completed').length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadAll}
                disabled={downloadingAll}
                className="flex items-center gap-2"
              >
                {downloadingAll ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Download All
                  </>
                )}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteAll}
              disabled={deletingAll}
              className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              {deletingAll ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete All
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Recordings Grid */}
      {visibleRecordings.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 bg-gray-50 rounded-lg p-12">
          <div className="text-center">
            <FileVideo className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No recordings</h3>
            <p className="mt-1 text-sm text-gray-500">
              Video calls will automatically be recorded and appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRecordings.map((recording, index) => (
            <div
              key={recording._id}
              className="group border border-gray-200 rounded-lg bg-white flex items-center justify-between py-3 px-4 hover:bg-gray-50 cursor-pointer transition-colors shadow-sm"
              onClick={() => recording.status === 'completed' && handleOpenModal(recording)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Letter Avatar */}
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-600 font-medium text-sm">
                  {(recording.participants?.find(p => p.type === 'agent')?.name || 'A').charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Meeting Name */}
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-900 truncate">
                      {formatMeetingName(recording.participants)}
                    </h3>
                    {(() => {
                      const displayStatus = getDisplayStatus(recording);
                      // Show badge for non-completed status OR analysis_failed
                      if (displayStatus !== 'completed') {
                        return (
                          <span className="flex-shrink-0">
                            {getStatusBadge(displayStatus)}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  {/* Analysis Status Badge - only show if actively processing/queued (not failed) */}
                  {(recording.analysisResult?.status === 'processing' || recording.analysisResult?.status === 'queued') &&
                   getDisplayStatus(recording) !== 'analysis_failed' && (
                    <div className="flex gap-1 mt-1">
                      <Badge variant="secondary" className="text-xs px-1.5 py-0.5 animate-pulse">
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        {recording.analysisResult?.status === 'queued' ? 'Queued' : 'Processing'}
                      </Badge>
                    </div>
                  )}

                  {/* Inventory Badges */}
                  {(() => {
                    // Check both sessionId and egressId for items
                    const sessionInventory = inventoryByRecordingId[recording._id?.toString()] || inventoryByRecordingId[recording.sessionId] || inventoryByRecordingId[recording.egressId] || inventoryByRecordingId[recording.customerEgressId] || [];
                    if (sessionInventory.length === 0) return null;

                    const furnitureItems = sessionInventory.filter(i => i.itemType === 'furniture' || i.itemType === 'regular_item');
                    const packedBoxes = sessionInventory.filter(i => i.itemType === 'packed_box' || i.itemType === 'existing_box');
                    const boxesNeeded = sessionInventory.filter(i => i.itemType === 'boxes_needed');

                    const furnitureCount = furnitureItems.reduce((sum, i) => sum + (i.quantity || 1), 0);
                    const boxCount = packedBoxes.reduce((sum, i) => sum + (i.quantity || 1), 0);
                    const neededCount = boxesNeeded.reduce((sum, i) => sum + (i.quantity || 1), 0);

                    return (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {furnitureCount > 0 && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
                            <Package className="w-3 h-3 mr-1" />
                            {furnitureCount} item{furnitureCount !== 1 ? 's' : ''}
                          </Badge>
                        )}
                        {boxCount > 0 && (
                          <Badge className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-800 border-orange-200">
                            {boxCount} box{boxCount !== 1 ? 'es' : ''}
                          </Badge>
                        )}
                        {neededCount > 0 && (
                          <Badge className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-800 border-purple-200">
                            {neededCount} needed
                          </Badge>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                {/* Relative Date */}
                <span className="text-sm text-gray-500 whitespace-nowrap">
                  {formatRelativeDate(recording.startedAt || recording.createdAt)}
                </span>

                {/* Actions Dropdown */}
                <DropdownMenu
                  open={openDropdownId === recording._id}
                  onOpenChange={(open) => setOpenDropdownId(open ? recording._id : null)}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-50" onClick={(e) => e.stopPropagation()}>
                    {recording.status === 'completed' ? (
                      <>
                        <DropdownMenuItem
                          onSelect={() => {
                            setOpenDropdownId(null);
                            setTimeout(() => handleOpenModal(recording), 100);
                          }}
                        >
                          <Play className="w-4 h-4 mr-2" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setOpenDropdownId(null);
                            setTimeout(() => handleDownload(recording), 100);
                          }}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </DropdownMenuItem>
                        {/* Rerun Analysis - for completed recordings */}
                        <DropdownMenuItem
                          onSelect={async () => {
                            setOpenDropdownId(null);
                            try {
                              toast('Starting analysis rerun...');
                              const response = await fetch(
                                `/api/projects/${projectId}/video-recordings/${recording._id}/reprocess`,
                                { method: 'POST' }
                              );
                              if (response.ok) {
                                toast.success('Analysis restarted!');
                                fetchRecordings(pagination.page);
                              } else {
                                const result = await response.json();
                                toast.error(result.error || 'Failed to restart analysis');
                              }
                            } catch (error) {
                              toast.error('Error restarting analysis');
                            }
                          }}
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Rerun Analysis
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            setOpenDropdownId(null);
                            setTimeout(() => handleDelete(recording), 100);
                          }}
                          className="text-red-600 focus:text-red-600 focus:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <>
                        <div className="px-2 py-1.5 text-xs text-gray-500">
                          {recording.status === 'starting' && 'Recording is starting...'}
                          {recording.status === 'recording' && 'Recording in progress...'}
                          {recording.status === 'processing' && 'Processing video...'}
                          {recording.status === 'failed' && 'Recording failed'}
                          {getDisplayStatus(recording) === 'analysis_failed' && 'Analysis failed - click to retry'}
                        </div>
                        {/* Fix Status button for stuck starting/recording */}
                        {(recording.status === 'starting' || recording.status === 'recording') && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={async () => {
                                setOpenDropdownId(null);
                                try {
                                  toast('Checking recording status...');
                                  const response = await fetch(
                                    `/api/projects/${projectId}/video-recordings/fix-status`,
                                    {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ roomId: recording.roomId })
                                    }
                                  );

                                  const result = await response.json();

                                  if (response.ok) {
                                    toast.success('Recording status updated!');
                                    fetchRecordings(pagination.page);
                                  } else {
                                    toast.error(result.error || 'Failed to fix recording');
                                  }
                                } catch (error) {
                                  toast.error('Error fixing recording status');
                                }
                              }}
                            >
                              <AlertCircle className="w-4 h-4 mr-2" />
                              Fix Status
                            </DropdownMenuItem>
                          </>
                        )}
                        {/* Rerun Analysis button for analysis_failed recordings */}
                        {getDisplayStatus(recording) === 'analysis_failed' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={async () => {
                                setOpenDropdownId(null);
                                try {
                                  toast('Starting analysis rerun...');
                                  const response = await fetch(
                                    `/api/projects/${projectId}/video-recordings/${recording._id}/reprocess`,
                                    { method: 'POST' }
                                  );
                                  if (response.ok) {
                                    toast.success('Analysis restarted!');
                                    fetchRecordings(pagination.page);
                                  } else {
                                    const result = await response.json();
                                    toast.error(result.error || 'Failed to restart analysis');
                                  }
                                } catch (error) {
                                  toast.error('Error restarting analysis');
                                }
                              }}
                            >
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Rerun Analysis
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            setOpenDropdownId(null);
                            setTimeout(() => handleDelete(recording), 100);
                          }}
                          className="text-red-600 focus:text-red-600 focus:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-1 justify-between sm:hidden">
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasPrevPage}
              onClick={() => fetchRecordings(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasNextPage}
              onClick={() => fetchRecordings(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                Showing page {pagination.page} of {pagination.totalPages}
              </p>
            </div>
            <div>
              <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasPrevPage}
                  onClick={() => fetchRecordings(pagination.page - 1)}
                  className="rounded-r-none"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasNextPage}
                  onClick={() => fetchRecordings(pagination.page + 1)}
                  className="rounded-l-none"
                >
                  Next
                </Button>
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Video Playback Modal */}
      {isModalOpen && selectedRecording && (
        <VideoRecordingModal
          recording={selectedRecording}
          projectId={projectId}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          inventoryItems={inventoryItems}
          onInventoryUpdate={fetchInventoryItems}
        />
      )}
    </div>
  );
};

export default VideoRecordingsTab;