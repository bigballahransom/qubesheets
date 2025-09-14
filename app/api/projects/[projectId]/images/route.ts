// app/api/projects/[projectId]/images/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/images - Get all images for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get all images for the project (include binary data for gallery view)
    const filter = getProjectFilter(authContext, projectId);
    console.log('🖼️ Image gallery filter:', filter);
    
    const images = await Image.find(filter)
      .select('name originalName mimeType size description analysisResult source metadata data createdAt updatedAt')
      .sort({ createdAt: -1 });
    
    console.log(`🖼️ Found ${images.length} images for project ${projectId}`);
    
    // Convert binary data to base64 data URLs
    const imagesWithDataUrls = images.map(img => {
      let dataUrl = null;
      if (img.data && img.data.length > 0) {
        const base64 = img.data.toString('base64');
        dataUrl = `data:${img.mimeType || 'image/jpeg'};base64,${base64}`;
      }
      
      return {
        _id: img._id,
        name: img.name,
        originalName: img.originalName,
        mimeType: img.mimeType,
        size: img.size,
        description: img.description,
        analysisResult: img.analysisResult,
        source: img.source,
        metadata: img.metadata,
        dataUrl, // Base64 data URL for direct display
        createdAt: img.createdAt,
        updatedAt: img.updatedAt
      };
    });
    
    console.log('🖼️ Images with data URLs:', imagesWithDataUrls.map(img => ({
      name: img.name,
      source: img.source,
      hasDataUrl: !!img.dataUrl,
      dataUrlLength: img.dataUrl ? img.dataUrl.length : 0,
      createdAt: img.createdAt
    })));
    
    return NextResponse.json(imagesWithDataUrls);
  } catch (error) {
    console.error('Error fetching images:', error);
    return NextResponse.json(
      { error: 'Failed to fetch images' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:projectId/images - Upload a new image
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Check if project exists and belongs to the organization
    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Parse the form data
    const formData = await request.formData();
    const image = formData.get('image') as File;
    const description = formData.get('description') as string;
    const analysisResult = formData.get('analysisResult') as string;
    const s3RawFile = formData.get('s3RawFile') as string;

    if (!image) {
      return NextResponse.json(
        { error: 'No image file provided' },
        { status: 400 }
      );
    }

    // Enhanced file type validation for mobile browsers - accept anything that looks like an image
    const isRegularImage = image.type.startsWith('image/');
    const hasImageExtension = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(image.name);
    const isPotentialMobileImage = (image.type === '' || image.type === 'application/octet-stream' || image.type === 'text/plain') && hasImageExtension;
    const isAnyImageType = isRegularImage || isPotentialMobileImage;
    
    console.log('📱 File validation debug:', {
      fileName: image.name,
      mimeType: image.type || 'empty',
      size: image.size,
      sizeInMB: (image.size / (1024 * 1024)).toFixed(2) + 'MB',
      isRegularImage,
      hasImageExtension,
      isPotentialMobileImage,
      isAnyImageType,
      userAgent: request.headers.get('user-agent')?.substring(0, 100),
      contentLength: request.headers.get('content-length'),
      isIPhone: request.headers.get('user-agent')?.includes('iPhone') || false
    });
    
    if (!isAnyImageType) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an image (JPEG, PNG, GIF, HEIC, or HEIF).' },
        { status: 400 }
      );
    }

    // Validate file size (50MB limit for high-quality images)
    const maxSize = parseInt(process.env.MAX_UPLOAD_SIZE || '52428800'); // 50MB default
    if (image.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024));
      return NextResponse.json(
        { error: `File size too large. Please upload an image smaller than ${maxSizeMB}MB.` },
        { status: 400 }
      );
    }

    // Convert image to buffer with iPhone-specific error handling
    let buffer: Buffer;
    try {
      console.log(`📱 Converting image to buffer: ${image.name} (${(image.size / (1024 * 1024)).toFixed(2)}MB)`);
      const bytes = await image.arrayBuffer();
      buffer = Buffer.from(bytes);
      console.log(`✅ Buffer conversion successful: ${buffer.length} bytes`);
    } catch (bufferError) {
      console.error('❌ Buffer conversion failed:', bufferError);
      return NextResponse.json(
        { error: 'Failed to process image. The file may be corrupted or too large for processing.' },
        { status: 400 }
      );
    }

    // Generate unique name
    const timestamp = Date.now();
    const name = `${timestamp}-${image.name}`;

    // Parse analysis result if provided
    let parsedAnalysisResult;
    if (analysisResult) {
      try {
        parsedAnalysisResult = JSON.parse(analysisResult);
      } catch (e) {
        console.warn('Failed to parse analysis result:', e);
      }
    }

    // Parse S3 raw file information if provided
    let parsedS3RawFile;
    if (s3RawFile) {
      try {
        parsedS3RawFile = JSON.parse(s3RawFile);
        console.log('📤 S3 raw file info received:', {
          key: parsedS3RawFile.key,
          bucket: parsedS3RawFile.bucket,
          size: parsedS3RawFile.size || 'unknown'
        });
      } catch (e) {
        console.warn('Failed to parse S3 raw file info:', e);
      }
    }

    // Create the image document with normalized MIME type
    let normalizedMimeType = image.type;
    
    // Fix common MIME type issues
    if (!normalizedMimeType || normalizedMimeType === 'application/octet-stream' || normalizedMimeType === 'text/plain') {
      // Guess MIME type from file extension
      const ext = image.name.toLowerCase().split('.').pop();
      switch (ext) {
        case 'jpg':
        case 'jpeg':
          normalizedMimeType = 'image/jpeg';
          break;
        case 'png':
          normalizedMimeType = 'image/png';
          break;
        case 'gif':
          normalizedMimeType = 'image/gif';
          break;
        case 'webp':
          normalizedMimeType = 'image/webp';
          break;
        case 'heic':
          normalizedMimeType = 'image/heic';
          break;
        case 'heif':
          normalizedMimeType = 'image/heif';
          break;
        default:
          normalizedMimeType = 'image/jpeg'; // Default fallback
      }
      console.log(`📱 Normalized MIME type from ${image.type || 'empty'} to ${normalizedMimeType}`);
    }

    const imageData: any = {
      name,
      originalName: image.name,
      mimeType: normalizedMimeType,
      size: image.size,
      data: buffer,
      projectId,
      userId,
      description: description || '',
      analysisResult: parsedAnalysisResult ? {
        summary: parsedAnalysisResult.summary,
        itemsCount: parsedAnalysisResult.items?.length || 0,
        totalBoxes: parsedAnalysisResult.total_boxes ? 
          Object.values(parsedAnalysisResult.total_boxes).reduce((a: number, b: unknown) => a + (typeof b === 'number' ? b : 0), 0) : 0
      } : undefined,
      // Add S3 raw file information if provided
      s3RawFile: parsedS3RawFile ? {
        key: parsedS3RawFile.key,
        bucket: parsedS3RawFile.bucket,
        url: parsedS3RawFile.url,
        etag: parsedS3RawFile.etag,
        uploadedAt: new Date(parsedS3RawFile.uploadedAt),
        contentType: parsedS3RawFile.contentType
      } : undefined
    };
    
    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      imageData.organizationId = authContext.organizationId;
    }
    
    let imageDoc;
    try {
      console.log(`💾 Saving image to MongoDB: ${name}`);
      imageDoc = await Image.create(imageData);
      console.log(`✅ Image saved successfully: ${imageDoc._id}`);
    } catch (mongoError) {
      console.error('❌ MongoDB save failed:', mongoError);
      
      // Check for specific MongoDB errors
      if (mongoError instanceof Error) {
        if (mongoError.message.includes('Document too large')) {
          return NextResponse.json(
            { error: 'Image file is too large to save. Please reduce the image size and try again.' },
            { status: 413 }
          );
        } else if (mongoError.message.includes('timeout')) {
          return NextResponse.json(
            { error: 'Upload timed out. Please check your connection and try again.' },
            { status: 408 }
          );
        }
      }
      
      return NextResponse.json(
        { error: 'Failed to save image. Please try again or reduce image size.' },
        { status: 500 }
      );
    }

    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });

    // Return image info without binary data
    const responseData = {
      _id: imageDoc._id,
      name: imageDoc.name,
      originalName: imageDoc.originalName,
      mimeType: imageDoc.mimeType,
      size: imageDoc.size,
      description: imageDoc.description,
      analysisResult: imageDoc.analysisResult,
      createdAt: imageDoc.createdAt,
      updatedAt: imageDoc.updatedAt
    };

    return NextResponse.json(responseData, { status: 201 });
  } catch (error) {
    console.error('Error uploading image:', error);
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}