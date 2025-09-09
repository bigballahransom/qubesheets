// app/api/customer-upload/[token]/upload/route.ts - Updated with queue system

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Image from '@/models/Image';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { persistentQueue } from '@/lib/persistentQueue';
import { uploadVideo, uploadImage as uploadImageToCloudinary } from '@/lib/cloudinary';
import { processImage, validateImageFile, validateFileSize, isVideoFile } from '@/lib/imageProcessor';

// Helper functions are now imported from imageProcessor

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

    // Validate file type using centralized validator
    const validation = validateImageFile(image);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error! },
        { status: 400 }
      );
    }

    // Validate file size using centralized validator
    const imageMaxSize = 15 * 1024 * 1024; // 15MB for images
    const videoMaxSize = parseInt(process.env.MAX_VIDEO_UPLOAD_SIZE || '104857600'); // 100MB for videos
    const sizeValidation = validateFileSize(image, imageMaxSize, videoMaxSize);
    
    if (!sizeValidation.isValid) {
      return NextResponse.json(
        { error: sizeValidation.error! },
        { status: 400 }
      );
    }
    
    console.log('📱 Customer upload file validation:', {
      fileName: image.name,
      mimeType: image.type || 'empty',
      size: image.size,
      isVideo: validation.isVideo,
      isHeic: validation.isHeic,
      userAgent: request.headers.get('user-agent')?.substring(0, 100)
    });

    // Handle video files - upload to Cloudinary and save metadata
    if (validation.isVideo) {
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

    // Process image using centralized processor
    let processedImage;
    try {
      processedImage = await processImage(image, {
        maxSizeBytes: 14 * 1024 * 1024, // 14MB for MongoDB safety
        targetQuality: 80,
        minQuality: 30,
        allowHeicConversion: true
      });
      
      console.log('✅ Image processing completed:', {
        originalName: processedImage.originalName,
        processedName: processedImage.processedName,
        finalSize: processedImage.size,
        finalSizeMB: (processedImage.size / (1024 * 1024)).toFixed(2) + 'MB',
        mimeType: processedImage.mimeType,
        heicConverted: processedImage.heicConverted,
        compressionApplied: processedImage.compressionApplied,
        qualityReduction: processedImage.qualityReduction
      });
      
    } catch (processingError) {
      console.error('❌ Image processing failed:', processingError);
      const errorMsg = processingError instanceof Error ? processingError.message : 'Unknown processing error';
      
      return NextResponse.json(
        { error: `Image processing failed: ${errorMsg}` },
        { status: 400 }
      );
    }

    // Generate unique name
    const timestamp = Date.now();
    const customerName = customerUpload?.customerName || 'anonymous';
    const cleanCustomerName = customerName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `customer-${cleanCustomerName}-${timestamp}-${processedImage.name}`;

    console.log('💾 Creating image document...');

    // Create the image document with proper status tracking
    const imageDoc = await Image.create({
      name,
      originalName: processedImage.originalName,
      mimeType: processedImage.mimeType,
      size: processedImage.size,
      data: processedImage.buffer,
      projectId,
      userId,
      organizationId,
      description: `Image uploaded by ${customerName}`,
      processingStatus: 'uploaded', // Set initial status
      source: 'customer_upload',
      uploadToken: token,
      // Initialize with pending analysis status (for backward compatibility)
      analysisResult: {
        summary: 'Analysis pending...',
        itemsCount: 0,
        totalBoxes: 0,
        status: 'pending'
      }
    });

    console.log('✅ Image document created:', imageDoc._id);

    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });

    // Queue background analysis using persistent queue
    console.log('🚀 Queueing background analysis...');
    
    let jobId = 'manual-fallback';
    try {
      jobId = await persistentQueue.enqueue('image_analysis', {
        imageId: imageDoc._id.toString(),
        projectId: projectId.toString(),
        userId: userId,
        organizationId: organizationId,
        estimatedSize: buffer.length,
        source: 'customer_upload'
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