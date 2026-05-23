import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const {
      bookingId,
      amount,
      deposit,
      venueName,
      customerEmail,
      isBalancePayment,
    } = await request.json();

    // Stripe's minimum is 30 min from `created`; align with the
    // booking's 30-min pendingExpiresAt so the checkout link dies at
    // the same moment the expire-pending-bookings cron flips the
    // booking to payment_not_completed. Without this, the session
    // would live 24 h by default and a customer could complete payment
    // long after the slot was released to someone else.
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      expires_at: expiresAt,
      line_items: [
        {
          price_data: {
            currency: 'hkd',
            product_data: {
              name: `SPACO — ${venueName}`,
              description: `Booking ID: ${bookingId}`,
            },
            unit_amount: amount * 100, // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/zh/book/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/zh/my-bookings`,
      customer_email: customerEmail,
      metadata: {
        bookingId,
        deposit: String(deposit),
        // Webhook uses this flag to decide whether to clear balanceDue
        // (balance payment) or just confirm the booking (deposit payment).
        isBalancePayment: isBalancePayment ? 'true' : 'false',
      },
    });

    return NextResponse.json({ sessionUrl: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
