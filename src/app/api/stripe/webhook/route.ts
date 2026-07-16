import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// RETIRED — the Stripe checkout route is disabled (KPay is the live rail),
// so no new Stripe sessions can be created and any legacy session is long
// past its 30-min expiry. This webhook previously cleared balanceDue on
// isBalancePayment WITHOUT checking the amount paid — disabling it removes
// that latent hole. Return 410 so Stripe stops retrying.
export async function POST() {
  return NextResponse.json({ error: 'gone', message: 'Stripe webhook retired.' }, { status: 410 });
}
