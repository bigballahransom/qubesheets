// app/api/cron/webhook-delivery-sweeper/route.ts
//
// Vercel Cron (every 5 min, see vercel.json): the durability layer for
// outbound webhooks (lib/outbound-webhooks.ts). The trigger route sends
// inline after a holdoff; this sweeper (a) reclaims rows stuck in 'sending'
// (function froze mid-send), and (b) sends anything due - first attempts a
// frozen function dropped, plus scheduled retries of failed deliveries.

import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import { drainDueDeliveries, reclaimStuckDeliveries } from '@/lib/outbound-webhooks';

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  // Same auth pattern as the other crons (Bearer CRON_SECRET, enforced in
  // production only) - hardened: an UNSET secret rejects too, so a missing
  // env var can't leave the route open to "Bearer undefined".
  const authHeader = request.headers.get('authorization');
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Reclaim and drain are independently fallible - one phase failing must
  // never block the other (drain is what actually delivers).
  let reclaimed = 0;
  let reclaimError: string | null = null;
  try {
    await connectMongoDB();
    reclaimed = await reclaimStuckDeliveries();
  } catch (error) {
    reclaimError = error instanceof Error ? error.message : String(error);
    console.error('webhook-delivery-sweeper reclaim error:', error);
  }

  try {
    const counts = await drainDueDeliveries({ limit: 50 });
    if (reclaimed > 0 || counts.attempted > 0) {
      console.log('📤 webhook-delivery-sweeper:', { reclaimed, ...counts });
    }
    return NextResponse.json({ reclaimed, reclaimError, ...counts });
  } catch (error) {
    console.error('webhook-delivery-sweeper drain error:', error);
    return NextResponse.json({ error: 'Sweep failed', reclaimed, reclaimError }, { status: 500 });
  }
}
