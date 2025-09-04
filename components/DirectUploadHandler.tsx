// components/DirectUploadHandler.tsx - Handle direct uploads to Cloudinary with fallback
'use client';

import { useState, useCallback } from 'react';
import { uploadVideoDirectly, uploadImageDirectly } from '@/lib/directCloudinaryUpload';

export interface UploadResult {
  success: boolean;
  data?: any;
  error?: string;
}

interface DirectUploadHandlerProps {
  onUploadStart?: () => void;
  onUploadProgress?: (progress: number) => void;
  onUploadComplete?: (result: UploadResult) => void;
  onUploadError?: (error: string) => void;
  uploadPreset: string;
  maxFileSize?: number; // in bytes
  acceptedTypes?: string[];
}

export default function DirectUploadHandler({
  onUploadStart,
  onUploadProgress,
  onUploadComplete,
  onUploadError,
  uploadPreset,
  maxFileSize = 100 * 1024 * 1024, // 100MB default
  acceptedTypes = ['image/*', 'video/*']
}: DirectUploadHandlerProps) {
  const [isUploading, setIsUploading] = useState(false);
  
  const uploadFile = useCallback(async (
    file: File, 
    options: {
      saveMetadataUrl: string;
      additionalData?: any;
      cloudinaryOptions?: any;
    }
  ): Promise<UploadResult> => {
    if (!file) {
      const error = 'No file provided';
      onUploadError?.(error);
      return { success: false, error };
    }
    
    // Validate file size
    if (file.size > maxFileSize) {
      const error = `File size (${(file.size / (1024 * 1024)).toFixed(2)}MB) exceeds maximum allowed size (${(maxFileSize / (1024 * 1024)).toFixed(2)}MB)`;
      onUploadError?.(error);
      return { success: false, error };
    }
    
    // Validate file type
    const isAccepted = acceptedTypes.some(type => {
      if (type.endsWith('/*')) {
        return file.type.startsWith(type.slice(0, -1));
      }
      return file.type === type;
    });
    
    if (!isAccepted) {
      const error = `File type ${file.type} is not accepted. Allowed types: ${acceptedTypes.join(', ')}`;
      onUploadError?.(error);
      return { success: false, error };
    }
    
    setIsUploading(true);
    onUploadStart?.();
    onUploadProgress?.(0);
    
    try {
      console.log('📤 Starting direct upload for:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        uploadPreset
      });
      
      // Determine if it's a video or image
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      
      if (!isVideo && !isImage) {
        throw new Error('File must be an image or video');
      }
      
      // Step 1: Upload directly to Cloudinary
      onUploadProgress?.(20);
      
      let cloudinaryResult;
      if (isVideo) {
        cloudinaryResult = await uploadVideoDirectly(file, uploadPreset, {
          folder: options.cloudinaryOptions?.folder || 'qubesheets/uploads',
          context: 'direct_upload=true',
          ...options.cloudinaryOptions
        });
      } else {
        cloudinaryResult = await uploadImageDirectly(file, uploadPreset, {
          folder: options.cloudinaryOptions?.folder || 'qubesheets/uploads', 
          context: 'direct_upload=true',
          ...options.cloudinaryOptions
        });
      }
      
      console.log('✅ Direct Cloudinary upload successful:', cloudinaryResult);
      onUploadProgress?.(60);
      
      // Step 2: For images, also get base64 data for analysis
      let imageBuffer = null;
      if (isImage) {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const img = new Image();
          
          await new Promise((resolve, reject) => {
            img.onload = () => {
              canvas.width = img.width;
              canvas.height = img.height;
              ctx?.drawImage(img, 0, 0);
              imageBuffer = canvas.toDataURL('image/jpeg', 0.8);
              resolve(null);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
          });
          
          console.log('📊 Generated base64 data for analysis');
        } catch (base64Error) {
          console.warn('⚠️ Could not generate base64 for analysis:', base64Error);
          // Continue without base64 - metadata will still be saved
        }
      }
      
      onUploadProgress?.(80);
      
      // Step 3: Save metadata to our database
      const metadataPayload = {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        cloudinaryResult,
        imageBuffer, // Only for images
        ...options.additionalData
      };
      
      console.log('💾 Saving metadata to:', options.saveMetadataUrl);
      
      const metadataResponse = await fetch(options.saveMetadataUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadataPayload)
      });
      
      if (!metadataResponse.ok) {
        const errorData = await metadataResponse.text();
        throw new Error(`Metadata save failed: ${metadataResponse.status} - ${errorData}`);
      }
      
      const metadataResult = await metadataResponse.json();
      console.log('✅ Metadata saved successfully:', metadataResult);
      
      onUploadProgress?.(100);
      
      const result: UploadResult = {
        success: true,
        data: {
          ...metadataResult,
          cloudinaryResult,
          fileInfo: {
            name: file.name,
            size: file.size,
            type: file.type
          }
        }
      };
      
      onUploadComplete?.(result);
      return result;
      
    } catch (error) {
      console.error('❌ Direct upload failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      
      onUploadError?.(errorMessage);
      return { success: false, error: errorMessage };
      
    } finally {
      setIsUploading(false);
      onUploadProgress?.(0);
    }
  }, [uploadPreset, maxFileSize, acceptedTypes, onUploadStart, onUploadProgress, onUploadComplete, onUploadError]);
  
  return {
    uploadFile,
    isUploading
  };
}

// Hook version for easier use
export function useDirectUpload(props: DirectUploadHandlerProps) {
  return DirectUploadHandler(props);
}