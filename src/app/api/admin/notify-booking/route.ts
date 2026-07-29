import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { sendStaffBookingNotification, sendStaffSupplierOrderNotification } from '@/lib/emailAutomations';
import { getVenueById } from '@/lib/venues';
import { formatAddOnsForStaff } from '@/lib/pricing';
import type { BookingRecord, UserProfile } from '@/types';
import { requireAdmin } from '@/lib/adminAuth';

// POST /api/admin/notify-booking { bookingId }
// Triggered when admin manually confirms a booking. Sends the staff
// notification email to STAFF_NOTIFICATION_EMAILS recipients.
//
// Uses Firebase Admin SDK so it bypasses Firestore rules (the route is
// invoked by client fetch() without forwarded auth tokens). Idempotency
// is left to the caller — the email send is cheap and Resend dedupes
// on identical payloads anyway.

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const _gate = await requireAdmin(req, 'bookings');
  if (!_gate.ok) return _gate.res;

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

    let profile: UserProfile | undefined;
    if (booking.userId) {
      const userSnap = await adminDb.collection('users').doc(booking.userId).get();
      profile = userSnap.data() as UserProfile | undefined;
    }

    const venue = getVenueById(booking.venueId);
    const origin = req.nextUrl.origin;

    await sendStaffBookingNotification({
      bookingId: booking.id,
      venueName: venue?.name.zh || booking.branchSlug,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      endDate: booking.endDate,
      guestCount: booking.guestCount,
      adultCount: booking.adultCount,
      childCount: booking.childCount,
      customerName: profile?.displayName || '—',
      customerEmail: profile?.email,
      whatsappPhone: booking.whatsappPhone,
      subtotal: booking.pricing.subtotal,
      deposit: booking.pricing.deposit,
      securityDeposit: booking.pricing.securityDeposit,
      promoCode: booking.promoCode,
      promoDiscount: booking.promoDiscount,
      pointsDiscount: booking.pointsDiscount,
      balanceDue: booking.balanceDue ?? 0,
      addOnsLine: formatAddOnsForStaff(booking.addOns, 'zh'),
      hasBYOFood: !!booking.hasBYOFood,
      paymentMethod: booking.paymentMethod || 'Manual',
      adminUrl: `${origin}/zh/admin/bookings/${booking.id}`,
    });

    // Supplier-order email — no-op when the booking has no supplier
    // items, so safe to call unconditionally.
    await sendStaffSupplierOrderNotification({
      booking,
      venueName: venue?.name.zh || booking.branchSlug,
      customerName: profile?.displayName || '—',
      customerEmail: profile?.email,
      adminUrl: `${origin}/zh/admin/bookings/${booking.id}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Notify failed' },
      { status: 500 },
    );
  }
}
