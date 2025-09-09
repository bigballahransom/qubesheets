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
  Loader2
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
  createdAt: string;
  updatedAt: string;
}

interface ImageGalleryProps {
  projectId: string;
  onUploadClick: () => void;
}

export default function ImageGallery({ projectId, onUploadClick }: ImageGalleryProps) {
  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<ImageData | null>(null);
  const [editingImageId, setEditingImageId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [updating, setUpdating] = useState(false);

  // Fetch images
  const fetchImages = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/images`);
      if (!response.ok) {
        throw new Error('Failed to fetch images');
      }
      const data = await response.json();
      setImages(data);
    } catch (error) {
      console.error('Error fetching images:', error);
      toast.error("Failed to load images");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImages();
  }, [projectId]);

  // Delete image
  const handleDeleteImage = async (imageId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/images/${imageId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete image');
      }
      
      setImages(prev => prev.filter(img => img._id !== imageId));
      toast.success("Image deleted successfully");
    } catch (error) {
      console.error('Error deleting image:', error);
      toast.error("Failed to delete image");
    }
  };

  // Update image description
  const handleUpdateDescription = async (imageId: string) => {
    setUpdating(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/images/${imageId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description: editDescription }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update image');
      }
      
      const updatedImage = await response.json();
      setImages(prev => prev.map(img => 
        img._id === imageId ? { ...img, description: updatedImage.description } : img
      ));
      
      setEditingImageId(null);
      setEditDescription('');
      
      toast.success("Image description updated");
    } catch (error) {
      console.error('Error updating image:', error);
      toast.error("Failed to update image");
    } finally {
      setUpdating(false);
    }
  };

  // Download image
  const handleDownloadImage = async (image: ImageData) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/images/${image._id}`);
      if (!response.ok) {
        throw new Error('Failed to download image');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = image.originalName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast.success("Image downloaded successfully");
    } catch (error) {
      console.error('Error downloading image:', error);
      toast.error("Failed to download image");
    }
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
        <span className="ml-2 text-gray-600">Loading images...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Project Images</h3>
          <p className="text-sm text-gray-500">
            {images.length} {images.length === 1 ? 'image' : 'images'} uploaded
          </p>
        </div>
        {/* <Button onClick={onUploadClick} className="flex items-center gap-2">
          <Camera size={16} />
          Upload Photo
        </Button> */}
      </div>

      {/* Empty state */}
      {images.length === 0 ? (
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
        /* Image Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {images.map((image) => (
            <Card key={image._id} className="group hover:shadow-lg transition-shadow overflow-hidden p-0">
              <div className="relative aspect-video bg-gray-100 overflow-hidden rounded-t-lg">
                  {/* Loading spinner */}
                  <div className="loading-spinner absolute inset-0 flex items-center justify-center bg-gray-100">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                  
                  <img
                    src={`/api/projects/${projectId}/images/${image._id}`}
                    alt={image.originalName}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 relative z-10"
                    onError={(e) => {
                      console.error('❌ Failed to load image thumbnail:', {
                        imageId: image._id,
                        imageName: image.originalName,
                        projectId,
                        imageSize: image.size,
                        mimeType: image.mimeType,
                        createdAt: image.createdAt,
                        url: `/api/projects/${projectId}/images/${image._id}`
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
                          <span class="text-xs text-center">Failed to load<br/>thumbnail</span>
                        `;
                        parent.appendChild(errorDiv);
                      }
                    }}
                    onLoad={(e) => {
                      console.log('✅ Successfully loaded image thumbnail:', {
                        imageId: image._id,
                        imageName: image.originalName
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
                  {/* Click overlay for entire image */}
                  <div 
                    className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-10 transition-all duration-200 cursor-pointer flex items-center justify-center"
                    onClick={() => setSelectedImage(image)}
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
                    <DropdownMenu key={`dropdown-${image._id}-${selectedImage ? 'modal-open' : 'modal-closed'}`}>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="secondary" className="h-8 w-8 p-0 relative z-20">
                          <MoreVertical size={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="z-30">
                        <DropdownMenuItem onClick={() => setSelectedImage(image)}>
                          <Eye size={16} className="mr-2" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          setEditingImageId(image._id);
                          setEditDescription(image.description || '');
                        }}>
                          <Edit3 size={16} className="mr-2" />
                          Edit Description
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDownloadImage(image)}>
                          <Download size={16} className="mr-2" />
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDeleteImage(image._id)}
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
                    <h4 className="font-medium text-gray-900 truncate">
                      {image.originalName}
                    </h4>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <Calendar size={12} />
                      {formatDate(image.createdAt)}
                    </p>
                  </div>

                  {editingImageId === image._id ? (
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
                          onClick={() => handleUpdateDescription(image._id)}
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
                          onClick={() => setEditingImageId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {image.description ? (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {image.description}
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
                    {image.processingStatus === 'processing' ? (
                      <Badge variant="secondary" className="text-xs animate-pulse">
                        <Loader2 size={10} className="mr-1 animate-spin" />
                        Processing...
                      </Badge>
                    ) : image.processingStatus === 'failed' ? (
                      <Badge variant="destructive" className="text-xs">
                        <X size={10} className="mr-1" />
                        Analysis failed
                      </Badge>
                    ) : image.processingStatus === 'timeout' ? (
                      <Badge variant="destructive" className="text-xs">
                        <X size={10} className="mr-1" />
                        Analysis timed out
                      </Badge>
                    ) : image.processingStatus === 'completed' ? (
                      <>
                        <Badge variant="secondary" className="text-xs">
                          <Package size={10} className="mr-1" />
                          {image.analysisResult?.itemsCount || 0} items
                        </Badge>
                        {image.analysisResult?.totalBoxes && image.analysisResult.totalBoxes > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {image.analysisResult.totalBoxes} boxes
                          </Badge>
                        )}
                      </>
                    ) : image.processingStatus === 'queued' ? (
                      <Badge variant="outline" className="text-xs animate-pulse">
                        <Loader2 size={10} className="mr-1 animate-spin" />
                        Queued...
                      </Badge>
                    ) : image.processingStatus === 'uploaded' ? (
                      <Badge variant="outline" className="text-xs">
                        <Loader2 size={10} className="mr-1 animate-spin" />
                        Queued...
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        <Loader2 size={10} className="mr-1 animate-spin" />
                        Analyzing...
                      </Badge>
                    )}
                  </div>

                  <div className="text-xs text-gray-500">
                    {formatFileSize(image.size)}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Image Detail Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={(open) => {
        if (!open) {
          // Small delay to ensure modal state is fully reset
          setTimeout(() => setSelectedImage(null), 10);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{selectedImage?.originalName}</DialogTitle>
            <DialogDescription>
              Uploaded on {selectedImage && formatDate(selectedImage.createdAt)}
            </DialogDescription>
          </DialogHeader>
          
          {selectedImage && (
            <div className="space-y-4">
              <div className="relative bg-gray-100 rounded-lg overflow-hidden">
                <img
                  src={`/api/projects/${projectId}/images/${selectedImage._id}`}
                  alt={selectedImage.originalName}
                  className="w-full h-auto max-h-96 object-contain"
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">File size:</span>
                      <span>{formatFileSize(selectedImage.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Type:</span>
                      <span>{selectedImage.mimeType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Uploaded:</span>
                      <span>{formatDate(selectedImage.createdAt)}</span>
                    </div>
                  </div>
                </div>
                
                {selectedImage.analysisResult && (
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Analysis Results</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Items found:</span>
                        <span>{selectedImage.analysisResult.itemsCount}</span>
                      </div>
                      {selectedImage.analysisResult.totalBoxes && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Boxes needed:</span>
                          <span>{selectedImage.analysisResult.totalBoxes}</span>
                        </div>
                      )}
                    </div>
                    {selectedImage.analysisResult.summary && (
                      <div className="mt-3">
                        <h5 className="font-medium text-gray-900 mb-1">Summary</h5>
                        <p className="text-sm text-gray-600">
                          {selectedImage.analysisResult.summary}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              {selectedImage.description && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Description</h4>
                  <p className="text-sm text-gray-600">{selectedImage.description}</p>
                </div>
              )}
              
              <div className="flex gap-2 pt-4">
                <Button onClick={() => handleDownloadImage(selectedImage)}>
                  <Download size={16} className="mr-2" />
                  Download
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setEditingImageId(selectedImage._id);
                    setEditDescription(selectedImage.description || '');
                    setSelectedImage(null);
                  }}
                >
                  <Edit3 size={16} className="mr-2" />
                  Edit Description
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    handleDeleteImage(selectedImage._id);
                    setSelectedImage(null);
                  }}
                >
                  <Trash2 size={16} className="mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      
    </div>
  );
}