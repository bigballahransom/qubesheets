'use client';

import React from 'react';
import { Scan, Play, Square, AlertCircle, CheckCircle, Loader2, Trash2, Clock } from 'lucide-react';
import { Button } from '../ui/button';

export default function SAM2DetectionTab({
  isTracking,
  objects,
  frameCount,
  lastError,
  isProcessing,
  lastProcessingTime,
  totalUniqueObjects,
  onStartTracking,
  onStopTracking,
  onClearObjects,
}) {
  // Format area to human readable size
  const formatArea = (area) => {
    if (area > 100000) return `${(area / 1000).toFixed(0)}k px²`;
    return `${area.toFixed(0)} px²`;
  };

  // Get size category based on area
  const getSizeCategory = (area) => {
    if (area > 50000) return { label: 'Large', color: 'bg-green-100 text-green-700' };
    if (area > 10000) return { label: 'Medium', color: 'bg-blue-100 text-blue-700' };
    return { label: 'Small', color: 'bg-gray-100 text-gray-600' };
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="p-4 bg-white border-b">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg ${isTracking ? 'bg-purple-100' : 'bg-gray-100'}`}>
              <Scan className={`w-5 h-5 ${isTracking ? 'text-purple-600' : 'text-gray-400'}`} />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">SAM2 Detection</h3>
              <p className="text-xs text-gray-500">Real-time object segmentation</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {objects.length > 0 && (
              <Button
                onClick={onClearObjects}
                variant="ghost"
                size="sm"
                className="text-gray-500 hover:text-red-500"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <Button
              onClick={isTracking ? onStopTracking : onStartTracking}
              variant={isTracking ? "destructive" : "default"}
              size="sm"
              className={isTracking ? '' : 'bg-purple-600 hover:bg-purple-700'}
            >
              {isTracking ? (
                <>
                  <Square className="w-4 h-4 mr-1" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-1" />
                  Start
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-gray-50 rounded-lg p-2 text-center border">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Status</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              {isProcessing ? (
                <Loader2 className="w-3 h-3 text-purple-500 animate-spin" />
              ) : isTracking ? (
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-gray-300" />
              )}
              <p className={`text-xs font-medium ${isTracking ? 'text-green-600' : 'text-gray-400'}`}>
                {isProcessing ? 'Scanning' : isTracking ? 'Active' : 'Idle'}
              </p>
            </div>
          </div>
          <div className="bg-purple-50 rounded-lg p-2 text-center border border-purple-100">
            <p className="text-[10px] text-purple-600 uppercase tracking-wide">Objects</p>
            <p className="text-lg font-bold text-purple-700">{objects.length}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-2 text-center border border-blue-100">
            <p className="text-[10px] text-blue-600 uppercase tracking-wide">Frames</p>
            <p className="text-lg font-bold text-blue-700">{frameCount}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2 text-center border">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Latency</p>
            <p className="text-sm font-semibold text-gray-700">
              {lastProcessingTime ? `${(lastProcessingTime / 1000).toFixed(1)}s` : '--'}
            </p>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {lastError && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-700">Detection Error</p>
            <p className="text-xs text-red-600 mt-0.5">{lastError}</p>
          </div>
        </div>
      )}

      {/* Objects List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-gray-700">Detected Objects</h4>
          {totalUniqueObjects > 0 && (
            <span className="text-xs text-gray-500">
              {totalUniqueObjects} unique total
            </span>
          )}
        </div>

        {objects.length === 0 ? (
          <div className="text-center py-12">
            <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-3 ${
              isTracking ? 'bg-purple-100' : 'bg-gray-100'
            }`}>
              <Scan className={`w-8 h-8 ${isTracking ? 'text-purple-400 animate-pulse' : 'text-gray-300'}`} />
            </div>
            <p className="text-sm text-gray-500">
              {isTracking ? 'Scanning for objects...' : 'Start tracking to detect objects'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {isTracking ? 'Point camera at items in the room' : 'Click Start to begin'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {objects.map((obj) => {
              const size = getSizeCategory(obj.area);
              return (
                <div
                  key={obj.id}
                  className="bg-white rounded-lg p-3 border shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-purple-200 rounded-lg flex items-center justify-center">
                        <span className="text-sm font-bold text-purple-600">#{obj.id + 1}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 capitalize">
                            {obj.label || `Object ${obj.id + 1}`}
                          </p>
                          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${size.color}`}>
                            {size.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-500">
                            {(obj.confidence * 100).toFixed(0)}% confidence
                          </span>
                          {obj.frameCount && (
                            <>
                              <span className="text-xs text-gray-400">•</span>
                              <span className="text-xs text-gray-500 flex items-center gap-0.5">
                                <Clock className="w-3 h-3" />
                                {obj.frameCount} frames
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Debug Footer (POC only) */}
      <div className="p-3 bg-gray-100 border-t text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>POC Mode • YOLO-World</span>
          <span>Capture: 10s interval</span>
        </div>
      </div>
    </div>
  );
}
