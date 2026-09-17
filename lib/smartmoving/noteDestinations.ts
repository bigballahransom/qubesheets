/**
 * SmartMoving job-note sync destinations.
 *
 * Each piece of content the inventory sync can write into SmartMoving job
 * notes — the crew review link, the media vault links, and the three AI
 * walkthrough parts (summary, packing notes, customer statements) — is routed
 * to one of the SmartMoving note fields, or turned off entirely.
 *
 * Docs saved before these fields existed only have the legacy boolean flags
 * (syncCrewLinkOnSync / syncVaultLinksOnSync / syncAiSummariesOnSync);
 * resolveNoteSyncDestinations falls back to them so existing orgs keep their
 * behavior: an explicit `false` maps to 'off', anything else to the
 * historical hardcoded destination.
 */

export const NOTE_DESTINATIONS = ['off', 'internal', 'customer', 'crew'] as const;

export type NoteDestination = (typeof NOTE_DESTINATIONS)[number];

/** A real SmartMoving note field — every destination except 'off'. */
export type NoteField = Exclude<NoteDestination, 'off'>;

export const NOTE_FIELDS: NoteField[] = ['internal', 'customer', 'crew'];

export interface NoteSyncDestinations {
  crewLinkDestination: NoteDestination;
  vaultLinksDestination: NoteDestination;
  aiSummaryDestination: NoteDestination;
  packingNotesDestination: NoteDestination;
  customerStatementsDestination: NoteDestination;
}

/** Matches the pre-destination-field behavior: links → crew, AI → internal. */
export const DEFAULT_NOTE_SYNC_DESTINATIONS: NoteSyncDestinations = {
  crewLinkDestination: 'crew',
  vaultLinksDestination: 'crew',
  aiSummaryDestination: 'internal',
  packingNotesDestination: 'internal',
  customerStatementsDestination: 'internal',
};

export function normalizeNoteDestination(
  value: unknown,
  fallback: NoteDestination
): NoteDestination {
  return NOTE_DESTINATIONS.includes(value as NoteDestination)
    ? (value as NoteDestination)
    : fallback;
}

/**
 * Resolves the five destination settings from an integration doc or a
 * settings request body, falling back per-piece to the legacy boolean flags
 * for sources that predate the destination fields.
 */
export function resolveNoteSyncDestinations(
  source:
    | {
        crewLinkDestination?: unknown;
        vaultLinksDestination?: unknown;
        aiSummaryDestination?: unknown;
        packingNotesDestination?: unknown;
        customerStatementsDestination?: unknown;
        syncCrewLinkOnSync?: unknown;
        syncVaultLinksOnSync?: unknown;
        syncAiSummariesOnSync?: unknown;
      }
    | null
    | undefined
): NoteSyncDestinations {
  const s = source || {};
  const legacyCrewLink: NoteDestination = s.syncCrewLinkOnSync === false ? 'off' : 'crew';
  const legacyVaultLinks: NoteDestination = s.syncVaultLinksOnSync === false ? 'off' : 'crew';
  const legacyAi: NoteDestination = s.syncAiSummariesOnSync === false ? 'off' : 'internal';

  return {
    crewLinkDestination: normalizeNoteDestination(s.crewLinkDestination, legacyCrewLink),
    vaultLinksDestination: normalizeNoteDestination(s.vaultLinksDestination, legacyVaultLinks),
    aiSummaryDestination: normalizeNoteDestination(s.aiSummaryDestination, legacyAi),
    packingNotesDestination: normalizeNoteDestination(s.packingNotesDestination, legacyAi),
    customerStatementsDestination: normalizeNoteDestination(s.customerStatementsDestination, legacyAi),
  };
}
