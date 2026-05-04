// lib/selfServeEgress.ts
// Shared LiveKit egress client + helpers for the self-serve recording flow.
//
// Why this exists: the LiveKit Cloud project has auto-room-recording enabled
// at the project level (out of our control). It fires a roomComposite egress
// with no S3 destination as soon as a track publishes, racing with our
// explicit egress. We need centralized, defensive helpers to:
//   1. Identify "our" egresses by egressId only (positive allowlist).
//   2. Stop unknown orphan egresses without polluting the DB or SQS.
import { EgressClient } from 'livekit-server-sdk';

export const egressClient = new EgressClient(
  process.env.LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!
);

/**
 * Stop an egress that we believe is an orphan (started by LiveKit project-level
 * auto-egress, not by our /start-recording route). Tolerates "already stopped"
 * and "not found" errors which are expected when racing the orphan's natural
 * end or another concurrent stop.
 */
export async function safeStopOrphan(egressId: string, reason: string): Promise<void> {
  try {
    await egressClient.stopEgress(egressId);
    console.warn(`  ✓ Stopped orphan ${egressId} (reason: ${reason})`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('not found') || msg.includes('not active') || msg.includes('already')) {
      console.log(`  ⏭ Orphan ${egressId} already stopped/not active (reason: ${reason})`);
      return;
    }
    console.error(`  ✗ Failed to stop orphan ${egressId} (reason: ${reason}):`, msg);
  }
}
