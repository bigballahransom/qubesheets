// app/api/upload-to-s3/route.ts - Server-side S3 upload handler with SQS integration
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';
import { uploadFileToS3 } from '@/lib/s3Upload';
import { sendImageProcessingMessage, sendVideoProcessingMessage } from '@/lib/sqsUtils';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    // Check authentication
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId, organizationId } = authContext;

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('projectId') as string;
    const fileIndex = formData.get('fileIndex') as string;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    console.log(`📤 S3 Upload API - Processing file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB) for project: ${projectId}`);

    // Detect if this is a video file
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|avi|webm|mkv)$/i.test(file.name);
    const folder = isVideo ? 'Media/Videos' : 'Media/Images';
    
    console.log(`📂 File type detection: ${isVideo ? 'video' : 'image'} -> ${folder}`);

    try {
      // Upload to S3 from server side where we have access to AWS credentials
      const s3Result = await uploadFileToS3(file, {
        folder,
        metadata: {
          projectId: projectId || 'unknown',
          uploadSource: 'photo-inventory-uploader',
          fileIndex: fileIndex || '0',
          originalMimeType: file.type,
          uploadedBy: userId,
          uploadedAt: new Date().toISOString(),
          fileType: isVideo ? 'video' : 'image'
        },
        contentType: file.type
      });

      const uploadTime = Date.now() - startTime;
      console.log(`✅ S3 Upload API - Success: ${s3Result.key} (${uploadTime}ms)`);

      // Note: SQS message will be sent later by save-image-metadata/save-video-metadata 
      // with the actual imageId/videoId after the record is created in MongoDB
      const sqsMessageId = null;
      console.log(`📝 S3 upload complete. SQS message will be sent after metadata save with actual ${isVideo ? 'video' : 'image'}Id`);

      return NextResponse.json({
        success: true,
        s3Result: {
          key: s3Result.key,
          bucket: s3Result.bucket,
          url: s3Result.url,
          etag: s3Result.etag,
          uploadedAt: s3Result.uploadedAt,
          contentType: s3Result.contentType,
          size: s3Result.size
        },
        sqsMessageId,
        uploadTimeMs: uploadTime
      });

    } catch (s3Error) {
      const uploadTime = Date.now() - startTime;
      console.error(`❌ S3 Upload API - Failed after ${uploadTime}ms:`, s3Error);
      
      const errorMessage = s3Error instanceof Error ? s3Error.message : 'Unknown S3 upload error';
      
      return NextResponse.json(
        { error: `S3 upload failed: ${errorMessage}`, uploadTimeMs: uploadTime },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('❌ S3 Upload API - Request error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error during S3 upload' },
      { status: 500 }
    );
  }
}