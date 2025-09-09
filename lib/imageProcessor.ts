// lib/imageProcessor.ts - Centralized image preprocessing pipeline

import sharp from 'sharp';

export interface ProcessedImage {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  processedName: string;
  size: number;
  compressionApplied: boolean;
  heicConverted: boolean;
  qualityReduction?: number;
}

export interface ProcessingOptions {
  maxSizeBytes?: number;
  targetQuality?: number;
  minQuality?: number;
  allowHeicConversion?: boolean;
  forceJpegConversion?: boolean;
}

// Default processing options
const DEFAULT_OPTIONS: ProcessingOptions = {
  maxSizeBytes: 14 * 1024 * 1024, // 14MB for MongoDB safety
  targetQuality: 80,
  minQuality: 30,
  allowHeicConversion: true,
  forceJpegConversion: false,
};

// Helper function to detect video files
export function isVideoFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v'];
  const hasVideoExtension = videoExtensions.some(ext => fileName.endsWith(ext));
  const hasVideoMimeType = mimeType.startsWith('video/');
  
  return hasVideoExtension || hasVideoMimeType;
}

// Helper function to detect HEIC files
export function isHeicFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  return (
    fileName.endsWith('.heic') || 
    fileName.endsWith('.heif') ||
    mimeType === 'image/heic' ||
    mimeType === 'image/heif'
  );
}

// Validate file type
export function validateImageFile(file: File): { isValid: boolean; error?: string; isVideo: boolean; isHeic: boolean } {
  const isRegularImage = file.type.startsWith('image/');
  const isVideo = isVideoFile(file);
  const isHeic = isHeicFile(file);
  const hasImageExtension = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name);
  const isPotentialMobileImage = (file.type === '' || file.type === 'application/octet-stream' || file.type === 'text/plain') && hasImageExtension;
  
  const isAnyImageType = isRegularImage || isPotentialMobileImage || isHeic;
  
  if (!isAnyImageType && !isVideo) {
    return {
      isValid: false,
      error: 'Invalid file type. Please upload an image (JPEG, PNG, GIF, HEIC, HEIF) or video (MP4, MOV, AVI, WebM).',
      isVideo: false,
      isHeic: false
    };
  }
  
  return {
    isValid: true,
    isVideo,
    isHeic
  };
}

// Convert HEIC to JPEG with production-safe handling
async function convertHeicToJpeg(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
  console.log('🔧 Attempting HEIC conversion...');
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    console.log('🏭 Production environment - attempting fallback Sharp conversion');
    
    try {
      const convertedBuffer = await sharp(buffer)
        .jpeg({ quality: 80 })
        .toBuffer();
      
      console.log('✅ Sharp HEIC conversion successful');
      return {
        buffer: convertedBuffer,
        mimeType: 'image/jpeg'
      };
      
    } catch (error) {
      console.error('❌ Sharp HEIC conversion failed:', error);
      throw new Error('HEIC conversion failed. Please convert the image to JPEG using your device\'s photo app and try again.');
    }
  }
  
  // Development environment - try full conversion
  try {
    const convert = require('heic-convert');
    
    const convertedBuffer = await convert({
      buffer: buffer,
      format: 'JPEG',
      quality: 0.8
    });
    
    console.log('✅ heic-convert conversion successful');
    return {
      buffer: Buffer.from(convertedBuffer),
      mimeType: 'image/jpeg'
    };
    
  } catch (heicError) {
    console.log('⚠️ heic-convert failed, trying Sharp...', heicError);
    
    try {
      const convertedBuffer = await sharp(buffer)
        .jpeg({ quality: 80 })
        .toBuffer();
      
      console.log('✅ Sharp HEIC conversion successful');
      return {
        buffer: convertedBuffer,
        mimeType: 'image/jpeg'
      };
      
    } catch (sharpError) {
      console.error('❌ Both HEIC converters failed:', { heicError, sharpError });
      throw new Error('HEIC conversion failed with both converters. Please convert to JPEG manually.');
    }
  }
}

// Normalize MIME type based on file extension
function normalizeMimeType(originalType: string, fileName: string): string {
  // If we have a proper MIME type, use it
  if (originalType && originalType !== 'application/octet-stream' && originalType !== 'text/plain') {
    return originalType;
  }
  
  // Guess from extension
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'bmp':
      return 'image/bmp';
    case 'tiff':
    case 'tif':
      return 'image/tiff';
    default:
      return 'image/jpeg'; // Safe default
  }
}

// Compress image if too large
async function compressImage(buffer: Buffer, mimeType: string, options: ProcessingOptions): Promise<{ buffer: Buffer; mimeType: string; qualityUsed: number }> {
  const maxSize = options.maxSizeBytes!;
  
  if (buffer.length <= maxSize) {
    return { buffer, mimeType, qualityUsed: 100 };
  }
  
  console.log(`📋 Image too large (${(buffer.length / (1024 * 1024)).toFixed(2)}MB), compressing...`);
  
  let quality = options.targetQuality!;
  let compressed = await sharp(buffer)
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  
  // Iteratively reduce quality until we hit target size
  while (compressed.length > maxSize && quality > options.minQuality!) {
    quality -= 10;
    compressed = await sharp(buffer)
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    
    console.log(`📋 Trying quality ${quality}, size: ${(compressed.length / (1024 * 1024)).toFixed(2)}MB`);
  }
  
  if (compressed.length > maxSize) {
    throw new Error(`Image file is too large. Even after compression to quality ${quality}, the file still exceeds ${(maxSize / (1024 * 1024)).toFixed(1)}MB. Please resize the image and try again.`);
  }
  
  const reductionPercent = ((1 - compressed.length / buffer.length) * 100).toFixed(1);
  console.log(`✅ Image compressed: ${(compressed.length / (1024 * 1024)).toFixed(2)}MB (${reductionPercent}% reduction, quality: ${quality})`);
  
  return {
    buffer: compressed,
    mimeType: 'image/jpeg',
    qualityUsed: quality
  };
}

// Main image processing pipeline
export async function processImage(file: File, options: ProcessingOptions = {}): Promise<ProcessedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  console.log(`🖼️ Starting image processing pipeline: ${file.name}`);
  
  // Validate file
  const validation = validateImageFile(file);
  if (!validation.isValid) {
    throw new Error(validation.error!);
  }
  
  if (validation.isVideo) {
    throw new Error('Video files require different processing. Use video processing pipeline.');
  }
  
  // Convert to buffer
  const originalBuffer = Buffer.from(await file.arrayBuffer());
  let buffer = originalBuffer;
  let mimeType = normalizeMimeType(file.type, file.name);
  
  let heicConverted = false;
  let compressionApplied = false;
  let qualityReduction: number | undefined;
  
  console.log(`🖼️ Original: ${file.name}, ${(buffer.length / (1024 * 1024)).toFixed(2)}MB, ${mimeType}`);
  
  // Handle HEIC conversion
  if (validation.isHeic && opts.allowHeicConversion) {
    try {
      const converted = await convertHeicToJpeg(buffer);
      buffer = converted.buffer;
      mimeType = converted.mimeType;
      heicConverted = true;
      console.log(`✅ HEIC converted: ${(buffer.length / (1024 * 1024)).toFixed(2)}MB`);
    } catch (error) {
      console.error('❌ HEIC conversion failed:', error);
      throw error;
    }
  }
  
  // Force JPEG conversion if requested
  if (opts.forceJpegConversion && mimeType !== 'image/jpeg') {
    try {
      const convertedBuffer = await sharp(buffer)
        .jpeg({ quality: opts.targetQuality })
        .toBuffer();
      
      buffer = convertedBuffer;
      mimeType = 'image/jpeg';
      console.log(`✅ Forced JPEG conversion: ${(buffer.length / (1024 * 1024)).toFixed(2)}MB`);
    } catch (error) {
      console.warn('⚠️ Failed to force JPEG conversion:', error);
      // Continue with original format
    }
  }
  
  // Compress if needed
  if (buffer.length > opts.maxSizeBytes!) {
    try {
      const compressed = await compressImage(buffer, mimeType, opts);
      buffer = compressed.buffer;
      mimeType = compressed.mimeType;
      qualityReduction = compressed.qualityUsed;
      compressionApplied = true;
    } catch (error) {
      console.error('❌ Compression failed:', error);
      throw error;
    }
  }
  
  const processedName = heicConverted || compressionApplied ? 
    file.name.replace(/\.[^/.]+$/, '.jpg') : 
    file.name;
  
  console.log(`✅ Processing complete: ${processedName}, ${(buffer.length / (1024 * 1024)).toFixed(2)}MB, ${mimeType}`);
  
  return {
    buffer,
    mimeType,
    originalName: file.name,
    processedName,
    size: buffer.length,
    compressionApplied,
    heicConverted,
    qualityReduction
  };
}

// Helper function to check if file size is within limits
export function validateFileSize(file: File, maxImageSize?: number, maxVideoSize?: number): { isValid: boolean; error?: string } {
  const isVideo = isVideoFile(file);
  const maxSize = isVideo ? 
    (maxVideoSize || 100 * 1024 * 1024) : // 100MB default for video
    (maxImageSize || 50 * 1024 * 1024);   // 50MB default for images
  
  if (file.size > maxSize) {
    const fileType = isVideo ? 'video' : 'image';
    const maxSizeMB = Math.round(maxSize / (1024 * 1024));
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    
    return {
      isValid: false,
      error: `File size too large. Please upload a ${fileType} smaller than ${maxSizeMB}MB. Your file is ${fileSizeMB}MB.`
    };
  }
  
  return { isValid: true };
}