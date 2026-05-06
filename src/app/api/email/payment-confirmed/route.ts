import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { sendEmail, buildBookingConfirmationEmail, generateWhatsAppLink } from '@/lib/email';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import { getVenueById } from '@/lib/venues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sends the booking-confirmed email after admin manually approves an offline
 * receipt (mirrors what Stripe webhook does for online payments).
 */
export async function POST(req: NextRequest) {
  try {
    const { bookingId } = await req.json();
    if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

    const snap = await adminDb.collection('bookings').doc(bookingId).get();
    if (!snap.exists) return NextResponse.json({ error: 'booking not found' }, { status: 404 });
    const booking = snap.data() as Record<string, unknown> & {
      userId: string;
      venueId: string;
      date: string;
      startTime: string;
      endTime: string;
      guestCount: number;
      pricing: { subtotal: number; deposit: number };
      paymentMethod: string;
    };

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
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      guestCount: booking.guestCount,
      subtotal: booking.pricing.subtotal,
      deposit: booking.pricing.deposit,
      paymentMethod: booking.paymentMethod === 'fps' ? 'FPS / 銀行轉帳' : (booking.paymentMethod || 'Online'),
      whatsappLink,
    });
    await sendEmail({ to: user.email, subject: tpl.subject, html: tpl.html });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[payment-confirmed] failed:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
