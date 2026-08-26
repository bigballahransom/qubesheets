// app/api/stock-inventory/[id]/route.ts
//
// Granular edit/remove for a single stock library item.
//
// Semantics by target:
//  - Org/personal CUSTOM item (owned): PUT edits the doc in place; DELETE
//    removes it permanently.
//  - GLOBAL library item: never mutated. PUT upserts an org-scoped OVERRIDE
//    doc {organizationId, isOverride: true, overrideOf: <global _id>} carrying
//    the full effective field set (name, parent_class, cubic_feet, weight).
//    DELETE upserts an override with hidden: true ("remove from our library",
//    restorable). DELETE with ?revert=1 deletes the override doc entirely —
//    used for both "Revert to default" and "Restore hidden".
//  - Overrides are org-only: personal accounts get 403 for global-item edits
//    (they can still edit/delete their own custom items).
//
// STOCK_OVERRIDE_SYNC: the merge/fold consuming these docs lives in
// app/api/stock-inventory/route.js (GET) and railway-call-service/
// call-segment-processor.js (getOrgStockLibrary). Keep the three in sync.
import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import StockInventory from '@/models/StockInventory';
import { getAuthContext } from '@/lib/auth-helpers';

const MAX_NAME_LEN = 120;
const MAX_CATEGORY_LEN = 60;
const MAX_CUFT = 1000;
const MAX_WEIGHT = 5000;

function validateFields(body: any) {
  const errors: string[] = [];
  const name = String(body.name ?? '').trim();
  const parentClass = String(body.parent_class ?? '').trim();
  const cubicFeet = Number(body.cubic_feet);
  const weight = Number(body.weight);

  if (!name) errors.push('Name is required');
  if (name.length > MAX_NAME_LEN) errors.push(`Name must be under ${MAX_NAME_LEN} characters`);
  if (/["\n\r]/.test(name)) errors.push('Name cannot contain quotes or line breaks');
  if (parentClass.length > MAX_CATEGORY_LEN) errors.push(`Category must be under ${MAX_CATEGORY_LEN} characters`);
  if (!Number.isFinite(cubicFeet) || cubicFeet < 0 || cubicFeet > MAX_CUFT) errors.push(`Cubic feet must be between 0 and ${MAX_CUFT}`);
  if (!Number.isFinite(weight) || weight < 0 || weight > MAX_WEIGHT) errors.push(`Weight must be between 0 and ${MAX_WEIGHT}`);

  return { errors, name, parentClass, cubicFeet, weight };
}

async function loadTarget(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return StockInventory.findById(id);
}

function ownsCustomItem(item: any, auth: { organizationId?: string | null; userId: string; isPersonalAccount: boolean }) {
  if (!item.isCustom) return false;
  if (auth.isPersonalAccount) return !!item.userId && item.userId === auth.userId;
  return !!item.organizationId && item.organizationId === auth.organizationId;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    await connectMongoDB();
    const { id } = await params;
    const item = await loadTarget(id);
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    // Overrides themselves are not addressable targets — the UI always
    // addresses the GLOBAL item's id; guard against direct override edits.
    if (item.isOverride) {
      return NextResponse.json({ error: 'Address the library item, not its override' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { errors, name, parentClass, cubicFeet, weight } = validateFields(body);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
    }

    // Case 1: caller's own custom item — edit in place.
    if (item.isCustom) {
      if (!ownsCustomItem(item, authContext)) {
        return NextResponse.json({ error: 'Not your custom item' }, { status: 403 });
      }
      item.name = name;
      item.parent_class = parentClass || 'Custom';
      item.cubic_feet = cubicFeet;
      item.weight = weight;
      await item.save();
      return NextResponse.json({ success: true, kind: 'custom', item });
    }

    // Case 2: GLOBAL item — upsert an org override. Org-only.
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Overriding default library items requires an organization' },
        { status: 403 }
      );
    }

    // No-op guard: if the requested values match the global defaults exactly,
    // treat it as a revert (delete any override) instead of storing a
    // redundant override doc.
    const matchesDefaults =
      name === item.name &&
      (parentClass || '') === (item.parent_class || '') &&
      cubicFeet === (item.cubic_feet || 0) &&
      weight === (item.weight || 0);
    if (matchesDefaults) {
      await StockInventory.deleteOne({
        organizationId: authContext.organizationId,
        isOverride: true,
        overrideOf: item._id
      });
      return NextResponse.json({ success: true, kind: 'reverted' });
    }

    const override = await StockInventory.findOneAndUpdate(
      { organizationId: authContext.organizationId, isOverride: true, overrideOf: item._id },
      {
        $set: {
          name,
          parent_class: parentClass || item.parent_class || '',
          cubic_feet: cubicFeet,
          weight,
          hidden: false
        },
        $setOnInsert: {
          organizationId: authContext.organizationId,
          isOverride: true,
          overrideOf: item._id
        }
      },
      { upsert: true, new: true }
    );
    return NextResponse.json({ success: true, kind: 'override', override });
  } catch (error) {
    console.error('Error updating stock item:', error);
    const detail = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: `Failed to update item: ${detail}` }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) return authContext;

    await connectMongoDB();
    const { id } = await params;
    const revert = new URL(request.url).searchParams.get('revert') === '1';

    const item = await loadTarget(id);
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    if (item.isOverride) {
      return NextResponse.json({ error: 'Address the library item, not its override' }, { status: 400 });
    }

    // Custom item: hard delete (revert flag is meaningless here).
    if (item.isCustom) {
      if (!ownsCustomItem(item, authContext)) {
        return NextResponse.json({ error: 'Not your custom item' }, { status: 403 });
      }
      await StockInventory.deleteOne({ _id: item._id });
      return NextResponse.json({ success: true, kind: 'deleted' });
    }

    // Global item: org-only from here.
    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Hiding default library items requires an organization' },
        { status: 403 }
      );
    }

    if (revert) {
      // Revert-to-default / restore-hidden: drop the override entirely.
      const res = await StockInventory.deleteOne({
        organizationId: authContext.organizationId,
        isOverride: true,
        overrideOf: item._id
      });
      return NextResponse.json({ success: true, kind: 'reverted', removed: res.deletedCount });
    }

    // Hide: upsert override with hidden: true, preserving any prior field
    // edits so un-hiding restores them.
    await StockInventory.findOneAndUpdate(
      { organizationId: authContext.organizationId, isOverride: true, overrideOf: item._id },
      {
        $set: { hidden: true },
        $setOnInsert: {
          organizationId: authContext.organizationId,
          isOverride: true,
          overrideOf: item._id,
          name: item.name,
          parent_class: item.parent_class || '',
          cubic_feet: item.cubic_feet || 0,
          weight: item.weight || 0
        }
      },
      { upsert: true, new: true }
    );
    return NextResponse.json({ success: true, kind: 'hidden' });
  } catch (error) {
    console.error('Error deleting stock item:', error);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
