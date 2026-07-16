import { NextResponse } from 'next/server';

// RETIRED — KPay is the live payment rail. This route was unauthenticated
// and priced by the client (unit_amount = client `amount`), a standing
// liability with live Stripe keys. The customer payment pages now call
// /api/kpay/checkout only, so this is disabled.
export async function POST() {
  return NextResponse.json(
    { error: 'gone', message: 'Stripe checkout retired — payments go through KPay.' },
    { status: 410 },
  );
}
