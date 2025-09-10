// app/api/upload-to-s3/route.ts - Server-side S3 upload handler with SQS integration
import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth-helpers';
import { uploadFileToS3 } from '@/lib/s3Upload';
import { sendImageProcessingMessage } from '@/lib/sqsUtils';

export async function POST(request: NextRequest) {
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

    console.log(`📤 S3 Upload API - Processing file: ${file.name} for project: ${projectId}`);

    try {
      // Upload to S3 from server side where we have access to AWS credentials
      const s3Result = await uploadFileToS3(file, {
        folder: `Media/Images`,
        metadata: {
          projectId: projectId || 'unknown',
          uploadSource: 'photo-inventory-uploader',
          fileIndex: fileIndex || '0',
          originalMimeType: file.type,
          uploadedBy: userId,
          uploadedAt: new Date().toISOString()
        },
        contentType: file.type
      });

      console.log(`✅ S3 Upload API - Success: ${s3Result.key}`);

      // Send message to SQS for processing
      let sqsMessageId = null;
      try {
        sqsMessageId = await sendImageProcessingMessage({
          imageId: 'pending', // Will be set when image is saved to MongoDB
          projectId: projectId || 'unknown',
          userId,
          organizationId: organizationId || undefined,
          s3ObjectKey: s3Result.key,
          s3Bucket: s3Result.bucket,
          s3Url: s3Result.url,
          originalFileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          source: 'photo-inventory-uploader'
        });
        console.log(`✅ SQS message sent: ${sqsMessageId}`);
      } catch (sqsError) {
        console.error('⚠️ SQS message failed (S3 upload still successful):', sqsError);
        // Don't fail the entire request if SQS fails
      }

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
        sqsMessageId
      });

    } catch (s3Error) {
      console.error('❌ S3 Upload API - Failed:', s3Error);
      
      const errorMessage = s3Error instanceof Error ? s3Error.message : 'Unknown S3 upload error';
      
      return NextResponse.json(
        { error: `S3 upload failed: ${errorMessage}` },
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