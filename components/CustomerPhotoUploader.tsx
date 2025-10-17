// components/CustomerPhotoUploader.tsx
'use client';

import { useState, useRef } from 'react';
import { Camera, Upload, Loader2, Video } from 'lucide-react';

interface CustomerPhotoUploaderProps {
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
}

// Video file detection (now enabled with S3 support)
function isVideoFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  console.log('🎬 Customer video file detection:', {
    name: file.name,
    type: file.type,
    size: file.size
  });
  
  const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
  const hasVideoExtension = videoExtensions.some(ext => fileName.endsWith(ext));
  const hasVideoMimeType = mimeType.startsWith('video/');
  
  return hasVideoExtension || hasVideoMimeType;
}

// Check video duration (max 1 minute)
async function checkVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video metadata'));
    };
    
    video.src = url;
  });
}

// Enhanced HEIC file detection for iPhone compatibility
function isHeicFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  // Log file details for debugging iPhone issues
  console.log('🔍 Customer uploader file analysis:', {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  });
  
  const isHeicByExtension = fileName.endsWith('.heic') || fileName.endsWith('.heif');
  const isHeicByMimeType = mimeType === 'image/heic' || mimeType === 'image/heif';
  
  // iPhone sometimes doesn't set proper MIME types, so check for empty MIME type with HEIC extension
  const isPotentialIPhoneHeic = (mimeType === '' || mimeType === 'application/octet-stream') && 
                                isHeicByExtension;
  
  const result = isHeicByExtension || isHeicByMimeType || isPotentialIPhoneHeic;
  
  console.log('📱 Customer uploader HEIC detection result:', {
    isHeicByExtension,
    isHeicByMimeType,
    isPotentialIPhoneHeic,
    finalResult: result
  });
  
  return result;
}

// Universal image processing for mobile devices - handles ANY image type and size
async function processImageForMobile(file: File): Promise<File> {
  // Always process on mobile or for large files (regardless of device)
  const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
  const isLargeFile = file.size > 3 * 1024 * 1024; // 3MB threshold
  const isVeryLargeFile = file.size > 10 * 1024 * 1024; // 10MB threshold
  
  // Process if mobile OR file is large
  if (!isMobile && !isLargeFile) {
    return file;
  }
  
  const deviceType = isMobile ? (navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Mobile') : 'Desktop';
  console.log(`📱 Customer uploader: Processing ${deviceType} image: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`);
  
  try {
    // Create a canvas to process the image
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get canvas context');
    
    // Create an image element with error handling
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Handle CORS issues
    
    // Use createObjectURL for better memory management
    const imageUrl = URL.createObjectURL(file);
    
    return new Promise((resolve, reject) => {
      // Set up timeout to prevent hanging
      const timeout = setTimeout(() => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error('Image processing timeout'));
      }, 30000); // 30 second timeout
      
      img.onload = () => {
        clearTimeout(timeout);
        try {
          // Calculate new dimensions based on file size and device
          let maxDimension = 2048; // Default
          if (isVeryLargeFile) {
            maxDimension = 1920; // Reduce for very large files
          } else if (isMobile) {
            maxDimension = 1600; // Smaller for mobile to save memory
          }
          
          let { width, height } = img;
          let needsResize = width > maxDimension || height > maxDimension;
          
          if (needsResize) {
            if (width > height) {
              height = (height * maxDimension) / width;
              width = maxDimension;
            } else {
              width = (width * maxDimension) / height;
              height = maxDimension;
            }
          }
          
          // Set canvas size
          canvas.width = width;
          canvas.height = height;
          
          // Draw with anti-aliasing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          
          // Determine quality based on original file size
          let quality = 0.8; // Default
          if (isVeryLargeFile) {
            quality = 0.7; // More compression for very large files
          } else if (file.size < 5 * 1024 * 1024) {
            quality = 0.9; // Less compression for smaller files
          }
          
          // Convert to blob with compression
          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(imageUrl);
              
              if (!blob) {
                reject(new Error('Failed to process image'));
                return;
              }
              
              // Create processed file with proper naming
              let newName = file.name;
              if (!newName.toLowerCase().endsWith('.jpg') && !newName.toLowerCase().endsWith('.jpeg')) {
                newName = file.name.replace(/\.[^.]*$/, '.jpg');
              }
              
              const processedFile = new File(
                [blob],
                newName,
                {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                }
              );
              
              const reductionPercent = ((1 - processedFile.size / file.size) * 100).toFixed(1);
              console.log(`✅ Customer uploader: ${deviceType} image processed: ${(processedFile.size / (1024 * 1024)).toFixed(2)}MB (${reductionPercent}% reduction)`);
              resolve(processedFile);
            },
            'image/jpeg',
            quality
          );
        } catch (error) {
          clearTimeout(timeout);
          URL.revokeObjectURL(imageUrl);
          reject(error);
        }
      };
      
      img.onerror = (error) => {
        clearTimeout(timeout);
        URL.revokeObjectURL(imageUrl);
        console.error('❌ Customer uploader: Failed to load image for processing:', error);
        reject(new Error('Failed to load image - file may be corrupted or unsupported'));
      };
      
      img.src = imageUrl;
    });
  } catch (error) {
    console.warn(`⚠️ Customer uploader: ${deviceType} image processing failed, using original:`, error);
    return file;
  }
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
  const [dragActive, setDragActive] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);


  const handleFile = async (file: File) => {
    if (!file) return;

    try {
      const isMobile = typeof window !== 'undefined' && /iphone|ipad|android|mobile/i.test(navigator.userAgent);
      
      console.log(`📱 Customer upload - Mobile detection:`, {
        isMobile,
        userAgent: navigator.userAgent.substring(0, 100),
        fileDetails: {
          name: file.name,
          size: file.size,
          type: file.type || 'empty',
          lastModified: file.lastModified
        }
      });
      
      // File type detection - support both images and videos
      const isRegularImage = file.type.startsWith('image/');
      const isHeic = isHeicFile(file);
      const isVideo = isVideoFile(file);
      
      // Special handling for iPhone photos that may have empty MIME types
      const isPotentialImage = file.type === '' || file.type === 'application/octet-stream';
      const hasImageExtension = /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
      
      console.log(`📹 File type detection:`, {
        fileName: file.name,
        mimeType: file.type,
        isVideo,
        isRegularImage,
        isHeic
      });
      
      if (!isRegularImage && !isHeic && !isVideo && !(isPotentialImage && hasImageExtension)) {
        const errorMsg = isMobile 
          ? 'Please select a photo or video from your device.'
          : 'Please select a valid image (JPEG, PNG, GIF, HEIC, HEIF) or video (MP4, MOV, AVI, WebM).';
        alert(errorMsg);
        return;
      }
      
      // Check video duration (max 1 minute) before other validations
      if (isVideo) {
        try {
          const duration = await checkVideoDuration(file);
          console.log(`🎬 Video duration check: ${file.name} = ${duration.toFixed(2)} seconds`);
          
          if (duration > 60) { // 60 seconds = 1 minute
            const durationMinutes = (duration / 60).toFixed(1);
            setError(`Video is too long: ${durationMinutes} minutes. Please upload videos shorter than 1 minute for optimal processing.`);
            return;
          }
        } catch (durationError) {
          console.warn('⚠️ Could not check video duration:', durationError);
          // Continue with upload - server can handle duration check as fallback
        }
      }
      
      // Client-side file size validation (only for images, no video size limit)
      if (!isVideo) {
        const maxImageSize = 15 * 1024 * 1024; // 15MB for images
        
        if (file.size > maxImageSize) {
          const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
          const maxSizeMB = (maxImageSize / (1024 * 1024)).toFixed(0);
          
          const errorMsg = `Image too large: ${fileSizeMB}MB. Please select an image smaller than ${maxSizeMB}MB.`;
          setError(errorMsg);
          return;
        }
      }
      
      console.log('📷 Customer uploader file validation passed:', {
        isRegularImage,
        isHeic,
        isVideo,
        isPotentialImage,
        hasImageExtension,
        proceeding: true
      });

      let finalFile = file;

      // Try client-side HEIC conversion (only for images, skip for videos)
      if (!isVideo && (isHeic || (isPotentialImage && hasImageExtension && file.name.toLowerCase().includes('.heic')))) {
        setIsConverting(true);
        try {
          console.log('🔍 Attempting client-side HEIC conversion...');
          
          // For iPhone photos, ensure we have the right file object
          if (file.type === '' && file.name.toLowerCase().endsWith('.heic')) {
            console.log('📱 Detected iPhone HEIC file with empty MIME type, forcing conversion');
          }
          
          finalFile = await convertHeicToJpeg(file);
          console.log('✅ Client-side HEIC conversion successful');
        } catch (conversionError) {
          console.log('⚠️ Client-side HEIC conversion failed, server will handle it:', conversionError);
          // Don't show alert - let server handle the conversion
          finalFile = file; // Keep original HEIC file for server processing
        } finally {
          setIsConverting(false);
        }
      }

      // Upload videos directly without client-side conversion
      if (isVideo) {
        console.log('🎬 Video detected - uploading directly to server for processing');
        finalFile = file; // Keep original video file for server processing
      }

      // Process images for mobile devices to prevent upload failures (skip for videos)
      if (!isVideo) {
        try {
          finalFile = await processImageForMobile(finalFile);
        } catch (processingError) {
          console.warn('⚠️ Customer uploader: Image processing failed, using original file:', processingError);
          // Continue with original file
        }
      }

      // Mobile-optimized upload with retry logic
      let uploadSuccess = false;
      let retryCount = 0;
      const maxRetries = isMobile ? 3 : 1; // More retries on mobile
      
      while (!uploadSuccess && retryCount < maxRetries) {
        try {
          if (retryCount > 0) {
            console.log(`📱 Retry attempt ${retryCount} for ${finalFile.name}`);
            // Add exponential backoff delay for retries
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          }
          
          await onUpload(finalFile);
          uploadSuccess = true;
          
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          
        } catch (uploadError) {
          console.error(`❌ Upload attempt ${retryCount + 1} failed:`, uploadError);
          retryCount++;
          
          if (retryCount >= maxRetries) {
            const errorMsg = isMobile
              ? 'Upload failed after multiple attempts. Please check your internet connection and try again.'
              : 'Failed to process the selected file. Please try again.';
            alert(errorMsg);
            throw uploadError;
          }
        }
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setIsConverting(false); // Reset conversion state for any ongoing HEIC conversion
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
    
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      // Process multiple files
      files.forEach((file) => {
        handleFile(file);
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Check if any files are videos
    const videoFiles = files.filter(isVideoFile);
    const imageFiles = files.filter(file => !isVideoFile(file));
    
    if (videoFiles.length > 0 && imageFiles.length > 0) {
      setError('Please upload either images or videos, not both at the same time.');
      return;
    }
    
    if (videoFiles.length > 1) {
      setError('Please upload one video at a time for optimal processing.');
      return;
    }

    // Clear any previous errors
    setError(null);

    // Process files
    files.forEach((file) => {
      handleFile(file);
    });
  };

  return (
    <div className="space-y-4">
      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="font-medium text-red-800">Error</p>
          <p className="text-red-600">{error}</p>
        </div>
      )}
      
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
          accept="image/*,video/*,.heic,.heif"
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading || isConverting}
          multiple
        />

        {uploading ? (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-500" />
            <p className="text-gray-600">Uploading file...</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center items-center gap-4 mb-4">
              <Camera className="w-12 h-12 text-gray-400" />
            </div>
            <div>
              <p className="text-lg font-medium text-gray-700 mb-2">
                Upload photos or videos of your items
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Drag and drop files here, or click to select
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                <Upload className="w-5 h-5" />
                Select Files
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 text-center">
        Images: JPG, PNG, GIF, HEIC, HEIF (max 15MB) • Videos: MP4, MOV, AVI, WebM (max 1 minute)
      </p>
    </div>
  );
}
