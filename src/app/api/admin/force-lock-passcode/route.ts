import { NextRequest, NextResponse } from 'next/server';
import { processBookingForLockAccess } from '@/lib/lockPasscode';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/admin/force-lock-passcode?id=<bookingId>
 *
 * Diagnostic — runs the EXACT same processor that the cron + admin
 * "即時生成密碼" button call, surfacing the result directly. Safe to
 * call repeatedly (the inner logic is idempotent: bails if
 * passcode-exists / balance-due / window-not-open / etc).
 *
 * Use this when the cron silently fails on a specific booking and
 * we need to see the exact ProcessResult.reason/.error.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Allow 8-char prefix for convenience (mirrors booking-inspect).
  let resolvedId = id;
  if (id.length < 20) {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    const all = await adminDb.collection('bookings').get();
    const hit = all.docs.find((d) => d.id.startsWith(id));
    if (!hit) return NextResponse.json({ error: 'booking-not-found' }, { status: 404 });
    resolvedId = hit.id;
  }

  const result = await processBookingForLockAccess(resolvedId);
  return NextResponse.json({ id: resolvedId, result });
}
