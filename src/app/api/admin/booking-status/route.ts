import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { setBookingStatusServer } from '@/lib/bookingLifecycle';
import { getPublicOrigin } from '@/lib/kpay';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/booking-status { bookingId, status, customerEmail?, actorEmail?, actorName? }
 *
 * The one way staff change a booking's status by hand (site review
 * 2026-11-13, phase 5; #4, #13): the status in a transaction, slots
 * restored (conflict-checked) or released with it, rewards consumed and
 * the confirmation effects run when it becomes confirmed, the Calendar
 * re-synced otherwise. `status: 'cancelled'` is the cancel flow.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({})) as { bookingId?: string; status?: string; customerEmail?: boolean; actorEmail?: string; actorName?: string };
  if (!body.bookingId || typeof body.status !== 'string') return NextResponse.json({ error: 'bookingId and status required' }, { status: 400 });
  try {
    const result = await setBookingStatusServer(
      body.bookingId, body.status,
      { uid: gate.uid, email: typeof body.actorEmail === 'string' ? body.actorEmail.slice(0, 200) : undefined, displayName: typeof body.actorName === 'string' ? body.actorName.slice(0, 100) : undefined },
      getPublicOrigin(req.nextUrl.origin),
      { customerEmail: body.customerEmail === true },
    );
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    const status = msg === 'BOOKING_NOT_FOUND' ? 404 : msg === 'INVALID_STATUS' ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
