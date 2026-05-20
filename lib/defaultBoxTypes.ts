// lib/defaultBoxTypes.ts
//
// The eight canonical box types used by the Railway box-recommendation
// prompts (see lib/boxRecommendationPrompts.ts). These are the defaults a
// mover sees on /settings/box-types before they customize. Once they save
// their first edit, the org's persisted list overrides these.
//
// When runtime wiring lands, the AI prompt's "BOX TYPES — USE EXACT NAMES
// AND CAPACITIES" section will be rendered from the org's list (falling
// back to this module). Names, capacities, and descriptions here must
// stay consistent with the hardcoded entries currently inside each prompt
// variant in boxRecommendationPrompts.ts.

export interface BoxType {
  /** Stable id for React keys + reorder. Generated client-side on create. */
  id: string;
  /** Display + AI-prompt name. Must be unique within an org's list. */
  name: string;
  /** Capacity in cubic feet. AI is told this is exact. */
  capacityCuft: number;
  /** Parenthetical "for what" copy that follows the name in the prompt. */
  description: string;
}

export const DEFAULT_BOX_TYPES: BoxType[] = [
  {
    id: 'default-book-box',
    name: 'Book Box',
    capacityCuft: 1.0,
    description: 'books, tools, heavy items >40 lbs or >7 lbs/cuft'
  },
  {
    id: 'default-small-box',
    name: 'Small Box',
    capacityCuft: 1.5,
    description: 'canned goods, small heavy items, files'
  },
  {
    id: 'default-medium-box',
    name: 'Medium Box',
    capacityCuft: 3.0,
    description: 'kitchen items, toys, small appliances, general items'
  },
  {
    id: 'default-large-box',
    name: 'Large Box',
    capacityCuft: 4.5,
    description: 'lightweight bulky items, linens, lampshades'
  },
  {
    id: 'default-extra-large-box',
    name: 'Extra Large Box',
    capacityCuft: 6.0,
    description: 'comforters, pillows, coats, very light items'
  },
  {
    id: 'default-wardrobe-box',
    name: 'Wardrobe Box',
    capacityCuft: 12.0,
    description: 'hanging clothes only'
  },
  {
    id: 'default-dish-pack',
    name: 'Dish Pack',
    capacityCuft: 5.2,
    description: 'dishes, glassware, fragile kitchen items'
  },
  {
    id: 'default-picture-box',
    name: 'Picture Box',
    capacityCuft: 4.5,
    description: 'artwork, mirrors, framed pictures, flat items'
  }
];

export const MAX_BOX_NAME_LENGTH = 64;
export const MAX_BOX_DESCRIPTION_LENGTH = 240;
export const MAX_BOX_CAPACITY_CUFT = 100;
export const MAX_BOX_TYPES_PER_ORG = 32;

// Renders the org's box-types list in the exact format the AI prompts
// expect (one bullet per type, name in double quotes, capacity always with
// at least one decimal, description in parentheses). Whole-number capacities
// keep a single trailing .0 to match the historic prompt format ("1.0",
// "12.0"); fractional capacities show their actual precision ("5.2",
// "0.75"). Used by getBoxRecommendationPrompt below and by every Railway
// worker that imports the duplicated config.
export function renderBoxTypesList(boxTypes: BoxType[]): string {
  const list = boxTypes && boxTypes.length > 0 ? boxTypes : DEFAULT_BOX_TYPES;
  return list
    .map((b) => {
      const capacity = b.capacityCuft % 1 === 0 ? b.capacityCuft.toFixed(1) : String(b.capacityCuft);
      const description = b.description?.trim();
      const suffix = description ? ` (${description})` : '';
      return `   - "${b.name}": EXACTLY ${capacity} cuft per box${suffix}`;
    })
    .join('\n');
}

// Sanitize + validate one entry. Returns null if it can't be made valid.
// Names get trimmed and stripped of newlines/quotes (those would break the
// AI prompt's box-types list formatting).
export function normalizeBoxType(raw: Partial<BoxType>): BoxType | null {
  const name = (raw.name ?? '').toString().replace(/["\r\n]/g, '').trim();
  if (!name || name.length > MAX_BOX_NAME_LENGTH) return null;

  const capacityCuft = Number(raw.capacityCuft);
  if (!Number.isFinite(capacityCuft) || capacityCuft <= 0 || capacityCuft > MAX_BOX_CAPACITY_CUFT) {
    return null;
  }

  const description = (raw.description ?? '').toString().replace(/[\r\n]/g, ' ').trim().slice(0, MAX_BOX_DESCRIPTION_LENGTH);
  const id = (raw.id ?? '').toString().trim() || `box-${Math.random().toString(36).slice(2, 10)}`;

  return { id, name, capacityCuft, description };
}
