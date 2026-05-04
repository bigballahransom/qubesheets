import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import mongoose from 'mongoose';
// VideoRecordingSession removed - now using LiveKit Egress (server-side) recording only

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

    // Check if requesting a specific recording by egressId
    const egressId = searchParams.get('egressId');
    if (egressId) {
      console.log('🔍 Fetching recording by egressId:', egressId);
      const recording = await VideoRecording.findOne({
        projectId,
        $or: [
          { egressId: egressId },
          { customerEgressId: egressId }
        ]
      }).lean();

      if (!recording) {
        return NextResponse.json({ recording: null });
      }

      // Transform recording with download URL
      const transformedRecording = {
        ...recording,
        source: 'livekit',
        downloadUrl: (recording as any).s3Url || `https://${process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${(recording as any).s3Key}`,
        formattedDuration: formatDuration((recording as any).duration),
        formattedFileSize: formatFileSize((recording as any).fileSize)
      };

      console.log('✅ Found recording by egressId:', (recording as any)._id);
      return NextResponse.json({ recording: transformedRecording });
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const source = searchParams.get('source');
    const sourceExclude = searchParams.get('sourceExclude');
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 1 : -1;

    // Build base match criteria
    const matchCriteria: any = {
      projectId: projectId
    };

    // Filter by status if provided
    if (status && status !== 'all') {
      matchCriteria.status = status;
    }

    // Filter by source if provided (e.g., source=self_serve)
    if (source) {
      matchCriteria.source = source;
    }

    // Exclude specific source if provided (e.g., sourceExclude=self_serve)
    // Belt-and-suspenders: also exclude by roomId pattern for robustness
    // IMPORTANT: Use $not: { $eq: value } instead of $ne to also match documents
    // where the source field doesn't exist (regular video calls don't have source set)
    if (sourceExclude === 'self_serve') {
      matchCriteria.$and = [
        { source: { $not: { $eq: 'self_serve' } } },  // Matches undefined/null/other values
        { roomId: { $not: { $regex: '^self-serve-' } } }  // Also exclude by roomId pattern
      ];
    } else if (sourceExclude) {
      matchCriteria.source = { $not: { $eq: sourceExclude } };
    }

    console.log('🔍 Video recordings query:', { projectId, status, source, sourceExclude, sortBy, sortOrder });

    // Use aggregation to group recordings by roomId and return only the best one per call
    // This prevents duplicate entries when a call has multiple recording attempts (e.g., failed + succeeded)
    const aggregationPipeline: any[] = [
      { $match: matchCriteria },
      // Add computed fields for sorting:
      // - statusPriority: completed=1, processing=2, recording=3, others=4+
      // - hasAgentName: true if there's an agent participant with a non-empty name
      {
        $addFields: {
          statusPriority: {
            $switch: {
              branches: [
                { case: { $eq: ['$status', 'completed'] }, then: 1 },
                { case: { $eq: ['$status', 'processing'] }, then: 2 },
                { case: { $eq: ['$status', 'recording'] }, then: 3 },
                { case: { $eq: ['$status', 'starting'] }, then: 4 },
                { case: { $eq: ['$status', 'waiting'] }, then: 5 },
              ],
              default: 6 // failed and others
            }
          },
          // Check if recording has an agent participant with a non-empty name
          hasAgentName: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ['$participants', []] },
                    as: 'p',
                    cond: {
                      $and: [
                        { $eq: ['$$p.type', 'agent'] },
                        { $gt: [{ $strLenCP: { $ifNull: ['$$p.name', ''] } }, 0] }
                      ]
                    }
                  }
                }
              },
              0
            ]
          }
        }
      },
      // Sort by: hasAgentName DESC (prefer recordings with agent names),
      // then statusPriority ASC (prefer better status), then createdAt DESC (most recent)
      { $sort: { hasAgentName: -1, statusPriority: 1, createdAt: -1 } },
      // Group by roomId and keep only the best recording per room
      {
        $group: {
          _id: '$roomId',
          recording: { $first: '$$ROOT' },
          totalAttempts: { $sum: 1 }
        }
      },
      // Flatten the result back to recording documents
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ['$recording', { totalAttempts: '$totalAttempts' }]
          }
        }
      },
      // Remove the temporary computed fields
      { $unset: ['statusPriority', 'hasAgentName'] }
    ];

    // Add final sort based on user preference
    const finalSort: any = {};
    finalSort[sortBy] = sortOrder;
    aggregationPipeline.push({ $sort: finalSort });

    // Get total count of unique rooms (for pagination)
    const countPipeline = [
      { $match: matchCriteria },
      { $group: { _id: '$roomId' } },
      { $count: 'total' }
    ];

    const [recordings, countResult] = await Promise.all([
      VideoRecording.aggregate([
        ...aggregationPipeline,
        { $skip: (page - 1) * limit },
        { $limit: limit }
      ]),
      VideoRecording.aggregate(countPipeline)
    ]);

    const totalCount = countResult[0]?.total || 0;

    console.log('📊 Query results:', { totalCount, returnedCount: recordings.length });

    // Transform recordings with download URLs
    const transformedRecordings = recordings.map((recording: any) => ({
      ...recording,
      source: 'livekit',
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

    console.log(`✅ Found ${transformedRecordings.length} recordings (${totalCount} total)`);
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