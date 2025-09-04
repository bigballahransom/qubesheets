// components/RailwayTransferOverlay.tsx - Prevents users from leaving until Railway receives all images
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, CheckCircle, AlertCircle, Upload, Cloud } from 'lucide-react';

interface TransferStatus {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  pending: number;
  allTransferred: boolean;
  hasFailures: boolean;
  summary: {
    message: string;
    canLeave: boolean;
  };
}

interface RailwayTransferOverlayProps {
  jobIds: string[];
  onComplete?: () => void;
  itemType?: 'images' | 'video frames';
  totalFiles?: number;
  processedFiles?: number;
}

export default function RailwayTransferOverlay({ 
  jobIds, 
  onComplete,
  itemType = 'images',
  totalFiles,
  processedFiles
}: RailwayTransferOverlayProps) {
  const [status, setStatus] = useState<TransferStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasCalledComplete = useRef(false);
  const startTime = useRef<Date>(new Date());

  // Fetch transfer status
  const fetchStatus = useCallback(async () => {
    if (jobIds.length === 0) return;
    
    try {
      console.log('🔍 Checking transfer status for job IDs:', jobIds);
      
      const response = await fetch('/api/background-queue/transfer-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Transfer status API error:', errorData);
        throw new Error(errorData.error || 'Failed to check transfer status');
      }

      const data = await response.json();
      console.log('📊 Transfer status response:', data);
      setStatus(data);
      setError(null);

      // If all transferred, clear interval and call onComplete
      if (data.allTransferred && !hasCalledComplete.current) {
        console.log('✅ All transfers completed!');
        hasCalledComplete.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        
        // Wait a moment to show success state
        setTimeout(() => {
          if (onComplete) {
            onComplete();
          }
        }, 1500);
      }
    } catch (err) {
      console.error('❌ Failed to fetch transfer status:', err);
      setError(err instanceof Error ? err.message : 'Failed to check status');
    }
  }, [jobIds, onComplete]);

  // Check if manual tracking is complete
  useEffect(() => {
    if (totalFiles !== undefined && processedFiles !== undefined && processedFiles >= totalFiles && !hasCalledComplete.current) {
      console.log('✅ Manual tracking completed!');
      hasCalledComplete.current = true;
      
      // Wait a moment to show success state
      setTimeout(() => {
        if (onComplete) {
          onComplete();
        }
      }, 1500);
    }
  }, [totalFiles, processedFiles, onComplete]);

  // Set up polling and timeout
  useEffect(() => {
    if (jobIds.length === 0) return;

    // Initial fetch
    fetchStatus();

    // Poll every 2 seconds
    intervalRef.current = setInterval(fetchStatus, 2000);

    // Set timeout to auto-complete after 2 minutes (for stuck cases)
    timeoutRef.current = setTimeout(() => {
      console.warn('⏰ Transfer status check timed out after 2 minutes - auto-completing');
      if (!hasCalledComplete.current) {
        hasCalledComplete.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (onComplete) {
          onComplete();
        }
      }
    }, 120000); // 2 minutes timeout

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [jobIds, fetchStatus, onComplete]);

  // Prevent navigation while transferring
  useEffect(() => {
    if (!status || status.allTransferred) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Your images are still being sent to our processing server. Leaving now will cause them to get stuck. Please wait a few more seconds.';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [status]);

  // Don't show overlay if no jobs AND no manual tracking
  if (jobIds.length === 0 && totalFiles === undefined) {
    return null;
  }

  // Calculate progress percentage - use manual tracking if available
  let progress = 0;
  let isComplete = false;
  
  if (totalFiles !== undefined && processedFiles !== undefined) {
    // Use manual file tracking (for immediate UI feedback)
    progress = totalFiles > 0 ? (processedFiles / totalFiles) * 100 : 0;
    isComplete = processedFiles >= totalFiles;
  } else if (status) {
    // Fallback to job status tracking
    progress = ((status.sent + status.failed) / status.total) * 100;
    isComplete = status.allTransferred;
  }
  
  const hasErrors = status?.hasFailures || false;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 m-4 max-w-md w-full">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
            isComplete 
              ? (hasErrors ? 'bg-yellow-100' : 'bg-green-100') 
              : 'bg-blue-100'
          }`}>
            {isComplete ? (
              hasErrors ? (
                <AlertCircle className="w-10 h-10 text-yellow-600" />
              ) : (
                <CheckCircle className="w-10 h-10 text-green-600" />
              )
            ) : (
              <Cloud className="w-10 h-10 text-blue-600 animate-pulse" />
            )}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">
          {isComplete 
            ? (hasErrors ? 'Upload Complete' : 'Upload Complete!') 
            : 'Processing Your Files'}
        </h2>

        {/* Status Message */}
        <p className="text-center text-gray-600 mb-6">
          {isComplete
            ? 'Your files have been uploaded successfully!'
            : 'Please wait while we prepare your files for analysis...'
          }
        </p>


        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* Loading Animation */}
        {!isComplete && (
          <div className="flex items-center justify-center gap-3 text-blue-600">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm font-medium">Please keep this page open</span>
          </div>
        )}

        {/* Success Message */}
        {isComplete && !hasErrors && (
          <div className="text-center">
            <p className="text-green-600 font-medium">
              ✓ All done! You can close this page now.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}