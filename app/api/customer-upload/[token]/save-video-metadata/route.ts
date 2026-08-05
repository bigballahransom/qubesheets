// app/api/customer-upload/[token]/save-video-metadata/route.ts - Save video metadata after direct upload
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Video from '@/models/Video';
import Project from '@/models/Project';
import { uploadFileToS3 } from '@/lib/s3Upload';
import { sendVideoProcessingMessage } from '@/lib/sqsUtils';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  console.log('💾 Video metadata save API called');
  try {
    await connectMongoDB();
    console.log('🔗 MongoDB connected');
    
    const { token } = await params;
    const body = await request.json();
    
    const {
      fileName,
      fileSize,
      fileType,
      videoBuffer, // Base64 encoded video data
      customerName,
      label
    } = body;
    
    console.log('💾 Received video metadata:', {
      fileName,
      fileSize,
      hasVideoBuffer: !!videoBuffer
    });
    
    // Find customer upload for project association
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true
    });

    let projectId = null;
    let userId = null;
    let organizationId = null;
    
    if (customerUpload) {
      projectId = customerUpload.projectId;
      userId = customerUpload.userId;
      organizationId = customerUpload.organizationId;
    } else {
      // Fallback: Create/use a default project
      let defaultProject = await Project.findOne({ 
        name: 'Anonymous Customer Uploads',
        isDefault: true 
      });
      
      if (!defaultProject) {
        defaultProject = await Project.create({
          name: 'Anonymous Customer Uploads',
          description: 'Videos uploaded without specific project tokens',
          isDefault: true,
          createdAt: new Date()
        });
      }
      
      projectId = defaultProject._id;
    }
    
    // Generate unique name
    const timestamp = Date.now();
    const cleanCustomerName = (customerName || 'anonymous').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const name = `customer-${cleanCustomerName}-${timestamp}-${fileName}`;
    
    // Convert base64 to buffer for S3 upload
    let buffer = null;
    if (videoBuffer) {
      try {
        // Remove data URL prefix if present
        const base64Data = videoBuffer.replace(/^data:video\/[a-z0-9]+;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
        console.log('📊 Converted video buffer size:', buffer.length, 'bytes');
      } catch (bufferError) {
        console.error('❌ Failed to convert video buffer:', bufferError);
        return NextResponse.json(
          { error: 'Invalid video data provided' },
          { status: 400 }
        );
      }
    }
    
    // Upload to S3 and queue for SQS processing if we have video data
    let s3Result = null;
    let sqsMessageId = 'no-analysis-data';
    
    // Media Vault uploads are stored for reference only — no AI processing
    const isVault = customerUpload?.purpose === 'vault';

    // Save video metadata to database first
    const videoDoc = await Video.create({
      name,
      originalName: fileName,
      mimeType: fileType,
      size: fileSize,
      duration: 0, // Will be updated after processing
      projectId,
      userId,
      organizationId,
      description: `Video uploaded by ${customerName || 'anonymous customer'}`,
      source: 'customer_upload',
      purpose: isVault ? 'vault' : 'inventory',
      ...(label ? { label: String(label).slice(0, 200) } : {}),
      processingStatus: isVault ? 'skipped' : 'queued',
      // Initialize with processing analysis status
      analysisResult: isVault ? {
        summary: 'Stored in Media Vault — not inventoried',
        itemsCount: 0,
        totalBoxes: 0,
        status: 'skipped'
      } : {
        summary: 'AI video analysis in progress...',
        itemsCount: 0,
        totalBoxes: 0,
        status: 'processing'
      },
      metadata: {
        uploadToken: token,
        processingPending: true,
        directUpload: true,
        uploadSource: 'customer-upload-metadata',
        customerName: customerName || 'anonymous'
      }
    });
    
    console.log('✅ Video metadata saved:', videoDoc._id);
    
    if (buffer) {
      try {
        // Upload to S3
        const videoFile = new File([buffer], fileName, { type: fileType });
        s3Result = await uploadFileToS3(videoFile, {
          folder: 'Media/Videos',
          metadata: {
            projectId: projectId?.toString() || 'unknown',
            uploadSource: 'customer-upload-metadata',
            customerToken: token,
            customerName: customerName || 'anonymous',
            originalMimeType: fileType,
            uploadedAt: new Date().toISOString()
          },
          contentType: fileType
        });
        
        console.log(`✅ S3 upload successful: ${s3Result.key}`);
        
        // Update video document with S3 raw file info
        await Video.findByIdAndUpdate(videoDoc._id, {
          s3RawFile: {
            key: s3Result.key,
            bucket: s3Result.bucket,
            url: s3Result.url,
            etag: s3Result.etag,
            uploadedAt: new Date(),
            contentType: s3Result.contentType
          }
        });
        
        // Send to SQS for Railway processing (vault media is never processed;
        // instead fire the vault-media notification to opted-in org members)
        if (isVault) {
          sqsMessageId = 'vault-skip';
          try {
            const { sendInventoryUpdateNotification } = await import('@/lib/inventoryUpdateNotifications');
            const projectDoc = await Project.findById(projectId).select('name').lean();
            await sendInventoryUpdateNotification({
              projectId: String(projectId),
              body: `New vault video added to ${(projectDoc as any)?.name || 'a project'}.`,
              source: 'vault-media',
              settingKey: 'enableVaultMediaUpdates'
            });
          } catch (notifyErr) {
            console.error('vault-media SMS (video upload) failed (non-fatal):', notifyErr);
          }
        } else {
        sqsMessageId = await sendVideoProcessingMessage({
          videoId: videoDoc._id.toString(),
          projectId: projectId?.toString() || 'unknown',
          userId: userId || 'anonymous',
          organizationId: organizationId,
          s3ObjectKey: s3Result.key,
          s3Bucket: s3Result.bucket,
          s3Url: s3Result.url,
          originalFileName: fileName,
          mimeType: fileType,
          fileSize: buffer.length,
          uploadedAt: new Date().toISOString(),
          source: 'video-upload'
        });

        console.log(`✅ SQS message sent: ${sqsMessageId}`);
        }

      } catch (s3Error) {
        console.error('⚠️ S3/SQS upload failed, video still saved to MongoDB:', s3Error);
        sqsMessageId = 'fallback-local-processing';
      }
    }
    
    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json({
      success: true,
      videoId: videoDoc._id.toString(),
      sqsMessageId: sqsMessageId,
      s3Info: s3Result ? {
        key: s3Result.key,
        bucket: s3Result.bucket,
        url: s3Result.url
      } : null,
      message: isVault
        ? 'Video saved to the Media Vault.'
        : buffer
        ? 'Video uploaded successfully! AI analysis is processing in the background and items will appear in your inventory shortly.'
        : 'Video uploaded successfully! Analysis requires video data.',
      customerName: customerName || 'anonymous',
      analysisStatus: isVault ? 'skipped' : buffer ? 'queued' : 'skipped'
    });
    
  } catch (error) {
    console.error('❌ Error saving video metadata:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to save video metadata',
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