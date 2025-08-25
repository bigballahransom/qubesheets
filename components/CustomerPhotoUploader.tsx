// components/CustomerPhotoUploader.tsx
'use client';

import { useState, useRef } from 'react';
import { Camera, Upload, Loader2 } from 'lucide-react';

interface CustomerPhotoUploaderProps {
  onUpload: (file: File, description?: string) => Promise<void>;
  uploading: boolean;
}

// Helper function to detect HEIC files
function isHeicFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  return (
    fileName.endsWith('.heic') || 
    fileName.endsWith('.heif') ||
    mimeType === 'image/heic' ||
    mimeType === 'image/heif'
  );
}

// Modern HEIC to JPEG conversion using heic-to library
async function convertHeicToJpeg(file: File): Promise<File> {
  // Ensure we're running on client-side
  if (typeof window === 'undefined') {
    throw new Error('HEIC conversion only available on client-side');
  }
  
  let retryCount = 0;
  const maxRetries = 2;
  
  while (retryCount <= maxRetries) {
    try {
      console.log(`🔄 Starting HEIC conversion attempt ${retryCount + 1} for:`, file.name, 'Size:', file.size);
      
      // Validate that we have a valid File object
      if (!file || !(file instanceof File)) {
        throw new Error('Invalid file object provided for conversion');
      }
      
      // Check if file is actually HEIC
      if (!isHeicFile(file)) {
        throw new Error('File is not a valid HEIC/HEIF file');
      }
      
      console.log('🔧 Loading heic-to library...');
      
      // Dynamic import with timeout - heic-to is more reliable than heic2any
      const importPromise = import('heic-to');
      const timeoutPromise = new Promise((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('Library import timeout')), 15000);
      });
      
      const { heicTo } = await Promise.race([importPromise, timeoutPromise]) as any;
      
      console.log('📦 heic-to loaded, starting conversion...');
      
      // Set up conversion with timeout - heic-to uses a simpler API
      const conversionPromise = heicTo({
        blob: file,
        type: 'image/jpeg',
        quality: 0.85 // Good balance of quality and compatibility
      });
      
      const conversionTimeoutPromise = new Promise((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('HEIC conversion timeout after 45 seconds')), 45000);
      });
      
      const convertedBlob = await Promise.race([conversionPromise, conversionTimeoutPromise]);
      
      if (!convertedBlob || convertedBlob.size === 0) {
        throw new Error('Conversion resulted in empty blob');
      }
      
      // Create a new File object with converted data
      const convertedFile = new File(
        [convertedBlob],
        file.name.replace(/\.(heic|heif)$/i, '.jpg'),
        { 
          type: 'image/jpeg',
          lastModified: Date.now()
        }
      );
      
      console.log('✅ HEIC conversion successful:', convertedFile.name, 'Size:', convertedFile.size);
      return convertedFile;
      
    } catch (error) {
      console.error(`❌ HEIC conversion attempt ${retryCount + 1} failed:`, error);
      
      retryCount++;
      
      if (retryCount > maxRetries) {
        // Handle different error types and provide meaningful messages
        let errorMessage = 'Failed to convert HEIC image after multiple attempts.';
        
        if (error instanceof Error && error.message) {
          if (error.message.includes('timeout')) {
            errorMessage = 'HEIC conversion timed out. This file may be too large or complex. Try reducing file size or using a different image.';
          } else if (error.message.includes('Library import')) {
            errorMessage = 'Failed to load HEIC conversion library. Please check your internet connection and try again.';
          } else {
            errorMessage = `HEIC conversion failed: ${error.message}`;
          }
        } else if (error && typeof error === 'object' && Object.keys(error).length === 0) {
          errorMessage = 'HEIC conversion failed due to an internal library error. This may be due to browser compatibility, memory constraints, or a corrupted HEIC file.';
        } else if (typeof error === 'string') {
          errorMessage = `HEIC conversion failed: ${error}`;
        }
        
        throw new Error(errorMessage);
      }
      
      // Wait before retry with exponential backoff
      const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  // This should never be reached, but TypeScript requires it
  throw new Error('HEIC conversion failed after all retry attempts');
}

export default function CustomerPhotoUploader({ onUpload, uploading }: CustomerPhotoUploaderProps) {
  const [description, setDescription] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;

    try {
      // Check if file is a supported image type or HEIC
      const isRegularImage = file.type.startsWith('image/');
      const isHeic = isHeicFile(file);
      
      if (!isRegularImage && !isHeic) {
        alert('Please select a valid image file (JPEG, PNG, GIF, HEIC, or HEIF)');
        return;
      }

      let finalFile = file;

      // Try client-side HEIC conversion
      if (isHeic) {
        setIsConverting(true);
        try {
          finalFile = await convertHeicToJpeg(file);
          console.log('✅ Client-side HEIC conversion successful');
        } catch (conversionError) {
          console.log('⚠️ Client-side HEIC conversion failed, server will handle it');
          // Don't show alert - let server handle the conversion
          finalFile = file; // Keep original HEIC file for server processing
        } finally {
          setIsConverting(false);
        }
      }

      // Upload the processed file
      await onUpload(finalFile, description);
      setDescription('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error processing file:', error);
      alert('Failed to process the selected file. Please try again.');
      setIsConverting(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Description Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Photo Description (Optional)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g., Living room items, Kitchen appliances..."
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={uploading || isConverting}
        />
      </div>

      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : uploading || isConverting
            ? 'border-gray-200 bg-gray-50'
            : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif"
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading || isConverting}
        />

        {uploading ? (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-500" />
            <p className="text-gray-600">Uploading photo...</p>
          </div>
        ) : isConverting ? (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-500" />
            <p className="text-blue-600 font-medium">Converting HEIC image...</p>
            <p className="text-sm text-blue-500">Please wait while we convert your image to a compatible format</p>
          </div>
        ) : (
          <div className="space-y-4">
            <Camera className="w-12 h-12 mx-auto text-gray-400" />
            <div>
              <p className="text-lg font-medium text-gray-700 mb-2">
                Upload a photo of your items
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Drag and drop an image here, or click to select
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                <Upload className="w-5 h-5" />
                Select Photo
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 text-center">
        Supported formats: JPG, PNG, GIF, HEIC, HEIF (max 10MB)
      </p>
    </div>
  );
}
