// lib/vaultUploadForm.ts
// Sanitizes client-supplied custom vault-form answers into the canonical
// { fieldId, label, value } array stored on media docs. Built-in fieldIds
// ('title'/'description') are excluded — those travel as label /
// mediaDescription. Empty values are dropped; labels are denormalized at
// capture time so display survives later edits to the org's form config.
export interface VaultFormValue {
  fieldId: string;
  label: string;
  value: string;
}

export function sanitizeVaultFormValues(raw: unknown): VaultFormValue[] | undefined {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(parsed)) return undefined;
  const out: VaultFormValue[] = [];
  for (const entry of parsed.slice(0, 20)) {
    if (!entry || typeof entry !== 'object') continue;
    const fieldId =
      typeof (entry as any).fieldId === 'string' ? (entry as any).fieldId.trim().slice(0, 60) : '';
    const label =
      typeof (entry as any).label === 'string' ? (entry as any).label.trim().slice(0, 80) : '';
    const value =
      typeof (entry as any).value === 'string' ? (entry as any).value.trim().slice(0, 500) : '';
    if (!fieldId || !label || !value) continue;
    if (fieldId === 'title' || fieldId === 'description') continue;
    out.push({ fieldId, label, value });
  }
  return out.length > 0 ? out : undefined;
}
