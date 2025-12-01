import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import { Inventory } from '@/models/inventory';

// GET /api/inventory - Get all static inventory items from the catalog
export async function GET(request: Request) {
  try {
    console.log('📥 GET /api/inventory called - Fetching static inventory catalog');
    
    await connectMongoDB();
    console.log('✅ MongoDB connected');
    
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = (page - 1) * limit;
    
    // Build search filter
    let filter = {};
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter = {
        $or: [
          { name: searchRegex },
          { parent_class: searchRegex },
          { tags: { $in: [searchRegex] } }
        ]
      };
    }
    
    // Get total count for pagination
    const total = await Inventory.countDocuments(filter);
    
    // Fetch inventory items with pagination
    const items = await Inventory.find(filter)
      .select('_id name parent_class weight cubic_feet tags image')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    console.log(`✅ Found ${items.length} inventory items (${total} total, page ${page})`);
    
    return NextResponse.json({
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('❌ Error in GET /api/inventory:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory items', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}