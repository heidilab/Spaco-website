import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { adminDb } from '@/lib/firebaseAdmin';
import { restoreBlockedSlotsIfMissing } from '@/lib/finalizeBooking';
import { consumeBookingRewards } from '@/lib/bookingRewards';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';

/**
 * POST /api/admin/booking-confirmed { bookingId }
 *
 * The server-side half of a staff member confirming a booking by hand
 * (status dropdown, bookings-list approve, receipt approval). The status
 * flip itself still happens in the browser; this makes the consequences
 * happen once, server-side:
 *   • blocked_slots rebuilt if the expiry cron had removed them — with a
 *     conflict check (site review 2026-11-13 #4/#5);
 *   • loyalty points and the promo code consumed (#6).
 * Idempotent: safe to call again.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;
  const { bookingId } = await req.json().catch(() => ({}));
  if (typeof bookingId !== 'string' || !bookingId) {
    return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  }
  const snap = await adminDb.collection('bookings').doc(bookingId).get();
  if (!snap.exists) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  const booking = { id: snap.id, ...snap.data() } as BookingRecord;
  if (!['confirmed', 'completed'].includes(booking.status)) {
    return NextResponse.json({ ok: true, skipped: 'not-confirmed', status: booking.status });
  }
  const slots = await restoreBlockedSlotsIfMissing(booking);
  const rewards = await consumeBookingRewards(bookingId);
  return NextResponse.json({ ok: true, slots, rewards });
}
