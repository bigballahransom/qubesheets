// lib/videoUploadHelper.ts - Helper for consistent video upload handling
export interface VideoUploadResult {
  success: boolean;
  videoId?: string;
  projectId?: string;
  sqsMessageId?: string;
  s3Info?: {
    key: string;
    bucket: string;
    url: string;
  };
  message?: string;
  error?: string;
}

// Size threshold for switching to pre-signed URLs (4MB to stay under serverless limits)
const PRESIGNED_URL_THRESHOLD = 4 * 1024 * 1024; // 4MB

export async function uploadVideoFile(
  file: File,
  options: {
    projectId: string;
    isCustomerUpload?: boolean;
    customerToken?: string;
    userId?: string;
    organizationId?: string;
  }
): Promise<VideoUploadResult> {
  const { projectId, isCustomerUpload = false, customerToken } = options;
  
  console.log('🎬 Starting video upload:', {
    fileName: file.name,
    size: file.size,
    sizeMB: (file.size / (1024 * 1024)).toFixed(2),
    uploadMethod: 'pre-signed URL (direct to S3)'
  });

  try {
    // Always use pre-signed URL for videos to bypass Vercel serverless limits
    // This allows direct upload to S3 without going through Vercel
    console.log('🎬 Using pre-signed URL for direct S3 upload (bypassing Vercel limits)');
    return await uploadLargeVideo(file, options);
  } catch (error) {
    console.error('❌ Video upload failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown upload error'
    };
  }
}

async function uploadLargeVideo(
  file: File,
  options: {
    projectId: string;
    isCustomerUpload?: boolean;
    customerToken?: string;
    userId?: string;
    organizationId?: string;
  }
): Promise<VideoUploadResult> {
  const { projectId, isCustomerUpload, customerToken } = options;
  
  console.log('📤 Using pre-signed URL for large video');
  
  // Step 1: Get pre-signed URL
  console.log('🎯 Making API request to generate-video-upload-url...');
  const urlResponse = await fetch('/api/generate-video-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      projectId,
      isCustomerUpload,
      customerToken
    })
  });
  console.log('📡 API response status:', urlResponse.status);

  if (!urlResponse.ok) {
    const errorData = await urlResponse.text();
    throw new Error(`Failed to get upload URL: ${errorData}`);
  }

  const { uploadUrl, s3Key, bucket, metadata } = await urlResponse.json();
  
  // Step 2: Upload directly to S3
  console.log('📤 Uploading to S3 via pre-signed URL');
  console.log('🔗 Pre-signed URL:', uploadUrl);
  console.log('📋 Upload details:', {
    s3Key,
    bucket,
    fileSize: file.size,
    fileType: file.type,
    fileName: file.name
  });
  
  // Add timeout for large file uploads (10 minutes)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 600000); // 10 minutes timeout for large files
  
  let uploadResponse;
  try {
    console.log('🚀 Starting fetch to S3...');
    uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
      },
      body: file,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    console.log('✅ S3 fetch completed, status:', uploadResponse.status);
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('❌ S3 fetch failed:', error);
    console.error('❌ Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack'
    });
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Upload timed out - file is too large or network is too slow');
    }
    throw error;
  }

  if (!uploadResponse.ok) {
    throw new Error(`S3 upload failed: ${uploadResponse.statusText}`);
  }

  // Step 3: Confirm upload completion
  const confirmResponse = await fetch('/api/confirm-video-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      s3Key,
      actualFileSize: file.size,
      metadata
    })
  });

  if (!confirmResponse.ok) {
    const errorData = await confirmResponse.text();
    throw new Error(`Failed to confirm upload: ${errorData}`);
  }

  const result = await confirmResponse.json();
  return {
    success: true,
    videoId: result.videoId,
    projectId: result.projectId,
    sqsMessageId: result.sqsMessageId,
    s3Info: {
      key: s3Key,
      bucket,
      url: `https://${bucket}.s3.amazonaws.com/${s3Key}`
    },
    message: 'Video uploaded successfully! AI analysis is processing in the background.'
  };
}

async function uploadSmallVideo(
  file: File,
  options: {
    projectId: string;
    isCustomerUpload?: boolean;
    customerToken?: string;
    userId?: string;
    organizationId?: string;
  }
): Promise<VideoUploadResult> {
  const { projectId, isCustomerUpload, customerToken } = options;
  
  console.log('📤 Using direct API upload for small video');
  
  // Use existing direct upload API
  const formData = new FormData();
  formData.append('image', file);

  const uploadUrl = isCustomerUpload 
    ? `/api/customer-upload/${customerToken}/upload`
    : `/api/projects/${projectId}/admin-upload`;

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Upload failed: ${errorData}`);
  }

  const result = await response.json();
  
  if (!result.success) {
    throw new Error(result.error || 'Upload failed');
  }

  return {
    success: true,
    videoId: result.videoId,
    sqsMessageId: result.sqsMessageId,
    s3Info: result.s3Info,
    message: result.message
  };
}