// app/customer/[sessionToken]/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Camera, Upload, CheckCircle, Clock, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';

interface CustomerSession {
  sessionToken: string;
  projectId: string;
  customerName: string;
  expiresAt: string;
  isActive: boolean;
  photosUploaded: number;
}

interface UploadedPhoto {
  _id: string;
  name: string;
  originalName: string;
  size: number;
  createdAt: string;
  analysisStatus: 'pending' | 'processing' | 'completed' | 'failed';
  analysisResult?: {
    summary: string;
    itemsCount: number;
  };
}

export default function CustomerPortal() {
  const params = useParams();
  const sessionToken = params.sessionToken as string;
  
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch session info and photos
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Fetch session info
      const sessionResponse = await fetch(`/api/customer/session/${sessionToken}`);
      if (!sessionResponse.ok) {
        throw new Error('Invalid or expired link');
      }
      const sessionData = await sessionResponse.json();
      setSession(sessionData);

      // Fetch photos
      const photosResponse = await fetch(`/api/customer/photos/${sessionToken}`);
      if (photosResponse.ok) {
        const photosData = await photosResponse.json();
        setPhotos(photosData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    
    try {
      for (const file of Array.from(files)) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} is not an image file`);
          continue;
        }

        // Validate file size (10MB limit)
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} is too large (max 10MB)`);
          continue;
        }

        const formData = new FormData();
        formData.append('image', file);
        formData.append('sessionToken', sessionToken);

        const response = await fetch('/api/customer/upload', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const result = await response.json();
          toast.success(`${file.name} uploaded successfully`);
          
          // Add to photos list
          setPhotos(prev => [result, ...prev]);
          
          // Update session photo count
          if (session) {
            setSession(prev => prev ? { ...prev, photosUploaded: prev.photosUploaded + 1 } : null);
          }
        } else {
          const errorData = await response.json();
          toast.error(`Failed to upload ${file.name}: ${errorData.error}`);
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      // Clear file input
      event.target.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={16} />;
      case 'processing':
        return <Clock className="text-blue-500 animate-pulse" size={16} />;
      case 'failed':
        return <AlertCircle className="text-red-500" size={16} />;
      default:
        return <Clock className="text-gray-500" size={16} />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Link Invalid</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!session || !session.isActive) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Link Expired</h2>
          <p className="text-gray-600">This upload link has expired or is no longer active.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Hi {session.customerName}! 👋
          </h1>
          <p className="text-gray-600 mb-4">
            Please upload photos of your items for your moving inventory. 
            Our AI will automatically analyze the images and add items to your inventory.
          </p>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span>📸 {session.photosUploaded} photos uploaded</span>
            <span>⏰ Expires {formatDate(session.expiresAt)}</span>
          </div>
        </div>

        {/* Upload Section */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Photos</h2>
          
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
            <input
              type="file"
              id="photo-upload"
              multiple
              accept="image/*"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
            <label
              htmlFor="photo-upload"
              className={`cursor-pointer ${uploading ? 'pointer-events-none opacity-50' : ''}`}
            >
              {uploading ? (
                <div className="flex flex-col items-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                  <p className="text-lg font-medium text-gray-700">Uploading...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Camera className="h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-lg font-medium text-gray-700 mb-2">
                    Click to upload photos
                  </p>
                  <p className="text-sm text-gray-500">
                    Or drag and drop images here (max 10MB each)
                  </p>
                </div>
              )}
            </label>
          </div>
          
          <p className="text-xs text-gray-500 mt-2 text-center">
            Supported formats: JPG, PNG, GIF • Maximum file size: 10MB
          </p>
        </div>

        {/* Photos List */}
        {photos.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Your Photos ({photos.length})
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {photos.map((photo) => (
                <div key={photo._id} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="aspect-video bg-gray-100 flex items-center justify-center">
                    <img
                      src={`/api/customer/photo/${photo._id}`}
                      alt={photo.originalName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        target.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                    <div className="hidden flex-col items-center text-gray-400">
                      <ImageIcon size={48} />
                      <p className="text-sm mt-2">Image not available</p>
                    </div>
                  </div>
                  
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-gray-900 truncate">
                        {photo.originalName}
                      </h3>
                      {getStatusIcon(photo.analysisStatus)}
                    </div>
                    
                    <div className="flex justify-between text-xs text-gray-500 mb-2">
                      <span>{formatFileSize(photo.size)}</span>
                      <span>{formatDate(photo.createdAt)}</span>
                    </div>
                    
                    {photo.analysisResult && photo.analysisStatus === 'completed' && (
                      <div className="text-xs text-green-600 bg-green-50 p-2 rounded">
                        ✓ {photo.analysisResult.itemsCount} items detected
                      </div>
                    )}
                    
                    {photo.analysisStatus === 'processing' && (
                      <div className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                        🔄 Analyzing image...
                      </div>
                    )}
                    
                    {photo.analysisStatus === 'failed' && (
                      <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                        ❌ Analysis failed
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-gray-500">
          <p>Your photos are being processed automatically.</p>
          <p>The moving company will see all analyzed items in their inventory system.</p>
        </div>
      </div>
    </div>
  );
}