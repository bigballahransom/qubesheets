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
  Target
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

const VideoRecordingsTab = ({ projectId }) => {
  const [recordings, setRecordings] = useState([]);
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
  const recordingsRef = useRef(recordings);

  // Calculate statistics
  const recordingStats = useMemo(() => {
    const completed = recordings.filter(r => r.status === 'completed').length;
    const processing = recordings.filter(r => r.status === 'processing').length;
    const failed = recordings.filter(r => r.status === 'failed').length;
    const totalDuration = recordings
      .filter(r => r.duration && r.status === 'completed')
      .reduce((sum, r) => sum + r.duration, 0);
    
    return {
      total: recordings.length,
      completed,
      processing,
      failed,
      totalDuration: Math.round(totalDuration / 60) // Convert to minutes
    };
  }, [recordings]);

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
        const prevRecordings = new Map(recordingsRef.current.map(r => [r._id, r.status]));
        data.recordings?.forEach(recording => {
          const prevStatus = prevRecordings.get(recording._id);
          if (prevStatus && prevStatus !== 'completed' && recording.status === 'completed') {
            toast.success(`Recording ${recording.roomId.split('-').pop()} is ready to view!`);
          }
        });
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
    }
  }, [projectId]);

  // Auto-refresh effect for processing recordings
  useEffect(() => {
    // Check if we have any processing recordings
    const hasProcessing = recordings.some(r => 
      r.status === 'starting' || r.status === 'recording' || r.status === 'processing'
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

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'recording':
        return <Pause className="w-4 h-4 text-blue-500" />;
      case 'processing':
        return <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
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
      starting: {
        className: 'bg-gray-100 text-gray-800 border-gray-200',
        icon: <Clock className="w-3 h-3" />
      }
    };

    const config = statusConfig[status] || statusConfig.starting;

    return (
      <Badge className={cn("inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border", config.className)}>
        {config.icon}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatParticipants = (participants) => {
    if (!participants || participants.length === 0) return 'Unknown';
    
    const agent = participants.find(p => p.type === 'agent');
    const customer = participants.find(p => p.type === 'customer');
    
    return `${agent?.name || 'Agent'} & ${customer?.name || 'Customer'}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-600">Loading video recordings...</p>
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
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Customer Video Calls</h3>
        <p className="text-sm text-gray-600 mt-1">
          {pagination.totalCount} recording{pagination.totalCount !== 1 ? 's' : ''} found
        </p>
      </div>

      {/* Recordings Grid */}
      {recordings.length === 0 ? (
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recordings.map((recording) => (
            <Card 
              key={recording._id} 
              className="group relative hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => recording.status === 'completed' && handleOpenModal(recording)}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <Video className="w-4 h-4 text-gray-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-gray-900 truncate">
                        Call room: {recording.roomId.split('-').pop()}
                      </h3>
                      <p className="text-xs text-gray-500 truncate">
                        Video ID: {recording.egressId}
                      </p>
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                        <Calendar className="w-3 h-3" />
                        {new Date(recording.createdAt).toLocaleDateString()}
                      </div>
                      <div className="mt-1">
                        {getStatusBadge(recording.status)}
                      </div>
                    </div>
                  </div>
                  
                  {/* Actions Dropdown */}
                  <DropdownMenu 
                    open={openDropdownId === recording._id}
                    onOpenChange={(open) => setOpenDropdownId(open ? recording._id : null)}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 w-8 p-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-50">
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
                        </>
                      ) : (
                        <>
                          <div className="px-2 py-1.5 text-xs text-gray-500">
                            {recording.status === 'starting' && 'Recording is starting...'}
                            {recording.status === 'recording' && 'Recording in progress...'}
                            {recording.status === 'processing' && 'Processing video...'}
                            {recording.status === 'failed' && 'Recording failed'}
                          </div>
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
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
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
        />
      )}
    </div>
  );
};

export default VideoRecordingsTab;