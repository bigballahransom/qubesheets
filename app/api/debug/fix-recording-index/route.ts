import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import mongoose from 'mongoose';

/**
 * Drop and recreate the unique_active_recording_per_room index
 * This is needed because we added 'processing' status to the partialFilterExpression
 * to prevent duplicate recordings when a call is ending
 */
export async function POST(request: NextRequest) {
  try {
    await connectMongoDB();

    const db = mongoose.connection.db;
    if (!db) {
      return NextResponse.json({ error: 'Database not connected' }, { status: 500 });
    }

    const collection = db.collection('videorecordings');

    // List current indexes
    const indexesBefore = await collection.indexes();
    console.log('Indexes before:', indexesBefore.map(i => ({ name: i.name, partialFilterExpression: i.partialFilterExpression })));

    // Drop the old index
    const indexName = 'unique_active_recording_per_room';
    try {
      await collection.dropIndex(indexName);
      console.log(`✅ Dropped ${indexName} index`);
    } catch (dropError: any) {
      if (dropError.code === 27) {
        // Index doesn't exist
        console.log(`Index ${indexName} does not exist`);
        return NextResponse.json({
          message: `Index ${indexName} does not exist (already dropped or never created)`,
          indexesBefore: indexesBefore.map(i => i.name),
          note: 'Mongoose will create the new index automatically on next model use'
        });
      }
      throw dropError;
    }

    // Force Mongoose to recreate the model to trigger index creation
    // Import the model to trigger ensureIndexes
    const VideoRecording = (await import('@/models/VideoRecording')).default;

    // Manually create the new index with the updated partialFilterExpression
    await collection.createIndex(
      { roomId: 1 },
      {
        unique: true,
        partialFilterExpression: {
          status: { $in: ['waiting', 'starting', 'recording', 'processing', 'failed'] }
        },
        name: 'unique_active_recording_per_room'
      }
    );
    console.log(`✅ Created new ${indexName} index with 'processing' status included`);

    // List indexes after
    const indexesAfter = await collection.indexes();
    console.log('Indexes after:', indexesAfter.map(i => ({ name: i.name, partialFilterExpression: i.partialFilterExpression })));

    // Find the new index to show its config
    const newIndex = indexesAfter.find(i => i.name === indexName);

    return NextResponse.json({
      success: true,
      message: `Successfully updated ${indexName} index to include 'processing' status`,
      indexesBefore: indexesBefore.map(i => i.name),
      indexesAfter: indexesAfter.map(i => i.name),
      newIndexConfig: newIndex ? {
        name: newIndex.name,
        unique: newIndex.unique,
        partialFilterExpression: newIndex.partialFilterExpression
      } : null
    });

  } catch (error: any) {
    console.error('Error fixing recording index:', error);
    return NextResponse.json({
      error: error.message,
      code: error.code
    }, { status: 500 });
  }
}
