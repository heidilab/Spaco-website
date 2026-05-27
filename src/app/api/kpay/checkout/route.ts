import { NextRequest, NextResponse } from 'next/server';
import {
  createManagedOrder,
  buildCashierRedirectUrl,
  isKpayConfigured,
} from '@/lib/kpay';

export const runtime = 'nodejs';

/**
 * POST /api/kpay/checkout
 *   { bookingId, amount, venueName, customerEmail, isBalancePayment }
 *
 * Mirrors /api/stripe/checkout's contract so the booking payment page
 * can hot-swap by switching the endpoint. Creates a KPay managed
 * (hosted cashier) order and returns the cashier redirect URL.
 *
 * Two-step KPay flow:
 *   1. POST /v1/managed/order/add → returns managedOrderNo
 *   2. Customer's browser hits a signed GET /v1/web/managed/order
 *      with the managedOrderNo → KPay shows the payment selection page.
 *
 * notifyUrl: KPay POSTs the result here. Must be a public HTTPS URL
 * with no query string.
 */
export async function POST(req: NextRequest) {
  if (!isKpayConfigured()) {
    return NextResponse.json(
      { error: 'KPay not configured. Set KPAY_MID / KPAY_PRIVATE_KEY / KPAY_PLATFORM_PUBLIC_KEY / KPAY_API_BASE.' },
      { status: 500 },
    );
  }
  try {
    const {
      bookingId,
      amount,
      venueName,
      isBalancePayment,
    } = await req.json() as {
      bookingId: string;
      amount: number;
      venueName?: string;
      customerEmail?: string;
      isBalancePayment?: boolean;
    };

    if (!bookingId || !amount || amount <= 0) {
      return NextResponse.json({ error: 'bookingId + positive amount required' }, { status: 400 });
    }

    // Compose a unique managedOutTradeNo. KPay limit: 32 chars.
    // Format: B<bookingId-first-12>_<P|B><epoch-seconds>
    //   P = initial payment, B = balance payment
    // Lets us trace a KPay order back to a booking + distinguish deposit
    // vs balance Stripe-style.
    const flag = isBalancePayment ? 'B' : 'P';
    const ts = Math.floor(Date.now() / 1000);
    const managedOutTradeNo = `B${bookingId.slice(0, 12)}_${flag}${ts}`.slice(0, 32);

    const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const notifyUrl = `${origin}/api/kpay/webhook`;
    const returnUrl = `${origin}/zh/book/success?booking_id=${bookingId}`;

    const create = await createManagedOrder({
      managedOutTradeNo,
      payAmount: amount,
      returnUrl,
      notifyUrl,
      itemList: [
        {
          itemNo: bookingId.slice(0, 32),
          itemName: `SPACO — ${venueName || 'Booking'}${isBalancePayment ? ' (Balance)' : ''}`,
          price: amount,
          quantity: 1,
        },
      ],
      orderRemark: `Booking ID: ${bookingId}`,
    });

    if (!create.ok || !create.managedOrderNo) {
      console.error('[kpay/checkout] order/add failed:', create);
      return NextResponse.json(
        { error: 'Failed to create KPay order', code: create.code, message: create.message },
        { status: 502 },
      );
    }

    const redirectUrl = buildCashierRedirectUrl({
      managedOrderNo: create.managedOrderNo,
    });

    return NextResponse.json({
      sessionUrl: redirectUrl,    // mirror stripe/checkout's response shape
      managedOrderNo: create.managedOrderNo,
      managedOutTradeNo,
    });
  } catch (err) {
    console.error('[kpay/checkout] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Checkout failed' },
      { status: 500 },
    );
  }
}
