import { NextRequest, NextResponse } from 'next/server';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  pushBookingToCalendar, removeBookingFromCalendar,
} from '@/lib/googleCalendar';
import { BookingRecord } from '@/types';

// POST /api/google/push-booking { bookingId } → push booking to gcal,
// update booking with returned eventId.
//
// DELETE /api/google/push-booking?bookingId=... → remove from gcal.
//
// (Authorisation note: these endpoints rely on Firestore rules + the booking
// containing the user's uid; staff sessions also have full update rights.
// Either way the underlying writes go through normal Firestore client
// auth — the route just orchestrates the gcal calls.)

async function loadBooking(bookingId: string): Promise<BookingRecord | null> {
  const snap = await getDoc(doc(db, 'bookings', bookingId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as BookingRecord;
}

export async function POST(req: NextRequest) {
  try {
    const { bookingId, customerName, notes } = await req.json();
    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
    }
    const booking = await loadBooking(bookingId);
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    if (booking.googleEventId) {
      // Already pushed — no-op (idempotent).
      return NextResponse.json({ alreadyPushed: true, eventId: booking.googleEventId });
    }

    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/google/callback`;
    const eventId = await pushBookingToCalendar(redirectUri, {
      booking, customerName, notes,
    });
    if (!eventId) {
      // Google not connected or no calendar configured for venue — fine, skip.
      return NextResponse.json({ skipped: true });
    }
    await updateDoc(doc(db, 'bookings', bookingId), { googleEventId: eventId });
    return NextResponse.json({ ok: true, eventId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Push failed' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const bookingId = req.nextUrl.searchParams.get('bookingId');
    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
    }
    const booking = await loadBooking(bookingId);
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    if (!booking.googleEventId) return NextResponse.json({ skipped: true });

    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/google/callback`;
    await removeBookingFromCalendar(redirectUri, {
      venueId: booking.venueId,
      googleEventId: booking.googleEventId,
    });
    await updateDoc(doc(db, 'bookings', bookingId), { googleEventId: null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Remove failed' },
      { status: 500 },
    );
  }
}
