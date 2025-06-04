// app/customer-upload/[token]/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Camera, Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import CustomerPhotoUploader from '@/components/CustomerPhotoUploader';

interface UploadValidation {
  customerName: string;
  projectName: string;
  expiresAt: string;
  isValid: boolean;
}

export default function CustomerUploadPage() {
  const params = useParams();
  const token = params.token as string;
  
  const [validation, setValidation] = useState<UploadValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Validate token on load
  useEffect(() => {
    const validateToken = async () => {
      try {
        const response = await fetch(`/api/customer-upload/${token}/validate`);
        if (!response.ok) {
          throw new Error('Invalid or expired link');
        }
        const data = await response.json();
        setValidation(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid upload link');
      } finally {
        setLoading(false);
      }
    };

    if (token) {
      validateToken();
    }
  }, [token]);

  const handleFileUpload = async (file: File, description: string = '') => {
    setUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('description', description);

      const response = await fetch(`/api/customer-upload/${token}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload image');
      }

      const result = await response.json();
      setUploadedImages(prev => [...prev, result.imageId]);
      
      // Show success message
      alert('Photo uploaded successfully! We\'ll analyze it shortly.');
      
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
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
        </div>
      </div>
    );
  }

  if (error || !validation) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid Link</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Hi {validation.customerName}!
          </h1>
          <p className="text-gray-600 mb-1">
            Upload photos for your moving inventory: <strong>{validation.projectName}</strong>
          </p>
          <p className="text-sm text-gray-500">
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
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Uploaded Photos ({uploadedImages.length})
            </h3>
            <div className="space-y-2">
              {uploadedImages.map((imageId, index) => (
                <div key={imageId} className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-gray-700">
                    Photo {index + 1} uploaded successfully
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600 mt-4">
              Your photos are being analyzed. Items will appear in your moving company's inventory system shortly.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}