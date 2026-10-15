import { NextRequest, NextResponse } from 'next/server';
import { adminVerifyIdToken } from '@/lib/adminAuth';
import { checkoutAmount, BookingInputError } from '@/lib/bookingSecurity';
import type { BookingRecord } from '@/types';
import { decideKpayOrderReuse, type KpayOrderReuseDecision } from '@/lib/kpayOrderLifecycle';
import { paidBase } from '@/lib/bookingMoney';
import { adminDb } from '@/lib/firebaseAdmin';
import {
  createManagedOrder,
  queryManagedOrder,
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
// APPLEPAY / GOOGLEPAY / PAYME were pulled on 2026-07-21 when Apple Pay
// returned 403 to customers, on the theory that KPay had not provisioned
// those channels. The real cause turned out to be a KPay-side cashier
// outage (payment.kpay-group.com returned 403 to every request, from any
// network, for all methods). KPay resolved it on 2026-07-22, so the
// channels are restored here. Samsung Pay rides CARD.
//
// If any single method fails again while the OTHERS still work, that IS a
// per-merchant channel issue — remove just that one and ask KPay to
// enable it on merchant 852124324500007. If EVERY method fails, check the
// cashier host itself before touching this list.
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
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return NextResponse.json({ error: 'missing-token' }, { status: 401 });
  let uid: string;
  try { uid = (await adminVerifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }
  if (!isKpayConfigured()) {
    return NextResponse.json(
      { error: 'KPay not configured. Set KPAY_MID / KPAY_PRIVATE_KEY / KPAY_PLATFORM_PUBLIC_KEY / KPAY_API_BASE.' },
      { status: 500 },
    );
  }
  try {
    const {
      bookingId,
      amount: requestedAmount,
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

    if (typeof bookingId !== 'string' || bookingId.includes('/') || !bookingId
      || !['card', 'wallet'].includes(methodGroup || '') || (isBalancePayment !== undefined && typeof isBalancePayment !== 'boolean')) {
      return NextResponse.json({ error: 'INVALID_CHECKOUT' }, { status: 400 });
    }
    const bookingRef = adminDb.collection('bookings').doc(bookingId);
    const lockRef = adminDb.collection('_checkout_orders').doc(`${bookingId}_${isBalancePayment ? 'balance' : 'initial'}`);
    // Read and authenticate before a gateway lookup; re-check inside the
    // transaction so a concurrent payment or another retry cannot be overwritten.
    const before = await bookingRef.get();
    if (!before.exists) throw new BookingInputError('BOOKING_NOT_FOUND');
    const initialBooking = before.data() as BookingRecord;
    if (initialBooking.userId !== uid) throw new BookingInputError('FORBIDDEN');
    const expectedAmount = checkoutAmount(initialBooking, !!isBalancePayment);
    if (typeof requestedAmount !== 'number' || !Number.isFinite(requestedAmount)
      || Math.abs(requestedAmount - expectedAmount) > 0.005) throw new BookingInputError('PRICE_CHANGED');
    const oldLock = (await lockRef.get()).data();
    let replaceTradeNo: string | null = null;
    // A previously created managed order (deposit OR balance) is only
    // reusable while the gateway still reports it awaiting payment. The
    // cashier expires orders, so ask KPay before re-signing: a dead unpaid
    // order is replaced, a paid/unknown one blocks a second charge.
    if (oldLock?.managedOrderNo && oldLock.paidBase === paidBase(initialBooking)) {
      const expected = {
        managedOrderNo: oldLock.managedOrderNo as string,
        managedOutTradeNo: oldLock.managedOutTradeNo as string,
        chargeTotal: oldLock.chargeTotal
          ?? Math.round((oldLock.amount + (oldLock.surcharge ?? (oldLock.methodGroup === 'card' ? cardSurchargeFor(oldLock.amount) : 0))) * 100) / 100,
      };
      let decision: KpayOrderReuseDecision = 'blocked';
      let detail: Record<string, unknown> = {};
      try {
        const result = await queryManagedOrder(expected.managedOutTradeNo, expected.managedOrderNo);
        decision = decideKpayOrderReuse(result, expected);
        detail = { code: result.code, state: result.data?.managedOrderState, attempts: Array.isArray(result.data?.paymentOrderList) ? result.data!.paymentOrderList.length : undefined };
      } catch (err) {
        detail = { error: err instanceof Error ? err.message : String(err) };
      }
      // Operational trace (no customer data): why a retry was reused,
      // replaced or refused, so staff can read Vercel logs when a
      // customer reports a payment-link failure.
      console.log('[kpay/checkout] prior order', { bookingId, kind: isBalancePayment ? 'balance' : 'initial', decision, ...detail });
      if (decision === 'replace') replaceTradeNo = expected.managedOutTradeNo;
      else if (decision !== 'reuse') throw new BookingInputError('PAYMENT_STATUS_UNAVAILABLE');
    }
    const reservation = await adminDb.runTransaction(async tx => {
      const [bookingSnap, orderSnap] = await Promise.all([tx.get(bookingRef), tx.get(lockRef)]);
      if (!bookingSnap.exists) throw new BookingInputError('BOOKING_NOT_FOUND');
      const booking = bookingSnap.data() as BookingRecord;
      if (booking.userId !== uid) throw new BookingInputError('FORBIDDEN');
      const amount = checkoutAmount(booking, !!isBalancePayment);
      // Do not silently charge an amount different from the visible confirmation.
      if (typeof requestedAmount !== 'number' || !Number.isFinite(requestedAmount) || Math.abs(requestedAmount - amount) > 0.005) {
        throw new BookingInputError('PRICE_CHANGED');
      }
      const existing = orderSnap.data();
      if (existing && existing.paidBase === paidBase(booking)
        && existing.managedOutTradeNo !== replaceTradeNo) {
        if (existing.amount !== amount || existing.methodGroup !== methodGroup) throw new BookingInputError('PAYMENT_ALREADY_STARTED');
        if (existing.managedOrderNo) return { amount, existing, managedOutTradeNo: existing.managedOutTradeNo as string };
        throw new BookingInputError('PAYMENT_PROCESSING');
      }
      if (!booking.pointsRedeemedAt && (booking.pointsUsed || 0) > 0) {
        const profile = await tx.get(adminDb.collection('users').doc(uid));
        if ((profile.data()?.loyaltyPoints || 0) < booking.pointsUsed!) throw new BookingInputError('REWARDS_UNAVAILABLE');
      }
      if (booking.promoCodeId && !booking.promoRedeemedAt) {
        const promo = await tx.get(adminDb.collection('promo_codes').doc(booking.promoCodeId));
        const pc = promo.data();
        const uses = await tx.get(adminDb.collection('bookings').where('userId', '==', uid));
        if (!pc || (pc.totalUsageLimit != null && pc.totalUsageCount >= pc.totalUsageLimit)
          || (pc.perUserLimit != null && uses.docs.filter(d => d.data().promoCodeId === booking.promoCodeId && d.data().promoRedeemedAt).length >= pc.perUserLimit)) {
          throw new BookingInputError('REWARDS_UNAVAILABLE');
        }
      }
      // The transaction serializes creation; milliseconds distinguish later top-up orders.
      const tradeNo = `B${bookingId.slice(0, 12)}_${isBalancePayment ? 'B' : 'P'}${Date.now()}`;
      if (replaceTradeNo) {
        if (existing?.managedOutTradeNo !== replaceTradeNo) throw new BookingInputError('PAYMENT_PROCESSING');
        tx.set(adminDb.collection('_kpay_orders').doc(replaceTradeNo), { replacedBy: tradeNo, closedVerifiedAt: Date.now() }, { merge: true });
      }
      tx.create(adminDb.collection('_kpay_orders').doc(tradeNo), { bookingId, amount, surcharge: methodGroup === 'card' ? cardSurchargeFor(amount) : 0, isBalancePayment: !!isBalancePayment, createdAt: Date.now() });
      tx.set(lockRef, { bookingId, uid, amount, methodGroup, managedOutTradeNo: tradeNo,
        paidBase: paidBase(booking), status: 'creating', createdAt: Date.now() });
      return { amount, existing: null, managedOutTradeNo: tradeNo };
    });
    const { amount, managedOutTradeNo } = reservation;
    if (reservation.existing) {
      // Reuse the gateway order, never its timestamped cashier signature.
      // KPay rejects an old signed URL with 40009 even while the order is payable.
      const existing = reservation.existing;
      return NextResponse.json({
        sessionUrl: buildCashierRedirectUrl({ managedOrderNo: existing.managedOrderNo }),
        managedOrderNo: existing.managedOrderNo,
        managedOutTradeNo,
        baseAmount: existing.baseAmount ?? amount,
        surcharge: existing.surcharge ?? 0,
        chargeTotal: existing.chargeTotal ?? amount,
      });
    }
    const venueName = 'Booking';

    const surcharge = methodGroup === 'card' ? cardSurchargeFor(amount) : 0;
    const chargeTotal = Math.round((amount + surcharge) * 100) / 100;
    const payMethodOrder = methodGroup ? PAY_METHOD_GROUPS[methodGroup] : undefined;

    const origin = getPublicOrigin(req.nextUrl.origin);
    const notifyUrl = `${origin}/api/kpay/webhook`;
    const returnUrl = `${origin}/zh/book/success?booking_id=${bookingId}`;

    // Persist before calling the gateway. If this fails, do not create a charge.
    if (surcharge > 0) await bookingRef.update({ [`kpaySurcharges.${managedOutTradeNo}`]: surcharge });

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

    await lockRef.update({ status: 'ready', managedOrderNo: create.managedOrderNo,
      baseAmount: amount, surcharge, chargeTotal });
    return NextResponse.json({
      sessionUrl: redirectUrl,    // mirror stripe/checkout's response shape
      managedOrderNo: create.managedOrderNo,
      managedOutTradeNo,
      baseAmount: amount,
      surcharge,
      chargeTotal,
    });
  } catch (err) {
    if (err instanceof BookingInputError) return NextResponse.json({ error: err.message }, { status: err.message === 'FORBIDDEN' ? 403 : 409 });
    console.error('[kpay/checkout] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Checkout failed' },
      { status: 500 },
    );
  }
}
