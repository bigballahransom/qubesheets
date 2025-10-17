// Admin upload endpoint that mirrors customer-upload for reliability
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { uploadFileToS3 } from '@/lib/s3Upload';
import { sendImageProcessingMessage, sendVideoProcessingMessage } from '@/lib/sqsUtils';
import { logUploadActivity } from '@/lib/activity-logger';
import sharp from 'sharp';

// Helper function to detect video files server-side
function isVideoFile(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.mpg', '.mpeg', '.wmv', '.3gp'];
  const hasVideoExtension = videoExtensions.some(ext => fileName.endsWith(ext));
  const hasVideoMimeType = mimeType.startsWith('video/');
  
  return hasVideoExtension || hasVideoMimeType;
}

// Helper function to normalize video MIME types for Gemini API compatibility
function normalizeVideoMimeType(fileName: string, originalMimeType: string): string {
  if (originalMimeType === 'video/quicktime') {
    return 'video/mov';
  }
  
  if (originalMimeType && originalMimeType.startsWith('video/')) {
    return originalMimeType;
  }
  
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/mov';
    case 'avi':
      return 'video/avi';
    case 'webm':
      return 'video/webm';
    case 'flv':
      return 'video/x-flv';
    case 'mpg':
    case 'mpeg':
      return 'video/mpeg';
    case 'wmv':
      return 'video/wmv';
    case '3gp':
      return 'video/3gpp';
    case 'mkv':
      return 'video/x-matroska';
    default:
      return 'video/mp4';
  }
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
  
  console.log('🏭 Environment detected - attempting HEIC conversion for mobile compatibility');
  
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
  { params }: { params: Promise<{ projectId: string }> }
) {
  console.log('🚀 Admin upload API called');
  try {
    // Check authentication
    const { userId, orgId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await connectMongoDB();
    console.log('🔗 MongoDB connected');

    const { projectId } = await params;
    
    // Verify project exists and user has access
    const project = await Project.findById(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('image') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    console.log('📁 Processing file:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    // Enhanced file type validation for mobile browsers
    const isRegularImage = file.type.startsWith('image/');
    const isVideo = isVideoFile(file);
    const isHeic = isHeicFile(file);
    const hasImageExtension = /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);
    const isPotentialMobileImage = (file.type === '' || file.type === 'application/octet-stream') && hasImageExtension;
    
    console.log('📱 Admin upload file validation:', {
      fileName: file.name,
      mimeType: file.type || 'empty',
      size: file.size,
      isRegularImage,
      isVideo,
      isHeic,
      hasImageExtension,
      isPotentialMobileImage,
      userAgent: request.headers.get('user-agent')?.substring(0, 100)
    });
    
    if (!isRegularImage && !isVideo && !isHeic && !isPotentialMobileImage) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an image (JPEG, PNG, GIF, HEIC, HEIF) or video (MP4, MOV, AVI, WebM, FLV, MPG, WMV, 3GP).' },
        { status: 400 }
      );
    }

    // File size limits
    const mongoDBLimit = 16 * 1024 * 1024; // 16MB MongoDB limit
    const imageMaxSize = 15 * 1024 * 1024; // 15MB for images
    // No video size limit - videos are uploaded to S3 directly
    const maxSize = isVideo ? Number.MAX_SAFE_INTEGER : imageMaxSize;
    
    console.log('📄 File size validation:', {
      fileName: file.name,
      fileSize: file.size,
      fileSizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB',
      isVideo,
      maxSize,
      maxSizeMB: (maxSize / (1024 * 1024)).toFixed(2) + 'MB',
      mongoDBLimit: (mongoDBLimit / (1024 * 1024)).toFixed(2) + 'MB'
    });
    
    if (file.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      const fileType = isVideo ? 'video' : 'image';
      
      if (isVideo && file.size > 4.5 * 1024 * 1024) {
        return NextResponse.json(
          { 
            error: `Video file is too large (${fileSizeMB}MB) for direct upload. Please use smaller video files.`,
            errorCode: 'FILE_TOO_LARGE_FOR_DIRECT_UPLOAD',
            fileSize: file.size,
            fileSizeMB: fileSizeMB
          },
          { status: 413 }
        );
      }
      
      return NextResponse.json(
        { error: `File size too large. Please upload a ${fileType} smaller than ${maxSizeMB}MB. Your file is ${fileSizeMB}MB.` },
        { status: 400 }
      );
    }

    // Handle video files
    if (isVideo) {
      console.log('🎬 Processing video file for admin upload:', file.name);
      
      // Upload video directly without server-side conversion - Railway service will handle conversion
      console.log('🎬 Uploading video directly to S3 for Railway processing');
      
      const videoBuffer = Buffer.from(await file.arrayBuffer());
      const finalFileName = file.name;
      const finalMimeType = file.type;
      
      const timestamp = Date.now();
      const name = `admin-video-${timestamp}-${finalFileName}`;
      
      const normalizedMimeType = normalizeVideoMimeType(finalFileName, finalMimeType);
      
      // Upload to S3
      try {
        console.log('📤 Uploading video to S3...');
        
        const videoFile = new File([videoBuffer], finalFileName, { type: normalizedMimeType });
        
        const s3Result = await uploadFileToS3(videoFile, {
          folder: 'Media/Videos',
          metadata: {
            projectId: projectId.toString(),
            uploadSource: 'admin-upload',
            uploadedBy: userId,
            uploadedAt: new Date().toISOString(),
            originalMimeType: file.type,
            normalizedMimeType: normalizedMimeType
          },
          contentType: normalizedMimeType
        });
        
        console.log('✅ Video uploaded to S3');
        
        // Save video metadata
        const videoDoc = await Video.create({
          name,
          originalName: file.name,
          mimeType: normalizedMimeType,
          size: videoBuffer.length,
          duration: 0,
          projectId,
          userId,
          organizationId: orgId,
          description: 'Admin upload via AdminPhotoUploader',
          source: 'admin_upload',
          s3RawFile: {
            key: s3Result.key,
            bucket: s3Result.bucket,
            url: s3Result.url,
            etag: s3Result.etag,
            uploadedAt: new Date(),
            contentType: s3Result.contentType
          },
          analysisResult: {
            summary: 'Analysis pending...',
            itemsCount: 0,
            totalBoxes: 0,
            status: 'pending'
          },
          metadata: {
            uploadSource: 'admin-upload',
            originalMimeType: file.type,
            normalizedMimeType: normalizedMimeType,
            finalFileName: finalFileName
          }
        });
        
        console.log('✅ Video saved to MongoDB');
        
        // Log activity
        await logUploadActivity(
          projectId.toString(),
          file.name,
          'video',
          'admin',
          {
            userName: 'Admin User',
            sourceId: videoDoc._id.toString()
          },
          userId,
          orgId
        );
        
        // Update project timestamp
        await Project.findByIdAndUpdate(projectId, { 
          updatedAt: new Date() 
        });
        
        // Send to SQS for video processing
        let sqsMessageId = null;
        try {
          sqsMessageId = await sendVideoProcessingMessage({
            videoId: videoDoc._id.toString(),
            projectId: projectId.toString(),
            userId: userId,
            organizationId: orgId,
            s3ObjectKey: s3Result.key,
            s3Bucket: s3Result.bucket,
            s3Url: s3Result.url,
            originalFileName: file.name,
            mimeType: normalizedMimeType,
            originalMimeType: file.type,
            fileSize: videoBuffer.length,
            uploadedAt: new Date().toISOString(),
            source: 'video-upload'
          });
          
          console.log('✅ Video queued for processing');
        } catch (sqsError) {
          console.error('⚠️ Video SQS message failed:', sqsError);
        }
        
        return NextResponse.json({
          success: true,
          videoId: videoDoc._id.toString(),
          sqsMessageId,
          s3Info: {
            key: s3Result.key,
            bucket: s3Result.bucket,
            url: s3Result.url
          },
          message: 'Video uploaded successfully! AI analysis is processing in the background.',
          analysisStatus: 'queued'
        });
        
      } catch (s3Error) {
        console.error('❌ Admin video S3 upload failed:', s3Error);
        const errorMessage = s3Error instanceof Error ? s3Error.message : 'Unknown error';
        return NextResponse.json(
          { error: `Failed to upload video: ${errorMessage}` },
          { status: 500 }
        );
      }
    }

    // Process image
    const bytes = await file.arrayBuffer();
    let buffer = Buffer.from(bytes);
    let mimeType = file.type;
    
    console.log('🖼️ Original image details:', {
      fileName: file.name,
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
        
        const errorMsg = conversionError instanceof Error ? conversionError.message : 'Unknown conversion error';
        
        return NextResponse.json(
          { error: `HEIC processing failed: ${errorMsg}` },
          { status: 400 }
        );
      }
    }
    
    // Compress image if too large for MongoDB
    const mongoDBSafeSize = 14 * 1024 * 1024; // 14MB
    if (buffer.length > mongoDBSafeSize) {
      console.log('📋 Image too large, compressing...', {
        originalSize: buffer.length,
        originalSizeMB: (buffer.length / (1024 * 1024)).toFixed(2) + 'MB',
        target: 'Under ' + (mongoDBSafeSize / (1024 * 1024)).toFixed(2) + 'MB'
      });
      
      try {
        let quality = 80;
        let compressed = await sharp(buffer)
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
        
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
          console.log(`✅ Image compressed successfully: ${(compressed.length / (1024 * 1024)).toFixed(2)}MB`);
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
      name: file.name,
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
    const name = `admin-${timestamp}-${processedImage.name}`;

    console.log('📤 Uploading image to S3...');

    // Upload to S3
    const processedFile = new File([buffer], processedImage.name, { 
      type: processedImage.type 
    });

    try {
      const s3Result = await uploadFileToS3(processedFile, {
        folder: `Media/Images`,
        metadata: {
          projectId: projectId.toString(),
          uploadSource: 'admin-upload',
          originalMimeType: processedImage.type,
          uploadedBy: userId,
          uploadedAt: new Date().toISOString()
        },
        contentType: processedImage.type
      });

      console.log(`✅ S3 Upload successful: ${s3Result.key}`);

      // Save image to MongoDB
      const imageDoc = await Image.create({
        name,
        originalName: file.name,
        mimeType: processedImage.type,
        size: processedImage.size,
        data: buffer,
        projectId,
        userId,
        organizationId: orgId,
        description: 'Admin upload via AdminPhotoUploader',
        source: 'admin_upload',
        s3RawFile: {
          key: s3Result.key,
          bucket: s3Result.bucket,
          url: s3Result.url,
          etag: s3Result.etag,
          uploadedAt: new Date(),
          contentType: s3Result.contentType
        },
        analysisResult: {
          summary: 'Analysis pending...',
          itemsCount: 0,
          totalBoxes: 0
        },
        metadata: {
          uploadSource: 'admin-upload'
        }
      });

      console.log(`✅ Image saved to MongoDB: ${imageDoc._id}`);

      // Log activity
      await logUploadActivity(
        projectId.toString(),
        file.name,
        'image',
        'admin',
        {
          userName: 'Admin User',
          sourceId: imageDoc._id.toString()
        },
        userId,
        orgId
      );

      // Update project timestamp
      await Project.findByIdAndUpdate(projectId, { 
        updatedAt: new Date() 
      });

      // Send SQS message for processing
      console.log('🚀 Sending SQS message for processing...');
      
      let sqsMessageId = null;
      try {
        sqsMessageId = await sendImageProcessingMessage({
          imageId: imageDoc._id.toString(),
          projectId: projectId.toString(),
          userId: userId,
          organizationId: orgId || undefined,
          s3ObjectKey: s3Result.key,
          s3Bucket: s3Result.bucket,
          s3Url: s3Result.url,
          originalFileName: file.name,
          mimeType: processedImage.type,
          fileSize: processedImage.size,
          uploadedAt: new Date().toISOString(),
          source: 'admin-upload'
        });
        console.log(`✅ SQS message sent: ${sqsMessageId}`);
      } catch (sqsError) {
        console.error('⚠️ SQS message failed:', sqsError);
      }

      return NextResponse.json({
        success: true,
        imageId: imageDoc._id.toString(),
        s3Result: {
          key: s3Result.key,
          bucket: s3Result.bucket,
          url: s3Result.url
        },
        sqsMessageId,
        message: 'Image uploaded successfully! AI analysis is processing in the background.',
        analysisStatus: 'queued'
      });

    } catch (s3Error) {
      console.error('❌ S3 Upload failed:', s3Error);
      const errorMessage = s3Error instanceof Error ? s3Error.message : 'Unknown S3 upload error';
      return NextResponse.json(
        { error: `S3 upload failed: ${errorMessage}` },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('❌ Error in admin upload:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    return NextResponse.json(
      { 
        error: 'Failed to upload file',
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