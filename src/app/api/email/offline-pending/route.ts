import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { sendEmail, buildOfflinePaymentPendingEmail, generateWhatsAppLink } from '@/lib/email';
import { PAYMENT_DETAILS } from '@/lib/paymentDetails';
import { getVenueById } from '@/lib/venues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Triggered after the customer picks "FPS / bank" on the payment-method page.
 * Sends an email containing the payment instructions, the 30-min hold notice,
 * and a WhatsApp deeplink for receipt upload.
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
      pricing: { deposit: number };
    };

    const userSnap = await adminDb.collection('users').doc(booking.userId).get();
    if (!userSnap.exists) return NextResponse.json({ ok: true, skipped: 'no user' });
    const user = userSnap.data() as { email?: string; displayName?: string };
    if (!user.email) return NextResponse.json({ ok: true, skipped: 'no email' });

    const venue = getVenueById(booking.venueId);
    const whatsappLink = generateWhatsAppLink(
      PAYMENT_DETAILS.fps.digitsOnly,
      `你好，我已完成線下付款。\n預訂編號：${bookingId}\n金額：HK$${booking.pricing.deposit.toLocaleString()}`,
    );

    const tpl = buildOfflinePaymentPendingEmail({
      customerName: user.displayName || 'there',
      venueName: venue?.name.zh || booking.venueId,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      amountDue: booking.pricing.deposit,
      fpsNumber: PAYMENT_DETAILS.fps.display,
      bankName: PAYMENT_DETAILS.bank.name,
      bankAccount: PAYMENT_DETAILS.bank.accountNumber,
      bankHolder: PAYMENT_DETAILS.bank.accountHolder,
      bookingId,
      whatsappLink,
    });
    await sendEmail({ to: user.email, subject: tpl.subject, html: tpl.html });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[offline-pending] failed:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
