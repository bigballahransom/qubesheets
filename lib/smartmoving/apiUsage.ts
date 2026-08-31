// lib/smartmoving/apiUsage.ts - fire-and-forget SmartMoving API call
// accounting (see models/SmartMovingApiUsage.ts for why).
import crypto from 'crypto';

export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

export function currentUsageMonth(): string {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM' UTC
}

/**
 * Record one outbound SmartMoving call. Never throws, never blocks the
 * caller — accounting must not be able to break a sync.
 */
export function recordSmartMovingCall(apiKey: string | undefined, was429: boolean): void {
  if (!apiKey) return;
  void (async () => {
    try {
      const [{ default: connectMongoDB }, { default: SmartMovingApiUsage }] = await Promise.all([
        import('@/lib/mongodb'),
        import('@/models/SmartMovingApiUsage'),
      ]);
      await connectMongoDB();
      await SmartMovingApiUsage.updateOne(
        { keyHash: hashApiKey(apiKey), month: currentUsageMonth() },
        { $inc: { calls: 1, throttled: was429 ? 1 : 0 } },
        { upsert: true }
      );
    } catch {
      // accounting is best-effort
    }
  })();
}

/** Monthly usage for an API key (for the integration settings page). */
export async function getMonthlyUsage(apiKey: string): Promise<{ month: string; calls: number; throttled: number }> {
  const month = currentUsageMonth();
  try {
    const [{ default: connectMongoDB }, { default: SmartMovingApiUsage }] = await Promise.all([
      import('@/lib/mongodb'),
      import('@/models/SmartMovingApiUsage'),
    ]);
    await connectMongoDB();
    const doc = await SmartMovingApiUsage.findOne({ keyHash: hashApiKey(apiKey), month }).lean() as any;
    return { month, calls: doc?.calls || 0, throttled: doc?.throttled || 0 };
  } catch {
    return { month, calls: 0, throttled: 0 };
  }
}
