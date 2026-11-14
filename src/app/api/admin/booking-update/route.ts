import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { loadAddOnConfigServer } from '@/lib/addOnConfigServer';
import { loadBookingRulesServer } from '@/lib/bookingRulesServer';
import { loadPackagesServer } from '@/lib/packageRegistryServer';
import { updateBookingServer, followUpAfterEdit, BookingEditError, type BookingEditInput } from '@/lib/bookingEditServer';
import { getPublicOrigin } from '@/lib/kpay';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/booking-update { bookingId, ...BookingEditInput, email?: boolean }
 *
 * The staff edit of a booking (date / time / venue / guests / add-ons /
 * overrides), on the server in one transaction (lib/bookingEditServer),
 * then the passcode, the customer's update email (default on) and the
 * Calendar event. Replaces lib/firestore.updateBookingDateTime + the
 * follow-up call from the browser.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;
  const body = await req.json().catch(() => ({})) as Partial<BookingEditInput> & { bookingId?: string; email?: boolean };
  if (!body.bookingId || typeof body.date !== 'string' || typeof body.startTime !== 'string' || typeof body.endTime !== 'string') {
    return NextResponse.json({ error: 'bookingId, date, startTime and endTime required' }, { status: 400 });
  }
  await loadAddOnConfigServer();
  await loadBookingRulesServer();
  await loadPackagesServer();
  const { bookingId, email, ...next } = body;
  try {
    const r = await updateBookingServer(bookingId, next as BookingEditInput, { actorUid: gate.uid });
    const follow = await followUpAfterEdit(bookingId, getPublicOrigin(req.nextUrl.origin), {
      previousSnapshot: r.before, email: email !== false, updatedBalance: r.balanceDue ?? null,
    });
    return NextResponse.json({ ...r, effects: follow.effects, errors: follow.errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed';
    const known = err instanceof BookingEditError;
    return NextResponse.json({ error: msg }, { status: msg === 'BOOKING_NOT_FOUND' ? 404 : msg.startsWith('SLOT_CONFLICT') ? 409 : known ? 400 : 500 });
  }
}
