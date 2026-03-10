import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import mongoose from 'mongoose';

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
    console.log('Indexes before:', indexesBefore.map(i => i.name));

    // Drop the problematic index
    try {
      await collection.dropIndex('egressId_1');
      console.log('✅ Dropped egressId_1 index');
    } catch (dropError: any) {
      if (dropError.code === 27) {
        // Index doesn't exist
        console.log('Index egressId_1 does not exist');
        return NextResponse.json({
          message: 'Index egressId_1 does not exist (already dropped or never created)',
          indexesBefore: indexesBefore.map(i => i.name)
        });
      }
      throw dropError;
    }

    // List indexes after
    const indexesAfter = await collection.indexes();
    console.log('Indexes after:', indexesAfter.map(i => i.name));

    return NextResponse.json({
      success: true,
      message: 'Successfully dropped egressId_1 index. Mongoose will recreate it with sparse:true on next use.',
      indexesBefore: indexesBefore.map(i => i.name),
      indexesAfter: indexesAfter.map(i => i.name)
    });

  } catch (error: any) {
    console.error('Error dropping index:', error);
    return NextResponse.json({
      error: error.message,
      code: error.code
    }, { status: 500 });
  }
}
