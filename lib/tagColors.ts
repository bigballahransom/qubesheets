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

export function tagStyleFor(name: string): TagPalette {
  const key = (name || '').trim().toLowerCase();
  if (!key) return PALETTE[0];
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
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
