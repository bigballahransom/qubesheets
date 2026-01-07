import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    // Await params as required in Next.js 15+
    const { projectId } = await params;
    console.log('🎥 Fetching video recordings for project:', projectId);
    
    // Authentication check
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 1 : -1;

    // Build query
    const query: any = {
      projectId: projectId
    };

    // Filter by status if provided
    if (status && status !== 'all') {
      query.status = status;
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy] = sortOrder;

    // Execute query with pagination
    const skip = (page - 1) * limit;
    
    const [recordings, totalCount] = await Promise.all([
      VideoRecording.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      VideoRecording.countDocuments(query)
    ]);

    // Transform recordings to include computed fields
    const transformedRecordings = recordings.map(recording => ({
      ...recording,
      downloadUrl: recording.s3Url || `https://${process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${recording.s3Key}`,
      formattedDuration: formatDuration(recording.duration),
      formattedFileSize: formatFileSize(recording.fileSize)
    }));

    const response = {
      recordings: transformedRecordings,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page * limit < totalCount,
        hasPrevPage: page > 1
      }
    };

    console.log(`✅ Found ${recordings.length} recordings (${totalCount} total)`);
    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ Error fetching video recordings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video recordings' },
      { status: 500 }
    );
  }
}

// Helper function to format duration in seconds to MM:SS or HH:MM:SS
function formatDuration(durationInSeconds?: number): string {
  if (!durationInSeconds) return 'Unknown';
  
  const hours = Math.floor(durationInSeconds / 3600);
  const minutes = Math.floor((durationInSeconds % 3600) / 60);
  const seconds = Math.floor(durationInSeconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Helper function to format file size in bytes to human readable
function formatFileSize(sizeInBytes?: number): string {
  if (!sizeInBytes) return 'Unknown';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = sizeInBytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}