// components/dev/QueueMonitor.tsx - Development tool to monitor background queue

'use client';

import { useState, useEffect } from 'react';
import { Activity, Clock, CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';

interface QueueStatus {
  queueLength: number;
  processing: boolean;
  workers: number;
  maxWorkers: number;
  items: Array<{
    id: string;
    type: string;
    retries: number;
    scheduledFor: string;
    createdAt: string;
  }>;
  timestamp: string;
}

export default function QueueMonitor() {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/background-queue/status');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setStatus(data);
    } catch (err) {
      console.error('Error fetching queue status:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      setLoading(false);
    }
  };

  const addTestJob = async () => {
    try {
      const response = await fetch('/api/background-queue/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' })
      });
      
      if (response.ok) {
        await fetchStatus(); // Refresh after adding test job
      }
    } catch (err) {
      console.error('Error adding test job:', err);
    }
  };

  // Auto-refresh effect
  useEffect(() => {
    fetchStatus(); // Initial fetch
    
    if (autoRefresh) {
      const interval = setInterval(fetchStatus, 2000); // Refresh every 2 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString();
  };

  const getStatusIcon = (item: any) => {
    const now = new Date();
    const scheduledFor = new Date(item.scheduledFor);
    
    if (scheduledFor > now) {
      return <Clock className="w-4 h-4 text-yellow-500" />;
    } else if (item.retries > 0) {
      return <XCircle className="w-4 h-4 text-red-500" />;
    } else {
      return <Activity className="w-4 h-4 text-blue-500" />;
    }
  };

  if (process.env.NODE_ENV === 'production') {
    return null; // Don't show in production
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-4 max-w-md w-full z-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />
          Queue Monitor
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`p-1 rounded ${autoRefresh ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}
            title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-1 rounded bg-blue-100 text-blue-600 hover:bg-blue-200 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-2 rounded mb-3 text-sm">
          {error}
        </div>
      )}

      {status && (
        <div className="space-y-3">
          {/* Queue Stats */}
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="bg-gray-50 p-2 rounded text-center">
              <div className="font-semibold text-gray-900">{status.queueLength}</div>
              <div className="text-gray-600">Queued</div>
            </div>
            <div className="bg-blue-50 p-2 rounded text-center">
              <div className="font-semibold text-blue-900">{status.workers}/{status.maxWorkers}</div>
              <div className="text-blue-600">Workers</div>
            </div>
            <div className={`p-2 rounded text-center ${status.processing ? 'bg-green-50' : 'bg-gray-50'}`}>
              <div className={`font-semibold ${status.processing ? 'text-green-900' : 'text-gray-900'}`}>
                {status.processing ? 'ON' : 'OFF'}
              </div>
              <div className={status.processing ? 'text-green-600' : 'text-gray-600'}>
                Processing
              </div>
            </div>
          </div>

          {/* Queue Items */}
          {status.items.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">Queue Items:</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {status.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-xs">
                    {getStatusIcon(item)}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{item.type}</div>
                      <div className="text-gray-500">
                        {item.retries > 0 ? `Retry ${item.retries}` : 'Pending'} • 
                        {formatTime(item.scheduledFor)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 text-center py-2">
              No items in queue
            </div>
          )}

          {/* Development Actions */}
          <div className="border-t pt-2">
            <button
              onClick={addTestJob}
              className="w-full py-1 px-2 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              Add Test Job
            </button>
          </div>

          <div className="text-xs text-gray-500 text-center">
            Last updated: {formatTime(status.timestamp)}
          </div>
        </div>
      )}
    </div>
  );
}