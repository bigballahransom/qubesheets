// components/PhotoInventoryUploader.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, Camera, Loader2, X, Package, Box, BoxesIcon, Video, Play, Clock } from 'lucide-react';
import RealTimeUploadStatus from './RealTimeUploadStatus';
import { uploadImageDirectly, uploadVideoDirectly } from '@/lib/directCloudinaryUpload';

// S3UploadResult type for client-side usage
interface S3UploadResult {
  key: string;
  bucket: string;
  url: string;
  etag: string;
  uploadedAt: Date;
  contentType: string;
  size: number;
}

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

// Convert video to Gemini-compatible MP4 format
async function convertVideoToMP4(file: File): Promise<File> {
  // ALWAYS convert .MOV files - they are never compatible with Gemini
  const isMovFile = file.name.toLowerCase().endsWith('.mov');
  
  if (!isMovFile && file.type === 'video/mp4') {
    console.log('🎬 Video is already compatible MP4');
    return file;
  }

  console.log(`🔄 Converting ${file.name} (${file.type}) for compatibility...`);

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      reject(new Error('Video conversion timeout'));
    }, 120000);

    video.onloadedmetadata = () => {
      try {
        clearTimeout(timeout);

        // Find supported codec
        const mimeTypes = [
          'video/mp4; codecs="avc1.42E01E"', // H.264 baseline
          'video/mp4',
          'video/webm; codecs="vp8"'
        ];

        let supportedMimeType = null;
        for (const mimeType of mimeTypes) {
          if (MediaRecorder.isTypeSupported(mimeType)) {
            supportedMimeType = mimeType;
            break;
          }
        }

        if (!supportedMimeType) {
          throw new Error('Browser does not support video conversion');
        }

        console.log(`🎬 Using codec: ${supportedMimeType}`);

        // Set up canvas with mobile-optimized dimensions
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const maxDimension = 1280; // Good for mobile
        const aspectRatio = video.videoWidth / video.videoHeight;
        
        if (video.videoWidth > video.videoHeight) {
          canvas.width = Math.min(video.videoWidth, maxDimension);
          canvas.height = Math.round(canvas.width / aspectRatio);
        } else {
          canvas.height = Math.min(video.videoHeight, maxDimension);
          canvas.width = Math.round(canvas.height * aspectRatio);
        }

        const stream = canvas.captureStream(15); // 15 FPS

        // Add audio if available
        try {
          if ((video as any).captureStream) {
            const videoStream = (video as any).captureStream();
            const audioTracks = videoStream.getAudioTracks();
            audioTracks.forEach((track: MediaStreamTrack) => stream.addTrack(track));
          }
        } catch (audioError) {
          console.warn('🎬 Audio not available:', audioError);
        }

        const recorder = new MediaRecorder(stream, {
          mimeType: supportedMimeType,
          videoBitsPerSecond: 1000000, // 1 Mbps for good quality
          audioBitsPerSecond: 128000
        });

        const chunks: BlobPart[] = [];
        
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        recorder.onstop = () => {
          const outputType = supportedMimeType.includes('mp4') ? 'video/mp4' : 'video/webm';
          const blob = new Blob(chunks, { type: outputType });
          
          const fileName = file.name.replace(/\.[^/.]+$/, '.mp4');
          const convertedFile = new File([blob], fileName, {
            type: 'video/mp4',
            lastModified: Date.now()
          });

          const sizeMB = (convertedFile.size / 1024 / 1024).toFixed(2);
          const originalSizeMB = (file.size / 1024 / 1024).toFixed(2);
          console.log(`✅ Video converted: ${originalSizeMB}MB → ${sizeMB}MB`);
          
          resolve(convertedFile);
        };

        recorder.onerror = (event) => {
          console.error('🎬 Conversion error:', event.error);
          reject(new Error(`Conversion failed: ${event.error?.message || 'Unknown error'}`));
        };

        recorder.start(1000);

        // Video playback and canvas drawing
        const startTime = Date.now();
        const maxDuration = 60000; // 60 second limit

        const drawFrame = () => {
          if (video.paused || video.ended || Date.now() - startTime > maxDuration) {
            recorder.stop();
            return;
          }

          ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
          requestAnimationFrame(drawFrame);
        };

        video.onplay = drawFrame;
        video.onended = () => setTimeout(() => recorder.stop(), 500);
        
        video.play().catch(error => {
          reject(new Error(`Playback failed: ${error.message}`));
        });

      } catch (error) {
        clearTimeout(timeout);
        console.error('🎬 Setup error:', error);
        reject(new Error(`Setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    };

    video.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load video'));
    };

    video.src = URL.createObjectURL(file);
    video.load();
  });
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
  // Job tracking removed - using simple S3 upload with SQS instead
  const [s3UploadStatus, setS3UploadStatus] = useState<{[fileName: string]: 'uploading' | 'completed' | 'failed'}>({});
  const [s3UploadResults, setS3UploadResults] = useState<{[fileName: string]: S3UploadResult}>({});
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

        // Handle video conversion for .MOV files
        if (isVideo) {
          const isMovFile = file.name.toLowerCase().endsWith('.mov');
          if (isMovFile) {
            try {
              console.log(`🔄 Converting .MOV file: ${file.name}`);
              finalFile = await convertVideoToMP4(file);
              console.log(`✅ Video converted successfully: ${file.name} → ${finalFile.name}`);
            } catch (conversionError) {
              console.warn(`⚠️ Video conversion failed for ${file.name}, uploading original:`, conversionError);
              // Continue with original file as fallback
            }
          } else {
            console.log(`🎬 Video file ${file.name} is already compatible`);
          }
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
        const file = validFiles[0];
        const isVideo = isVideoFile(file);
        
        if (isVideo) {
          // For videos, create preview URL for video element
          try {
            setPreviewUrl(URL.createObjectURL(file));
          } catch (previewError) {
            console.log('Could not create video preview, will show placeholder');
            setPreviewUrl(null);
          }
        } else {
          // For images, create preview URL for img element
          try {
            setPreviewUrl(URL.createObjectURL(file));
          } catch (previewError) {
            console.log('Could not create image preview, will show placeholder');
            setPreviewUrl(null);
          }
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

  // Transfer status polling removed - using simple S3 upload with SQS instead

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

  // Upload raw file to S3 via server-side API with automatic retry
  const uploadRawFileToS3 = async (file: File, fileNum: number): Promise<S3UploadResult | null> => {
    const maxRetries = 3;
    const retryDelays = [1000, 2000]; // 1s, 2s delays between retries
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📤 S3 upload attempt ${attempt}/${maxRetries} for file ${fileNum}: ${file.name}`);
        
        // Update S3 upload status with retry info
        const statusText = attempt === 1 ? 'uploading' : `retrying (${attempt}/${maxRetries})`;
        setS3UploadStatus(prev => ({
          ...prev,
          [file.name]: statusText as any
        }));

        // Create form data for API call
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', projectId || 'unknown');
        formData.append('fileIndex', fileNum.toString());

        // Call server-side API to upload to S3
        const response = await fetch('/api/upload-to-s3', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'S3 upload failed');
        }

        const result = await response.json();
        const s3Result = result.s3Result as S3UploadResult;

        console.log(`✅ S3 upload successful on attempt ${attempt} for file ${fileNum}:`, s3Result.key);

        // Update status and store result
        setS3UploadStatus(prev => ({
          ...prev,
          [file.name]: 'completed'
        }));
        
        setS3UploadResults(prev => ({
          ...prev,
          [file.name]: s3Result
        }));

        return s3Result;

      } catch (error) {
        console.error(`❌ S3 upload attempt ${attempt}/${maxRetries} failed for file ${fileNum}:`, error);
        
        // If this was the last attempt, mark as failed and give up
        if (attempt === maxRetries) {
          console.error(`❌ S3 upload failed permanently for file ${fileNum} after ${maxRetries} attempts`);
          setS3UploadStatus(prev => ({
            ...prev,
            [file.name]: 'failed'
          }));
          return null;
        }
        
        // Wait before retrying (exponential backoff)
        const delay = retryDelays[attempt - 1];
        console.log(`⏳ Waiting ${delay}ms before retry attempt ${attempt + 1} for file ${fileNum}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // This should never be reached due to the logic above, but TypeScript needs it
    return null;
  };

  // Handle direct Cloudinary upload for large files (images only)
  const handleDirectUpload = async (file: File, fileNum: number, s3Result?: S3UploadResult | null) => {
    try {
      console.log('📤 Starting direct Cloudinary upload for admin');
      
      // Only allow images
      if (file.type.startsWith('video/')) {
        throw new Error('Video uploads are not supported at this time.');
      }
      
      // Upload directly to Cloudinary
      const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!;
      
      const cloudinaryResult = await uploadImageDirectly(file, uploadPreset, {
        folder: `qubesheets/processed-images/${projectId}`,
        context: 'admin_upload=true'
      });
      
      console.log('✅ Direct Cloudinary upload successful:', cloudinaryResult);
      
      // Get base64 for analysis (images only)
      let imageBuffer = null;
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
      } catch (error) {
        console.warn('Could not generate base64:', error);
      }
      
      // Save metadata to database
      const metadataUrl = `/api/projects/${projectId}/save-image-metadata`;
      const metadataPayload = {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        cloudinaryResult,
        imageBuffer,
        description: imageDescription,
        // Include S3 information if available
        s3RawFile: s3Result ? {
          key: s3Result.key,
          bucket: s3Result.bucket,
          url: s3Result.url,
          etag: s3Result.etag,
          uploadedAt: s3Result.uploadedAt,
          contentType: s3Result.contentType
        } : undefined
      };
      
      console.log('💾 Saving admin metadata to:', metadataUrl);
      
      const metadataResponse = await fetch(metadataUrl, {
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
      
      const result = await metadataResponse.json();
      console.log('✅ Admin metadata saved successfully:', result);
      
      return result;
      
    } catch (error) {
      console.error('❌ Direct admin upload failed:', error);
      throw error;
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
          // Step 0: Upload raw file to S3 BEFORE any processing
          console.log(`📤 Step 0: Uploading raw file ${fileNum} to S3...`);
          let s3Result: S3UploadResult | null = null;
          try {
            s3Result = await uploadRawFileToS3(file, fileNum);
            if (s3Result) {
              console.log(`✅ Raw file ${fileNum} uploaded to S3:`, s3Result.key);
            } else {
              console.log(`⚠️ S3 upload failed for file ${fileNum}, continuing with existing flow`);
            }
          } catch (s3Error) {
            console.warn(`⚠️ S3 upload failed for file ${fileNum}:`, s3Error);
            // Continue with existing functionality even if S3 fails
          }

          // Step 1: Process mobile images to prevent upload failures (skip for videos)
          let processedFile = file;
          const isVideo = file.type.startsWith('video/');
          
          if (!isVideo) {
            try {
              processedFile = await processImageForMobile(file);
            } catch (processingError) {
              console.warn('⚠️ Image processing failed, using original file:', processingError);
              processedFile = file;
            }
          } else {
            console.log(`🎬 Skipping image processing for video file: ${file.name}`);
          }

          // Handle both images and videos
          console.log(`📹 Processing ${isVideo ? 'video' : 'image'} file ${fileNum}: ${processedFile.name}`);
          
          // Step 1: Check if file is too large for regular upload
          const PAYLOAD_LIMIT = 2 * 1024 * 1024; // 2MB
          const shouldUseDirectUpload = processedFile.size > PAYLOAD_LIMIT;
          let savedImage;
          
          console.log(`📊 Upload decision for file ${fileNum}:`, {
            fileName: processedFile.name,
            fileSize: processedFile.size,
            fileSizeMB: (processedFile.size / (1024 * 1024)).toFixed(2),
            payloadLimit: PAYLOAD_LIMIT,
            shouldUseDirectUpload
          });
          
          if (isVideo) {
            // Videos: Save metadata to MongoDB and trigger SQS processing
            console.log(`🎬 Video ${fileNum} uploaded to S3, now saving metadata to MongoDB...`);
            if (s3Result) {
              try {
                const videoMetadata = {
                  fileName: file.name,
                  fileSize: file.size,
                  fileType: file.type,
                  s3RawFile: {
                    key: s3Result.key,
                    bucket: s3Result.bucket,
                    url: s3Result.url,
                    etag: s3Result.etag,
                    uploadedAt: s3Result.uploadedAt,
                    contentType: s3Result.contentType
                  }
                };

                const metadataResponse = await fetch(`/api/projects/${projectId}/save-video-metadata`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(videoMetadata),
                });

                if (!metadataResponse.ok) {
                  const errorText = await metadataResponse.text();
                  console.error(`❌ Failed to save video metadata for ${file.name}:`, errorText);
                  throw new Error(`Failed to save video metadata: ${errorText}`);
                }

                savedImage = await metadataResponse.json();
                console.log(`✅ Video metadata saved for ${file.name}:`, savedImage);
              } catch (metadataError) {
                console.error(`❌ Error saving video metadata for ${file.name}:`, metadataError);
                setProcessingStatus(prev => ({
                  ...prev,
                  [file.name]: 'failed'
                }));
                continue; // Skip to next file
              }
            } else {
              console.error(`❌ No S3 result available for video ${file.name}`);
              savedImage = { success: false, message: 'S3 upload failed' };
            }
          } else if (shouldUseDirectUpload) {
            console.log(`📤 File ${fileNum} using direct Cloudinary upload (size > 2MB)`);
            savedImage = await handleDirectUpload(processedFile, fileNum, s3Result);
          } else {
            // Regular upload for smaller files - use save-image-metadata endpoint to trigger SQS processing
            console.log(`💾 Image ${fileNum} uploaded to S3, now saving metadata to MongoDB...`);
            if (s3Result) {
              try {
                // Convert image to base64 for analysis
                let imageBuffer = null;
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
                    img.src = URL.createObjectURL(processedFile);
                  });
                } catch (error) {
                  console.warn('Could not generate base64 for analysis:', error);
                }

                const imageMetadata = {
                  fileName: processedFile.name,
                  fileSize: processedFile.size,
                  fileType: processedFile.type,
                  imageBuffer,
                  s3RawFile: {
                    key: s3Result.key,
                    bucket: s3Result.bucket,
                    url: s3Result.url,
                    etag: s3Result.etag,
                    uploadedAt: s3Result.uploadedAt,
                    contentType: s3Result.contentType,
                    size: s3Result.size
                  }
                };

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

                const saveResponse = await fetch(`/api/projects/${projectId}/save-image-metadata`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(imageMetadata),
                  // Add timeout for mobile networks
                  signal: AbortSignal.timeout(120000) // 2 minute timeout for mobile
                });

                if (!saveResponse.ok) {
                  const errorText = await saveResponse.text();
                  console.error(`❌ Failed to save image metadata for ${file.name}:`, errorText);
                  throw new Error(`Failed to save image metadata: ${errorText}`);
                }

                savedImage = await saveResponse.json();
                console.log(`✅ Image metadata saved for ${file.name}:`, savedImage);
              } catch (metadataError) {
                console.error(`❌ Error saving image metadata for ${file.name}:`, metadataError);
                setProcessingStatus(prev => ({
                  ...prev,
                  [file.name]: 'failed'
                }));
                continue; // Skip to next file
              }
            } else {
              console.error(`❌ No S3 result available for image ${file.name}`);
              savedImage = { success: false, message: 'S3 upload failed' };
            }
          }
          console.log(`✅ ${isVideo ? 'Video' : 'Image'} ${fileNum} saved and queued for processing:`, savedImage.imageId || savedImage.videoId);

          // Immediate UI feedback - trigger gallery refresh right away
          if (onImageSaved) {
            console.log('🔄 Triggering immediate gallery refresh...');
            onImageSaved();
          }

          // SQS processing is automatically triggered by metadata save endpoints
          setProcessingStatus(prev => ({
            ...prev,
            [file.name]: 'completed'
          }));
          
          // Show notification after first successful save
          if (!modalClosed) {
            const { toast } = await import('sonner');
            toast.success(`Saving ${selectedFiles.length} image${selectedFiles.length > 1 ? 's' : ''}...`, {
              description: 'Images will be processed automatically...',
              duration: 4000,
            });
            modalClosed = true;
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

      // Simple completion - no job tracking needed with SQS
      console.log('📋 [PhotoUploader] All images processed - closing');
      handleReset();
      if (onClose) {
        onClose();
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
    // Job tracking state removed
    setS3UploadStatus({});
    setS3UploadResults({});
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
          Upload photos or videos to automatically identify inventory items
        </p>
      </div>

      {/* Upload Section */}
      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,.heic,.heif"
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
              Images: JPG, PNG, GIF, HEIC, HEIF (up to 15MB each)<br/>
              Videos: MP4, MOV, AVI, WebM (up to 100MB each)
            </p>
          </div>
        ) : isConverting ? (
          <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50">
            <Loader2 className="mx-auto h-12 w-12 text-blue-500 animate-spin mb-4" />
            <p className="text-lg font-medium text-blue-700 mb-2">
              Uploading...
            </p>
          </div>
        ) : selectedFiles.length > 0 ? (
          <div className="space-y-4">
            {/* Media preview - works for both images and videos */}
            <div className="relative">
              {selectedFiles.length === 1 && previewUrl ? (
                hasVideoFiles ? (
                  <video
                    src={previewUrl}
                    controls
                    preload="metadata"
                    className="w-1/2 max-w-md mx-auto rounded-lg shadow-md"
                    style={{ maxHeight: '300px' }}
                  />
                ) : (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-1/2 max-w-md mx-auto rounded-lg shadow-md"
                  />
                )
              ) : selectedFiles.length === 1 ? (
                  <div className="w-1/2 max-w-md mx-auto rounded-lg shadow-md bg-gray-100 border-2 border-dashed border-gray-300 flex flex-col items-center justify-center p-8">
                    {hasVideoFiles ? (
                      <>
                        <Video className="h-12 w-12 text-purple-500 mb-2" />
                        <p className="text-sm font-medium text-gray-600">Video Selected</p>
                        <p className="text-xs text-gray-500 text-center mt-1">
                          {selectedFiles[0].name}
                          <br />
                          Video will be analyzed with full content
                        </p>
                      </>
                    ) : (
                      <>
                        <Camera className="h-12 w-12 text-gray-400 mb-2" />
                        <p className="text-sm font-medium text-gray-600">Image Selected</p>
                        <p className="text-xs text-gray-500 text-center mt-1">
                          {selectedFiles[0].name}
                          <br />
                          Preview will be available after analysis
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="w-1/2 max-w-md mx-auto rounded-lg shadow-md bg-blue-100 border-2 border-dashed border-blue-300 flex flex-col items-center justify-center p-8">
                    <Package className="h-12 w-12 text-blue-500 mb-2" />
                    <p className="text-lg font-medium text-blue-700">{selectedFiles.length} {hasVideoFiles ? 'Media Files' : 'Images'} Selected</p>
                    <p className="text-sm text-blue-600 text-center mt-1">
                      Ready to analyze {hasVideoFiles ? 'images and videos' : 'multiple images'}
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
            
            {/* Media Description Input - works for both images and videos */}
            <div className="max-w-md mx-auto">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Add a description (optional)
              </label>
              <input
                id="description"
                type="text"
                value={imageDescription}
                onChange={(e) => setImageDescription(e.target.value)}
                placeholder="e.g., Living room items, Kitchen inventory, Home walkthrough..."
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Action Buttons - Show for both image and video uploads */}
      {selectedFiles.length > 0 && !analysisResult && (
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
            Your {hasVideoFiles ? 'video' : 'image'} will be saved to the project gallery
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

      {/* Transfer status UI removed - using simple S3 upload with SQS */}

      {/* S3 Upload Status */}
      {Object.keys(s3UploadStatus).length > 0 && (
        <div className="mb-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            {/* <h3 className="text-sm font-medium text-blue-900 mb-3">📤 S3 Raw File Upload Status</h3> */}
            <div className="space-y-2">
              {Object.entries(s3UploadStatus).map(([fileName, status]) => (
                <div key={fileName} className="flex items-center justify-between text-sm">
                  <span className="text-blue-800 truncate max-w-xs">{fileName}</span>
                  <div className="flex items-center gap-2">
                    {(status === 'uploading' || status.includes('retrying')) && (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="text-blue-600">
                          {status === 'uploading' ? 'Uploading...' : `Retrying...`}
                        </span>
                        {status.includes('retrying') && (
                          <span className="text-xs text-blue-500">
                            {status.match(/\((\d+\/\d+)\)/)?.[1]}
                          </span>
                        )}
                      </>
                    )}
                    {status === 'completed' && (
                      <>
                        <span className="text-green-600">✅ Uploaded</span>
                        {s3UploadResults[fileName] && (
                          <span className="text-xs text-gray-500">
                            ({(s3UploadResults[fileName].size / (1024 * 1024)).toFixed(2)}MB)
                          </span>
                        )}
                      </>
                    )}
                    {status === 'failed' && (
                      <span className="text-red-600">❌ Failed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* <p className="text-xs text-blue-600 mt-2">
              Raw files are uploaded to S3 for backup before processing
            </p> */}
          </div>
        </div>
      )}

      {/* Real-time Upload Status */}
      {Object.keys(processingStatus).length > 0 && (
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