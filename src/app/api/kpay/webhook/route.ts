import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyNotify, isTransactionSuccess } from '@/lib/kpay';
import { pushBookingToCalendar, updateBookingOnCalendar } from '@/lib/googleCalendar';
import type { BookingRecord, UserProfile } from '@/types';

export const runtime = 'nodejs';

/**
 * POST /api/kpay/webhook
 *
 * KPay calls this URL after a managed-order payment completes (success
 * or failure). Per docs:
 *   - HTTPS only, no query string
 *   - Must respond within 4 s with HTTP 200 to ACK
 *   - Failed ACKs trigger 2 immediate retries then back-off: 1m / 5m /
 *     10m / 1h / 2h / 6h / 6h / 10h
 *   - The same notification CAN arrive multiple times — handlers must
 *     be idempotent.
 *
 * Sign verification: KPay signs the notification with their platform
 * private key. We verify with KPAY_PLATFORM_PUBLIC_KEY.
 *
 * Booking lookup: managedOutTradeNo is what we sent at order creation,
 * format `B<bookingIdPrefix>_<P|B><epoch>`. We use the data.bookingId
 * encoded in orderRemark as the authoritative lookup — but we also
 * accept the prefix match against bookings[].
 */

interface KPayNotifyPayload {
  eventType: string;
  merchantCode: string;
  outTradeNo: string;
  orderNo: string;
  managedOrderNo?: string;
  managedMerchantOrderNo?: string;
  transactionNo: string;
  transactionState: number;     // 1=pending 2=success 3=failed 4=refunded 5=cancelled
  transactionStateDesc?: string;
  payAmount: number;
  payCurrency: string;
  transactionFinishTime?: number;
  payMethodId?: number;
}

export async function POST(req: NextRequest) {
  // Read raw body FIRST (must match exactly what KPay signed).
  const rawBody = await req.text();

  // Extract KPay's signature headers.
  const signature = req.headers.get('K-Signature') || req.headers.get('k-signature') || '';
  const timestamp = req.headers.get('K-Timestamp') || req.headers.get('k-timestamp') || '';
  const nonce = req.headers.get('K-Nonce-Str') || req.headers.get('k-nonce-str') || '';
  const merchantCode = req.headers.get('K-Merchant-Code') || req.headers.get('k-merchant-code') || '';

  if (!signature || !timestamp || !nonce || !merchantCode) {
    console.warn('[kpay/webhook] missing K-* headers', { signature: !!signature, timestamp, nonce, merchantCode });
    return NextResponse.json({ error: 'missing signature headers' }, { status: 400 });
  }

  // Verify the signature so an attacker can't fabricate a "success" callback.
  const valid = verifyNotify({
    method: 'POST',
    url: '/api/kpay/webhook',
    signature,
    timestamp,
    nonce,
    merchantCode,
    body: rawBody,
  });
  if (!valid) {
    console.warn('[kpay/webhook] signature verification FAILED');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: KPayNotifyPayload;
  try {
    payload = JSON.parse(rawBody) as KPayNotifyPayload;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // We only care about SALES (sale/charge) for now; refunds + chargebacks
  // get their own webhook events later.
  if (payload.eventType !== 'SALES') {
    console.log('[kpay/webhook] ignoring eventType:', payload.eventType);
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (!isTransactionSuccess(payload.transactionState)) {
    // Logged so admin sees declines in Vercel logs, but ACK with 200 so
    // KPay doesn't keep retrying.
    console.log('[kpay/webhook] non-success transactionState', {
      state: payload.transactionState,
      desc: payload.transactionStateDesc,
      outTradeNo: payload.outTradeNo,
    });
    return NextResponse.json({ ok: true, ignored: 'non-success' });
  }

  // Recover the bookingId from our managedOutTradeNo encoding:
  //   B<bookingIdFirst12>_<P|B><epoch>
  // We persist the full bookingId in orderRemark too, but
  // managedMerchantOrderNo is the more authoritative field on the
  // notification side. Fall back to a prefix search if needed.
  const managedTradeNo =
    payload.managedMerchantOrderNo
    || payload.outTradeNo;  // some payment paths put it here
  const bookingIdPrefix = managedTradeNo.startsWith('B')
    ? managedTradeNo.slice(1).split('_')[0]
    : '';
  const isBalancePayment =
    /_B\d+$/.test(managedTradeNo);

  let bookingRef: FirebaseFirestore.DocumentReference | null = null;
  let booking: BookingRecord | null = null;

  if (bookingIdPrefix) {
    // Try exact lookup first when prefix happens to be full-length.
    const directSnap = await adminDb.collection('bookings').doc(bookingIdPrefix).get();
    if (directSnap.exists) {
      bookingRef = directSnap.ref;
      booking = { id: directSnap.id, ...directSnap.data() } as BookingRecord;
    } else {
      // Firestore can't prefix-query by doc id directly, so we scan and
      // match by prefix. Fine for our scale (~50 bookings/month).
      const all = await adminDb.collection('bookings').get();
      const hit = all.docs.find((d) => d.id.startsWith(bookingIdPrefix));
      if (hit) {
        bookingRef = hit.ref;
        booking = { id: hit.id, ...hit.data() } as BookingRecord;
      }
    }
  }

  if (!bookingRef || !booking) {
    console.error('[kpay/webhook] booking not found for', managedTradeNo);
    // ACK so KPay stops retrying — but log for manual reconciliation.
    return NextResponse.json({ ok: true, notFound: true, managedTradeNo });
  }

  // Idempotency — skip if we've already recorded this transaction.
  const alreadyRecorded = (booking.payments || []).some(
    (p) => (p as { kpayTransactionNo?: string }).kpayTransactionNo === payload.transactionNo,
  );
  if (alreadyRecorded) {
    return NextResponse.json({ ok: true, alreadyRecorded: true });
  }

  // Append a payments[] entry. KPay's payAmount is the actual charged
  // amount in HKD with 2 dp.
  const payments = booking.payments || [];
  const realGrandTotal =
    (booking.pricing?.subtotal || 0) + (booking.pricing?.securityDeposit || 0);
  const loggedSum = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const newBalanceDue = Math.max(0, realGrandTotal - loggedSum - payload.payAmount);

  const updates: Record<string, unknown> = {
    payments: FieldValue.arrayUnion({
      rentalAmount: 0,
      addOnAmount: 0,
      depositAmount: 0,
      amount: payload.payAmount,
      method: 'stripe',  // KPay is a Stripe-like card processor; we'll add a 'kpay' method in a follow-up
      kind: isBalancePayment ? 'balance' : 'initial',
      note: 'KPay',
      recordedBy: 'kpay-webhook',
      recordedAt: new Date().toISOString(),
      // KPay-specific metadata for audit + idempotency
      kpayTransactionNo: payload.transactionNo,
      kpayOrderNo: payload.orderNo,
      kpayPayMethodId: payload.payMethodId,
    }),
    balanceDue: newBalanceDue,
    status: newBalanceDue === 0 ? 'confirmed' : 'awaiting_payment',
    paymentMethod: 'stripe',
    updatedAt: FieldValue.serverTimestamp(),
    ...(newBalanceDue === 0 && !booking.balancePaidAt
      ? { balancePaidAt: FieldValue.serverTimestamp() }
      : {}),
    ...(newBalanceDue === 0 && !booking.paymentVerifiedAt
      ? { paymentVerifiedAt: FieldValue.serverTimestamp() }
      : {}),
  };
  await bookingRef.update(updates);

  // Push to Google Calendar — gated on payment status inside the helper.
  try {
    const userSnap = booking.userId
      ? await adminDb.collection('users').doc(booking.userId).get()
      : null;
    const customerName = userSnap?.exists
      ? (userSnap.data() as UserProfile).displayName
      : undefined;
    const fresh = { ...booking, ...updates } as BookingRecord;
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/google/callback`;
    if (fresh.googleEventId) {
      await updateBookingOnCalendar(redirectUri, { booking: fresh, customerName });
    } else {
      const newEventId = await pushBookingToCalendar(redirectUri, {
        booking: fresh,
        customerName,
      });
      if (newEventId) {
        await bookingRef.update({ googleEventId: newEventId });
      }
    }
  } catch (err) {
    console.warn('[kpay/webhook] gcal sync failed:', err);
    // Non-fatal — booking is already updated.
  }

  return NextResponse.json({ ok: true, bookingId: bookingRef.id });
}
