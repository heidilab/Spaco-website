/**
 * Daily cron — sweeps every confirmed booking ≤ 2 days from today and either
 * generates the TTLock passcode or sends a balance reminder, whichever
 * applies. Idempotent — safe to run multiple times per day.
 *
 * Triggered by Vercel Cron (vercel.json) at 09:00 HKT (= 01:00 UTC).
 *
 * Auth:  Vercel Cron always sends `Authorization: Bearer <CRON_SECRET>`.
 *        Dev / manual: hit /api/cron/lock-passcodes?key=<CRON_SECRET>.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sweepUpcomingBookings } from '@/lib/lockPasscode';

// Force the route onto the Node runtime — Firestore + Resend SDKs are
// Node-only and the TTLock helper uses `crypto.createHash`.
export const runtime = 'nodejs';
// Cron jobs can take longer than the default 10s on Hobby — bump to the
// max Hobby allows (60s). Pro plans can go higher if needed.
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — refuse to run rather than open the door.
    return false;
  }
  // Vercel Cron sends Authorization: Bearer <secret>
  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  // Manual trigger via ?key= for ops
  const key = req.nextUrl.searchParams.get('key');
  if (key === secret) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await sweepUpcomingBookings();
    return NextResponse.json({
      ok: true,
      runAt: new Date().toISOString(),
      ...summary,
    });
  } catch (err) {
    console.error('[cron/lock-passcodes] failed', err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
