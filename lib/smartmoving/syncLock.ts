// lib/smartmoving/syncLock.ts
//
// Serializes SmartMoving syncs per organization. All of an org's syncs share
// one SmartMoving subscription key with a ~120 req/min throttle, so two
// concurrent syncs (two reps, or auto-sync + manual) split the window and
// both slow down. The lease lives on the org's SmartMovingIntegration doc so
// it works across serverless instances.
import crypto from 'crypto';
import connectMongoDB from '@/lib/mongodb';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';

const LEASE_MS = 150_000; // generous upper bound for one diff sync
const POLL_MS = 3_000;
const MAX_WAIT_MS = 45_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs fn while holding the org's sync lease. Waits up to MAX_WAIT_MS for a
 * concurrent sync to finish; on timeout returns { acquired: false } without
 * running fn. Expired leases (crashed holders) are taken over.
 */
export async function withOrgSyncLock<T>(
  organizationId: string,
  fn: () => Promise<T>
): Promise<{ acquired: boolean; result?: T }> {
  await connectMongoDB();
  const token = crypto.randomUUID();
  const deadline = Date.now() + MAX_WAIT_MS;

  let acquired = false;
  while (!acquired) {
    const now = Date.now();
    const doc = await SmartMovingIntegration.findOneAndUpdate(
      {
        organizationId,
        $or: [
          { syncLockUntil: { $exists: false } },
          { syncLockUntil: null },
          { syncLockUntil: { $lt: now } },
        ],
      },
      { $set: { syncLockUntil: now + LEASE_MS, syncLockToken: token } },
      { new: true }
    );
    if (doc) {
      acquired = true;
      break;
    }
    if (Date.now() + POLL_MS > deadline) {
      return { acquired: false };
    }
    await sleep(POLL_MS);
  }

  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    // Release only if we still hold the lease (a takeover after expiry
    // must not have its lock cleared by the old holder)
    await SmartMovingIntegration.updateOne(
      { organizationId, syncLockToken: token },
      { $set: { syncLockUntil: 0 }, $unset: { syncLockToken: 1 } }
    ).catch(() => undefined);
  }
}
