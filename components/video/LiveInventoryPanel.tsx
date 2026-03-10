// components/video/LiveInventoryPanel.tsx
// UI component for live inventory analysis during video calls
'use client';

import React, { useState, useCallback } from 'react';
import {
  useLiveInventoryCapture,
  RoomInventory,
  BoxRecommendation,
  ChunkAnalysisResult
} from '@/lib/hooks/useLiveInventoryCapture';
import { toast } from 'sonner';

interface LiveInventoryPanelProps {
  projectId: string;
  roomId: string;
  remoteVideoTrack: MediaStreamTrack | null;
  onInventoryCreated?: () => void;
}

export default function LiveInventoryPanel({
  projectId,
  roomId,
  remoteVideoTrack,
  onInventoryCreated
}: LiveInventoryPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [finalResult, setFinalResult] = useState<{
    totalItems: number;
    roomsSurveyed: string[];
  } | null>(null);

  const handleChunkAnalyzed = useCallback((result: ChunkAnalysisResult) => {
    if (result.itemsAdded > 0) {
      toast.success(`Found ${result.itemsAdded} new item${result.itemsAdded > 1 ? 's' : ''} in ${result.detectedRoom}`);
    }
    if (result.isRoomChange) {
      toast.info(`Room changed to: ${result.detectedRoom}`);
    }
  }, []);

  const handleRoomDetected = useCallback((room: string) => {
    console.log('Room detected:', room);
  }, []);

  const handleError = useCallback((error: Error) => {
    toast.error(`Analysis error: ${error.message}`);
    console.error('Live inventory error:', error);
  }, []);

  const {
    isCapturing,
    isProcessing,
    sessionId,
    currentRoom,
    inventory,
    boxRecommendations,
    chunks,
    chunksProcessed,
    totalItems,
    totalCuft,
    totalWeight,
    startCapture,
    stopCapture
  } = useLiveInventoryCapture({
    projectId,
    roomId,
    onChunkAnalyzed: handleChunkAnalyzed,
    onRoomDetected: handleRoomDetected,
    onError: handleError
  });

  const handleStart = async () => {
    console.log('📹 Start Analysis clicked', {
      hasRemoteVideoTrack: !!remoteVideoTrack,
      projectId,
      roomId
    });

    if (!remoteVideoTrack) {
      toast.error('No customer video available. Make sure the customer has joined and their camera is on.');
      console.error('📹 Cannot start: remoteVideoTrack is null');
      return;
    }

    try {
      console.log('📹 Calling startCapture with track:', {
        id: remoteVideoTrack.id,
        readyState: remoteVideoTrack.readyState,
        enabled: remoteVideoTrack.enabled
      });
      await startCapture(remoteVideoTrack);
      toast.success('Live inventory analysis started');
      setFinalResult(null);
    } catch (error) {
      console.error('📹 Start capture failed:', error);
      toast.error(`Failed to start analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleStop = async () => {
    const result = await stopCapture();
    if (result) {
      setFinalResult({
        totalItems: result.totalItems,
        roomsSurveyed: result.roomsSurveyed
      });
      toast.success(`Analysis complete! Found ${result.totalItems} items in ${result.roomsSurveyed.length} room(s)`);
      if (onInventoryCreated) {
        onInventoryCreated();
      }
    }
  };

  // Calculate total items across all rooms
  const getTotalItemCount = () => {
    return inventory.reduce((total, room) => total + room.items.length, 0);
  };

  // Get status color
  const getStatusColor = () => {
    if (isCapturing && isProcessing) return 'bg-yellow-500';
    if (isCapturing) return 'bg-green-500';
    return 'bg-gray-400';
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getStatusColor()} ${isCapturing ? 'animate-pulse' : ''}`} />
          <h3 className="font-medium text-gray-900">Live Inventory Analysis</h3>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          {showDetails ? 'Hide Details' : 'Show Details'}
        </button>
      </div>

      {/* Main Content */}
      <div className="p-4">
        {/* Customer Video Status */}
        {!remoteVideoTrack && !isCapturing && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 text-amber-700 text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>Waiting for customer video...</span>
            </div>
            <p className="text-xs text-amber-600 mt-1">
              The customer must join the call with their camera enabled.
            </p>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-2 mb-4">
          {!isCapturing ? (
            <button
              onClick={handleStart}
              disabled={!remoteVideoTrack}
              className={`flex-1 px-4 py-2 rounded-lg font-medium text-white transition-colors ${
                remoteVideoTrack
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-300 cursor-not-allowed'
              }`}
            >
              Start Analysis
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="flex-1 px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
            >
              Stop & Save
            </button>
          )}
        </div>

        {/* Status */}
        {isCapturing && (
          <div className="space-y-3 mb-4">
            {/* Current Room */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Current Room:</span>
              <span className="font-medium text-gray-900 bg-blue-100 px-2 py-0.5 rounded">
                {currentRoom}
              </span>
            </div>

            {/* Progress */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Chunks Processed:</span>
              <span className="font-medium text-gray-900">
                {chunksProcessed} / {chunks.length}
              </span>
            </div>

            {/* Processing indicator */}
            {isProcessing && (
              <div className="flex items-center gap-2 text-sm text-yellow-600">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>Analyzing video...</span>
              </div>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-900">{totalItems}</div>
            <div className="text-xs text-gray-500">Items</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-900">{Math.round(totalCuft)}</div>
            <div className="text-xs text-gray-500">Cu. Ft.</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-900">{Math.round(totalWeight)}</div>
            <div className="text-xs text-gray-500">Lbs</div>
          </div>
        </div>

        {/* Final Result Banner */}
        {finalResult && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 text-green-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium">Analysis Complete!</span>
            </div>
            <p className="text-sm text-green-600 mt-1">
              Found {finalResult.totalItems} items in {finalResult.roomsSurveyed.length} room(s).
              Inventory has been added to the project.
            </p>
          </div>
        )}

        {/* Detailed Inventory */}
        {showDetails && inventory.length > 0 && (
          <div className="border-t border-gray-200 pt-4 mt-4">
            <h4 className="font-medium text-gray-900 mb-3">Detected Items by Room</h4>
            <div className="space-y-4 max-h-64 overflow-y-auto">
              {inventory.map((roomInv: RoomInventory) => (
                <div key={roomInv.room} className="bg-gray-50 rounded-lg p-3">
                  <h5 className="font-medium text-gray-800 mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-500 rounded-full" />
                    {roomInv.room}
                    <span className="text-xs text-gray-500">
                      ({roomInv.items.length} items)
                    </span>
                  </h5>
                  <ul className="space-y-1">
                    {roomInv.items.slice(0, 10).map((item, idx) => (
                      <li
                        key={`${item.name}-${idx}`}
                        className="text-sm text-gray-600 flex items-center justify-between"
                      >
                        <span>
                          {item.quantity > 1 ? `${item.quantity}x ` : ''}
                          {item.name}
                        </span>
                        <span className="text-xs text-gray-400">
                          {item.cuft} cuft
                        </span>
                      </li>
                    ))}
                    {roomInv.items.length > 10 && (
                      <li className="text-xs text-gray-400 italic">
                        +{roomInv.items.length - 10} more items...
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>

            {/* Box Recommendations */}
            {boxRecommendations.length > 0 && (
              <div className="mt-4">
                <h4 className="font-medium text-gray-900 mb-3">Box Recommendations</h4>
                <div className="bg-amber-50 rounded-lg p-3">
                  <ul className="space-y-1">
                    {boxRecommendations.map((rec: BoxRecommendation, idx) => (
                      <li
                        key={`${rec.boxType}-${rec.room}-${idx}`}
                        className="text-sm text-gray-600 flex items-center justify-between"
                      >
                        <span>
                          {rec.quantity}x {rec.boxType}
                          <span className="text-xs text-gray-400 ml-1">
                            ({rec.room})
                          </span>
                        </span>
                        <span className="text-xs text-gray-400">
                          {rec.forItems.substring(0, 30)}
                          {rec.forItems.length > 30 ? '...' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Chunk Status (collapsed by default) */}
        {showDetails && chunks.length > 0 && (
          <div className="border-t border-gray-200 pt-4 mt-4">
            <h4 className="font-medium text-gray-900 mb-3">Processing Status</h4>
            <div className="flex flex-wrap gap-1">
              {chunks.map((chunk) => (
                <div
                  key={chunk.chunkIndex}
                  className={`w-6 h-6 rounded flex items-center justify-center text-xs font-medium ${
                    chunk.status === 'completed'
                      ? 'bg-green-100 text-green-700'
                      : chunk.status === 'failed'
                      ? 'bg-red-100 text-red-700'
                      : chunk.status === 'processing'
                      ? 'bg-yellow-100 text-yellow-700 animate-pulse'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                  title={`Chunk ${chunk.chunkIndex}: ${chunk.status}${
                    chunk.detectedRoom ? ` (${chunk.detectedRoom})` : ''
                  }`}
                >
                  {chunk.chunkIndex + 1}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isCapturing && inventory.length === 0 && !finalResult && (
          <div className="text-center py-4 text-gray-500 text-sm">
            <p>Click &quot;Start Analysis&quot; to begin scanning the customer&apos;s video for inventory items.</p>
            <p className="mt-1 text-xs text-gray-400">
              The AI will automatically detect items and rooms as the camera moves.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
