import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { buildBookingCancelledEmail, generateWhatsAppLink } from '@/lib/email';
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import { getVenueById } from '@/lib/venues';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sends the booking-cancelled email after admin cancels a booking.
 * Triggered from the centralised cancelBooking() helper.
 */
export async function POST(req: NextRequest) {
  try {
    const { bookingId } = await req.json();
    if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

    const snap = await adminDb.collection('bookings').doc(bookingId).get();
    if (!snap.exists) return NextResponse.json({ error: 'booking not found' }, { status: 404 });
    const booking: BookingRecord = { ...(snap.data() as BookingRecord), id: bookingId };

    const userSnap = await adminDb.collection('users').doc(booking.userId).get();
    const user = userSnap.exists ? (userSnap.data() as { email?: string; displayName?: string }) : null;
    if (!user?.email) return NextResponse.json({ ok: true, skipped: 'no email' });

    const venue = getVenueById(booking.venueId);
    const whatsappLink = generateWhatsAppLink(
      PAYMENT_DETAILS.fps.digitsOnly,
      `你好，預訂編號：${bookingId}\n想查詢取消／退款`,
    );

    const tpl = buildBookingCancelledEmail({
      customerName: user.displayName || 'there',
      venueName:    venue?.name.zh || booking.venueId,
      date:         booking.date,
      startTime:    booking.startTime,
      endTime:      booking.endTime,
      endDate:      booking.endDate,
      bookingId,
      whatsappLink,
    });
    await sendAutomatedEmail({
      automationKey: 'booking_cancelled',
      to:            user.email,
      subject:       tpl.subject,
      html:          tpl.html,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[booking-cancelled] failed:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
