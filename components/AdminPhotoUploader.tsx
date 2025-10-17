// components/AdminPhotoUploader.tsx
'use client';

import { useState, useRef } from 'react';
import { Camera, Upload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface AdminPhotoUploaderProps {
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
  onClose: () => void;
  projectId: string;
}

// Video file detection
function isVideoFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  console.log('🎬 Admin video file detection:', {
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
async function getVideoDuration(file: File): Promise<number> {
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
  
  console.log('🔍 Admin uploader file analysis:', {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified
  });
  
  const isHeicByExtension = fileName.endsWith('.heic') || fileName.endsWith('.heif');
  const isHeicByMimeType = mimeType === 'image/heic' || mimeType === 'image/heif';
  
  // iPhone sometimes doesn't set proper MIME types
  const isPotentialIPhoneHeic = (mimeType === '' || mimeType === 'application/octet-stream') && 
                                isHeicByExtension;
  
  const result = isHeicByExtension || isHeicByMimeType || isPotentialIPhoneHeic;
  
  console.log('📱 Admin uploader HEIC detection result:', {
    isHeicByExtension,
    isHeicByMimeType,
    isPotentialIPhoneHeic,
    finalResult: result
  });
  
  return result;
}

// Modern HEIC to JPEG conversion using heic-to library
async function convertHeicToJpeg(file: File): Promise<File> {
  if (typeof window === 'undefined') {
    throw new Error('HEIC conversion only available on client-side');
  }
  
  let retryCount = 0;
  const maxRetries = 2;
  
  while (retryCount <= maxRetries) {
    try {
      console.log(`🔄 Starting HEIC conversion attempt ${retryCount + 1} for:`, file.name, 'Size:', file.size);
      
      if (!file || !(file instanceof File)) {
        throw new Error('Invalid file object provided for conversion');
      }
      
      if (!isHeicFile(file)) {
        throw new Error('File is not a valid HEIC/HEIF file');
      }
      
      console.log('🔧 Loading heic-to library...');
      
      const importPromise = import('heic-to');
      const timeoutPromise = new Promise((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('Library import timeout')), 15000);
      });
      
      const { heicTo } = await Promise.race([importPromise, timeoutPromise]) as any;
      
      console.log('📦 heic-to loaded, starting conversion...');
      
      const conversionPromise = heicTo({
        blob: file,
        type: 'image/jpeg',
        quality: 0.85
      });
      
      const conversionTimeoutPromise = new Promise((_, timeoutReject) => {
        setTimeout(() => timeoutReject(new Error('HEIC conversion timeout after 45 seconds')), 45000);
      });
      
      const convertedBlob = await Promise.race([conversionPromise, conversionTimeoutPromise]);
      
      if (!convertedBlob || convertedBlob.size === 0) {
        throw new Error('Conversion resulted in empty blob');
      }
      
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
        let errorMessage = 'Failed to convert HEIC image after multiple attempts.';
        
        if (error instanceof Error && error.message) {
          if (error.message.includes('timeout')) {
            errorMessage = 'HEIC conversion timed out. This file may be too large or complex.';
          } else if (error.message.includes('Library import')) {
            errorMessage = 'Failed to load HEIC conversion library. Please check your internet connection and try again.';
          } else {
            errorMessage = `HEIC conversion failed: ${error.message}`;
          }
        }
        
        throw new Error(errorMessage);
      }
      
      const waitTime = Math.pow(2, retryCount) * 1000;
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error('HEIC conversion failed after all retry attempts');
}

// Universal image processing for mobile devices
async function processImageForMobile(file: File): Promise<File> {
  const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
  const isLargeFile = file.size > 3 * 1024 * 1024; // 3MB threshold
  
  if (!isMobile && !isLargeFile) {
    return file;
  }
  
  const deviceType = isMobile ? (navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Mobile') : 'Desktop';
  console.log(`📱 Admin uploader: Processing ${deviceType} image: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`);
  
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get canvas context');
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    const imageUrl = URL.createObjectURL(file);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error('Image processing timeout'));
      }, 30000);
      
      img.onload = () => {
        clearTimeout(timeout);
        try {
          let maxDimension = isMobile ? 1600 : 2048;
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
          
          canvas.width = width;
          canvas.height = height;
          
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          
          let quality = file.size > 10 * 1024 * 1024 ? 0.7 : 0.8;
          
          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(imageUrl);
              
              if (!blob) {
                reject(new Error('Failed to process image'));
                return;
              }
              
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
              console.log(`✅ Admin uploader: ${deviceType} image processed: ${(processedFile.size / (1024 * 1024)).toFixed(2)}MB (${reductionPercent}% reduction)`);
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
        console.error('❌ Admin uploader: Failed to load image for processing:', error);
        reject(new Error('Failed to load image - file may be corrupted or unsupported'));
      };
      
      img.src = imageUrl;
    });
  } catch (error) {
    console.warn(`⚠️ Admin uploader: Image processing failed, using original:`, error);
    return file;
  }
}

export default function AdminPhotoUploader({ onUpload, uploading, onClose, projectId }: AdminPhotoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const fileQueueRef = useRef<File[]>([]);


  const handleFileWithResult = async (file: File): Promise<boolean> => {
    if (!file) return false;

    try {
      await handleFile(file);
      return true;
    } catch (error) {
      console.error('Error processing file:', error);
      return false;
    }
  };

  const handleFile = async (file: File) => {
    if (!file) return;

    try {
      const isMobile = typeof window !== 'undefined' && /iphone|ipad|android|mobile/i.test(navigator.userAgent);
      
      console.log(`📱 Admin upload - Mobile detection:`, {
        isMobile,
        userAgent: navigator.userAgent.substring(0, 100),
        fileDetails: {
          name: file.name,
          size: file.size,
          type: file.type || 'empty',
          lastModified: file.lastModified
        }
      });
      
      // File type detection
      const isRegularImage = file.type.startsWith('image/');
      const isHeic = isHeicFile(file);
      const isVideo = isVideoFile(file);
      
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
        setError(errorMsg);
        throw new Error(errorMsg);
      }
      
      // File size validation (only for images)
      if (!isVideo) {
        const maxImageSize = 15 * 1024 * 1024; // 15MB for images
        if (file.size > maxImageSize) {
          const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
          const errorMsg = `Image too large: ${fileSizeMB}MB. Please select an image smaller than 15MB.`;
          setError(errorMsg);
          throw new Error(errorMsg);
        }
      }
      
      // Video duration validation (1 minute max)
      if (isVideo) {
        try {
          const duration = await getVideoDuration(file);
          if (duration > 60) { // 60 seconds = 1 minute
            setError(`This video is too long. Please select a video shorter than 1 minute for optimal processing. Pro tip: Take 1 short video for each room!`);
            throw new Error('Video duration exceeds limit');
          }
        } catch (error) {
          console.warn('Could not validate video duration:', error);
          // Continue with upload if duration check fails
        }
      }
      
      console.log('📷 Admin uploader file validation passed:', {
        isRegularImage,
        isHeic,
        isVideo,
        isPotentialImage,
        hasImageExtension,
        proceeding: true
      });

      let finalFile = file;

      // Upload videos directly without client-side conversion
      if (isVideo) {
        console.log('🎬 Video detected - uploading directly to server for processing');
        finalFile = file; // Keep original video file for server processing
      }

      // Try client-side HEIC conversion (only for images, skip for videos)
      if (!isVideo && (isHeic || (isPotentialImage && hasImageExtension && file.name.toLowerCase().includes('.heic')))) {
        setIsConverting(true);
        try {
          console.log('🔍 Attempting client-side HEIC conversion...');
          
          if (file.type === '' && file.name.toLowerCase().endsWith('.heic')) {
            console.log('📱 Detected iPhone HEIC file with empty MIME type, forcing conversion');
          }
          
          finalFile = await convertHeicToJpeg(file);
          console.log('✅ Client-side HEIC conversion successful');
        } catch (conversionError) {
          console.log('⚠️ Client-side HEIC conversion failed, server will handle it:', conversionError);
          finalFile = file; // Keep original HEIC file for server processing
        } finally {
          setIsConverting(false);
        }
      }

      // Process images for mobile devices (skip for videos)
      if (!isVideo) {
        try {
          finalFile = await processImageForMobile(finalFile);
        } catch (processingError) {
          console.warn('⚠️ Admin uploader: Image processing failed, using original file:', processingError);
        }
      }

      // Clear any previous errors
      setError(null);

      // Upload with retry logic
      let uploadSuccess = false;
      let retryCount = 0;
      const maxRetries = isMobile ? 3 : 1;
      
      while (!uploadSuccess && retryCount < maxRetries) {
        try {
          if (retryCount > 0) {
            console.log(`📱 Retry attempt ${retryCount} for ${finalFile.name}`);
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          }
          
          await onUpload(finalFile);
          uploadSuccess = true;
          
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          
          // Increment successful upload counter
          setUploadedCount(prev => prev + 1);
          
        } catch (uploadError) {
          console.error(`❌ Upload attempt ${retryCount + 1} failed:`, uploadError);
          retryCount++;
          
          if (retryCount >= maxRetries) {
            const errorMsg = isMobile
              ? 'Upload failed after multiple attempts. Please check your internet connection and try again.'
              : 'Failed to process the selected file. Please try again.';
            setError(errorMsg);
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

      // Add files to queue
      fileQueueRef.current = [...fileQueueRef.current, ...files];
      
      // Start processing the queue
      processFileQueue();
    }
  };

  // Process file queue
  const processFileQueue = async () => {
    if (isProcessingQueue || fileQueueRef.current.length === 0) return;
    
    setIsProcessingQueue(true);
    let successCount = 0;
    
    while (fileQueueRef.current.length > 0) {
      const file = fileQueueRef.current.shift();
      if (file) {
        try {
          // Process the file and if successful, increment counter
          const result = await handleFileWithResult(file);
          if (result) {
            successCount++;
          }
        } catch (error) {
          console.error('Failed to process file:', file.name, error);
        }
      }
    }
    
    setIsProcessingQueue(false);
    
    // Show toast and close modal if uploads were successful
    if (successCount > 0) {
      const message = successCount === 1 
        ? '1 file successfully uploaded' 
        : `${successCount} files successfully uploaded`;
        
      console.log('Showing success toast:', message);
      
      // Show toast notification
      toast.success(message);
      
      // Close the modal
      setTimeout(() => {
        console.log('Closing modal after successful uploads');
        onClose();
      }, 500); // Small delay to ensure toast is visible
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

    // Add files to queue
    fileQueueRef.current = [...fileQueueRef.current, ...files];
    
    // Start processing the queue
    processFileQueue();
  };

  return (
    <div className="space-y-6">
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
              : uploading || isConverting || isProcessingQueue
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
            disabled={uploading || isConverting || isProcessingQueue}
            multiple
          />

          {uploading || isProcessingQueue ? (
            <div className="space-y-4">
              <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-500" />
              <p className="text-gray-600">
                {isProcessingQueue && fileQueueRef.current.length > 0 
                  ? `Processing ${fileQueueRef.current.length + 1} files...` 
                  : 'Uploading file...'}
              </p>
              {uploadedCount > 0 && (
                <p className="text-sm text-gray-500">
                  {uploadedCount} {uploadedCount === 1 ? 'file' : 'files'} uploaded
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-center items-center gap-4 mb-4">
                <Camera className="w-12 h-12 text-gray-400" />
              </div>
              <div>
                <p className="text-lg font-medium text-gray-700 mb-2">
                  Upload photos or videos of inventory items
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