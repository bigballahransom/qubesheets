// lib/onsite-walkthrough/livekit.ts
// Helpers scoped to the onsite-walkthrough feature. P1a only needs the
// room-name generator. LiveKit token issuance + egress wiring lands in P1b.
import crypto from 'crypto';

export const ONSITE_ROOM_PREFIX = 'onsite-walkthrough-';

/**
 * Generate a unique LiveKit room name for an onsite walkthrough session.
 * Prefix lets the LiveKit webhook router and any future agent config match
 * onsite-walkthrough rooms with one rule.
 */
export function generateOnsiteRoomName(): string {
  const suffix = crypto.randomBytes(12).toString('hex');
  return `${ONSITE_ROOM_PREFIX}${suffix}`;
}

export function isOnsiteRoomName(name: string | undefined | null): boolean {
  return !!name && name.startsWith(ONSITE_ROOM_PREFIX);
}
