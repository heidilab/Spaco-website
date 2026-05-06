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

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
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
