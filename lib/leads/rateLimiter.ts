// lib/leads/rateLimiter.ts
//
// IP-based per-form sliding-window rate limiter backed by a TTL collection.

import connectMongoDB from '@/lib/mongodb';
import LeadRateLimitBucket from '@/models/LeadRateLimitBucket';

const DEFAULT_LIMIT = 20;
const ONE_HOUR_MS = 60 * 60 * 1000;

export async function checkAndRecord(params: {
  ip: string;
  formConfigId: string;
  limit?: number;
}): Promise<{ allowed: boolean; remaining: number }> {
  const limit = params.limit ?? DEFAULT_LIMIT;
  const ip = params.ip;

  // Cannot meaningfully rate-limit a missing/unknown IP — better to allow than block.
  if (!ip || ip === 'unknown') {
    return { allowed: true, remaining: limit };
  }

  await connectMongoDB();

  const since = new Date(Date.now() - ONE_HOUR_MS);
  const count = await LeadRateLimitBucket.countDocuments({
    ip,
    formConfigId: params.formConfigId,
    createdAt: { $gte: since },
  });

  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  await LeadRateLimitBucket.create({
    ip,
    formConfigId: params.formConfigId,
  });

  return { allowed: true, remaining: limit - count - 1 };
}
