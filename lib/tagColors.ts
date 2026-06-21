// lib/tagColors.ts
// Stable color assignment for Smart Tags. The same tag name always renders in
// the same palette slot so chips stay recognizable across the spreadsheet,
// settings page, and review screens.

export type TagPalette = {
  bg: string;
  text: string;
  border: string;
  hoverBg: string;
  ring: string;
};

const PALETTE: TagPalette[] = [
  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200',  hoverBg: 'hover:bg-indigo-100',  ring: 'ring-indigo-200' },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', hoverBg: 'hover:bg-emerald-100', ring: 'ring-emerald-200' },
  { bg: 'bg-amber-50',   text: 'text-amber-800',   border: 'border-amber-200',   hoverBg: 'hover:bg-amber-100',   ring: 'ring-amber-200' },
  { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    hoverBg: 'hover:bg-rose-100',    ring: 'ring-rose-200' },
  { bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-200',     hoverBg: 'hover:bg-sky-100',     ring: 'ring-sky-200' },
  { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  hoverBg: 'hover:bg-violet-100',  ring: 'ring-violet-200' },
  { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200',    hoverBg: 'hover:bg-teal-100',    ring: 'ring-teal-200' },
  { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200',  hoverBg: 'hover:bg-orange-100',  ring: 'ring-orange-200' },
];

// PDF (jsPDF) palette — RGB triples that visually match the Tailwind classes
// in PALETTE, slot-for-slot. Used by the project PDF generator so tag chips
// drawn in the table look like their on-screen counterparts. Values are
// sampled from the same Tailwind shades (50 bg / 200 border / 700-or-800 text).
export type TagRgbPalette = {
  bg: [number, number, number];
  text: [number, number, number];
  border: [number, number, number];
};

const RGB_PALETTE: TagRgbPalette[] = [
  // indigo
  { bg: [238, 242, 255], text: [67, 56, 202],  border: [199, 210, 254] },
  // emerald
  { bg: [236, 253, 245], text: [4, 120, 87],   border: [167, 243, 208] },
  // amber
  { bg: [255, 251, 235], text: [146, 64, 14],  border: [253, 230, 138] },
  // rose
  { bg: [255, 241, 242], text: [190, 18, 60],  border: [254, 205, 211] },
  // sky
  { bg: [240, 249, 255], text: [3, 105, 161],  border: [186, 230, 253] },
  // violet
  { bg: [245, 243, 255], text: [109, 40, 217], border: [221, 214, 254] },
  // teal
  { bg: [240, 253, 250], text: [15, 118, 110], border: [153, 246, 228] },
  // orange
  { bg: [255, 247, 237], text: [194, 65, 12],  border: [254, 215, 170] },
];

// Shared hash so tagStyleFor and tagRgbFor pick the same palette slot.
function paletteIndex(name: string): number {
  const key = (name || '').trim().toLowerCase();
  if (!key) return 0;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % PALETTE.length;
}

export function tagStyleFor(name: string): TagPalette {
  return PALETTE[paletteIndex(name)];
}

export function tagRgbFor(name: string): TagRgbPalette {
  return RGB_PALETTE[paletteIndex(name)];
}

export function parseTagsCell(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function stringifyTags(tags: string[]): string {
  return tags.map((t) => t.trim()).filter(Boolean).join(', ');
}
