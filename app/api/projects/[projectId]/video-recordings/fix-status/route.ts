import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    // Await params as required in Next.js 15+
    const { projectId } = await params;
    
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();
    
    const body = await request.json();
    const { roomId } = body;
    
    if (!roomId) {
      return NextResponse.json({ error: 'Room ID is required' }, { status: 400 });
    }
    
    // Find the recording
    const recording = await VideoRecording.findOne({ 
      projectId: projectId,
      roomId: new RegExp(roomId, 'i')
    });
    
    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }
    
    console.log('🔧 Fixing recording:', {
      id: recording._id,
      roomId: recording.roomId,
      currentStatus: recording.status,
      currentS3Key: recording.s3Key
    });
    
    // List S3 objects to find the actual recording
    const s3Params = {
      Bucket: process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME!,
      Prefix: `recordings/${recording.roomId}/`
    };
    
    console.log('🔍 Searching S3 with params:', s3Params);
    
    const s3Objects = await s3.listObjectsV2(s3Params).promise();
    
    if (!s3Objects.Contents || s3Objects.Contents.length === 0) {
      // Try without room ID subfolder (new structure)
      s3Params.Prefix = 'recordings/';
      const allRecordings = await s3.listObjectsV2(s3Params).promise();
      
      const matchingFiles = allRecordings.Contents?.filter(obj => 
        obj.Key?.includes(recording.roomId)
      ) || [];
      
      if (matchingFiles.length === 0) {
        return NextResponse.json({ 
          error: 'No recording file found in S3',
          searchedPrefix: s3Params.Prefix,
          roomId: recording.roomId
        }, { status: 404 });
      }
      
      s3Objects.Contents = matchingFiles;
    }
    
    // Get the most recent MP4 file
    const mp4Files = s3Objects.Contents.filter(obj => obj.Key?.endsWith('.mp4'));
    mp4Files.sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));
    
    if (mp4Files.length === 0) {
      return NextResponse.json({ 
        error: 'No MP4 file found',
        foundFiles: s3Objects.Contents.map(c => c.Key)
      }, { status: 404 });
    }
    
    const actualS3Key = mp4Files[0].Key!;
    const fileSize = mp4Files[0].Size || 0;
    
    console.log('✅ Found recording file:', {
      s3Key: actualS3Key,
      size: fileSize,
      lastModified: mp4Files[0].LastModified
    });
    
    // Update the recording
    const updatedRecording = await VideoRecording.findByIdAndUpdate(
      recording._id,
      {
        status: 'completed',
        s3Key: actualS3Key,
        fileSize: fileSize,
        endedAt: recording.endedAt || mp4Files[0].LastModified || new Date(),
        // Calculate approximate duration if not set
        duration: recording.duration || (recording.startedAt ? 
          Math.round((new Date().getTime() - new Date(recording.startedAt).getTime()) / 1000) : 
          0)
      },
      { new: true }
    );
    
    return NextResponse.json({
      success: true,
      message: 'Recording fixed successfully',
      recording: {
        _id: updatedRecording._id,
        roomId: updatedRecording.roomId,
        status: updatedRecording.status,
        s3Key: updatedRecording.s3Key,
        fileSize: updatedRecording.fileSize,
        duration: updatedRecording.duration
      },
      s3File: {
        key: actualS3Key,
        size: fileSize,
        lastModified: mp4Files[0].LastModified
      }
    });
    
  } catch (error) {
    console.error('Fix recording error:', error);
    return NextResponse.json(
      { error: 'Failed to fix recording', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}