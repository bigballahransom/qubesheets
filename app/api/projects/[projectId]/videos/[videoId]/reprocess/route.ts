// app/api/projects/[projectId]/videos/[videoId]/reprocess/route.ts
// Rerun analysis for an uploaded Video doc (railway-video-service pipeline).
// Mirror of video-recordings/[recordingId]/reprocess, which covers VideoRecording
// docs (call-service pipeline) — this covers the plain Video collection: clears
// the video's derived inventory items + spreadsheet rows, resets statuses, and
// re-enqueues the original S3 file on AWS_SQS_VIDEO_QUEUE_URL.
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Video from '@/models/Video';
import InventoryItem from '@/models/InventoryItem';
import SpreadsheetData from '@/models/SpreadsheetData';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import { sendVideoProcessingMessage } from '@/lib/sqsUtils';
import AWS from 'aws-sdk';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; videoId: string }> }
) {
  const { projectId, videoId } = await params;

  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const project = await Project.findOne(getOrgFilter(authContext, { _id: projectId }));
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const video = await Video.findOne({ _id: videoId, projectId });
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    if (video.purpose === 'vault') {
      return NextResponse.json(
        { error: 'Media Vault videos are reference-only and are not inventoried' },
        { status: 400 }
      );
    }

    const s3Key = video.s3RawFile?.key;
    if (!s3Key) {
      return NextResponse.json(
        { error: 'Video file not available for reprocessing' },
        { status: 400 }
      );
    }

    // The video pipeline has no processing-claim layer, so block a rerun while a
    // run is plausibly still live; a job silent for 45+ min is treated as dead.
    // analysisResult.status is the source of truth for completion — the worker
    // never advances processingStatus past 'queued'.
    const analysisStatus = video.analysisResult?.status;
    const isFinished = analysisStatus === 'completed' || analysisStatus === 'failed';
    const isActive = !isFinished && (
      video.processingStatus === 'processing' ||
      video.processingStatus === 'queued' ||
      analysisStatus === 'processing' ||
      analysisStatus === 'pending'
    );
    const lastTouched = new Date(video.updatedAt || video.createdAt).getTime();
    if (isActive && Date.now() - lastTouched < 45 * 60 * 1000) {
      return NextResponse.json(
        { error: 'This video is still being processed. Please wait for it to finish.' },
        { status: 400 }
      );
    }

    // Verify the source file exists before wiping results and queueing a run
    // that would fail on NoSuchKey. Only a definitive 404 blocks; any other
    // HEAD error fails open.
    const s3Bucket = video.s3RawFile?.bucket || process.env.AWS_S3_BUCKET_NAME || 'qubesheets';
    try {
      const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'us-east-1' });
      await s3.headObject({ Bucket: s3Bucket, Key: s3Key }).promise();
    } catch (headErr: any) {
      if (headErr?.code === 'NotFound' || headErr?.code === 'NoSuchKey' || headErr?.statusCode === 404) {
        await Video.findByIdAndUpdate(video._id, {
          processingStatus: 'failed',
          'analysisResult.status': 'failed',
          'analysisResult.error': 'Source video file does not exist in S3'
        });
        return NextResponse.json(
          { error: 'The source video file no longer exists in storage, so this video cannot be reprocessed.' },
          { status: 400 }
        );
      }
      console.warn(`⚠️ S3 HEAD check errored during video reprocess (${headErr?.code || headErr?.message}) — failing open, proceeding`);
    }

    console.log(`🔄 Reprocessing uploaded video ${videoId}`);

    // Delete the video's derived inventory items, capturing ids first so the
    // linked spreadsheet rows can be pulled too — otherwise each reprocess
    // stacks a fresh generation of rows onto the sheet.
    const itemFilter = {
      sourceVideoId: videoId,
      projectId,
      ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
    };
    const doomedItems = await InventoryItem.find(itemFilter, { _id: 1 }).lean();
    const doomedIds = doomedItems.map((d: any) => d._id.toString());

    const deletedItems = await InventoryItem.deleteMany(itemFilter);
    console.log(`   Deleted ${deletedItems.deletedCount} old inventory items`);

    if (doomedIds.length > 0) {
      const pulled = await SpreadsheetData.updateMany(
        { projectId },
        { $pull: { rows: { inventoryItemId: { $in: doomedIds } } } } as any
      );
      console.log(`   Pulled spreadsheet rows for ${doomedIds.length} item(s) (${pulled.modifiedCount} sheet(s))`);
    }

    // Reset status fields
    await Video.findByIdAndUpdate(video._id, {
      $set: {
        processingStatus: 'queued',
        'analysisResult.status': 'pending',
        'analysisResult.summary': null,
        'analysisResult.itemsCount': 0,
        'analysisResult.totalBoxes': 0,
        'analysisResult.error': null
      }
    });

    await sendVideoProcessingMessage({
      videoId: video._id.toString(),
      projectId,
      userId: video.userId || 'anonymous',
      organizationId: video.organizationId,
      s3ObjectKey: s3Key,
      s3Bucket,
      s3Url: video.s3RawFile?.url || '',
      originalFileName: video.originalName || video.name,
      mimeType: video.mimeType,
      originalMimeType: video.originalMimeType,
      fileSize: video.size || 0,
      uploadedAt: new Date().toISOString(),
      source: 'video-upload'
    });

    console.log(`✅ Reprocessing queued for uploaded video ${videoId}`);

    return NextResponse.json({
      success: true,
      message: 'Reprocessing started',
      videoId: video._id.toString(),
      deletedItems: deletedItems.deletedCount
    });

  } catch (error: any) {
    console.error('Error reprocessing uploaded video:', error);
    return NextResponse.json(
      { error: 'Failed to reprocess video', details: error.message },
      { status: 500 }
    );
  }
}
