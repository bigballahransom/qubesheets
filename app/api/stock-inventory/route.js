// app/api/stock-inventory/route.js
import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import StockInventory from '@/models/StockInventory';
import { getAuthContext } from '@/lib/auth-helpers';
import { getS3SignedUrl } from '@/lib/s3Upload';

// GET /api/stock-inventory?search=chair&parent_class=Furniture&limit=50&offset=0
export async function GET(request) {
  try {
    // Require authentication
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const parentClass = searchParams.get('parent_class');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query
    let query = {};
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (parentClass && parentClass !== 'all') {
      query.parent_class = parentClass;
    }

    // Fetch items and total count in parallel
    const [items, total] = await Promise.all([
      StockInventory.find(query)
        .skip(offset)
        .limit(limit)
        .sort({ name: 1 })
        .lean(),
      StockInventory.countDocuments(query)
    ]);

    // Get unique parent classes for filter dropdown (only on first request)
    let parentClasses = [];
    if (offset === 0) {
      parentClasses = await StockInventory.distinct('parent_class');
      // Filter out null/empty values and sort
      parentClasses = parentClasses
        .filter(pc => pc && pc.trim() !== '')
        .sort();
    }

    // Add signed URLs for images (S3 bucket is private)
    const itemsWithSignedUrls = items.map(item => {
      if (item.image) {
        // item.image is like "/images/xxx.png"
        // S3 key is "stockInventory/images/xxx.png"
        const s3Key = `stockInventory${item.image}`;
        item.signedImageUrl = getS3SignedUrl(s3Key, 3600); // 1 hour expiry
      }
      return item;
    });

    return NextResponse.json({
      items: itemsWithSignedUrls,
      total,
      parentClasses,
      hasMore: offset + items.length < total
    });
  } catch (error) {
    console.error('Error fetching stock inventory:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stock inventory' },
      { status: 500 }
    );
  }
}
