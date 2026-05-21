import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  pushBookingToCalendar, updateBookingOnCalendar, removeBookingFromCalendar,
} from '@/lib/googleCalendar';
import { BookingRecord, UserProfile } from '@/types';

// POST /api/google/push-booking { bookingId } → push booking to gcal,
// update booking with returned eventId.
//
// DELETE /api/google/push-booking?bookingId=... → remove from gcal.
//
// Uses Firebase Admin SDK (server-side, bypasses Firestore rules) because
// the route is invoked by client fetch() calls without forwarded auth tokens.
// This is consistent with how the Stripe webhook handles bookings.

export const runtime = 'nodejs';

async function loadBooking(bookingId: string): Promise<BookingRecord | null> {
  const snap = await adminDb.collection('bookings').doc(bookingId).get();
  if (!snap.exists) return null;
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

    // Auto-fill customerName from the user profile if not provided. This is
    // the common case when admin clicks "Push to Google Calendar" without
    // typing a name in.
    let resolvedName = customerName;
    if (!resolvedName && booking.userId) {
      try {
        const userSnap = await adminDb.collection('users').doc(booking.userId).get();
        const profile = userSnap.data() as UserProfile | undefined;
        resolvedName = profile?.displayName || undefined;
      } catch { /* profile read failed — push without name */ }
    }

    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/google/callback`;

    // When the booking already has an event id, UPDATE the event so
    // recent changes (new add-ons, refreshed totals, cleared balance)
    // show in the description. The previous "alreadyPushed no-op"
    // branch was the reason booking #6sURGgn9Pl's added BBQ never
    // surfaced on Google Calendar — admin clicked Push but the
    // endpoint short-circuited.
    if (booking.googleEventId) {
      await updateBookingOnCalendar(redirectUri, {
        booking, customerName: resolvedName, notes,
      });
      return NextResponse.json({ ok: true, eventId: booking.googleEventId, updated: true });
    }

    const eventId = await pushBookingToCalendar(redirectUri, {
      booking, customerName: resolvedName, notes,
    });
    if (!eventId) {
      // Google not connected or no calendar configured for venue — fine, skip.
      return NextResponse.json({ skipped: true });
    }
    await adminDb.collection('bookings').doc(bookingId).update({ googleEventId: eventId });
    return NextResponse.json({ ok: true, eventId, created: true });
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
    await adminDb.collection('bookings').doc(bookingId).update({ googleEventId: null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Remove failed' },
      { status: 500 },
    );
  }
}
