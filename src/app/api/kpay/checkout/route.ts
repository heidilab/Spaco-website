import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  createManagedOrder,
  buildCashierRedirectUrl,
  isKpayConfigured,
  getPublicOrigin,
} from '@/lib/kpay';

export const runtime = 'nodejs';

/**
 * Payment-method groups shown on the hosted cashier.
 *
 * card   → card-network rails (credit card / Apple Pay / Google Pay;
 *          Samsung Pay rides CARD). KPay's fee is higher here, so the
 *          customer pays a CARD_SURCHARGE_RATE surcharge on top.
 * wallet → e-wallets with no surcharge.
 *
 * FPS is deliberately in NEITHER list — FPS is handled off-KPay via
 * the pay-offline flow (bank transfer + receipt upload + admin
 * verification), so the cashier must never offer it.
 */
const PAY_METHOD_GROUPS: Record<'card' | 'wallet', string[]> = {
  card: ['CARD', 'APPLEPAY', 'GOOGLEPAY'],
  wallet: ['ALIPAYHK', 'ALIPAYCN', 'WXPAY', 'PAYME'],
};

/** 1.5% card surcharge, rounded to the cent. (Route files may only
 *  export Next.js handler names, so this stays module-local.) */
const CARD_SURCHARGE_RATE = 0.015;

function cardSurchargeFor(amount: number): number {
  return Math.round(amount * CARD_SURCHARGE_RATE * 100) / 100;
}

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
      methodGroup,
    } = await req.json() as {
      bookingId: string;
      amount: number;
      venueName?: string;
      customerEmail?: string;
      isBalancePayment?: boolean;
      /** 'card' → +1.5% surcharge, card rails only. 'wallet' → e-wallets
       *  only, no surcharge. Omitted → legacy behaviour (all methods,
       *  no surcharge) so old clients keep working mid-deploy. */
      methodGroup?: 'card' | 'wallet';
    };

    if (!bookingId || !amount || amount <= 0) {
      return NextResponse.json({ error: 'bookingId + positive amount required' }, { status: 400 });
    }

    const surcharge = methodGroup === 'card' ? cardSurchargeFor(amount) : 0;
    const chargeTotal = Math.round((amount + surcharge) * 100) / 100;
    const payMethodOrder = methodGroup ? PAY_METHOD_GROUPS[methodGroup] : undefined;

    // Compose a unique managedOutTradeNo. KPay limit: 32 chars.
    // Format: B<bookingId-first-12>_<P|B><epoch-seconds>
    //   P = initial payment, B = balance payment
    // Lets us trace a KPay order back to a booking + distinguish deposit
    // vs balance Stripe-style.
    const flag = isBalancePayment ? 'B' : 'P';
    const ts = Math.floor(Date.now() / 1000);
    const managedOutTradeNo = `B${bookingId.slice(0, 12)}_${flag}${ts}`.slice(0, 32);

    const origin = getPublicOrigin(req.nextUrl.origin);
    const notifyUrl = `${origin}/api/kpay/webhook`;
    const returnUrl = `${origin}/zh/book/success?booking_id=${bookingId}`;

    // Record the surcharge BEFORE creating the KPay order, keyed by
    // managedOutTradeNo, so the webhook credits only the base amount
    // toward the booking's balance and books the surcharge separately.
    // Fire-and-tolerate: a missing booking doc (diagnostic orders) is
    // fine — the webhook treats absent records as zero surcharge.
    if (surcharge > 0) {
      try {
        await adminDb.collection('bookings').doc(bookingId).update({
          [`kpaySurcharges.${managedOutTradeNo}`]: surcharge,
        });
      } catch (err) {
        console.warn('[kpay/checkout] surcharge record skipped:', err);
      }
    }

    const create = await createManagedOrder({
      managedOutTradeNo,
      payAmount: chargeTotal,
      returnUrl,
      notifyUrl,
      itemList: [
        {
          itemNo: bookingId.slice(0, 32),
          itemName: `SPACO — ${venueName || 'Booking'}${isBalancePayment ? ' (Balance)' : ''}${surcharge > 0 ? ' +1.5% card fee' : ''}`,
          price: chargeTotal,
          quantity: 1,
        },
      ],
      orderRemark: `Booking ID: ${bookingId}`,
      payMethodOrder,
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
      baseAmount: amount,
      surcharge,
      chargeTotal,
    });
  } catch (err) {
    console.error('[kpay/checkout] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Checkout failed' },
      { status: 500 },
    );
  }
}
