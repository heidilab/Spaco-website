import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { cancelBookingServer } from '@/lib/bookingLifecycle';
import { getPublicOrigin } from '@/lib/kpay';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/booking-cancel { bookingId, actorEmail?, actorName? }
 *
 * The one way staff cancel a booking (site review 2026-11-13, phase 5):
 * status + audit + blocked_slots + rewards back in one transaction, then
 * Calendar / passcode / email, each recorded on the booking. Safe to
 * repeat — a second call only retries what failed.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({})) as { bookingId?: string; actorEmail?: string; actorName?: string };
  if (!body.bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  try {
    const result = await cancelBookingServer(
      body.bookingId,
      { uid: gate.uid, email: typeof body.actorEmail === 'string' ? body.actorEmail.slice(0, 200) : undefined, displayName: typeof body.actorName === 'string' ? body.actorName.slice(0, 100) : undefined },
      getPublicOrigin(req.nextUrl.origin),
    );
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    return NextResponse.json({ error: msg }, { status: msg === 'BOOKING_NOT_FOUND' ? 404 : 500 });
  }
}
