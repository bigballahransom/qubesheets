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

    // Build base query for search/category filters
    let baseQuery = {};
    if (search) {
      baseQuery.name = { $regex: search, $options: 'i' };
    }
    if (parentClass && parentClass !== 'all') {
      baseQuery.parent_class = parentClass;
    }

    // Build org-scoped query to include both:
    // 1. Global stock library items (no organizationId, not custom)
    // 2. Organization's custom items (matching organizationId, isCustom: true)
    const orgScopeQuery = authContext.isPersonalAccount
      ? {
          $or: [
            { organizationId: { $exists: false }, isCustom: { $ne: true } },  // Global stock
            { userId: authContext.userId, isCustom: true }  // User's personal custom items
          ]
        }
      : {
          $or: [
            { organizationId: { $exists: false }, isCustom: { $ne: true } },  // Global stock
            { organizationId: authContext.organizationId, isCustom: true }  // Org's custom items
          ]
        };

    // Combine base query with org scope
    const query = { ...baseQuery, ...orgScopeQuery };

    // Fetch items and total count in parallel
    const [items, total] = await Promise.all([
      StockInventory.find(query)
        .skip(offset)
        .limit(limit)
        .sort({ isCustom: -1, name: 1 })  // Custom items first, then alphabetical
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

// POST /api/stock-inventory - Create a custom stock library item (organization-scoped)
export async function POST(request) {
  try {
    // Require authentication
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    const data = await request.json();

    // Validate required fields
    if (!data.name || !data.name.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    // Create organization-scoped custom item
    const newItem = {
      name: data.name.trim(),
      parent_class: data.parent_class || 'Custom',
      weight: data.weight || 0,
      cubic_feet: data.cubic_feet || 0,
      tags: data.tags || '[]',
      image: '',  // No image for custom items initially
      isCustom: true,
      // Scope to organization or personal account
      ...(authContext.isPersonalAccount
        ? { userId: authContext.userId }
        : { organizationId: authContext.organizationId }
      ),
    };

    const created = await StockInventory.create(newItem);

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error creating custom stock item:', error);
    return NextResponse.json(
      { error: 'Failed to create custom item' },
      { status: 500 }
    );
  }
}
