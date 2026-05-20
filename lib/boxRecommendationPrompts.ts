// lib/boxRecommendationPrompts.ts
//
// Hidden prompt templates that back the per-org "Box Recommendations" slider
// (settings page: /app/settings/box-recommendations/page.tsx; field:
// OrganizationSettings.boxRecommendationLevel; valid range 1..3).
//
// Each entry replaces the "3. BOX RECOMMENDATIONS (...)" section inside the
// larger AI prompt used by the Railway processors. Each prompt contains a
// {{BOX_TYPES_LIST}} placeholder that getBoxRecommendationPrompt() fills in
// from the org's saved boxTypes (or the canonical defaults).
//
// BOX_REC_CONFIG_SYNC — when editing this file, also edit the three
// Railway service copies at:
//   railway-call-service/box-recommendation-config.js
//   railway-video-service/box-recommendation-config.js
//   railway-sqs-service/box-recommendation-config.js

import { DEFAULT_BOX_TYPES, renderBoxTypesList, type BoxType } from './defaultBoxTypes';

export type BoxRecommendationLevel = 1 | 2 | 3;

// Level 1 — Competitive. Leaner-than-Balanced estimate. Parallel structure
// to BALANCED_PROMPT below, but every closed-storage assumption biases
// toward "lightly full" and every baseline range is roughly halved. Same
// box types, rules, and picture-box coverage — the cost-control lever is
// quantity, not category.
const COMPETITIVE_PROMPT = `3. BOX RECOMMENDATIONS (boxes_needed) — estimate the packing supplies the crew needs to bring. Be lean and competitive: customers compare quotes side-by-side and an inflated box count can lose the bid. Recommend only what visible inventory clearly justifies; don't pad closed-storage assumptions.

   ## HOW TO ESTIMATE STORAGE CONTENTS
   - Count loose items you can SEE on desks, tables, counters, open shelves, and inside any OPEN drawers / cabinets / closets.
   - For CLOSED storage you can't see into: assume the contents are LIGHTLY FILLED — about a third full on average. Use the per-piece baselines below; lean toward the LOWER end of each range when contents are unknown.
   - If you can SEE storage is empty or sparsely filled, drop the recommendation to zero for that piece.
   - If you can SEE storage is clearly stuffed full, you may go up to the higher end of the range — but do not exceed it.
   - If the customer has already PACKED boxes (visible in packed_boxes for that area), reduce or skip the recommendation for that storage — that work is already done.
   - Do NOT recommend any boxes for items in furniture_items, packed_boxes, or the "NEVER inventory" list. Those are handled separately.

   ## ARTWORK / PICTURES / WALL MIRRORS — ALWAYS PICTURE BOXES (never furniture)
   - EVERY framed picture, photo, print, poster, painting, and standard wall mirror needs a Picture Box. Count one Picture Box per visible piece (or group small same-size pieces together — Picture Box holds multiple flat items).
   - These are NOT inventoried as furniture. They go here, in boxes_needed, with box_type set to "Picture Box".
   - The only exception is OVERSIZED wall art that physically won't fit in a Picture Box (over ~4 ft × 3 ft) — that one goes in furniture_items.
   - Scan walls deliberately for art; it's the most commonly missed category. (Picture boxes are NOT a cost-control lever — don't trim artwork.)

   ## BASELINE QUANTITIES PER STORAGE PIECE (calibrated to lightly filled; lean toward the lower end when storage is closed)
   - Dresser (6 drawers): 2-4 Medium Boxes
   - Nightstand (2 drawers): 1 Small Box
   - Desk (3 drawers): 1-2 Small Boxes
   - Filing cabinet (4 drawers): 2-3 Book Boxes
   - China cabinet: 1-2 Dish Packs
   - Bookshelf (5 shelves): 2-3 Book Boxes (only count shelves you can SEE have books; a clearly decorative/empty shelf is zero)
   - Entertainment center: 1-2 Medium Boxes
   - Kitchen cabinets: 1-2 Dish Packs for dish/glassware cabinets, 1-2 Medium Boxes per visible dry-goods cabinet
   - Bathroom vanity: 1 Small Box
   - Closet: 1-2 Wardrobe Boxes for hanging clothes if visible, 1 Medium / Large Box for visible folded items

   ## VISIBLE LOOSE ITEMS (count what you actually see — don't skip these)
   - Office desk items: keyboards, mice, monitor cables, desk lamps, office supplies, papers, files
   - Living room items: remotes, books, DVDs, games, decorations, photo frames
   - Kitchen counter items: small appliances, utensils, dish towels, food items
   - Bathroom items: toiletries, medicines, towels, bathroom accessories

   ## SANITY CHECK BEFORE RETURNING
   - Rough benchmarks (lean): a 1-bedroom apartment is around 15-25 boxes, a 3-bedroom 2-bath home is around 35-55 boxes, a 4+ bedroom larger home is around 60-95 boxes.
   - If your total is well above these ranges, look for line items you cannot justify from visible inventory and trim them. Closed-storage estimates are the first place to cut.
   - If your total is well below the range, double-check that you counted picture boxes (artwork) and wardrobe boxes for visible hanging clothes — those are the lean version's commonly-missed line items, not closed-storage padding.

   ## BOX TYPES — USE EXACT NAMES AND CAPACITIES
{{BOX_TYPES_LIST}}

   BOX-RECS RULES:
   1. Use ONLY these exact box type names (no variations, no plurals).
   2. capacity_cuft MUST match the value listed above.
   3. Never exceed 50 lbs per box — use smaller boxes for heavy items.
   4. Combine same-type same-room recommendations into ONE entry — e.g. if the office needs 2 Medium Boxes for desk drawers + 1 Medium Box for the shelf, output ONE row of Medium Box × 3 in the office, not multiple rows.
   5. boxes_needed is the ONLY place these recommendations go. Do NOT also list them as furniture or packed_boxes.`;

// Level 2 — Balanced. Mirrors the current Railway baseline prompt in
// call-segment-processor.js (lines 362-416). Captured here so the runtime
// swap can be data-driven without grepping the live worker.
const BALANCED_PROMPT = `3. BOX RECOMMENDATIONS (boxes_needed) — estimate the packing supplies the crew needs to bring. Be realistic: don't worst-case it, but don't shortchange the crew either. Customers and crews both lose when the estimate is too low.

   ## HOW TO ESTIMATE STORAGE CONTENTS
   - Count loose items you can SEE on desks, tables, counters, open shelves, and inside any OPEN drawers / cabinets / closets.
   - For CLOSED storage you can't see into: assume the contents are HALF TO MOSTLY FULL — closets, dressers, kitchen cabinets, and filing cabinets are rarely empty. Use the per-piece baselines below; lean toward the HIGHER end of each range when contents are unknown.
   - If you can SEE storage is empty or sparsely filled, reduce the recommendation toward zero for that piece.
   - If you can SEE storage is clearly stuffed full, you may go above the baseline range.
   - If the customer has already PACKED boxes (visible in packed_boxes for that area), reduce or skip the recommendation for that storage — that work is already done.
   - Do NOT recommend any boxes for items in furniture_items, packed_boxes, or the "NEVER inventory" list. Those are handled separately.

   ## ARTWORK / PICTURES / WALL MIRRORS — ALWAYS PICTURE BOXES (never furniture)
   - EVERY framed picture, photo, print, poster, painting, and standard wall mirror needs a Picture Box. Count one Picture Box per visible piece (or group small same-size pieces together — Picture Box holds multiple flat items).
   - These are NOT inventoried as furniture. They go here, in boxes_needed, with box_type set to "Picture Box".
   - The only exception is OVERSIZED wall art that physically won't fit in a Picture Box (over ~4 ft × 3 ft) — that one goes in furniture_items.
   - Scan walls deliberately for art; it's the most commonly missed category.

   ## BASELINE QUANTITIES PER STORAGE PIECE (calibrated to half-to-mostly full; lean toward the higher end when storage is closed)
   - Dresser (6 drawers): 4-7 Medium Boxes
   - Nightstand (2 drawers): 1-2 Small Boxes
   - Desk (3 drawers): 2-3 Small Boxes
   - Filing cabinet (4 drawers): 3-5 Book Boxes
   - China cabinet: 2-3 Dish Packs
   - Bookshelf (5 shelves): 3-6 Book Boxes (only count shelves you can SEE have books; a clearly decorative/empty shelf is zero)
   - Entertainment center: 2-3 Medium Boxes
   - Kitchen cabinets: 2-3 Dish Packs for dish/glassware cabinets, 2-3 Medium Boxes per visible dry-goods cabinet
   - Bathroom vanity: 1-2 Small Boxes
   - Closet: 2-3 Wardrobe Boxes for hanging clothes if visible, 1-2 Medium / Large Boxes for visible folded items

   ## VISIBLE LOOSE ITEMS (count what you actually see — don't skip these)
   - Office desk items: keyboards, mice, monitor cables, desk lamps, office supplies, papers, files
   - Living room items: remotes, books, DVDs, games, decorations, photo frames
   - Kitchen counter items: small appliances, utensils, dish towels, food items
   - Bathroom items: toiletries, medicines, towels, bathroom accessories

   ## SANITY CHECK BEFORE RETURNING
   - Rough benchmarks: a 1-bedroom apartment is around 20-35 boxes, a 3-bedroom 2-bath home is around 50-85 boxes, a 4+ bedroom larger home is around 85-130 boxes.
   - If your total is well below the range for the home size you saw, look back — you probably missed picture boxes (artwork), wardrobe boxes for closets, or contents of closed storage.
   - If your total is well above the range, look for line items you cannot justify and trim them.

   ## BOX TYPES — USE EXACT NAMES AND CAPACITIES
{{BOX_TYPES_LIST}}

   BOX-RECS RULES:
   1. Use ONLY these exact box type names (no variations, no plurals).
   2. capacity_cuft MUST match the value listed above.
   3. Never exceed 50 lbs per box — use smaller boxes for heavy items.
   4. Combine same-type same-room recommendations into ONE entry — e.g. if the office needs 2 Medium Boxes for desk drawers + 1 Medium Box for the shelf, output ONE row of Medium Box × 3 in the office, not multiple rows.
   5. boxes_needed is the ONLY place these recommendations go. Do NOT also list them as furniture or packed_boxes.`;

// Level 3 — Padded. Adds a buffer on top of the inventory so the crew
// rarely runs short. Assumes closed storage is full and biases upward on
// every per-piece baseline range.
const PADDED_PROMPT = `3. CALCULATE BOXES NEEDED for all loose/unpacked items:
   Group similar items and determine optimal box distribution.

   IMPORTANT: All small items visible on desks, tables, counters, shelves belong HERE (not in furniture_items):
   - Office desk items: keyboards, mice, monitors cables, desk lamps, office supplies, papers, files
   - Living room items: remotes, books, DVDs, games, decorations, photo frames
   - Kitchen counter items: small appliances, utensils, dish towels, food items
   - Bathroom items: toiletries, medicines, towels, bathroom accessories

   CRITICAL - ESTIMATE CONTENTS OF ALL STORAGE FURNITURE:
   For EVERY dresser, cabinet, drawer unit, nightstand, desk, or storage furniture you list, ALSO estimate boxes needed to pack their contents:
   - Dresser (6 drawers): Add 6-12 Medium Boxes for clothing
   - Nightstand (2 drawers): Add 1-2 Small Boxes for personal items
   - Desk (3 drawers): Add 2-3 Small Boxes for office supplies, files
   - Filing cabinet (4 drawers): Add 4-8 Book Boxes for files/documents
   - China cabinet: Add 2-4 Dish Packs for dishes/glassware
   - Bookshelf (5 shelves): Add 5-10 Book Boxes for books
   - Entertainment center: Add 2-4 Medium Boxes for media, games, electronics
   - Kitchen cabinets: Add Dish Packs for dishes, Medium Boxes for dry goods
   - Bathroom vanity: Add 1-2 Small Boxes for toiletries
   - Closets: Add Wardrobe Boxes for hanging clothes, Medium/Large for folded items

   ASSUME ALL DRAWERS AND CABINETS ARE FULL - customers rarely have empty storage!

   Available box types with EXACT, NON-NEGOTIABLE names and capacities:
{{BOX_TYPES_LIST}}

   CRITICAL BOX REQUIREMENTS:
   1. Use ONLY these exact box type names in quotes (no variations, no plurals)
   2. Use ONLY these exact capacity values (do NOT modify or estimate different capacities)
   3. capacity_cuft MUST match the exact value listed above
   4. Never exceed 50 lbs per box - use smaller boxes for heavy items

   BE GENEROUS WITH BOX ESTIMATES - it's better to overestimate than underestimate:
   - Kitchen drawers: estimate 1-2 Small Boxes per drawer for utensils/tools
   - Kitchen cabinets: estimate 1-2 Dish Packs per cabinet for dishes/glassware, Medium Boxes for dry goods
   - Dresser drawers: estimate 1-2 Medium Boxes per drawer for clothing
   - Bathroom cabinets: estimate 1-2 Small Boxes for toiletries/supplies
   - Desk drawers: estimate 1 Small Box per drawer for office supplies
   - Closets: estimate Wardrobe Boxes for hanging clothes, Medium/Large Boxes for folded items
   - Pantry: estimate Medium Boxes for food items
   - Garage shelving: estimate Medium/Large Boxes based on visible contents
   - Bookshelves: estimate Book Boxes based on number of books visible
   - Entertainment centers: estimate Medium Boxes for media, cables, games`;

export const BOX_RECOMMENDATION_PROMPTS: Record<BoxRecommendationLevel, string> = {
  1: COMPETITIVE_PROMPT,
  2: BALANCED_PROMPT,
  3: PADDED_PROMPT
};

export const DEFAULT_BOX_RECOMMENDATION_LEVEL: BoxRecommendationLevel = 2;

// Disabled stub — emitted when an org has switched box recommendations off
// via OrganizationSettings.boxRecommendationsEnabled = false. Explicit
// negative instruction is more reliable than an empty section: telling the
// model "return []" keeps the JSON contract intact and prevents the AI from
// guessing boxes anyway.
export const BOX_RECOMMENDATIONS_DISABLED_PROMPT = `3. BOX RECOMMENDATIONS — DISABLED FOR THIS ORGANIZATION.
   Do NOT recommend any packing boxes for this estimate. The "boxes_needed" array MUST be empty ([]). Continue capturing furniture_items and packed_boxes normally — the disable only applies to NEW box-pack recommendations, not to boxes the customer already packed.`;

// Returns the prompt for the requested level with the {{BOX_TYPES_LIST}}
// placeholder substituted from the org's boxTypes (or DEFAULT_BOX_TYPES if
// none were saved). When enabled is explicitly false, returns the disabled
// stub instead — no level / box-types substitution happens. Falls back to
// the Balanced default when the level is unknown.
export function getBoxRecommendationPrompt(
  level: number | undefined | null,
  boxTypes?: BoxType[] | null,
  enabled: boolean = true
): string {
  if (enabled === false) {
    return BOX_RECOMMENDATIONS_DISABLED_PROMPT;
  }
  const fallback = BOX_RECOMMENDATION_PROMPTS[DEFAULT_BOX_RECOMMENDATION_LEVEL];
  let template: string;
  if (level !== 1 && level !== 2 && level !== 3) {
    template = fallback || PADDED_PROMPT;
  } else {
    template = BOX_RECOMMENDATION_PROMPTS[level] || fallback || PADDED_PROMPT;
  }
  const list = boxTypes && boxTypes.length > 0 ? boxTypes : DEFAULT_BOX_TYPES;
  return template.replace('{{BOX_TYPES_LIST}}', renderBoxTypesList(list));
}
