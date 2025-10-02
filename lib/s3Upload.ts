// lib/s3Upload.ts - S3 upload utilities for raw file storage
import AWS from 'aws-sdk';

// Configure AWS S3 with better error handling and multiple credential sources
const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_AWS_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
};

console.log('🔧 AWS S3 Configuration:', {
  accessKeyId: awsConfig.accessKeyId ? `${awsConfig.accessKeyId.slice(0, 8)}...` : 'undefined',
  secretAccessKey: awsConfig.secretAccessKey ? `${awsConfig.secretAccessKey.slice(0, 8)}...` : 'undefined',
  region: awsConfig.region,
  hasCredentials: !!(awsConfig.accessKeyId && awsConfig.secretAccessKey)
});

const s3 = new AWS.S3(awsConfig);

export interface S3UploadResult {
  key: string;
  bucket: string;
  url: string;
  etag: string;
  size: number;
  contentType: string;
  uploadedAt: Date;
}

export interface S3UploadOptions {
  folder?: string;
  metadata?: Record<string, string>;
  contentType?: string;
  public?: boolean;
}

/**
 * Upload raw file to S3 bucket
 * @param file - File object to upload
 * @param options - Upload options
 * @returns S3UploadResult with upload details
 */
export async function uploadFileToS3(
  file: File, 
  options: S3UploadOptions = {}
): Promise<S3UploadResult> {
  // Validate credentials first
  if (!awsConfig.accessKeyId || !awsConfig.secretAccessKey) {
    console.error('❌ AWS credentials not configured:', {
      hasAccessKeyId: !!awsConfig.accessKeyId,
      hasSecretAccessKey: !!awsConfig.secretAccessKey,
      envVars: {
        AWS_ACCESS_KEY_ID: !!process.env.AWS_ACCESS_KEY_ID,
        AWS_ACCESS_KEY: !!process.env.AWS_ACCESS_KEY,
        AWS_SECRET_ACCESS_KEY: !!process.env.AWS_SECRET_ACCESS_KEY,
        SECRET_AWS_ACCESS_KEY: !!process.env.SECRET_AWS_ACCESS_KEY
      }
    });
    throw new Error('AWS credentials are not properly configured. Please check your environment variables.');
  }

  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  
  if (!bucketName) {
    throw new Error('AWS_S3_BUCKET_NAME environment variable is not configured');
  }

  // Generate unique key with folder structure
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 15);
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  
  const folder = options.folder || 'uploads';
  const key = `${folder}/${timestamp}-${randomId}-${sanitizedFileName}`;

  // Convert File to Buffer for AWS SDK v2 compatibility
  let fileBuffer: Buffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    fileBuffer = Buffer.from(arrayBuffer);
  } catch (bufferError) {
    console.error('❌ Failed to convert file to buffer:', bufferError);
    throw new Error('Failed to process file for upload');
  }

  // Prepare upload parameters
  const uploadParams: AWS.S3.PutObjectRequest = {
    Bucket: bucketName,
    Key: key,
    Body: fileBuffer, // Use Buffer instead of File
    ContentType: options.contentType || file.type || 'application/octet-stream',
    Metadata: {
      originalName: encodeURIComponent(file.name),
      uploadTimestamp: timestamp.toString(),
      fileSize: file.size.toString(),
      ...options.metadata
    }
  };

  // Note: ACL setting removed - many AWS accounts have ACLs disabled by default
  // If you need public access, consider using bucket policies instead
  // if (options.public) {
  //   uploadParams.ACL = 'public-read';
  // }

  console.log('📤 Starting S3 upload:', {
    key,
    bucket: bucketName,
    size: file.size,
    sizeInMB: (file.size / 1024 / 1024).toFixed(2) + 'MB',
    type: file.type,
    bufferSize: fileBuffer.length
  });

  // Log warning for large files
  if (file.size > 50 * 1024 * 1024) { // 50MB
    console.warn(`⚠️ Large file upload: ${(file.size / 1024 / 1024).toFixed(2)}MB - this may take several minutes`);
  }

  try {
    // Skip bucket tests and upload directly (matching AWS CLI behavior)
    console.log('📤 Uploading directly to S3...');
    
    // Add timeout protection to S3 upload (5 minutes for large videos)
    const putResult = await Promise.race([
      s3.putObject(uploadParams).promise(),
      new Promise<any>((_, reject) => 
        setTimeout(() => reject(new Error('S3 upload timeout - file too large or network issue')), 300000)
      )
    ]) as AWS.S3.PutObjectOutput;
    
    // Construct result object manually since putObject doesn't return Location
    const result = {
      Key: key,
      Bucket: bucketName,
      Location: `https://${bucketName}.s3.${awsConfig.region}.amazonaws.com/${key}`,
      ETag: putResult.ETag
    };
    
    const uploadResult: S3UploadResult = {
      key: result.Key!,
      bucket: result.Bucket!,
      url: result.Location!,
      etag: result.ETag!,
      size: file.size,
      contentType: file.type,
      uploadedAt: new Date()
    };

    console.log('✅ S3 upload successful:', {
      key: uploadResult.key,
      url: uploadResult.url,
      size: uploadResult.size
    });

    return uploadResult;

  } catch (error) {
    console.error('❌ S3 upload failed:', error);
    
    // Enhanced error handling with null safety
    if (error instanceof Error) {
      const errorMessage = error.message || 'Unknown error';
      let detailedMessage = `S3 upload failed: ${errorMessage}`;
      
      // AWS SDK errors often have additional properties
      const awsError = error as any;
      
      // Log full error details for debugging
      console.error('Full S3 error details:', {
        name: awsError.name,
        code: awsError.code,
        statusCode: awsError.statusCode,
        message: awsError.message,
        region: awsError.region,
        time: awsError.time,
        requestId: awsError.requestId
      });
      
      // Provide specific error messages based on error code
      if (awsError.code === 'NoSuchBucket') {
        detailedMessage = `S3 bucket "${bucketName}" does not exist or is not accessible`;
      } else if (awsError.code === 'InvalidAccessKeyId') {
        detailedMessage = 'AWS Access Key ID is invalid';
      } else if (awsError.code === 'SignatureDoesNotMatch') {
        detailedMessage = 'AWS Secret Access Key is invalid';
      } else if (awsError.code === 'AccessDenied' || awsError.code === 'Forbidden') {
        detailedMessage = `Access denied to S3 bucket "${bucketName}". Check IAM permissions for PutObject and PutObjectAcl operations.`;
      } else if (awsError.code === 'NetworkingError') {
        detailedMessage = 'Network error connecting to S3. Check your internet connection.';
      } else if (awsError.statusCode === 403) {
        detailedMessage = `403 Forbidden: Check IAM permissions for bucket "${bucketName}". Required permissions: s3:PutObject, s3:PutObjectAcl`;
      }
      
      // Include error code in message if available
      if (awsError.code && !detailedMessage.includes(awsError.code)) {
        detailedMessage += ` (Error code: ${awsError.code})`;
      }
      
      throw new Error(detailedMessage);
    } else {
      throw new Error(`S3 upload failed: ${JSON.stringify(error)}`);
    }
  }
}

/**
 * Upload multiple files to S3 concurrently with rate limiting
 * @param files - Array of files to upload
 * @param options - Upload options
 * @param concurrency - Number of concurrent uploads (default: 3)
 * @returns Array of S3UploadResult
 */
export async function uploadMultipleFilesToS3(
  files: File[],
  options: S3UploadOptions = {},
  concurrency: number = 3
): Promise<S3UploadResult[]> {
  if (files.length === 0) {
    return [];
  }

  console.log(`📤 Starting batch S3 upload: ${files.length} files, concurrency: ${concurrency}`);

  const results: S3UploadResult[] = [];
  const errors: { file: string; error: string }[] = [];

  // Process files in batches to respect concurrency limit
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(files.length / concurrency);
    
    console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} files)`);

    // Upload batch concurrently
    const batchPromises = batch.map(async (file, index) => {
      try {
        const fileOptions = {
          ...options,
          metadata: {
            ...options.metadata,
            batchNumber: batchNum.toString(),
            fileIndex: (i + index).toString(),
            totalFiles: files.length.toString()
          }
        };
        
        return await uploadFileToS3(file, fileOptions);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to upload ${file.name}:`, errorMessage);
        
        errors.push({
          file: file.name,
          error: errorMessage
        });
        
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    
    // Add successful uploads to results
    batchResults.forEach(result => {
      if (result) {
        results.push(result);
      }
    });

    // Add delay between batches to avoid overwhelming S3
    if (i + concurrency < files.length) {
      console.log('⏳ Brief delay between batches...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }
  }

  if (errors.length > 0) {
    console.warn(`⚠️ ${errors.length} files failed to upload:`, errors);
  }

  console.log(`✅ S3 batch upload complete: ${results.length}/${files.length} files uploaded successfully`);
  
  return results;
}

/**
 * Generate a pre-signed URL for accessing S3 object
 * @param key - S3 object key
 * @param expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns Pre-signed URL
 */
export function getS3SignedUrl(key: string, expiresIn: number = 3600): string {
  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  
  if (!bucketName) {
    throw new Error('AWS_S3_BUCKET_NAME environment variable is not configured');
  }

  return s3.getSignedUrl('getObject', {
    Bucket: bucketName,
    Key: key,
    Expires: expiresIn
  });
}

/**
 * Generate a pre-signed URL for uploading to S3
 * @param key - S3 object key for the upload
 * @param contentType - MIME type of the file
 * @param fileSizeBytes - Size of the file in bytes
 * @param expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns Pre-signed PUT URL
 */
export async function generatePresignedUploadUrl(
  key: string, 
  contentType: string,
  fileSizeBytes: number,
  expiresIn: number = 3600
): Promise<string | null> {
  const bucketName = process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME;
  
  if (!bucketName) {
    console.error('AWS bucket name not configured');
    return null;
  }

  if (!awsConfig.accessKeyId || !awsConfig.secretAccessKey) {
    console.error('AWS credentials not configured');
    return null;
  }

  try {
    const params = {
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
      Expires: expiresIn
    };

    const signedUrl = s3.getSignedUrl('putObject', params);
    
    console.log('✅ Pre-signed upload URL generated:', {
      key,
      bucket: bucketName,
      contentType,
      expiresIn
    });
    
    return signedUrl;
  } catch (error) {
    console.error('❌ Failed to generate pre-signed URL:', error);
    return null;
  }
}

/**
 * Generate pre-signed POST policy for direct browser uploads
 * More secure than pre-signed PUT URLs for client-side uploads
 * NOTE: Currently disabled due to AWS SDK type issues
 */
/*
export async function generatePresignedPostPolicy(
  key: string,
  contentType: string, 
  fileSizeBytes: number,
  expiresIn: number = 3600
): Promise<{
  url: string;
  fields: Record<string, string>;
} | null> {
  // Implementation temporarily disabled
  return null;
}
*/

/**
 * Delete file from S3
 * @param key - S3 object key to delete
 * @returns Success boolean
 */
export async function deleteS3File(key: string): Promise<boolean> {
  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  
  if (!bucketName) {
    throw new Error('AWS_S3_BUCKET_NAME environment variable is not configured');
  }

  try {
    await s3.deleteObject({
      Bucket: bucketName,
      Key: key
    }).promise();
    
    console.log('✅ S3 file deleted:', key);
    return true;
  } catch (error) {
    console.error('❌ S3 file deletion failed:', error);
    return false;
  }
}