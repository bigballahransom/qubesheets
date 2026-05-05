// app/api/customer-upload/[token]/recording/chunk-uploaded/route.ts
// Confirm a chunk has been uploaded and get next pre-signed URL if needed
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import { generatePresignedUploadUrl } from '@/lib/s3Upload';
import CustomerUpload from '@/models/CustomerUpload';
import SelfServeRecordingSession from '@/models/SelfServeRecordingSession';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    const { token } = await params;

    if (!token) {
      return NextResponse.json(
        { error: 'No upload token provided' },
        { status: 400 }
      );
    }

    // Validate upload link
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true
    });

    if (!customerUpload) {
      return NextResponse.json(
        { error: 'Invalid or expired upload link' },
        { status: 404 }
      );
    }

    // Parse request body
    const body = await request.json();
    const {
      sessionId,
      chunkIndex,
      s3Key,
      fileSize,
      duration // chunk duration in seconds
    } = body;

    if (!sessionId || chunkIndex === undefined || !s3Key) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, chunkIndex, s3Key' },
        { status: 400 }
      );
    }

    // Find session
    const session = await SelfServeRecordingSession.findOne({
      sessionId,
      uploadToken: token
    });

    if (!session) {
      return NextResponse.json(
        { error: 'Recording session not found' },
        { status: 404 }
      );
    }

    // Check if session is in valid state
    if (!['initialized', 'recording', 'uploading'].includes(session.status)) {
      return NextResponse.json(
        { error: `Cannot upload chunks in ${session.status} state` },
        { status: 400 }
      );
    }

    // Update session status if this is the first chunk
    if (session.status === 'initialized') {
      session.status = 'recording';
      session.startedAt = new Date();
    }

    // Find existing chunk or create new one
    const existingChunkIndex = session.chunks.findIndex(
      (c: any) => c.chunkIndex === chunkIndex
    );

    const chunkData = {
      chunkIndex,
      s3Key,
      s3Bucket: process.env.AWS_S3_BUCKET_NAME,
      fileSize: fileSize || 0,
      duration: duration || 60,
      status: 'uploaded' as const,
      uploadedAt: new Date(),
      retryCount: 0
    };

    if (existingChunkIndex >= 0) {
      // Update existing chunk
      session.chunks[existingChunkIndex] = chunkData;
    } else {
      // Add new chunk
      session.chunks.push(chunkData);
    }

    // Update counters
    session.uploadedChunks = session.chunks.filter((c: any) => c.status === 'uploaded').length;
    session.totalChunks = Math.max(session.totalChunks, chunkIndex + 1);

    // Calculate total duration from chunks
    session.totalDuration = session.chunks.reduce((sum: number, c: any) => {
      return sum + (c.duration || 60);
    }, 0);

    await session.save();

    // Generate next pre-signed URL if needed
    let nextPresignedUrl = null;
    const nextChunkIndex = chunkIndex + 1;

    // Check if we need more pre-signed URLs (look ahead by 3 chunks)
    const maxExistingChunkIndex = Math.max(...session.chunks.map((c: any) => c.chunkIndex), -1);

    if (nextChunkIndex > maxExistingChunkIndex) {
      const chunkKey = `self-serve/${customerUpload.projectId}/${sessionId}/chunks/chunk-${nextChunkIndex.toString().padStart(3, '0')}.webm`;

      try {
        const uploadUrl = await generatePresignedUploadUrl(
          chunkKey,
          'video/webm',
          100 * 1024 * 1024, // 100MB max per chunk
          3600 // 1 hour expiry
        );

        nextPresignedUrl = {
          chunkIndex: nextChunkIndex,
          uploadUrl,
          s3Key: chunkKey,
          s3Bucket: process.env.AWS_S3_BUCKET_NAME,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
        };
      } catch (urlError) {
        console.error(`Failed to generate pre-signed URL for chunk ${nextChunkIndex}:`, urlError);
      }
    }

    console.log(`📹 CHUNK UPLOAD: session=${sessionId.substring(0, 12)}..., chunk=${chunkIndex}, size=${((fileSize || 0) / 1024 / 1024).toFixed(2)}MB, totalChunks=${session.chunks.length}`);

    return NextResponse.json({
      success: true,
      chunkIndex,
      uploadedChunks: session.uploadedChunks,
      totalDuration: session.totalDuration,
      nextPresignedUrl
    });

  } catch (error) {
    console.error('Error confirming chunk upload:', error);
    return NextResponse.json(
      { error: 'Failed to confirm chunk upload' },
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
