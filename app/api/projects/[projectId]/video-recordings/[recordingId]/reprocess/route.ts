// app/api/projects/[projectId]/video-recordings/[recordingId]/reprocess/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import CallAnalysisSegment from '@/models/CallAnalysisSegment';
import InventoryItem from '@/models/InventoryItem';
import AWS from 'aws-sdk';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; recordingId: string }> }
) {
  const { projectId, recordingId } = await params;

  try {
    await connectMongoDB();

    // Fetch the recording
    const recording = await VideoRecording.findOne({
      _id: recordingId,
      projectId: projectId
    });

    if (!recording) {
      return NextResponse.json(
        { error: 'Recording not found' },
        { status: 404 }
      );
    }

    // Determine which video file to use - prefer customer video, fall back to main recording
    let videoS3Key = recording.customerVideoS3Key || recording.s3Key;

    if (!videoS3Key) {
      return NextResponse.json(
        { error: 'Video file not available for reprocessing' },
        { status: 400 }
      );
    }

    // Extract S3 key from URL if it's a full URL
    if (videoS3Key.startsWith('https://')) {
      // Handle URLs like https://qubesheets.s3.amazonaws.com/recordings/...
      videoS3Key = videoS3Key.replace(/^https?:\/\/[^\/]+\//, '');
    } else if (videoS3Key.startsWith('s3://')) {
      // Handle s3:// URLs
      videoS3Key = videoS3Key.replace(/^s3:\/\/[^\/]+\//, '');
    }

    console.log(`   Using video file: ${videoS3Key} (${recording.customerVideoS3Key ? 'customer' : 'main recording'})`);

    // Only block if the call is actively being recorded
    if (recording.status === 'recording' || recording.status === 'starting') {
      return NextResponse.json(
        { error: 'Recording is still in progress. Please wait for it to complete.' },
        { status: 400 }
      );
    }

    console.log(`🔄 Reprocessing video recording ${recordingId}`);

    // Delete old CallAnalysisSegment records
    const deletedSegments = await CallAnalysisSegment.deleteMany({
      videoRecordingId: recording._id
    });
    console.log(`   Deleted ${deletedSegments.deletedCount} old segments`);

    // Delete old InventoryItem records linked to this recording
    // Check multiple fields since items can be linked by different IDs
    const orConditions: any[] = [
      { sourceVideoRecordingId: recording._id },
      { sourceVideoRecordingId: recordingId } // Also try string version
    ];
    if (recording.sessionId) orConditions.push({ sourceRecordingSessionId: recording.sessionId });
    if (recording.egressId) orConditions.push({ sourceRecordingSessionId: recording.egressId });
    if (recording.customerEgressId) orConditions.push({ sourceRecordingSessionId: recording.customerEgressId });
    if (recording.roomId) orConditions.push({ sourceRecordingSessionId: recording.roomId });

    const deletedItems = await InventoryItem.deleteMany({
      $or: orConditions,
      projectId: recording.projectId
    });
    console.log(`   Deleted ${deletedItems.deletedCount} old inventory items`);

    // Reset status fields
    await VideoRecording.findByIdAndUpdate(recording._id, {
      $set: {
        'analysisResult.status': 'processing',
        'analysisResult.error': null,
        'analysisResult.processedSegments': 0,
        'analysisResult.totalSegments': 0,
        'analysisResult.itemsCount': 0,
        'analysisResult.totalBoxes': 0,
        'analysisResult.summary': null,
        'processingPipeline.status': 'processing',
        'processingPipeline.currentStep': 'segments',
        'processingPipeline.segmentsProcessed': 0,
        'processingPipeline.segmentsTotal': 0,
        'processingPipeline.error': null,
        'processingPipeline.startedAt': new Date(),
        'processingPipeline.completedAt': null,
        'consolidationResult': null,
        'consolidatedInventory': [],
        'transcriptAnalysisResult': null
      }
    });

    // Send SQS message to reprocess
    const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;
    if (!queueUrl) {
      console.error('❌ AWS_SQS_CALL_QUEUE_URL not configured');
      return NextResponse.json(
        { error: 'Processing queue not configured' },
        { status: 500 }
      );
    }

    const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });

    const message = {
      type: 'customer-video',
      videoRecordingId: recording._id.toString(),
      projectId: recording.projectId,
      s3Key: videoS3Key,
      s3Bucket: process.env.AWS_S3_BUCKET_NAME || 'qubesheets',
      roomName: recording.roomId,
      customerIdentity: recording.customerIdentity || 'customer',
      duration: recording.duration || 0
    };

    await sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message)
    }).promise();

    console.log(`✅ Reprocessing queued for recording ${recordingId}`);

    return NextResponse.json({
      success: true,
      message: 'Reprocessing started',
      videoRecordingId: recording._id.toString(),
      deletedSegments: deletedSegments.deletedCount,
      deletedItems: deletedItems.deletedCount
    });

  } catch (error: any) {
    console.error('Error reprocessing video recording:', error);
    return NextResponse.json(
      { error: 'Failed to reprocess recording', details: error.message },
      { status: 500 }
    );
  }
}
