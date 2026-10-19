// lib/external-inventory-payload.ts
//
// Builds the partner-facing inventory payload used by BOTH:
//   - GET /api/external/projects/:projectId/inventory (polling)
//   - outbound inventory.ready webhooks (lib/outbound-webhooks.ts)
// One builder so the pushed payload is byte-identical in shape to the GET
// response partners already integrate against.
//
// Items expose per-unit AND total cuft/weight explicitly (item.cuft/.weight
// are stored per-unit - totals are always per-unit × quantity). The summary
// block is computed by lib/inventory-stats.ts, the same code path as the
// project page, review links, and PDFs, so partners see the numbers the org
// sees in the app.

import InventoryItem from '@/models/InventoryItem';
import { computeInventoryStats, deriveGoingQuantity, isBoxItem } from '@/lib/inventory-stats';
import { resolveWeightConfig, resolveItemWeight } from '@/lib/weight-config';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ExternalInventoryPayloadInput {
  /** Project document (needs _id, name, weightMode, customWeightMultiplier). */
  project: any;
  organizationId: string;
}

export async function buildExternalInventoryPayload({
  project,
  organizationId,
}: ExternalInventoryPayloadInput) {
  const weightConfig = await resolveWeightConfig({
    project: {
      weightMode: project.weightMode,
      customWeightMultiplier: project.customWeightMultiplier,
    },
    organizationId,
  });

  const items = await InventoryItem.find({ projectId: project._id })
    .sort({ location: 1, createdAt: 1 })
    .lean<any[]>();

  const stats = computeInventoryStats(items, weightConfig);

  return {
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
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }),
  };
}
