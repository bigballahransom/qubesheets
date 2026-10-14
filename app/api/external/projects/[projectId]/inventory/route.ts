// app/api/external/projects/[projectId]/inventory/route.ts
//
// GET /api/external/projects/:projectId/inventory
//
// Partner-facing inventory read. Items expose per-unit AND total cuft/weight
// explicitly (item.cuft/item.weight are stored per-unit - totals are always
// per-unit × quantity). The summary block is computed by
// lib/inventory-stats.ts, the same code path as the project page, review
// links, and PDFs, so partners see the numbers the org sees in the app.
//
// Full endpoint documentation: GET /api/external

import { NextRequest, NextResponse } from 'next/server';
import InventoryItem from '@/models/InventoryItem';
import { authenticateExternalProjectRequest, externalApiError } from '@/lib/external-api';
import { computeInventoryStats, deriveGoingQuantity, isBoxItem } from '@/lib/inventory-stats';
import { resolveWeightConfig, resolveItemWeight } from '@/lib/weight-config';

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const ctx = await authenticateExternalProjectRequest(request, projectId);
    if (ctx instanceof NextResponse) return ctx;
    const { authContext, project } = ctx;

    const weightConfig = await resolveWeightConfig({
      project: {
        weightMode: project.weightMode,
        customWeightMultiplier: project.customWeightMultiplier,
      },
      organizationId: authContext.organizationId,
    });

    const items = await InventoryItem.find({ projectId: project._id })
      .sort({ location: 1, createdAt: 1 })
      .lean<any[]>();

    const stats = computeInventoryStats(items, weightConfig);

    return NextResponse.json({
      projectId: project._id.toString(),
      projectName: project.name,
      summary: {
        // Number of line items (rows) in the inventory.
        rowCount: items.length,
        // Going-aware topline figures, identical to the app's project page:
        // totalItems counts going non-box units, totalBoxes going box units,
        // volume/weight include recommended boxes (the *WithoutRecommendedBoxes
        // variants exclude them).
        totalItems: stats.totalItems,
        totalBoxes: stats.totalBoxes,
        totalCuft: stats.totalCuft,
        totalWeightLbs: stats.totalWeight,
        totalCuftWithoutRecommendedBoxes: stats.totalCuftWithoutRecommended,
        totalWeightLbsWithoutRecommendedBoxes: stats.totalWeightWithoutRecommended,
        totalRooms: stats.totalRooms,
      },
      items: items.map(item => {
        const quantity = Math.max(1, item.quantity || 1);
        const goingQuantity = deriveGoingQuantity(item);
        const cuftPerUnit = item.cuft || 0;
        const weightPerUnitLbs = resolveItemWeight(item, weightConfig);
        return {
          id: item._id.toString(),
          name: item.name,
          description: item.description || null,
          room: item.location || null,
          category: item.category || null,
          quantity,
          going: item.going || 'going',
          goingQuantity,
          cuftPerUnit: round2(cuftPerUnit),
          totalCuft: round2(cuftPerUnit * quantity),
          weightPerUnitLbs: round2(weightPerUnitLbs),
          totalWeightLbs: round2(weightPerUnitLbs * quantity),
          itemType: item.itemType || 'regular_item',
          isBox: isBoxItem(item),
          fragile: !!item.fragile,
          packedBy: item.packed_by || 'N/A',
          specialHandling: item.special_handling || null,
          boxRecommendation: item.box_recommendation
            ? {
                boxType: item.box_recommendation.box_type,
                boxQuantity: item.box_recommendation.box_quantity,
                boxDimensions: item.box_recommendation.box_dimensions,
              }
            : null,
          tags: item.tags || [],
          aiGenerated: !!item.ai_generated,
          sourceType: item.sourceType || null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
    });
  } catch (error) {
    console.error('Error in GET /api/external/projects/[projectId]/inventory:', error);
    return externalApiError(500, 'Internal server error', 'Failed to fetch inventory. Please try again later.');
  }
}
