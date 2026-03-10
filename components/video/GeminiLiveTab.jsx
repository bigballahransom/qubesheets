'use client';

import React from 'react';
import {
  Wifi, WifiOff, Play, Square, AlertCircle, CheckCircle,
  Loader2, RefreshCw, Package, Download, Trash2
} from 'lucide-react';
import { Button } from '../ui/button';

export default function GeminiLiveTab({
  isConnected,
  isStreaming,
  inventory,
  sessionDuration,
  reconnectCount,
  error,
  onConnect,
  onDisconnect,
  onStartStreaming,
  onStopStreaming,
  onClearInventory,
  onExportInventory,
}) {
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getItemTypeColor = (itemType) => {
    switch (itemType) {
      case 'furniture': return 'bg-purple-100 text-purple-700';
      case 'packed_box': return 'bg-blue-100 text-blue-700';
      case 'boxes_needed': return 'bg-orange-100 text-orange-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const getItemTypeLabel = (itemType) => {
    switch (itemType) {
      case 'furniture': return 'Furniture';
      case 'packed_box': return 'Packed';
      case 'boxes_needed': return 'Needs Box';
      default: return 'Item';
    }
  };

  const getItemTypeIcon = (itemType) => {
    // Could expand this with different icons per type
    return <Package className="w-5 h-5 text-purple-600" />;
  };

  // Calculate totals
  const totalCuft = inventory.reduce((sum, item) => sum + (item.cuft * (item.quantity || 1)), 0);
  const totalWeight = inventory.reduce((sum, item) => sum + (item.weight * (item.quantity || 1)), 0);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="p-4 bg-white border-b">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-lg ${isConnected ? 'bg-green-100' : 'bg-gray-100'}`}>
              {isConnected ? (
                <Wifi className="w-5 h-5 text-green-600" />
              ) : (
                <WifiOff className="w-5 h-5 text-gray-400" />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Gemini Live</h3>
              <p className="text-xs text-gray-500">
                {isStreaming ? 'Streaming video...' : isConnected ? 'Connected' : 'Disconnected'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {inventory.length > 0 && (
              <Button
                onClick={onClearInventory}
                variant="ghost"
                size="sm"
                className="text-gray-500 hover:text-red-500"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            {!isConnected ? (
              <Button
                onClick={() => {
                  console.log('Connect button clicked');
                  onConnect();
                }}
                size="sm"
                className="bg-green-600 hover:bg-green-700"
              >
                Connect
              </Button>
            ) : !isStreaming ? (
              <Button onClick={onStartStreaming} size="sm" className="bg-purple-600 hover:bg-purple-700">
                <Play className="w-4 h-4 mr-1" />
                Start
              </Button>
            ) : (
              <Button onClick={onStopStreaming} variant="destructive" size="sm">
                <Square className="w-4 h-4 mr-1" />
                Stop
              </Button>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-5 gap-2">
          <div className="bg-gray-50 rounded-lg p-2 text-center border">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Status</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              {isStreaming ? (
                <Loader2 className="w-3 h-3 text-purple-500 animate-spin" />
              ) : isConnected ? (
                <span className="w-2 h-2 rounded-full bg-green-500" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-gray-300" />
              )}
              <p className={`text-xs font-medium ${isStreaming ? 'text-purple-600' : isConnected ? 'text-green-600' : 'text-gray-400'}`}>
                {isStreaming ? 'Live' : isConnected ? 'Ready' : 'Offline'}
              </p>
            </div>
          </div>
          <div className="bg-purple-50 rounded-lg p-2 text-center border border-purple-100">
            <p className="text-[10px] text-purple-600 uppercase tracking-wide">Items</p>
            <p className="text-lg font-bold text-purple-700">{inventory.length}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-2 text-center border border-green-100">
            <p className="text-[10px] text-green-600 uppercase tracking-wide">Cu.Ft</p>
            <p className="text-sm font-semibold text-green-700">{totalCuft.toFixed(1)}</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-2 text-center border border-orange-100">
            <p className="text-[10px] text-orange-600 uppercase tracking-wide">Weight</p>
            <p className="text-sm font-semibold text-orange-700">{totalWeight} lbs</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-2 text-center border border-blue-100">
            <p className="text-[10px] text-blue-600 uppercase tracking-wide">Duration</p>
            <p className="text-sm font-semibold text-blue-700">{formatDuration(sessionDuration)}</p>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-700">Connection Error</p>
            <p className="text-xs text-red-600 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Inventory List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-gray-700">Detected Inventory</h4>
          {inventory.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onExportInventory}>
              <Download className="w-4 h-4 mr-1" />
              Export
            </Button>
          )}
        </div>

        {inventory.length === 0 ? (
          <div className="text-center py-12">
            <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-3 ${
              isStreaming ? 'bg-purple-100' : 'bg-gray-100'
            }`}>
              <Package className={`w-8 h-8 ${isStreaming ? 'text-purple-400 animate-pulse' : 'text-gray-300'}`} />
            </div>
            <p className="text-sm text-gray-500">
              {isStreaming ? 'Scanning for items...' : isConnected ? 'Click Start to begin scanning' : 'Connect to start scanning'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {isStreaming ? 'Point camera at furniture and items' : 'Gemini Live will track inventory automatically'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {inventory.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-lg p-3 border shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-purple-200 rounded-lg flex items-center justify-center">
                      {getItemTypeIcon(item.itemType)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 capitalize">
                          {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                        </p>
                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${getItemTypeColor(item.itemType)}`}>
                          {getItemTypeLabel(item.itemType)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500">{item.cuft} cuft</span>
                        <span className="text-xs text-gray-400">•</span>
                        <span className="text-xs text-gray-500">{item.weight} lbs</span>
                        {item.room && (
                          <>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-gray-500">{item.room}</span>
                          </>
                        )}
                        {item.for_items && (
                          <>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-gray-400 italic truncate max-w-[100px]">{item.for_items}</span>
                          </>
                        )}
                        {item.special_handling && (
                          <>
                            <span className="text-xs text-gray-400">•</span>
                            <span className="text-xs text-orange-500 italic truncate max-w-[100px]">{item.special_handling}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 bg-gray-100 border-t text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>Gemini Live API • 1 FPS streaming</span>
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
            Session memory {isConnected ? 'active' : 'inactive'}
          </span>
        </div>
      </div>
    </div>
  );
}
