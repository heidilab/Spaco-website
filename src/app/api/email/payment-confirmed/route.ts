import { NextRequest, NextResponse } from 'next/server';
import { adminDiscountAmount } from '@/lib/bookingMoney';
import { adminDb } from '@/lib/firebaseAdmin';
import { buildBookingConfirmationEmail, generateWhatsAppLink } from '@/lib/email';
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import { getVenueById } from '@/lib/venues';
import { formatAddOnsForStaff } from '@/lib/pricing';
import { consumeBookingRewards } from '@/lib/bookingRewards';
import type { BookingRecord } from '@/types';
import { requireAdmin } from '@/lib/adminAuth';
import { restoreBlockedSlotsIfMissing } from '@/lib/finalizeBooking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sends the booking-confirmed email after admin manually approves an offline
 * receipt (mirrors what Stripe webhook does for online payments).
 */
export async function POST(req: NextRequest) {
  const _gate = await requireAdmin(req, 'bookings');
  if (!_gate.ok) return _gate.res;

  try {
    const { bookingId } = await req.json();
    if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

    const snap = await adminDb.collection('bookings').doc(bookingId).get();
    if (!snap.exists) return NextResponse.json({ error: 'booking not found' }, { status: 404 });
    // Pin doc id onto the booking — .data() drops it and downstream
    // gcal description / email body both render Booking ID.
    const booking: BookingRecord = { ...(snap.data() as BookingRecord), id: bookingId };

    // An FPS booking approved AFTER the 30-minute hold lapsed has already
    // had its blocked_slots deleted by the expiry cron; approval flips it
    // back to confirmed but nothing re-blocked the time, so the site kept
    // selling it (CWB 2026-10-31, SW 2026-10-29). Rebuild before anything
    // else, and regardless of whether the customer has an email.
    try {
      if (await restoreBlockedSlotsIfMissing(booking)) console.warn('[payment-confirmed] restored blocked_slots for', bookingId);
    } catch (err) {
      console.error('[payment-confirmed] blocked_slots restore failed:', err);
    }

    // Points and promo code: consumed once, in a transaction, BEFORE the
    // email — the old block sat after an early return for customers with
    // no email, so their rewards were never consumed (site review #6).
    try {
      await consumeBookingRewards(bookingId);
    } catch (err) {
      console.warn('[payment-confirmed] rewards consumption failed:', err);
    }

    const userSnap = await adminDb.collection('users').doc(booking.userId).get();
    const user = userSnap.exists ? (userSnap.data() as { email?: string; displayName?: string }) : null;
    if (!user?.email) return NextResponse.json({ ok: true, skipped: 'no email' });

    const venue = getVenueById(booking.venueId);
    const whatsappLink = generateWhatsAppLink(
      PAYMENT_DETAILS.fps.digitsOnly,
      `你好，預訂編號：${bookingId}`,
    );

    const tpl = buildBookingConfirmationEmail({
      customerName: user.displayName || 'there',
      venueId: booking.venueId,
      venueName: venue?.name.zh || booking.venueId,
      venueAddress: venue?.address.zh,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      endDate: booking.endDate,
      guestCount: booking.guestCount,
      adultCount: booking.adultCount,
      childCount: booking.childCount,
      subtotal: booking.pricing.subtotal,
      deposit: booking.pricing.deposit,
      securityDeposit: booking.pricing.securityDeposit,
      promoCode: booking.promoCode,
      promoDiscount: booking.promoDiscount,
        adminDiscount: adminDiscountAmount(booking as never),
      pointsUsed: booking.pointsUsed,
      pointsDiscount: booking.pointsDiscount,
      balanceDue: booking.balanceDue,
      balanceDueDate: booking.balanceDueDate,
      addOnsLine: formatAddOnsForStaff(booking.addOns, 'zh'),
      paymentMethod: booking.paymentMethod === 'fps' || booking.paymentMethod === 'bank' ? 'FPS / 銀行轉帳' : (booking.paymentMethod || 'Online'),
      whatsappLink,
    });
    await sendAutomatedEmail({
      automationKey: 'booking_confirmation',
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[payment-confirmed] failed:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
