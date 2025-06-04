// app/customer-upload/[token]/page.tsx - Updated with toast notifications
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2, ImageIcon } from 'lucide-react';
import CustomerPhotoUploader from '@/components/CustomerPhotoUploader';
import { toast } from 'sonner';

interface UploadValidation {
  customerName: string;
  projectName: string;
  expiresAt: string;
  isValid: boolean;
}

interface UploadedImage {
  id: string;
  name: string;
  uploadedAt: string;
}

export default function CustomerUploadPage() {
  const params = useParams();
  const token = params.token as string;
  
  const [validation, setValidation] = useState<UploadValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);

  // Validate token on load
  useEffect(() => {
    const validateToken = async () => {
      if (!token) {
        setError('No upload token provided');
        setLoading(false);
        return;
      }

      try {
        console.log('Validating token:', token);
        
        const response = await fetch(`/api/customer-upload/${token}/validate`);
        
        console.log('Validation response status:', response.status);
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Invalid or expired link');
        }
        
        const data = await response.json();
        console.log('Validation data:', data);
        
        setValidation(data);
      } catch (err) {
        console.error('Validation error:', err);
        setError(err instanceof Error ? err.message : 'Invalid upload link');
      } finally {
        setLoading(false);
      }
    };

    validateToken();
  }, [token]);

  const handleFileUpload = async (file: File, description: string = '') => {
    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('description', description);

      console.log('Uploading file:', file.name);

      const response = await fetch(`/api/customer-upload/${token}/upload`, {
        method: 'POST',
        body: formData,
      });

      console.log('Upload response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to upload image');
      }

      const result = await response.json();
      console.log('Upload result:', result);
      
      // Add to uploaded images list
      const newImage: UploadedImage = {
        id: result.imageId,
        name: file.name,
        uploadedAt: new Date().toISOString()
      };
      
      setUploadedImages(prev => [...prev, newImage]);
      
      // Show success message with toast
      toast.success('Photo uploaded successfully! We\'ll analyze it and add items to your inventory shortly.');
      
    } catch (err) {
      console.error('Upload error:', err);
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-500" />
          <p className="text-gray-600">Validating upload link...</p>
          <p className="text-sm text-gray-500 mt-2">Token: {token}</p>
        </div>
      </div>
    );
  }

  if (error || !validation) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Upload Link Issue</h1>
          <p className="text-gray-600 mb-4">{error}</p>
          <div className="text-left bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-700 mb-2"><strong>Debug Info:</strong></p>
            <p className="text-xs text-gray-600">Token: {token || 'No token'}</p>
            <p className="text-xs text-gray-600">URL: {typeof window !== 'undefined' ? window.location.href : 'N/A'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="text-center mb-4">
            <ImageIcon className="w-12 h-12 text-blue-500 mx-auto mb-2" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Hi {validation.customerName}!
            </h1>
          </div>
          <p className="text-gray-600 mb-1 text-center">
            Upload photos for your moving inventory
          </p>
          <p className="text-center">
            <strong className="text-blue-600">{validation.projectName}</strong>
          </p>
          <p className="text-sm text-gray-500 text-center mt-2">
            Link expires: {new Date(validation.expiresAt).toLocaleDateString()}
          </p>
        </div>

        {/* Upload Area */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <CustomerPhotoUploader
            onUpload={handleFileUpload}
            uploading={uploading}
          />
        </div>

        {/* Upload Status */}
        {uploadedImages.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              Uploaded Photos ({uploadedImages.length})
            </h3>
            <div className="space-y-3">
              {uploadedImages.map((image, index) => (
                <div key={image.id} className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <ImageIcon className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{image.name}</p>
                    <p className="text-sm text-gray-600">
                      Uploaded {new Date(image.uploadedAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <CheckCircle className="w-5 h-5 text-green-500" />
                </div>
              ))}
            </div>
            <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-800 font-medium mb-1">
                📊 What happens next?
              </p>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Your photos are being analyzed by AI</li>
                <li>• Items will be automatically identified and cataloged</li>
                <li>• Your moving company will see everything in their system</li>
                <li>• You'll get a complete inventory for your move</li>
              </ul>
            </div>
          </div>
        )}

        {/* Instructions for first upload */}
        {uploadedImages.length === 0 && (
          <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
            <h3 className="text-lg font-semibold text-blue-900 mb-3">
              📸 Upload Tips
            </h3>
            <ul className="text-sm text-blue-800 space-y-2">
              <li>• Take clear, well-lit photos of your items</li>
              <li>• Include multiple angles for large furniture</li>
              <li>• Group similar items together when possible</li>
              <li>• Add descriptions to help with identification</li>
              <li>• Upload as many photos as needed</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}