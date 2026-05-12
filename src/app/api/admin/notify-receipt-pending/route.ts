import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { sendStaffReceiptPendingNotification } from '@/lib/emailAutomations';
import { getVenueById } from '@/lib/venues';
import type { BookingRecord, UserProfile } from '@/types';

// POST /api/admin/notify-receipt-pending { bookingId }
// Fired the moment a customer uploads an offline-payment receipt — the
// booking is now in `awaiting_review` and admin/CS need to act on it.
// Same recipient list and toggle pattern as the booking-confirmed
// notification (see /api/admin/notify-booking).

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { bookingId } = await req.json();
    if (!bookingId) {
      return NextResponse.json({ error: 'Missing bookingId' }, { status: 400 });
    }

    const snap = await adminDb.collection('bookings').doc(bookingId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    const booking = { id: snap.id, ...snap.data() } as BookingRecord;

    if (!booking.receiptUrl) {
      return NextResponse.json({ error: 'No receipt uploaded yet' }, { status: 400 });
    }

    let profile: UserProfile | undefined;
    if (booking.userId) {
      const userSnap = await adminDb.collection('users').doc(booking.userId).get();
      profile = userSnap.data() as UserProfile | undefined;
    }

    const venue = getVenueById(booking.venueId);
    const origin = req.nextUrl.origin;

    await sendStaffReceiptPendingNotification({
      bookingId: booking.id,
      venueName: venue?.name.zh || booking.branchSlug,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      endDate: booking.endDate,
      guestCount: booking.guestCount,
      amountDue: booking.pricing.deposit,
      customerName: profile?.displayName || '—',
      customerEmail: profile?.email,
      whatsappPhone: booking.whatsappPhone,
      receiptUrl: booking.receiptUrl,
      adminUrl: `${origin}/zh/admin/receipts`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Notify failed' },
      { status: 500 },
    );
  }
}
