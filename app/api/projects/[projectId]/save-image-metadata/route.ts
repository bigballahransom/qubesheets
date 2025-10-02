// app/api/projects/[projectId]/save-image-metadata/route.ts - Save image metadata after direct upload on projects page
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Project from '@/models/Project';
import { sendImageProcessingMessage } from '@/lib/sqsUtils';
import mongoose from 'mongoose';
import { logUploadActivity } from '@/lib/activity-logger';
import sharp from 'sharp';
import AWS from 'aws-sdk';

// Configure AWS S3 for downloading HEIC files
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_AWS_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
});

// Helper function to detect HEIC files server-side
function isHeicFile(fileName: string, mimeType?: string): boolean {
  const fileNameLower = fileName.toLowerCase();
  const mimeTypeLower = mimeType?.toLowerCase() || '';
  
  // Standard HEIC detection
  const isStandardHeic = fileNameLower.endsWith('.heic') || 
                        fileNameLower.endsWith('.heif') ||
                        mimeTypeLower === 'image/heic' ||
                        mimeTypeLower === 'image/heif';
  
  // iPhone photos might be HEIF format even with .jpeg extension
  const isPotentialIPhoneHeif = fileNameLower.startsWith('img_') &&
                               fileNameLower.endsWith('.jpeg') &&
                               (mimeTypeLower === 'image/jpeg' || mimeTypeLower === '');
  
  console.log('🔍 Server HEIC detection:', {
    fileName,
    mimeType,
    isStandardHeic,
    isPotentialIPhoneHeif,
    finalResult: isStandardHeic || isPotentialIPhoneHeif
  });
  
  return isStandardHeic || isPotentialIPhoneHeif;
}

// Production-safe server-side HEIC handling (copied from customer-upload)
async function convertHeicToJpeg(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string; originalName: string; convertedName: string }> {
  console.log('🔧 Attempting server-side HEIC conversion...');
  
  // Enable HEIC conversion in production for mobile uploads
  console.log('🏭 Environment detected - attempting HEIC conversion for mobile compatibility');
  
  // Try HEIC conversion with multiple methods
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

// Download file from S3
async function downloadFromS3(key: string, bucket: string): Promise<Buffer> {
  console.log(`📥 Downloading HEIC file from S3: ${key} from bucket: ${bucket}`);
  
  try {
    const params = {
      Bucket: bucket,
      Key: key
    };
    
    console.log('🔗 S3 download params:', params);
    
    const result = await s3.getObject(params).promise();
    
    if (!result.Body) {
      throw new Error('S3 response body is empty');
    }
    
    const buffer = result.Body as Buffer;
    
    if (!buffer || buffer.length === 0) {
      throw new Error('Downloaded buffer is empty or invalid');
    }
    
    console.log(`✅ Downloaded ${buffer.length} bytes from S3`);
    return buffer;
  } catch (error) {
    console.error('❌ Failed to download from S3:', {
      key,
      bucket,
      error: error instanceof Error ? error.message : error,
      errorDetails: error
    });
    
    if (error instanceof Error && error.message.includes('NoSuchKey')) {
      throw new Error(`HEIC file not found in storage. The file may have been deleted or the upload didn't complete properly.`);
    } else if (error instanceof Error && error.message.includes('AccessDenied')) {
      throw new Error(`Access denied when downloading HEIC file. Please contact support.`);
    } else {
      throw new Error(`Failed to download HEIC file from S3: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  console.log('💾 Admin image metadata save API called');
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
    const body = await request.json();
    
    const {
      fileName,
      fileSize,
      fileType,
      cloudinaryResult, // Optional for backward compatibility
      userName = 'Admin User',
      imageBuffer, // Base64 encoded image data for analysis
      s3RawFile // S3 raw file information
    } = body;
    
    console.log('💾 Received admin image metadata:', {
      fileName,
      fileSize,
      fileType,
      projectId,
      cloudinaryPublicId: cloudinaryResult?.publicId,
      userId,
      orgId,
      hasImageBuffer: !!imageBuffer,
      hasS3RawFile: !!s3RawFile,
      isHeicDetected: s3RawFile ? isHeicFile(fileName, fileType) : false
    });
    
    // Verify project exists and user has access
    const project = await Project.findById(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }
    
    // Convert base64 to buffer for database storage
    let buffer = null;
    if (imageBuffer) {
      try {
        // Remove data URL prefix if present
        const base64Data = imageBuffer.replace(/^data:image\/[a-z]+;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
        console.log('📊 Converted image buffer size:', buffer.length, 'bytes');
      } catch (bufferError) {
        console.error('❌ Failed to convert image buffer:', bufferError);
        return NextResponse.json(
          { error: 'Invalid image data provided' },
          { status: 400 }
        );
      }
    } else if (s3RawFile && isHeicFile(fileName, fileType)) {
      // Handle HEIC files from mobile: download from S3 and convert
      console.log('📱 No imageBuffer provided but S3 raw file is HEIC - attempting server-side conversion');
      
      try {
        // Download the HEIC file from S3
        const heicBuffer = await downloadFromS3(s3RawFile.key, s3RawFile.bucket);
        console.log(`📥 Downloaded HEIC file: ${heicBuffer.length} bytes`);
        
        // Convert HEIC to JPEG
        const converted = await convertHeicToJpeg(heicBuffer);
        buffer = converted.buffer;
        console.log(`🔄 HEIC converted to JPEG: ${buffer.length} bytes`);
        
        // Compress if too large for MongoDB (14MB limit)
        const mongoDBSafeSize = 14 * 1024 * 1024;
        if (buffer.length > mongoDBSafeSize) {
          console.log('📋 Converted image too large, compressing...');
          
          let quality = 80;
          let compressed = await sharp(buffer)
            .jpeg({ quality, mozjpeg: true })
            .toBuffer();
          
          // Reduce quality until it fits
          while (compressed.length > mongoDBSafeSize && quality > 30) {
            quality -= 10;
            compressed = await sharp(buffer)
              .jpeg({ quality, mozjpeg: true })
              .toBuffer();
            console.log(`📋 Trying quality ${quality}, size: ${(compressed.length / (1024 * 1024)).toFixed(2)}MB`);
          }
          
          if (compressed.length <= mongoDBSafeSize) {
            buffer = compressed;
            console.log(`✅ Image compressed: ${(buffer.length / (1024 * 1024)).toFixed(2)}MB`);
          } else {
            throw new Error('Image too large even after compression');
          }
        }
        
      } catch (heicError) {
        console.error('❌ Failed to process HEIC file:', {
          error: heicError,
          fileName,
          fileType,
          s3RawFile,
          errorMessage: heicError instanceof Error ? heicError.message : 'Unknown error'
        });
        
        // For mobile HEIC uploads, provide helpful error message
        const errorMessage = heicError instanceof Error ? heicError.message : 'Unknown error';
        if (errorMessage.includes('Failed to download')) {
          return NextResponse.json(
            { error: 'Failed to download HEIC file from storage. Please try uploading again.' },
            { status: 400 }
          );
        } else if (errorMessage.includes('conversion failed')) {
          return NextResponse.json(
            { error: 'HEIC file conversion failed. Please convert to JPG/PNG before uploading or try again.' },
            { status: 400 }
          );
        } else {
          return NextResponse.json(
            { error: `Failed to process HEIC file: ${errorMessage}` },
            { status: 400 }
          );
        }
      }
    }
    
    // Generate unique name
    const timestamp = Date.now();
    const cleanUserName = userName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `admin-${cleanUserName}-${timestamp}-${fileName}`;
    
    // Use transaction to ensure MongoDB record is saved before SQS message
    const session = await mongoose.startSession();
    let imageDoc: any;
    let jobId = 'no-analysis-data';
    
    try {
      await session.withTransaction(async () => {
        // Check if we have either buffer or s3RawFile for fallback
        if (!buffer && !s3RawFile) {
          throw new Error('No image data or S3 file information available for processing.');
        }
        
        // Log what we're storing
        console.log('💾 Storing image with:', {
          hasBuffer: !!buffer,
          bufferSize: buffer?.length,
          hasS3RawFile: !!s3RawFile,
          s3Key: s3RawFile?.key
        });
        
        // Save image metadata to database
        [imageDoc] = await Image.create([{
          name,
          originalName: fileName,
          mimeType: fileType,
          size: fileSize,
          ...(buffer && { data: buffer }), // Store image data for analysis only if available
          // Cloudinary fields - optional for backward compatibility
          cloudinaryPublicId: cloudinaryResult?.publicId || undefined,
          cloudinaryUrl: cloudinaryResult?.url || undefined,
          cloudinarySecureUrl: cloudinaryResult?.secureUrl || undefined,
          projectId,
          userId,
          organizationId: orgId,
          description: `Image uploaded by ${userName} via admin interface`,
          source: 'admin_upload',
          processingStatus: 'queued',
          // Add S3 raw file information if provided
          s3RawFile: s3RawFile ? {
            key: s3RawFile.key,
            bucket: s3RawFile.bucket,
            url: s3RawFile.url,
            etag: s3RawFile.etag,
            uploadedAt: new Date(s3RawFile.uploadedAt),
            contentType: s3RawFile.contentType
          } : undefined,
          metadata: {
            directUpload: true,
            uploadedBy: userName,
            uploadedAt: new Date().toISOString(),
            cloudinaryInfo: cloudinaryResult ? {
              format: cloudinaryResult.format || 'unknown',
              bytes: cloudinaryResult.bytes || 0,
              width: cloudinaryResult.width || 0,
              height: cloudinaryResult.height || 0,
              createdAt: cloudinaryResult.createdAt || new Date().toISOString()
            } : null,
            s3RawFileInfo: s3RawFile ? {
              key: s3RawFile.key,
              bucket: s3RawFile.bucket,
              uploadedAt: s3RawFile.uploadedAt
            } : null
          },
          // Initialize with processing analysis status
          analysisResult: {
            summary: 'AI analysis in progress...',
            itemsCount: 0,
            totalBoxes: 0,
            status: 'processing'
          }
        }], { session });
        
        // Update project timestamp
        await Project.findByIdAndUpdate(projectId, { 
          updatedAt: new Date() 
        }, { session });
        
        console.log('✅ Admin image metadata saved in transaction:', imageDoc._id);
      });
    } finally {
      await session.endSession();
    }
    
    // Log the upload activity
    if (imageDoc) {
      await logUploadActivity(
        projectId,
        fileName,
        'image',
        'admin',
        {
          userName,
          sourceId: imageDoc._id.toString(),
          fileCount: 1
        }
      );
    }
    
    // Queue image for analysis AFTER transaction commits
    if (imageDoc) {
      if (buffer) {
        // Small delay to ensure MongoDB replication for bulk uploads
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // We have processed image data, queue for analysis
        try {
          jobId = await sendImageProcessingMessage({
            imageId: imageDoc._id.toString(),
            projectId: projectId.toString(),
            userId,
            organizationId: orgId,
            s3ObjectKey: s3RawFile?.key || 'unknown',
            s3Bucket: s3RawFile?.bucket || 'unknown',  
            s3Url: s3RawFile?.url || 'unknown',
            originalFileName: fileName,
            mimeType: fileType,
            fileSize: buffer.length,
            uploadedAt: new Date().toISOString(),
            source: 'admin-upload'
          });
          console.log(`✅ SQS Analysis job queued: ${jobId}`);
        } catch (queueError) {
          console.warn('⚠️ SQS queue failed, but image was saved:', queueError);
          jobId = 'queue-failed-manual-required';
          
          // Update processing status to failed
          await Image.findByIdAndUpdate(imageDoc._id, { 
            processingStatus: 'failed',
            'analysisResult.status': 'failed',
            'analysisResult.error': queueError instanceof Error ? queueError.message : 'Queue failed'
          });
        }
      } else if (s3RawFile) {
        // Only S3 raw file available (HEIC conversion failed), mark for manual processing
        console.log('⚠️ No processed image data available, marking for manual processing');
        jobId = 'manual-processing-required';
        
        await Image.findByIdAndUpdate(imageDoc._id, { 
          processingStatus: 'failed',
          'analysisResult.status': 'failed',
          'analysisResult.error': 'HEIC conversion failed - raw file stored for manual processing'
        });
      }
    }
    
    // Determine appropriate message based on what was processed
    let message: string;
    let analysisStatus: string;
    
    if (buffer) {
      message = 'Image uploaded successfully! AI analysis is processing in the background.';
      analysisStatus = 'queued';
    } else if (s3RawFile) {
      message = 'Image uploaded successfully! HEIC conversion failed, but raw file stored for manual processing.';
      analysisStatus = 'manual-required';
    } else {
      message = 'Image uploaded successfully! Analysis requires image data.';
      analysisStatus = 'skipped';
    }
    
    return NextResponse.json({
      success: true,
      imageId: imageDoc?._id.toString(),
      jobId: jobId,
      message: message,
      analysisStatus: analysisStatus,
      hasImageData: !!buffer,
      hasRawFile: !!s3RawFile
    });
    
  } catch (error) {
    console.error('❌ Error saving admin image metadata:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to save image metadata',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

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