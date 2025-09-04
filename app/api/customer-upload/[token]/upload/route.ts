// app/api/customer-upload/[token]/upload/route.ts - Updated with queue system

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Image from '@/models/Image';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { backgroundQueue } from '@/lib/backgroundQueue';
import sharp from 'sharp';
import { uploadVideo, uploadImage as uploadImageToCloudinary } from '@/lib/cloudinary';

// Helper function to detect video files server-side
function isVideoFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
  const hasVideoExtension = videoExtensions.some(ext => fileName.endsWith(ext));
  const hasVideoMimeType = mimeType.startsWith('video/');
  
  return hasVideoExtension || hasVideoMimeType;
}

// Helper function to detect HEIC files server-side
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

// Production-safe server-side HEIC handling
async function convertHeicToJpeg(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string; originalName: string; convertedName: string }> {
  console.log('🔧 Attempting server-side HEIC conversion...');
  
  // In production (Vercel), prioritize stability over server-side conversion
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    console.log('🏭 Vercel production environment detected - skipping complex HEIC conversion');
    throw new Error('HEIC files require client-side conversion in production. Please ensure your browser converted this file before upload, or try converting to JPEG using your device\'s photo app.');
  }
  
  // Development environment - try full conversion
  try {
    console.log('📦 Attempting conversion with heic-convert...');
    const convert = require('heic-convert');
    
    const convertedBuffer = await convert({
      buffer: buffer,
      format: 'JPEG',
      quality: 0.8
    });
    
    console.log('✅ Server-side heic-convert conversion successful');
    return {
      buffer: Buffer.from(convertedBuffer),
      mimeType: 'image/jpeg',
      originalName: 'original.heic',
      convertedName: 'converted.jpg'
    };
    
  } catch (heicConvertError) {
    console.log('⚠️ heic-convert failed, trying Sharp...', heicConvertError);
    
    // Fallback to Sharp (may work if libheif is compiled)
    try {
      const convertedBuffer = await sharp(buffer)
        .jpeg({ quality: 80 })
        .toBuffer();
      
      console.log('✅ Server-side Sharp HEIC conversion successful');
      return {
        buffer: convertedBuffer,
        mimeType: 'image/jpeg',
        originalName: 'original.heic',
        convertedName: 'converted.jpg'
      };
      
    } catch (sharpError) {
      console.log('❌ Both heic-convert and Sharp failed:', { heicConvertError, sharpError });
      
      // If both fail, provide comprehensive guidance
      const errorDetails: string[] = [];
      if (heicConvertError && typeof heicConvertError === 'object' && 'message' in heicConvertError && heicConvertError.message) {
        errorDetails.push(`heic-convert: ${heicConvertError.message}`);
      }
      if (sharpError && typeof sharpError === 'object' && 'message' in sharpError && sharpError.message) {
        errorDetails.push(`sharp: ${sharpError.message}`);
      }
      
      throw new Error(`Server-side HEIC conversion failed. ${errorDetails.join('; ')}. Client-side conversion should handle this automatically.`);
    }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  console.log('🔍 Customer upload API called');
  try {
    console.log('📤 Customer upload initiated');
    
    await connectMongoDB();
    console.log('🔗 MongoDB connected');
    
    const { token } = await params;
    console.log('🎫 Token received (optional):', token);
    
    // Try to find customer upload for project association, but don't require it
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true
    });

    console.log('📋 Customer upload found:', !!customerUpload);
    
    // If no valid customer upload, we'll create a default project association
    let projectId = null;
    let userId = null;
    let organizationId = null;
    
    if (customerUpload) {
      projectId = customerUpload.projectId;
      userId = customerUpload.userId;
      organizationId = customerUpload.organizationId;
    } else {
      // Fallback: Create/use a default "Customer Uploads" project
      console.log('🔄 No valid token, using fallback project creation');
      
      // Find or create a default project for anonymous uploads
      let defaultProject = await Project.findOne({ 
        name: 'Anonymous Customer Uploads',
        isDefault: true 
      });
      
      if (!defaultProject) {
        defaultProject = await Project.create({
          name: 'Anonymous Customer Uploads',
          description: 'Photos uploaded without specific project tokens',
          isDefault: true,
          createdAt: new Date()
        });
        console.log('📁 Created default project for anonymous uploads:', defaultProject._id);
      }
      
      projectId = defaultProject._id;
      // Leave userId and organizationId as null for anonymous uploads
    }

    // Parse the form data
    const formData = await request.formData();
    const image = formData.get('image') as File;

    console.log('📁 File received:', image?.name, 'Size:', image?.size);

    if (!image) {
      return NextResponse.json(
        { error: 'No image file provided' },
        { status: 400 }
      );
    }

    // Enhanced file type validation for mobile browsers - including video files
    const isRegularImage = image.type.startsWith('image/');
    const isVideo = isVideoFile(image);
    const isHeic = isHeicFile(image);
    const hasImageExtension = /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(image.name);
    const isPotentialMobileImage = (image.type === '' || image.type === 'application/octet-stream') && hasImageExtension;
    
    console.log('📱 Customer upload file validation:', {
      fileName: image.name,
      mimeType: image.type || 'empty',
      size: image.size,
      isRegularImage,
      isVideo,
      isHeic,
      hasImageExtension,
      isPotentialMobileImage,
      userAgent: request.headers.get('user-agent')?.substring(0, 100)
    });
    
    if (!isRegularImage && !isVideo && !isHeic && !isPotentialMobileImage) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an image (JPEG, PNG, GIF, HEIC, HEIF) or video (MP4, MOV, AVI, WebM).' },
        { status: 400 }
      );
    }

    // MongoDB document size limit is 16MB, so we need stricter limits
    const mongoDBLimit = 16 * 1024 * 1024; // 16MB MongoDB limit
    const imageMaxSize = 15 * 1024 * 1024; // 15MB for images (leaving buffer for metadata)
    const videoMaxSize = parseInt(process.env.MAX_VIDEO_UPLOAD_SIZE || '104857600'); // 100MB for videos (stored separately)
    const maxSize = isVideo ? videoMaxSize : imageMaxSize;
    
    console.log('📄 File size validation:', {
      fileName: image.name,
      fileSize: image.size,
      fileSizeMB: (image.size / (1024 * 1024)).toFixed(2) + 'MB',
      isVideo,
      maxSize,
      maxSizeMB: (maxSize / (1024 * 1024)).toFixed(2) + 'MB',
      mongoDBLimit: (mongoDBLimit / (1024 * 1024)).toFixed(2) + 'MB'
    });
    
    if (image.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      const fileType = isVideo ? 'video' : 'image';
      return NextResponse.json(
        { error: `File size too large. Please upload a ${fileType} smaller than ${maxSizeMB}MB. Your file is ${(image.size / (1024 * 1024)).toFixed(2)}MB.` },
        { status: 400 }
      );
    }

    // Handle video files - upload to Cloudinary and save metadata
    if (isVideo) {
      console.log('🎬 Processing video file for customer upload:', image.name);
      
      const videoBuffer = Buffer.from(await image.arrayBuffer());
      const timestamp = Date.now();
      const customerName = customerUpload?.customerName || 'anonymous';
      const cleanCustomerName = customerName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      const name = `customer-video-${cleanCustomerName}-${timestamp}-${image.name}`;
      
      // Upload to Cloudinary
      let cloudinaryResult: {
        success: boolean;
        publicId: string;
        url: string;
        secureUrl: string;
        duration?: number;
        format?: string;
        bytes?: number;
        width?: number;
        height?: number;
        createdAt?: string;
      };
      
      try {
        console.log('📤 Uploading customer video to Cloudinary...');
        
        const nameWithoutExt = image.name.replace(/\.[^/.]+$/, ''); // Remove file extension  
        const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9.-]/g, '_');
        const publicId = `customer_${cleanCustomerName}_${timestamp}_${sanitizedName}`;
        
        cloudinaryResult = await uploadVideo(videoBuffer, {
          public_id: publicId,
          folder: `qubesheets/customer-uploads/${projectId || 'anonymous'}/videos`,
          transformation: [
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
          ]
        }) as typeof cloudinaryResult;
        
        console.log('✅ Customer video uploaded to Cloudinary:', cloudinaryResult.publicId);
        
      } catch (cloudinaryError) {
        console.error('❌ Customer video Cloudinary upload failed:', cloudinaryError);
        const errorMessage = cloudinaryError instanceof Error ? cloudinaryError.message : 'Unknown error';
        return NextResponse.json(
          { error: `Failed to upload video: ${errorMessage}` },
          { status: 500 }
        );
      }
      
      // Save video metadata with Cloudinary URLs
      const videoDoc = await Video.create({
        name,
        originalName: image.name,
        mimeType: image.type,
        size: image.size,
        duration: cloudinaryResult.duration || 0,
        cloudinaryPublicId: cloudinaryResult.publicId,
        cloudinaryUrl: cloudinaryResult.url,
        cloudinarySecureUrl: cloudinaryResult.secureUrl,
        projectId,
        userId,
        organizationId,
        description: `Video uploaded by ${customerName}`,
        source: 'customer_upload',
        metadata: {
          uploadToken: token,
          processingPending: true,
          cloudinaryInfo: {
            format: cloudinaryResult.format || 'unknown',
            bytes: cloudinaryResult.bytes || 0,
            width: cloudinaryResult.width || 0,
            height: cloudinaryResult.height || 0,
            createdAt: cloudinaryResult.createdAt || new Date().toISOString()
          }
        }
      });
      
      console.log('✅ Customer video metadata saved:', videoDoc._id);
      
      // Update project timestamp
      await Project.findByIdAndUpdate(projectId, { 
        updatedAt: new Date() 
      });
      
      // Return instructions for client-side frame extraction
      return NextResponse.json({
        success: true,
        videoId: videoDoc._id.toString(),
        requiresClientProcessing: true,
        videoInfo: {
          fileName: image.name,
          size: image.size,
          type: image.type,
          customerName,
          projectId: projectId?.toString(),
          uploadToken: token,
          videoId: videoDoc._id.toString(),
          cloudinaryUrl: cloudinaryResult.secureUrl
        },
        message: 'Video uploaded successfully to cloud storage - ready for processing',
        instructions: 'extract_frames_and_upload'
      });
    }

    // Process image (handle HEIC if needed)
    const bytes = await image.arrayBuffer();
    let buffer = Buffer.from(bytes);
    let mimeType = image.type;
    
    console.log('🖼️ Original image details:', {
      fileName: image.name,
      originalSize: buffer.length,
      originalSizeMB: (buffer.length / (1024 * 1024)).toFixed(2) + 'MB',
      mimeType
    });

    // For HEIC files, attempt server-side handling as fallback
    if (isHeic) {
      try {
        const converted = await convertHeicToJpeg(buffer);
        buffer = Buffer.from(converted.buffer);
        mimeType = converted.mimeType;
        console.log('✅ Server-side HEIC conversion successful');
      } catch (conversionError) {
        console.error('❌ Server HEIC conversion failed:', conversionError);
        
        // Extract meaningful error message
        const errorMsg = conversionError instanceof Error ? conversionError.message : 'Unknown conversion error';
        
        return NextResponse.json(
          { error: `HEIC processing failed: ${errorMsg}` },
          { status: 400 }
        );
      }
    }
    
    // Compress image if it's too large for MongoDB
    const mongoDBSafeSize = 14 * 1024 * 1024; // 14MB to be safe
    if (buffer.length > mongoDBSafeSize) {
      console.log('📋 Image too large, compressing...', {
        originalSize: buffer.length,
        originalSizeMB: (buffer.length / (1024 * 1024)).toFixed(2) + 'MB',
        target: 'Under ' + (mongoDBSafeSize / (1024 * 1024)).toFixed(2) + 'MB'
      });
      
      try {
        // Use Sharp to compress the image
        let quality = 80;
        let compressed = await sharp(buffer)
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
        
        // If still too large, reduce quality further
        while (compressed.length > mongoDBSafeSize && quality > 30) {
          quality -= 10;
          compressed = await sharp(buffer)
            .jpeg({ quality, mozjpeg: true })
            .toBuffer();
          console.log(`📋 Trying quality ${quality}, size: ${(compressed.length / (1024 * 1024)).toFixed(2)}MB`);
        }
        
        if (compressed.length <= mongoDBSafeSize) {
          buffer = Buffer.from(compressed);
          mimeType = 'image/jpeg';
          const reductionPercent = ((1 - compressed.length / buffer.length) * 100).toFixed(1);
          console.log(`✅ Image compressed successfully: ${(compressed.length / (1024 * 1024)).toFixed(2)}MB (${reductionPercent}% reduction)`);
        } else {
          return NextResponse.json(
            { error: `Image file is too large to process. Even after compression, the file exceeds our 14MB limit. Please resize the image and try again.` },
            { status: 400 }
          );
        }
      } catch (compressionError) {
        console.error('❌ Image compression failed:', compressionError);
        return NextResponse.json(
          { error: `Image file is too large (${(buffer.length / (1024 * 1024)).toFixed(2)}MB) and compression failed. Please resize the image to under 14MB and try again.` },
          { status: 400 }
        );
      }
    }

    const processedImage = {
      name: image.name,
      type: mimeType,
      size: buffer.length
    };
    
    console.log('🖼️ Final processed image:', {
      fileName: processedImage.name,
      finalSize: processedImage.size,
      finalSizeMB: (processedImage.size / (1024 * 1024)).toFixed(2) + 'MB',
      finalMimeType: processedImage.type
    });

    // Generate unique name
    const timestamp = Date.now();
    const customerName = customerUpload?.customerName || 'anonymous';
    const cleanCustomerName = customerName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `customer-${cleanCustomerName}-${timestamp}-${processedImage.name}`;

    console.log('💾 Creating image document...');

    // Create the image document
    const imageDoc = await Image.create({
      name,
      originalName: image.name, // Keep original name for reference
      mimeType: processedImage.type,
      size: processedImage.size,
      data: buffer,
      projectId,
      userId,
      organizationId,
      description: `Image uploaded by ${customerName}`,
      // Initialize with pending analysis status
      analysisResult: {
        summary: 'Analysis pending...',
        itemsCount: 0,
        totalBoxes: 0
      }
    });

    console.log('✅ Image document created:', imageDoc._id);

    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });

    // Queue background analysis (truly asynchronous)
    console.log('🚀 Queueing background analysis...');
    
    let jobId = 'manual-fallback';
    try {
      jobId = backgroundQueue.enqueue('image_analysis', {
        imageId: imageDoc._id.toString(),
        projectId: projectId.toString(),
        userId: userId,
        organizationId: organizationId
      });
      console.log(`✅ Analysis job queued: ${jobId}`);
    } catch (queueError) {
      console.warn('⚠️ Background queue failed, but image was saved:', queueError);
      console.warn('Image will need to be analyzed manually via admin interface');
      jobId = 'queue-failed-manual-required';
    }

    // Return immediately - don't wait for analysis
    return NextResponse.json({
      success: true,
      imageId: imageDoc._id.toString(),
      jobId: jobId,
      message: 'Image uploaded successfully! AI analysis is processing in the background and items will appear in your inventory shortly.',
      customerName,
      analysisStatus: 'queued'
    });

  } catch (error) {
    console.error('❌ Error uploading customer image:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('❌ Error type:', typeof error);
    console.error('❌ Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined
    });
    
    return NextResponse.json(
      { 
        error: 'Failed to upload image',
        details: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.name : typeof error
      },
      { status: 500 }
    );
  }
}

// Handle OPTIONS method for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}