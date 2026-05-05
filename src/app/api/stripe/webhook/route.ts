import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { updateBookingStatus } from '@/lib/firestore';
import { processBookingForLockAccess } from '@/lib/lockPasscode';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const bookingId = session.metadata?.bookingId;

      if (bookingId) {
        await updateBookingStatus(bookingId, 'confirmed');
        // TODO: Send confirmation email
        // If the booking is within the 2-day lock-passcode window, this
        // generates the passcode + emails the customer immediately.
        // Otherwise it no-ops; the daily cron will pick it up at T−2 days.
        try {
          await processBookingForLockAccess(bookingId);
        } catch (err) {
          console.warn('[stripe webhook] lock passcode trigger failed:', err);
          // Non-fatal — the cron will retry tomorrow.
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return NextResponse.json({ error: 'Webhook failed' }, { status: 400 });
  }
}

