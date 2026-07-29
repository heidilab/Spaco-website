import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { buildBookingConfirmationEmail, generateWhatsAppLink } from '@/lib/email';
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import { getVenueById } from '@/lib/venues';
import { formatAddOnsForStaff } from '@/lib/pricing';
import { deductLoyaltyPoints } from '@/lib/loyaltyServer';
import { FieldValue } from 'firebase-admin/firestore';
import type { BookingRecord } from '@/types';
import { requireAdmin } from '@/lib/adminAuth';

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
      pointsUsed: booking.pointsUsed,
      pointsDiscount: booking.pointsDiscount,
      balanceDue: booking.balanceDue,
      balanceDueDate: booking.balanceDueDate,
      addOnsLine: formatAddOnsForStaff(booking.addOns, 'zh'),
      paymentMethod: booking.paymentMethod === 'fps' ? 'FPS / 銀行轉帳' : (booking.paymentMethod || 'Online'),
      whatsappLink,
    });
    await sendAutomatedEmail({
      automationKey: 'booking_confirmation',
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
    });

    // Deduct loyalty points + increment promo usage (idempotent).
    if (booking.pointsUsed && booking.pointsUsed > 0 && !booking.pointsRedeemedAt) {
      try {
        const deducted = await deductLoyaltyPoints(booking.userId, booking.pointsUsed);
        await adminDb.collection('bookings').doc(bookingId).update({
          pointsRedeemedAt: FieldValue.serverTimestamp(),
          pointsActuallyDeducted: deducted,
        });
      } catch (err) {
        console.warn('[payment-confirmed] points deduction failed:', err);
      }
    }
    if (booking.promoCodeId && !booking.promoRedeemedAt) {
      try {
        await adminDb.collection('promo_codes').doc(booking.promoCodeId).update({
          totalUsageCount: FieldValue.increment(1),
        });
        await adminDb.collection('bookings').doc(bookingId).update({
          promoRedeemedAt: FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.warn('[payment-confirmed] promo increment failed:', err);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[payment-confirmed] failed:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
