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

    // STOCK_OVERRIDE_SYNC: org-specific overrides of global items. An
    // override doc {organizationId, isOverride: true, overrideOf: <globalId>}
    // shadows the global's name/category/cuft/weight for this org only;
    // hidden: true removes the global from the org's merged view. The same
    // fold exists in railway-call-service getOrgStockLibrary — keep in sync.
    let overrideByGlobalId = new Map();
    if (!authContext.isPersonalAccount && authContext.organizationId) {
      const overrides = await StockInventory.find({
        organizationId: authContext.organizationId,
        isOverride: true
      }).lean();
      overrideByGlobalId = new Map(overrides.map(o => [String(o.overrideOf), o]));
    }
    const hiddenGlobalIds = Array.from(overrideByGlobalId.values())
      .filter(o => o.hidden)
      .map(o => o.overrideOf);
    const includeHidden = searchParams.get('includeHidden') === '1';

    // Global-branch filter: exclude org-hidden items (unless the settings
    // page asks for them), and never return override docs as rows.
    const globalBranch = {
      organizationId: { $exists: false },
      isCustom: { $ne: true },
      ...(hiddenGlobalIds.length > 0 && !includeHidden ? { _id: { $nin: hiddenGlobalIds } } : {})
    };

    // Build org-scoped query to include both:
    // 1. Global stock library items (no organizationId, not custom)
    // 2. Organization's custom items (matching organizationId, isCustom: true)
    const orgScopeQuery = authContext.isPersonalAccount
      ? {
          $or: [
            globalBranch,
            { userId: authContext.userId, isCustom: true }  // User's personal custom items
          ]
        }
      : {
          $or: [
            globalBranch,
            { organizationId: authContext.organizationId, isCustom: true }  // Org's custom items
          ]
        };

    // When searching, an org-RENAMED item must be findable by its new name.
    // The base regex matches stored (global) names, so the name filter
    // becomes: (name matches) OR (_id is a non-hidden override whose
    // overridden name matches).
    let query = { ...baseQuery, ...orgScopeQuery };
    if (search) {
      const searchRe = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const renamedMatchIds = Array.from(overrideByGlobalId.values())
        .filter(o => !o.hidden && typeof o.name === 'string' && searchRe.test(o.name))
        .map(o => o.overrideOf);
      if (renamedMatchIds.length > 0) {
        const { name: nameFilter, ...restBase } = baseQuery;
        query = {
          ...restBase,
          $and: [
            { $or: orgScopeQuery.$or },
            { $or: [{ name: nameFilter }, { _id: { $in: renamedMatchIds } }] }
          ]
        };
      }
    }

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

    // Fold org overrides onto their global items (effective values), then
    // add signed URLs for images (S3 bucket is private).
    const itemsWithSignedUrls = items.map(item => {
      const override = overrideByGlobalId.get(String(item._id));
      if (override) {
        // Preserve the library defaults so the UI can show/revert them.
        item.defaults = {
          name: item.name,
          parent_class: item.parent_class,
          cubic_feet: item.cubic_feet,
          weight: item.weight
        };
        item.name = override.name ?? item.name;
        item.parent_class = override.parent_class ?? item.parent_class;
        item.cubic_feet = override.cubic_feet ?? item.cubic_feet;
        item.weight = override.weight ?? item.weight;
        item.isOverridden = true;
        item.hidden = !!override.hidden;
      }
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

// DELETE /api/stock-inventory - "Reset all to defaults": removes every
// override doc for the org (field edits AND hides of default items).
// Custom items are intentionally untouched — they're the org's own
// creations, not deviations from our defaults.
export async function DELETE() {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Resetting library overrides requires an organization' },
        { status: 403 }
      );
    }

    await connectMongoDB();
    const res = await StockInventory.deleteMany({
      organizationId: authContext.organizationId,
      isOverride: true
    });
    return NextResponse.json({ success: true, removed: res.deletedCount });
  } catch (error) {
    console.error('Error resetting stock overrides:', error);
    return NextResponse.json(
      { error: 'Failed to reset overrides' },
      { status: 500 }
    );
  }
}
