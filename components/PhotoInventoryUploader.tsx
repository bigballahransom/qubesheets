// components/PhotoInventoryUploader.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, Camera, Loader2, X, Package, Box, BoxesIcon, Video, Play, Clock } from 'lucide-react';
import RealTimeUploadStatus from './RealTimeUploadStatus';
import VideoUpload from './video/VideoUpload';

export interface InventoryItem {
  name: string;
  description?: string;
  category?: string;
  quantity?: number;
  location?: string;
  cuft?: number;
  weight?: number;
  fragile?: boolean;
  special_handling?: string;
  box_recommendation?: {
    box_type: string;
    box_quantity: number;
    box_dimensions: string;
  };
}

export interface AnalysisResult {
  items: InventoryItem[];
  summary: string;
  total_boxes?: {
    small?: number;
    medium?: number;
    large?: number;
    extra_large?: number;
    book?: number;
    specialty?: number;
  };
  savedToDatabase?: boolean;
  dbError?: string;
}

interface PhotoInventoryUploaderProps {
  onItemsAnalyzed?: (result: AnalysisResult) => void;
  onImageSaved?: () => void; // New callback for when image is saved
  onClose?: () => void; // New callback to close the modal
  projectId?: string;
}

// Mobile device detection
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/i.test(userAgent);
  const isIOS = /iphone|ipad/i.test(userAgent);
  const isSafari = /safari/i.test(userAgent) && !/chrome/i.test(userAgent);
  
  console.log('📱 Device detection:', {
    userAgent: userAgent.substring(0, 50) + '...',
    isMobile,
    isIOS,
    isSafari,
    shouldSkipClientConversion: isMobile || (isIOS && isSafari)
  });
  
  return isMobile;
}

// Video file detection
function isVideoFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  console.log('🎬 Video file detection:', {
    name: file.name,
    type: file.type,
    size: file.size
  });
  
  const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
  const hasVideoExtension = videoExtensions.some(ext => fileName.endsWith(ext));
  const hasVideoMimeType = mimeType.startsWith('video/');
  
  return hasVideoExtension || hasVideoMimeType;
}

// Enhanced HEIC file detection for iPhone compatibility
function isHeicFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  // Log file details for debugging iPhone issues
  console.log('🔍 File analysis:', {
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
  
  console.log('📱 HEIC detection result:', {
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
  console.log(`📱 Processing ${deviceType} image: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`);
  
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
              console.log(`✅ ${deviceType} image processed: ${(processedFile.size / (1024 * 1024)).toFixed(2)}MB (${reductionPercent}% reduction)`);
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
        console.error('❌ Failed to load image for processing:', error);
        reject(new Error('Failed to load image - file may be corrupted or unsupported'));
      };
      
      img.src = imageUrl;
    });
  } catch (error) {
    console.warn(`⚠️ ${deviceType} image processing failed, using original:`, error);
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

// Helper functions to match those in the API route
function isFurniture(category?: string): boolean {
  const furnitureKeywords = [
    'sofa', 'couch', 'table', 'chair', 'bed', 'mattress', 'dresser', 
    'cabinet', 'desk', 'wardrobe', 'bookcase', 'shelf', 'shelving',
    'furniture', 'ottoman', 'recliner', 'bench', 'armchair'
  ];
  
  if (!category) return false;
  
  return furnitureKeywords.some(keyword => 
    category.toLowerCase().includes(keyword)
  );
}

function generateBoxRecommendation(
  category: string, 
  itemName: string, 
  cuft: number, 
  weight: number, 
  quantity: number
): { box_type: string; box_quantity: number; box_dimensions: string } {
  let boxType = "Medium";
  let boxDimensions = "18-1/8\" x 18\" x 16\"";
  let boxQuantity = 1;
  
  const itemNameLower = itemName.toLowerCase();
  const categoryLower = category ? category.toLowerCase() : '';
  
  if (categoryLower.includes('book') || itemNameLower.includes('book') || weight > 40) {
    if (cuft <= 1) {
      boxType = "Book Box";
      boxDimensions = "12\" x 12\" x 12\"";
      boxQuantity = Math.ceil(quantity * cuft / 1);
    } else {
      boxType = "Small";
      boxDimensions = "16-3/8\" x 12-5/8\" x 12-5/8\"";
      boxQuantity = Math.ceil(quantity * cuft / 1.5);
    }
  } else if (categoryLower.includes('kitchenware') || 
             itemNameLower.includes('dish') || 
             itemNameLower.includes('glass') || 
             itemNameLower.includes('cup') || 
             itemNameLower.includes('plate')) {
    boxType = "Dish Pack";
    boxDimensions = "18\" x 18\" x 28\"";
    boxQuantity = Math.ceil(quantity * cuft / 5);
  } else if (categoryLower.includes('electronic') || 
             itemNameLower.includes('tv') || 
             itemNameLower.includes('television') || 
             itemNameLower.includes('computer')) {
    boxType = "Medium";
    boxDimensions = "18-1/8\" x 18\" x 16\"";
    boxQuantity = Math.ceil(quantity * cuft / 3);
  } else if (itemNameLower.includes('mirror') || 
             itemNameLower.includes('picture') || 
             itemNameLower.includes('painting') || 
             itemNameLower.includes('art')) {
    boxType = "Mirror/Picture";
    boxDimensions = "37\" x 4\" x 27\"";
    boxQuantity = quantity;
  } else if (categoryLower.includes('cloth') || 
             itemNameLower.includes('dress') || 
             itemNameLower.includes('coat') || 
             itemNameLower.includes('suit')) {
    boxType = "Wardrobe";
    boxDimensions = "24\" x 21\" x 46\"";
    boxQuantity = Math.ceil(quantity * cuft / 10);
  } else if (cuft <= 1.5) {
    boxType = "Small";
    boxDimensions = "16-3/8\" x 12-5/8\" x 12-5/8\"";
    boxQuantity = Math.ceil(quantity * cuft / 1.5);
  } else if (cuft <= 3) {
    boxType = "Medium";
    boxDimensions = "18-1/8\" x 18\" x 16\"";
    boxQuantity = Math.ceil(quantity * cuft / 3);
  } else if (cuft <= 4.5) {
    boxType = "Large";
    boxDimensions = "18\" x 18\" x 24\"";
    boxQuantity = Math.ceil(quantity * cuft / 4.5);
  } else {
    boxType = "Extra-Large";
    boxDimensions = "24\" x 18\" x 24\"";
    boxQuantity = Math.ceil(quantity * cuft / 6);
  }
  
  boxQuantity = Math.max(1, boxQuantity);
  
  return {
    box_type: boxType,
    box_quantity: boxQuantity,
    box_dimensions: boxDimensions
  };
}

export default function PhotoInventoryUploader({ 
  onItemsAnalyzed, 
  onImageSaved,
  onClose,
  projectId 
}: PhotoInventoryUploaderProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageDescription, setImageDescription] = useState('');
  const [processingStatus, setProcessingStatus] = useState<{[key: string]: 'processing' | 'completed' | 'failed'}>({});
  const [uploadMode, setUploadMode] = useState<'image' | 'video'>('image');
  const [hasVideoFiles, setHasVideoFiles] = useState(false);
  const [pendingJobIds, setPendingJobIds] = useState<string[]>([]);
  const [transferStatus, setTransferStatus] = useState<{
    total: number;
    sent: number;
    pending: number;
    failed: number;
  } | null>(null);
  const [checkingTransferStatus, setCheckingTransferStatus] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
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

    // Reset states
    setError(null);
    setAnalysisResult(null);
    setImageDescription('');
    setPreviewUrl(null);
    setHasVideoFiles(videoFiles.length > 0);
    setUploadMode(videoFiles.length > 0 ? 'video' : 'image');
    setSelectedFiles([]);
    setProcessingStatus({});

    try {
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];
      
      setIsConverting(true);
      
      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Check if file is a supported image, video type, or HEIC
        const isRegularImage = file.type.startsWith('image/');
        const isVideo = isVideoFile(file);
        const isHeic = isHeicFile(file);
        
        // Special handling for iPhone photos that may have empty MIME types
        const isPotentialImage = file.type === '' || file.type === 'application/octet-stream';
        const hasImageExtension = /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
        
        if (!isRegularImage && !isVideo && !isHeic && !(isPotentialImage && hasImageExtension)) {
          invalidFiles.push(file.name);
          continue;
        }
        
        let finalFile = file;

        // Skip processing for video files - they'll be handled by VideoUpload component
        if (isVideo) {
          validFiles.push(finalFile);
          continue;
        }

        // Smart HEIC conversion: Mobile-first strategy
        if (isHeic || (isPotentialImage && hasImageExtension && file.name.toLowerCase().includes('.heic'))) {
          const isMobile = isMobileDevice();
          
          if (isMobile) {
            // Mobile Strategy: Skip client conversion, use server-side
            console.log('📱 Mobile device detected - skipping client conversion for', file.name);
            finalFile = file; // Send HEIC directly to server
          } else {
            // Desktop Strategy: Try client conversion first
            try {
              console.log('💻 Converting HEIC file:', file.name);
              finalFile = await convertHeicToJpeg(file);
              console.log('✅ Client-side HEIC conversion successful for', file.name);
            } catch (conversionError) {
              console.log('⚠️ Client-side HEIC conversion failed for', file.name, '- server will handle');
              finalFile = file; // Keep original HEIC file for server processing
            }
          }
        }

        validFiles.push(finalFile);
      }
      
      setIsConverting(false);
      
      // Show errors for invalid files
      if (invalidFiles.length > 0) {
        setError(`Invalid files skipped: ${invalidFiles.join(', ')}. Please select valid image files.`);
      }
      
      if (validFiles.length === 0) {
        setError('No valid image files selected. Please select JPEG, PNG, GIF, HEIC, or HEIF files.');
        return;
      }

      // Set selected files
      setSelectedFiles(validFiles);
      
      // Create preview for single file, or show count for multiple
      if (validFiles.length === 1) {
        try {
          setPreviewUrl(URL.createObjectURL(validFiles[0]));
        } catch (previewError) {
          console.log('Could not create preview, will show placeholder');
          setPreviewUrl(null);
        }
      } else {
        setPreviewUrl(null); // No preview for multiple files
      }
      
    } catch (error) {
      console.error('Error processing files:', error);
      setError('Failed to process the selected files. Please try again.');
      setIsConverting(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Poll transfer status
  const checkTransferStatus = async () => {
    if (pendingJobIds.length === 0) return;
    
    try {
      const response = await fetch('/api/background-queue/transfer-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: pendingJobIds })
      });

      if (response.ok) {
        const status = await response.json();
        setTransferStatus({
          total: status.total,
          sent: status.sent,
          pending: status.pending,
          failed: status.failed
        });

        // If all transferred, we can allow closing
        if (status.allTransferred) {
          setCheckingTransferStatus(false);
          
          // Show success message and close after delay
          const { toast } = await import('sonner');
          toast.success('All images sent to processing server!', {
            description: 'You can now safely close this window.',
            duration: 3000,
          });
          
          // Reset and close after showing success
          setTimeout(() => {
            handleReset();
            if (onClose) {
              onClose();
            }
          }, 2000);
        }
      }
    } catch (error) {
      console.error('Failed to check transfer status:', error);
    }
  };

  // Start polling when we have pending jobs
  useEffect(() => {
    if (pendingJobIds.length === 0 || !checkingTransferStatus) return;

    const interval = setInterval(checkTransferStatus, 2000);
    checkTransferStatus(); // Initial check

    return () => clearInterval(interval);
  }, [pendingJobIds, checkingTransferStatus]);

  const saveImageToDatabase = async (file: File, analysisResult: AnalysisResult) => {
    if (!projectId) return;

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('description', imageDescription);
      formData.append('analysisResult', JSON.stringify(analysisResult));

      const response = await fetch(`/api/projects/${projectId}/images`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to save image');
      }

      // Call the callback to refresh the image gallery
      if (onImageSaved) {
        onImageSaved();
      }
    } catch (error) {
      console.error('Error saving image:', error);
      // Don't throw error here, as analysis was successful
    }
  };

  const handleAnalyze = async () => {
    if (selectedFiles.length === 0) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      console.log(`🚀 Starting async processing for ${selectedFiles.length} images...`);
      
      let modalClosed = false;

      // Mobile-optimized sequential processing
      const isMobile = isMobileDevice();
      if (isMobile) {
        console.log('📱 Mobile device detected - using optimized upload strategy');
      }
      
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const fileNum = i + 1;
        
        console.log(`📸 Processing image ${fileNum}/${selectedFiles.length}: ${file.name}`);
        
        // Mobile: Add delay between uploads to prevent overwhelming the device
        if (isMobile && i > 0) {
          console.log('📱 Mobile: Adding delay between uploads...');
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        }
        
        // Update processing status for this file
        setProcessingStatus(prev => ({
          ...prev,
          [file.name]: 'processing'
        }));

        try {
          // Step 0: Process mobile images to prevent upload failures
          let processedFile = file;
          try {
            processedFile = await processImageForMobile(file);
          } catch (processingError) {
            console.warn('⚠️ Image processing failed, using original file:', processingError);
            processedFile = file;
          }

          // Step 1: Save image to MongoDB first
          const formData = new FormData();
          formData.append('image', processedFile);
          formData.append('description', imageDescription);
          
          if (projectId) {
            formData.append('projectId', projectId);
          }

          console.log(`💾 Saving image ${fileNum} to MongoDB...`);
          console.log(`📱 Mobile upload debug - File details:`, {
            originalName: file.name,
            originalSize: file.size,
            originalType: file.type,
            processedName: processedFile.name,
            processedSize: processedFile.size,
            processedType: processedFile.type,
            compressionRatio: processedFile.size !== file.size ? `${((1 - processedFile.size / file.size) * 100).toFixed(1)}% reduced` : 'no compression',
            isMobile: isMobileDevice(),
            isIPhone: /iPhone/i.test(navigator.userAgent),
            userAgent: navigator.userAgent.substring(0, 100)
          });
          
          const saveResponse = await fetch(`/api/projects/${projectId}/images`, {
            method: 'POST',
            body: formData,
            // Add timeout for mobile networks
            signal: AbortSignal.timeout(120000) // 2 minute timeout for mobile
          });

          if (!saveResponse.ok) {
            const errorText = await saveResponse.text();
            console.error(`❌ Failed to save image ${fileNum}:`, errorText);
            console.error(`📱 Mobile upload error details:`, {
              status: saveResponse.status,
              statusText: saveResponse.statusText,
              headers: Object.fromEntries(saveResponse.headers.entries()),
              isMobile: isMobileDevice()
            });
            setProcessingStatus(prev => ({
              ...prev,
              [file.name]: 'failed'
            }));
            continue; // Skip to next file
          }

          const savedImage = await saveResponse.json();
          console.log(`✅ Image ${fileNum} saved to MongoDB:`, savedImage._id);

          // Immediate UI feedback - trigger image gallery refresh right away
          if (onImageSaved) {
            console.log('🔄 Triggering immediate image gallery refresh...');
            onImageSaved();
          }

          // Step 2: Queue background analysis job
          console.log(`📋 Queueing background analysis job for image ${fileNum}...`);
          const useRailway = file.size > 4 * 1024 * 1024 || 
                           file.name.toLowerCase().match(/\.(heic|heif)$/) || 
                           file.type.includes('heic');
          
          console.log(`🚂 Railway decision for ${file.name}:`, {
            useRailway,
            fileSize: file.size,
            isLargeFile: file.size > 4 * 1024 * 1024,
            isHEIC: file.name.toLowerCase().match(/\.(heic|heif)$/) || file.type.includes('heic'),
            isMobile: isMobileDevice()
          });
          
          try {
            const queueResponse = await fetch('/api/background-queue', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                type: 'image_analysis',
                imageId: savedImage._id,
                projectId: projectId,
                useRailwayService: useRailway,
                estimatedSize: file.size // Pass file size for smart queue prioritization
              }),
              // Add timeout for mobile networks
              signal: AbortSignal.timeout(30000) // 30 second timeout for queue API
            });

            if (!queueResponse.ok) {
              const queueErrorText = await queueResponse.text();
              console.error(`⚠️ Failed to queue background job for image ${fileNum}:`, queueErrorText);
              console.error(`📱 Queue error details:`, {
                status: queueResponse.status,
                statusText: queueResponse.statusText,
                isMobile: isMobileDevice()
              });
              setProcessingStatus(prev => ({
                ...prev,
                [file.name]: 'completed' // Image was saved successfully
              }));
            } else {
              const queueResult = await queueResponse.json();
              console.log(`✅ Background job queued for image ${fileNum}:`, queueResult.jobId);
              
              // Track job ID for transfer monitoring
              if (queueResult.jobId) {
                console.log('📋 [PhotoUploader] Tracking job ID:', queueResult.jobId);
                setPendingJobIds(prev => [...prev, queueResult.jobId]);
              }
              
              setProcessingStatus(prev => ({
                ...prev,
                [file.name]: 'completed'
              }));
              
              // After first successful save AND queue, show notification but DON'T close modal
              if (!modalClosed) {
                // Import toast and show notification
                const { toast } = await import('sonner');
                toast.success(`Saving ${selectedFiles.length} image${selectedFiles.length > 1 ? 's' : ''}...`, {
                  description: 'Sending images to processing server...',
                  duration: 4000,
                });
                modalClosed = true;
              }
            }
          } catch (queueError) {
            console.error(`❌ Queue request failed for image ${fileNum}:`, queueError);
            console.error(`📱 Queue network error on mobile:`, {
              error: queueError instanceof Error ? queueError.message : 'Unknown error',
              isMobile: isMobileDevice(),
              isTimeout: queueError instanceof Error && queueError.name === 'AbortError'
            });
            // Still mark as completed since image was saved
            setProcessingStatus(prev => ({
              ...prev,
              [file.name]: 'completed'
            }));
          }

        } catch (fileError) {
          console.error(`❌ Error processing file ${fileNum}:`, fileError);
          setProcessingStatus(prev => ({
            ...prev,
            [file.name]: 'failed'
          }));
        }
      }

      // All files processed
      setIsAnalyzing(false);
      setError(null);

      // Start monitoring transfer status if we have job IDs
      console.log('📋 [PhotoUploader] Checking pending job IDs:', pendingJobIds);
      if (pendingJobIds.length > 0) {
        console.log('📋 [PhotoUploader] Starting transfer monitoring for', pendingJobIds.length, 'jobs');
        setCheckingTransferStatus(true);
        
        // Import toast dynamically for completion notification
        const { toast: completionToast } = await import('sonner');
        completionToast.info(`Sending ${pendingJobIds.length} images to processing server...`, {
          description: 'Please wait while we transfer your images.',
          duration: 5000,
        });
      } else {
        console.log('📋 [PhotoUploader] No pending job IDs - closing immediately');
        // No jobs queued, just close
        handleReset();
        if (onClose) {
          onClose();
        }
      }

      // Call success callback to refresh gallery
      if (onImageSaved) {
        onImageSaved();
      }

      return; // Exit here - no blocking analysis

    } catch (err) {
      console.error('❌ Error in async image processing:', err);
      
      // Enhanced error logging for debugging
      if (err instanceof Error) {
        console.error('Error details:', {
          name: err.name,
          message: err.message,
          stack: err.stack
        });
        setError(`Upload failed: ${err.message}`);
      } else if (err && typeof err === 'object') {
        console.error('Non-Error object:', JSON.stringify(err));
        setError(`Upload failed: ${JSON.stringify(err)}`);
      } else {
        console.error('Unknown error type:', typeof err, err);
        setError(`Upload failed: ${String(err)}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Legacy function kept for backward compatibility (not used in new async flow)
  const handleLegacyAnalyze = async () => {
    if (selectedFiles.length === 0) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      // Legacy blocking analysis code (kept for reference/fallback)
      const formData = new FormData();
      formData.append('image', selectedFiles[0]);
      
      if (projectId) {
        formData.append('projectId', projectId);
      }

      const response = await fetch('/api/analyze-image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to analyze image: ${response.statusText} - ${errorText}`);
      }

      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown JSON parse error';
        throw new Error(`Server returned invalid JSON: ${errorMessage}`);
      }
      
      // Only enhance items if fields are missing from the API response
      const enhancedItems = result.items.map((item: InventoryItem) => {
        const enhancedItem = { ...item };
        
        if (!enhancedItem.location) {
          enhancedItem.location = item.category === 'furniture' ? 'Living Room' : 
                             item.category === 'kitchenware' ? 'Kitchen' : 
                             item.category === 'electronics' ? 'Living Room' : 
                             item.category === 'bedroom' ? 'Bedroom' : 
                             item.category === 'bathroom' ? 'Bathroom' : 
                             item.category === 'office' ? 'Office' : 'Other';
        }
        
        if (!enhancedItem.cuft) {
          enhancedItem.cuft = item.category === 'furniture' ? 15 : 
                         item.category === 'electronics' ? 3 : 
                         item.category === 'kitchenware' ? 2 :
                         item.category === 'appliances' ? 20 :
                         item.category === 'decor' ? 1 : 3;
        }
        
        if (!enhancedItem.weight) {
          const cuft = enhancedItem.cuft || 3;
          if (item.category === 'furniture') {
            enhancedItem.weight = cuft * 8;
          } else if (item.category === 'electronics') {
            enhancedItem.weight = cuft * 10;
          } else if (item.category === 'books' || item.category === 'media') {
            enhancedItem.weight = cuft * 20;
          } else if (item.category === 'clothing' || item.category === 'bedding') {
            enhancedItem.weight = cuft * 4;
          } else if (item.category === 'kitchenware') {
            enhancedItem.weight = cuft * 9;
          } else if (item.category === 'appliances') {
            enhancedItem.weight = cuft * 12;
          } else {
            enhancedItem.weight = cuft * 7;
          }
        }
        
        if (!enhancedItem.box_recommendation && !isFurniture(item.category)) {
          enhancedItem.box_recommendation = generateBoxRecommendation(
            enhancedItem.category || '',
            enhancedItem.name,
            enhancedItem.cuft || 3,
            enhancedItem.weight || 21,
            enhancedItem.quantity || 1
          );
        }
        
        enhancedItem.fragile = enhancedItem.fragile || false;
        enhancedItem.special_handling = enhancedItem.special_handling || "";
        
        return enhancedItem;
      });

      if (!result.total_boxes && enhancedItems.length > 0) {
        const totalBoxes: {
          small: number;
          medium: number;
          large: number;
          extra_large: number;
          book: number;
          specialty: number;
        } = {
          small: 0,
          medium: 0,
          large: 0,
          extra_large: 0,
          book: 0,
          specialty: 0
        };
        
        enhancedItems.forEach((item: InventoryItem) => {
          if (item.box_recommendation) {
            const boxType = item.box_recommendation.box_type.toLowerCase();
            const quantity = item.box_recommendation.box_quantity || 0;
            
            if (boxType.includes('small')) {
              totalBoxes.small += quantity;
            } else if (boxType.includes('medium')) {
              totalBoxes.medium += quantity;
            } else if (boxType.includes('large') && !boxType.includes('extra')) {
              totalBoxes.large += quantity;
            } else if (boxType.includes('extra') || boxType.includes('xl')) {
              totalBoxes.extra_large += quantity;
            } else if (boxType.includes('book')) {
              totalBoxes.book += quantity;
            } else {
              totalBoxes.specialty += quantity;
            }
          }
        });
        
        result.total_boxes = totalBoxes;
      }

      const enhancedResult: AnalysisResult = {
        ...result,
        items: enhancedItems
      };

      setAnalysisResult(enhancedResult);
      
      // Save image to database
      await saveImageToDatabase(selectedFiles[0], enhancedResult);
      
      // Call the items analyzed callback
      if (onItemsAnalyzed) {
        onItemsAnalyzed(enhancedResult);
      }
    } catch (err) {
      console.error('❌ Error analyzing image:', err);
      
      // Enhanced error logging for debugging
      if (err instanceof Error) {
        console.error('Error details:', {
          name: err.name,
          message: err.message,
          stack: err.stack
        });
        setError(`Analysis failed: ${err.message}`);
      } else if (err && typeof err === 'object') {
        console.error('Non-Error object:', JSON.stringify(err));
        setError(`Analysis failed: ${JSON.stringify(err)}`);
      } else {
        console.error('Unknown error type:', typeof err, err);
        setError(`Analysis failed: ${String(err)}`);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setSelectedFiles([]);
    setPreviewUrl(null);
    setAnalysisResult(null);
    setError(null);
    setImageDescription('');
    setProcessingStatus({});
    setIsConverting(false);
    setUploadMode('image');
    setHasVideoFiles(false);
    setPendingJobIds([]);
    setTransferStatus(null);
    setCheckingTransferStatus(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const calculateTotalBoxes = (totalBoxes: AnalysisResult['total_boxes']): number => {
    if (!totalBoxes) return 0;
    
    let sum = 0;
    if (totalBoxes.small) sum += totalBoxes.small;
    if (totalBoxes.medium) sum += totalBoxes.medium;
    if (totalBoxes.large) sum += totalBoxes.large;
    if (totalBoxes.extra_large) sum += totalBoxes.extra_large;
    if (totalBoxes.book) sum += totalBoxes.book;
    if (totalBoxes.specialty) sum += totalBoxes.specialty;
    
    return sum;
  };

  return (
    <div className="max-w-none w-full">
      <div className="text-center mb-6">
        <p className="text-gray-600">
          Upload photos or videos to automatically extract frames and identify inventory items
        </p>
      </div>

      {/* Upload Section */}
      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif,video/*"
          onChange={handleFileSelect}
          className="hidden"
          multiple
        />

        {selectedFiles.length === 0 && !isConverting ? (
          <div
            onClick={handleUploadClick}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <div className="flex justify-center items-center gap-4 mb-4">
              <Camera className="h-12 w-12 text-gray-400" />
              <Video className="h-12 w-12 text-gray-400" />
            </div>
            <p className="text-lg font-medium text-gray-700 mb-2">
              Click to upload photos or videos
            </p>
            <p className="text-sm text-gray-500">
              Images: JPG, PNG, GIF, HEIC, HEIF (up to 10MB each)<br/>
              Videos: MP4, MOV, AVI, WebM (up to 100MB each)
            </p>
          </div>
        ) : isConverting ? (
          <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50">
            <Loader2 className="mx-auto h-12 w-12 text-blue-500 animate-spin mb-4" />
            <p className="text-lg font-medium text-blue-700 mb-2">
              Processing images...
            </p>
            <p className="text-sm text-blue-600">
              Please wait while we process your images
            </p>
          </div>
        ) : selectedFiles.length > 0 ? (
          <div className="space-y-4">
            {hasVideoFiles ? (
              // Video upload mode - automatically process the selected video
              <div>
                <VideoUpload 
                  projectId={projectId}
                  uploadLinkId={null}
                  initialVideoFile={selectedFiles.length > 0 ? selectedFiles[0] : null as any} // Pass the video file directly
                  autoStart={true} // Automatically start processing
                  onFramesExtracted={async () => {
                    console.log('Video frames extracted, triggering gallery refresh');
                    // Show toast but DON'T close modal yet
                    const { toast: videoToast } = await import('sonner');
                    videoToast.success('Processing video frames...', {
                      description: 'Extracting and analyzing frames from your video.',
                      duration: 4000,
                    });
                    
                    // Trigger gallery refresh when frames are extracted
                    if (onImageSaved) onImageSaved();
                  }}
                  onAnalysisComplete={async (results: any) => {
                    console.log('Video analysis complete:', results);
                    
                    // If we have queued jobs, start monitoring transfer status
                    if (results?.queuedJobs && results.queuedJobs.length > 0) {
                      setPendingJobIds(results.queuedJobs);
                      setCheckingTransferStatus(true);
                      
                      const { toast: videoTransferToast } = await import('sonner');
                      videoTransferToast.info(`Sending ${results.queuedJobs.length} video frames to processing server...`, {
                        description: 'Please wait while we transfer your video frames.',
                        duration: 5000,
                      });
                    } else {
                      // No jobs queued, just close after delay
                      setTimeout(() => {
                        handleReset();
                        if (onClose) {
                          onClose();
                        }
                      }, 2000);
                    }
                    
                    // Trigger gallery refresh when analysis completes
                    if (onImageSaved) onImageSaved();
                  }}
                  onReset={() => {
                    // Reset the parent component when video upload resets
                    handleReset();
                  }}
                />
              </div>
            ) : (
              // Image upload mode - show existing image preview
              <div className="relative">
                {selectedFiles.length === 1 && previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-1/2 max-w-md mx-auto rounded-lg shadow-md"
                  />
                ) : selectedFiles.length === 1 ? (
                  <div className="w-1/2 max-w-md mx-auto rounded-lg shadow-md bg-gray-100 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center p-8">
                    <Camera className="h-12 w-12 text-gray-400 mb-2" />
                    <p className="text-sm font-medium text-gray-600">HEIC Image Selected</p>
                    <p className="text-xs text-gray-500 text-center mt-1">
                      {selectedFiles[0].name}
                      <br />
                      Preview will be available after analysis
                    </p>
                  </div>
                ) : (
                  <div className="w-1/2 max-w-md mx-auto rounded-lg shadow-md bg-blue-100 border-2 border-dashed border-blue-300 flex flex-col items-center justify-center p-8">
                    <Package className="h-12 w-12 text-blue-500 mb-2" />
                    <p className="text-lg font-medium text-blue-700">{selectedFiles.length} Images Selected</p>
                    <p className="text-sm text-blue-600 text-center mt-1">
                      Ready to analyze multiple images
                    </p>
                  </div>
                )}
                <button
                  onClick={handleReset}
                  className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full hover:bg-red-600 transition-colors cursor-pointer focus:ring-2 focus:ring-red-500 focus:outline-none"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            
            {/* Image Description Input - Only show for images, not videos */}
            {!hasVideoFiles && (
              <div className="max-w-md mx-auto">
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                  Add a description (optional)
                </label>
                <input
                  id="description"
                  type="text"
                  value={imageDescription}
                  onChange={(e) => setImageDescription(e.target.value)}
                  placeholder="e.g., Living room items, Kitchen inventory..."
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Action Buttons - Only show for image uploads */}
      {selectedFiles.length > 0 && !analysisResult && !hasVideoFiles && (
        <div className="text-center mb-6">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || isConverting}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Analyzing & Saving...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                Analyze Items
              </>
            )}
          </button>
          <p className="text-xs text-gray-500 mt-2">
            Your image will be saved to the project gallery
          </p>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className={`border rounded-lg p-4 mb-6 ${
          error.includes('HEIC conversion is having issues') 
            ? 'bg-yellow-50 border-yellow-200' 
            : 'bg-red-50 border-red-200'
        }`}>
          <p className={`font-medium ${
            error.includes('HEIC conversion is having issues')
              ? 'text-yellow-800'
              : 'text-red-800'
          }`}>
            {error.includes('HEIC conversion is having issues') ? 'Notice' : 'Error'}
          </p>
          <p className={
            error.includes('HEIC conversion is having issues')
              ? 'text-yellow-600'
              : 'text-red-600'
          }>
            {error}
          </p>
          {error.includes('HEIC') && (
            <div className="mt-3 text-sm text-gray-700">
              <p className="font-medium">Tips for HEIC files:</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Try using Safari browser (better HEIC support)</li>
                <li>Convert to JPEG using your iPhone's Photos app</li>
                <li>Take new photos in JPEG format (iPhone Settings → Camera → Formats → Most Compatible)</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Transfer Status */}
      {checkingTransferStatus && transferStatus && (
        <div className="mb-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              <div>
                <h3 className="font-medium text-blue-900">Sending to Processing Server</h3>
                <p className="text-sm text-blue-700">Please don't close this window</p>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-blue-700">Progress:</span>
                <span className="font-medium text-blue-900">
                  {transferStatus.sent} of {transferStatus.total} sent
                </span>
              </div>
              
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(transferStatus.sent / transferStatus.total) * 100}%` }}
                />
              </div>
              
              {transferStatus.failed > 0 && (
                <p className="text-sm text-red-600">
                  {transferStatus.failed} images failed to transfer
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Real-time Upload Status */}
      {Object.keys(processingStatus).length > 0 && !checkingTransferStatus && (
        <div className="mb-6">
          <RealTimeUploadStatus 
            uploads={Object.fromEntries(
              Object.entries(processingStatus).map(([fileName, status]) => [
                fileName, 
                {
                  fileName,
                  status: status as 'uploading' | 'processing' | 'completed' | 'failed',
                  startTime: new Date()
                }
              ])
            )}
          />
        </div>
      )}

      {/* Results Display */}
      {analysisResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <h2 className="text-xl font-bold text-green-900 mb-4">
            Analysis Results
          </h2>

          {/* Summary */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Summary</h3>
            <p className="text-gray-700 bg-white p-3 rounded border">
              {analysisResult.summary}
            </p>
          </div>

          {/* Database Status */}
          {analysisResult.savedToDatabase !== undefined && (
            <div className={`mb-6 p-3 rounded ${analysisResult.savedToDatabase ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {analysisResult.savedToDatabase 
                ? '✅ Items and image have been saved to your project.' 
                : '⚠️ Items could not be saved to the database. They are still available in this session.'}
              {analysisResult.dbError && <p className="mt-1 text-sm">{analysisResult.dbError}</p>}
            </div>
          )}

          {/* Box Summary */}
          {analysisResult.total_boxes && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Box Requirements
              </h3>
              <div className="bg-white p-4 rounded-lg border shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {analysisResult.total_boxes.small && analysisResult.total_boxes.small > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 p-2 rounded border bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Box className="h-5 w-5 text-gray-500" />
                        <span className="font-medium">{analysisResult.total_boxes.small} Small</span>
                      </div>
                      <span className="text-xs text-gray-500 ml-7 sm:ml-0">(16⅜" x 12⅝" x 12⅝")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.medium && analysisResult.total_boxes.medium > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 p-2 rounded border bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Box className="h-5 w-5 text-gray-500" />
                        <span className="font-medium">{analysisResult.total_boxes.medium} Medium</span>
                      </div>
                      <span className="text-xs text-gray-500 ml-7 sm:ml-0">(18⅛" x 18" x 16")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.large && analysisResult.total_boxes.large > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 p-2 rounded border bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Box className="h-5 w-5 text-gray-500" />
                        <span className="font-medium">{analysisResult.total_boxes.large} Large</span>
                      </div>
                      <span className="text-xs text-gray-500 ml-7 sm:ml-0">(18" x 18" x 24")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.extra_large && analysisResult.total_boxes.extra_large > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 p-2 rounded border bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Box className="h-5 w-5 text-gray-500" />
                        <span className="font-medium">{analysisResult.total_boxes.extra_large} Extra-Large</span>
                      </div>
                      <span className="text-xs text-gray-500 ml-7 sm:ml-0">(24" x 18" x 24")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.book && analysisResult.total_boxes.book > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 p-2 rounded border bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Box className="h-5 w-5 text-gray-500" />
                        <span className="font-medium">{analysisResult.total_boxes.book} Book</span>
                      </div>
                      <span className="text-xs text-gray-500 ml-7 sm:ml-0">(12" x 12" x 12")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.specialty && analysisResult.total_boxes.specialty > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 p-2 rounded border bg-gray-50">
                      <div className="flex items-center gap-2">
                        <Box className="h-5 w-5 text-gray-500" />
                        <span className="font-medium">{analysisResult.total_boxes.specialty} Specialty</span>
                      </div>
                      <span className="text-xs text-gray-500 ml-7 sm:ml-0">(Various sizes)</span>
                    </div>
                  )}
                </div>
                
                <div className="mt-4 p-3 bg-blue-50 rounded-md border border-blue-100">
                  <div className="flex items-center gap-2">
                    <BoxesIcon className="h-5 w-5 text-blue-500" />
                    <span className="font-medium text-blue-800">
                      Total Boxes: {calculateTotalBoxes(analysisResult.total_boxes)}
                    </span>
                  </div>
                  <p className="text-sm text-blue-600 mt-1">
                    These are U-Haul standard box recommendations based on item dimensions and weight.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Items List */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Identified Items ({analysisResult.items.length})
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {analysisResult.items.map((item, index) => (
                <div
                  key={index}
                  className="bg-white p-4 rounded-lg border shadow-sm"
                >
                  <h4 className="font-semibold text-gray-900 mb-1">
                    {item.name}
                  </h4>
                  {item.description && (
                    <p className="text-sm text-gray-600 mb-2">
                      {item.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    {item.location && (
                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                        {item.location}
                      </span>
                    )}
                    {item.category && (
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {item.category}
                      </span>
                    )}
                    {item.quantity && (
                      <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded">
                        Qty: {item.quantity}
                      </span>
                    )}
                    {item.cuft && (
                      <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                        {item.cuft} cuft
                      </span>
                    )}
                    {item.weight && (
                      <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                        {item.weight} lbs
                      </span>
                    )}
                    {item.fragile && (
                      <span className="bg-red-100 text-red-800 px-2 py-1 rounded">
                        Fragile
                      </span>
                    )}
                    {item.special_handling && (
                      <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded">
                        {item.special_handling}
                      </span>
                    )}
                    {item.box_recommendation && (
                      <span className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {item.box_recommendation.box_quantity} {item.box_recommendation.box_type} Box{item.box_recommendation.box_quantity > 1 ? 'es' : ''}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reset Button */}
          <div className="mt-6 text-center">
            <button
              onClick={handleReset}
              className="bg-gray-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-700 transition-colors cursor-pointer focus:ring-2 focus:ring-gray-500 focus:outline-none"
            >
              Analyze Another Photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}