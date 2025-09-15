// components/ImageGallery.tsx
'use client';

import { useState, useEffect } from 'react';
import { 
  Camera, 
  Trash2, 
  Download, 
  Eye,
  Calendar,
  FileImage,
  Package,
  MoreVertical,
  X,
  Edit3,
  Save,
  Loader2,
  Video,
  Play
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ToggleGoingBadge } from '@/components/ui/ToggleGoingBadge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface ImageData {
  _id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  description?: string;
  analysisResult?: {
    summary: string;
    itemsCount: number;
    totalBoxes?: number;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
  };
  dataUrl?: string; // Base64 data URL for direct display
  createdAt: string;
  updatedAt: string;
}

interface VideoData {
  _id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  duration?: number;
  description?: string;
  analysisResult?: {
    summary: string;
    itemsCount: number;
    totalBoxes?: number;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
  };
  s3RawFile?: {
    bucket: string;
    key: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface ImageGalleryProps {
  projectId: string;
  onUploadClick: () => void;
  refreshSpreadsheet?: () => Promise<void>;
  inventoryItems?: any[];
  onInventoryUpdate?: (inventoryItemId: string, newGoingQuantity: number) => Promise<void>;
}

type MediaItem = ImageData | VideoData;

const isVideo = (item: MediaItem): item is VideoData => {
  return item.mimeType.startsWith('video/') || 'duration' in item;
};

export default function ImageGallery({ projectId, onUploadClick, refreshSpreadsheet, inventoryItems = [], onInventoryUpdate }: ImageGalleryProps) {
  const [images, setImages] = useState<ImageData[]>([]);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [updating, setUpdating] = useState(false);
  const [streamingVideo, setStreamingVideo] = useState<string | null>(null);

  // Fetch only images (videos are handled by VideoGallery in separate tab)
  const fetchMedia = async () => {
    setLoading(true);
    try {
      const imagesResponse = await fetch(`/api/projects/${projectId}/images`);
      
      if (!imagesResponse.ok) {
        throw new Error('Failed to fetch images');
      }
      
      const imagesData = await imagesResponse.json();
      
      setImages(imagesData);
      // Clear videos since this gallery only shows images now
      setVideos([]);
    } catch (error) {
      console.error('Error fetching images:', error);
      toast.error("Failed to load images");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, [projectId]);


  // Only show images (videos are in separate tab now)
  const mediaItems: MediaItem[] = images.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Delete media item
  const handleDeleteItem = async (item: MediaItem) => {
    try {
      const endpoint = isVideo(item) 
        ? `/api/projects/${projectId}/videos/${item._id}`
        : `/api/projects/${projectId}/images/${item._id}`;
      
      const response = await fetch(endpoint, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete ${isVideo(item) ? 'video' : 'image'}`);
      }
      
      if (isVideo(item)) {
        setVideos(prev => prev.filter(vid => vid._id !== item._id));
      } else {
        setImages(prev => prev.filter(img => img._id !== item._id));
      }
      
      // Refresh the spreadsheet to reflect cascading inventory deletes
      if (refreshSpreadsheet) {
        try {
          await refreshSpreadsheet();
        } catch (error) {
          console.error('Error refreshing spreadsheet after media delete:', error);
        }
      }
      
      toast.success(`${isVideo(item) ? 'Video' : 'Image'} deleted successfully`);
    } catch (error) {
      console.error('Error deleting item:', error);
      toast.error(`Failed to delete ${isVideo(item) ? 'video' : 'image'}`);
    }
  };

  // Update media description
  const handleUpdateDescription = async (item: MediaItem) => {
    setUpdating(true);
    try {
      const endpoint = isVideo(item)
        ? `/api/projects/${projectId}/videos/${item._id}`
        : `/api/projects/${projectId}/images/${item._id}`;
      
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description: editDescription }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to update ${isVideo(item) ? 'video' : 'image'}`);
      }
      
      const updatedItem = await response.json();
      
      if (isVideo(item)) {
        setVideos(prev => prev.map(vid => 
          vid._id === item._id ? { ...vid, description: updatedItem.description } : vid
        ));
      } else {
        setImages(prev => prev.map(img => 
          img._id === item._id ? { ...img, description: updatedItem.description } : img
        ));
      }
      
      setEditingItemId(null);
      setEditDescription('');
      
      toast.success(`${isVideo(item) ? 'Video' : 'Image'} description updated`);
    } catch (error) {
      console.error('Error updating description:', error);
      toast.error(`Failed to update ${isVideo(item) ? 'video' : 'image'}`);
    } finally {
      setUpdating(false);
    }
  };

  // Download media item
  const handleDownloadItem = async (item: MediaItem) => {
    try {
      if (isVideo(item)) {
        // For videos, get streaming URL and download from S3
        const streamResponse = await fetch(`/api/projects/${projectId}/videos/${item._id}/stream`);
        if (!streamResponse.ok) {
          throw new Error('Failed to get video stream URL');
        }
        const { streamUrl } = await streamResponse.json();
        
        // Open in new tab for download
        const a = document.createElement('a');
        a.href = streamUrl;
        a.download = item.originalName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        // For images, use existing download logic
        const response = await fetch(`/api/projects/${projectId}/images/${item._id}`);
        if (!response.ok) {
          throw new Error('Failed to download image');
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.originalName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
      
      toast.success(`${isVideo(item) ? 'Video' : 'Image'} download started`);
    } catch (error) {
      console.error('Error downloading item:', error);
      toast.error(`Failed to download ${isVideo(item) ? 'video' : 'image'}`);
    }
  };

  // Stream video
  const handleStreamVideo = async (video: VideoData) => {
    try {
      setStreamingVideo(video._id);
      const response = await fetch(`/api/projects/${projectId}/videos/${video._id}/stream`);
      if (!response.ok) {
        throw new Error('Failed to get video stream URL');
      }
      const { streamUrl } = await response.json();
      
      // Open video in new tab for streaming
      window.open(streamUrl, '_blank');
    } catch (error) {
      console.error('Error streaming video:', error);
      toast.error('Failed to stream video');
    } finally {
      setStreamingVideo(null);
    }
  };

  // Format duration for videos
  const formatDuration = (seconds: number): string => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format date
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">Loading media...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Project Media</h3>
          <p className="text-sm text-gray-500">
            {images.length} {images.length === 1 ? 'image' : 'images'}, {videos.length} {videos.length === 1 ? 'video' : 'videos'} uploaded
          </p>
        </div>
        {/* <Button onClick={onUploadClick} className="flex items-center gap-2">
          <Camera size={16} />
          Upload Photo
        </Button> */}
      </div>

      {/* Empty state */}
      {mediaItems.length === 0 ? (
        <Card className="border-2 border-dashed border-gray-200 bg-gray-50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileImage className="h-12 w-12 text-gray-400 mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No images yet</h4>
            <p className="text-sm text-gray-500 text-center mb-4">
              Upload photos to automatically identify and inventory items
            </p>
            <Button onClick={onUploadClick} variant="outline">
              <Camera size={16} className="mr-2" />
              Upload Your First Photo
            </Button>
          </CardContent>
        </Card>
      ) : (
        /* Media Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {mediaItems.map((item) => (
            <Card key={item._id} className="group hover:shadow-lg transition-shadow overflow-hidden p-0">
              <div className="relative aspect-video bg-gray-100 overflow-hidden rounded-t-lg">
                  {/* Loading spinner */}
                  <div className="loading-spinner absolute inset-0 flex items-center justify-center bg-gray-100">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                  
                  {/* Image thumbnail */}
                  {!isVideo(item) && item.dataUrl ? (
                    <img
                      src={item.dataUrl}
                      alt={item.originalName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 relative z-10"
                      onError={(e) => {
                        console.error('❌ Failed to load image thumbnail from dataUrl:', {
                          imageId: item._id,
                          imageName: item.originalName,
                          projectId,
                          imageSize: item.size,
                          mimeType: item.mimeType,
                          hasDataUrl: !!item.dataUrl,
                          dataUrlPrefix: item.dataUrl ? item.dataUrl.substring(0, 50) + '...' : 'none',
                          createdAt: item.createdAt
                        });
                        
                        // Replace with error placeholder that's still clickable
                        const target = e.currentTarget as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent && !parent.querySelector('.error-placeholder')) {
                          const errorDiv = document.createElement('div');
                          errorDiv.className = 'error-placeholder absolute inset-0 flex flex-col items-center justify-center bg-gray-200 text-gray-500 pointer-events-none z-10';
                          errorDiv.innerHTML = `
                            <svg class="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 18.5c-.77.833.192 2.5 1.732 2.5z"></path>
                            </svg>
                            <span class="text-xs text-center">No image data<br/>available</span>
                          `;
                          parent.appendChild(errorDiv);
                        }
                      }}
                      onLoad={(e) => {
                        console.log('✅ Successfully loaded image thumbnail from dataUrl:', {
                          imageId: item._id,
                          imageName: item.originalName
                        });
                        
                        // Hide loading spinner
                        const target = e.currentTarget as HTMLImageElement;
                        const parent = target.parentElement;
                        if (parent) {
                          const loader = parent.querySelector('.loading-spinner');
                          if (loader) {
                            (loader as HTMLElement).style.display = 'none';
                          }
                        }
                      }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-200 text-gray-500 z-10">
                      <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs text-center">No image data<br/>available</span>
                    </div>
                  )}
                  
                  {/* Click overlay for entire image item */}
                  <div 
                    className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-10 transition-all duration-200 cursor-pointer flex items-center justify-center"
                    onClick={() => setSelectedItem(item)}
                  >
                    <Button
                      size="sm"
                      variant="secondary"
                      className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    >
                      <Eye size={16} className="mr-2" />
                      View Details
                    </Button>
                  </div>
                  <div className="absolute top-2 right-2 z-20">
                    <DropdownMenu key={`dropdown-${item._id}-${selectedItem ? 'modal-open' : 'modal-closed'}`}>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="secondary" className="h-8 w-8 p-0 relative z-20">
                          <MoreVertical size={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="z-30">
                        {isVideo(item) ? (
                          <DropdownMenuItem onClick={() => handleStreamVideo(item)}>
                            <Play size={16} className="mr-2" />
                            Stream Video
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => setSelectedItem(item)}>
                            <Eye size={16} className="mr-2" />
                            View
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => {
                          setEditingItemId(item._id);
                          setEditDescription(item.description || '');
                        }}>
                          <Edit3 size={16} className="mr-2" />
                          Edit Description
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDownloadItem(item)}>
                          <Download size={16} className="mr-2" />
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDeleteItem(item)}
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
                      {isVideo(item) && <Video size={14} className="text-blue-500" />}
                      <h4 className="font-medium text-gray-900 truncate">
                        {item.originalName}
                      </h4>
                    </div>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <Calendar size={12} />
                      {formatDate(item.createdAt)}
                    </p>
                  </div>

                  {editingItemId === item._id ? (
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
                          onClick={() => handleUpdateDescription(item)}
                          disabled={updating}
                        >
                          {updating ? (
                            <Loader2 size={12} className="mr-1 animate-spin" />
                          ) : (
                            <Save size={12} className="mr-1" />
                          )}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingItemId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {item.description ? (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {item.description}
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
                    {item.analysisResult?.status === 'processing' ? (
                      <Badge variant="secondary" className="text-xs animate-pulse">
                        <Loader2 size={10} className="mr-1 animate-spin" />
                        Processing...
                      </Badge>
                    ) : item.analysisResult?.status === 'failed' ? (
                      <Badge variant="destructive" className="text-xs">
                        <X size={10} className="mr-1" />
                        Analysis failed
                      </Badge>
                    ) : item.analysisResult?.status === 'completed' ? (
                      <>
                        <Badge variant="secondary" className="text-xs">
                          <Package size={10} className="mr-1" />
                          {(() => {
                            const imageInventoryItems = inventoryItems.filter(invItem => {
                              const imageId = invItem.sourceImageId?._id || invItem.sourceImageId;
                              return imageId === item._id;
                            });
                            const totalCount = imageInventoryItems.reduce((total, invItem) => total + (invItem.quantity || 1), 0);
                            return totalCount > 0 ? `${totalCount} items` : `${item.analysisResult.itemsCount} items`;
                          })()}
                        </Badge>
                        {item.analysisResult.totalBoxes && item.analysisResult.totalBoxes > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {item.analysisResult.totalBoxes} boxes
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
                    <span>{formatFileSize(item.size)}</span>
                    {isVideo(item) && item.duration && (
                      <span className="flex items-center gap-1">
                        <Video size={10} />
                        {formatDuration(item.duration)}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Media Detail Dialog */}
      <Dialog open={!!selectedItem && !isVideo(selectedItem)} onOpenChange={(open) => {
        if (!open) {
          // Small delay to ensure modal state is fully reset
          setTimeout(() => setSelectedItem(null), 10);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileImage size={20} className="text-blue-500" />
              {selectedItem?.originalName}
            </DialogTitle>
            <DialogDescription>
              Uploaded on {selectedItem && formatDate(selectedItem.createdAt)}
            </DialogDescription>
          </DialogHeader>
          
          {selectedItem && (
            <div className="space-y-4">
              <div className="relative bg-gray-100 rounded-lg overflow-hidden">
                {selectedItem && !isVideo(selectedItem) && selectedItem.dataUrl ? (
                  <img
                    src={selectedItem.dataUrl}
                    alt={selectedItem.originalName}
                    className="w-full h-auto max-h-96 object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                    <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-center">No image data available</span>
                  </div>
                )}
              </div>
              
              {/* Inventory Items from this image */}
              {(() => {
                const items = inventoryItems.filter(item => {
                  const imageId = item.sourceImageId?._id || item.sourceImageId;
                  return imageId === selectedItem._id;
                });
                
                if (items.length > 0) {
                  return (
                    <div className="mb-4">
                      <h4 className="font-medium text-gray-900 mb-2">Inventory Items</h4>
                      <div className="flex flex-wrap gap-1">
                        {items.map((invItem) => {
                          const quantity = invItem.quantity || 1;
                          // Create an array with length equal to quantity to show each item separately
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
                      <span>{formatFileSize(selectedItem.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Type:</span>
                      <span>{selectedItem.mimeType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Uploaded:</span>
                      <span>{formatDate(selectedItem.createdAt)}</span>
                    </div>
                  </div>
                </div>
                
                {selectedItem.analysisResult && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Analysis Results</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Items found:</span>
                        <span>{(() => {
                          const imageInventoryItems = inventoryItems.filter(invItem => {
                            const imageId = invItem.sourceImageId?._id || invItem.sourceImageId;
                            return imageId === selectedItem._id;
                          });
                          const totalCount = imageInventoryItems.reduce((total, invItem) => total + (invItem.quantity || 1), 0);
                          return totalCount > 0 ? totalCount : selectedItem.analysisResult.itemsCount;
                        })()}</span>
                      </div>
                      {selectedItem.analysisResult.totalBoxes && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Boxes needed:</span>
                          <span>{selectedItem.analysisResult.totalBoxes}</span>
                        </div>
                      )}
                    </div>
                    
                    {selectedItem.analysisResult.summary && (
                      <div className="mt-3">
                        <h5 className="font-medium text-gray-900 mb-1">Summary</h5>
                        <p className="text-sm text-gray-600">
                          {selectedItem.analysisResult.summary}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {selectedItem.description && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Description</h4>
                  <p className="text-sm text-gray-600">{selectedItem.description}</p>
                </div>
              )}
              
              {/* <div className="flex gap-2 pt-4">
                <Button onClick={() => handleDownloadItem(selectedItem)}>
                  <Download size={16} className="mr-2" />
                  Download
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setEditingItemId(selectedItem._id);
                    setEditDescription(selectedItem.description || '');
                    setSelectedItem(null);
                  }}
                >
                  <Edit3 size={16} className="mr-2" />
                  Edit Description
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    handleDeleteItem(selectedItem);
                    setSelectedItem(null);
                  }}
                >
                  <Trash2 size={16} className="mr-2" />
                  Delete
                </Button>
              </div> */}
            </div>
          )}
        </DialogContent>
      </Dialog>
      
    </div>
  );
}