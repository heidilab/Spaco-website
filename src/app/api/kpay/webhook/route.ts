import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyNotifyMulti, isTransactionSuccess, getMid } from '@/lib/kpay';
import { settleKpayPayment } from '@/lib/settleKpayPayment';
import { runPaymentFinalization } from '@/lib/paymentFinalization';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';
// finalizeConfirmedBooking runs ~20 sequential awaits (Firestore reads,
// 3 emails, Google Calendar, staff + supplier notify). Under the default
// ~10s timeout the LAST steps (staff notification) were being killed
// mid-run, and KPay's retry hit the idempotency marker and skipped — so
// staff never got notified of the first real KPay booking. Give it room.
export const maxDuration = 60;

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
  transactionTypeId?: number;   // 15=sale 31=refund (observed in UAT)
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
  // We try a handful of signing conventions because KPay's notify format
  // isn't fully documented in the materials we have; verifyNotifyMulti
  // returns which variant matched so we can lock down to it later.
  const fullNotifyUrl = `${req.nextUrl.origin}/api/kpay/webhook`;
  const verifyResult = verifyNotifyMulti({
    method: 'POST',
    url: '/api/kpay/webhook',
    fullNotifyUrl,
    signature,
    timestamp,
    nonce,
    merchantCode,
    body: rawBody,
  });
  if (!verifyResult.ok) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }
  console.log('[kpay/webhook] signature OK via variant:', verifyResult.variant);

  let payload: KPayNotifyPayload;
  try {
    payload = JSON.parse(rawBody) as KPayNotifyPayload;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (merchantCode !== getMid() || payload.merchantCode !== getMid()
    || typeof payload.transactionNo !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(payload.transactionNo)
    || typeof payload.orderNo !== 'string' || typeof payload.outTradeNo !== 'string'
    || !Number.isFinite(payload.payAmount) || payload.payCurrency !== 'HKD') {
    return NextResponse.json({ error: 'invalid payment payload' }, { status: 400 });
  }

  // REFUND callbacks (fired by /v1/refund) get their own handler. They
  // recover the booking from our refund outTradeNo (R<bookingId>_<epoch>)
  // and append to kpayRefunds[] for audit — they do NOT auto-adjust
  // balanceDue/status (admin decides the booking-side consequence).
  //
  // ⚠️ KPay's docs describe a REFUND eventType, but in practice (UAT,
  // confirmed 2026-07-04) refund results arrive as eventType SALES with
  // transactionTypeId 31 and a NEGATIVE payAmount. Accept both shapes —
  // otherwise refunds fall through to the sales branch and are silently
  // dropped as booking-not-found.
  const isRefundNotify =
    payload.eventType === 'REFUND'
    || payload.transactionTypeId === 31
    || (typeof payload.payAmount === 'number' && payload.payAmount < 0);
  if (isRefundNotify) {
    return handleRefundNotify(payload);
  }

  // Everything else (chargebacks, etc.) is acknowledged but not acted on.
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

  const mapped = /^[A-Za-z0-9_-]+$/.test(managedTradeNo) ? await adminDb.collection('_kpay_orders').doc(managedTradeNo).get() : null;
  if (mapped?.exists) {
    const snap = await adminDb.collection('bookings').doc(mapped.data()!.bookingId).get();
    if (snap.exists) { bookingRef = snap.ref; booking = { ...snap.data(), id: snap.id } as BookingRecord; }
  }
  if (!mapped?.exists && bookingIdPrefix) {
    // Try exact lookup first when prefix happens to be full-length.
    const directSnap = await adminDb.collection('bookings').doc(bookingIdPrefix).get();
    if (directSnap.exists) {
      bookingRef = directSnap.ref;
      booking = { id: directSnap.id, ...directSnap.data() } as BookingRecord;
    } else {
      // Firestore can't prefix-query by doc id directly, so we scan and
      // match by prefix. Fine for our scale (~50 bookings/month).
      const all = await adminDb.collection('bookings').get();
      const hits = all.docs.filter((d) => d.id.startsWith(bookingIdPrefix));
      const hit = hits.length === 1 ? hits[0] : undefined;
      if (hit) {
        bookingRef = hit.ref;
        booking = { id: hit.id, ...hit.data() } as BookingRecord;
      }
    }
  }

  if (!bookingRef || !booking) {
    await adminDb.collection('_payment_reconciliation').doc(payload.transactionNo).set({ managedTradeNo, transactionNo: payload.transactionNo, amount: payload.payAmount, reason: 'booking_not_found', receivedAt: FieldValue.serverTimestamp() });
    // ACK so KPay stops retrying — but log for manual reconciliation.
    return NextResponse.json({ ok: true, notFound: true, managedTradeNo });
  }

  try {
    const result = await settleKpayPayment(bookingRef.id, managedTradeNo, payload, isBalancePayment);
    if (!result.review) {
      // A duplicate callback can recover unfinished side effects without crediting twice.
      waitUntil(runPaymentFinalization(payload.transactionNo, req.nextUrl.origin).catch(() => {
        console.warn('[kpay/webhook] finalization queued for retry');
      }));
    }
    return NextResponse.json({ ok: true, bookingId: bookingRef.id, ...result });
  } catch {
    return NextResponse.json({ error: 'settlement-failed' }, { status: 500 });
  }

}

/**
 * Find a booking by the id-prefix encoded in a managed/refund trade no.
 * Our trade numbers embed the first 12 chars of the bookingId:
 *   sales:  B<bookingIdFirst12>_<P|B><epoch>
 *   refund: R<bookingIdFirst12>_<epoch>
 */
async function findBookingByTradePrefix(
  prefix: string,
): Promise<{ ref: FirebaseFirestore.DocumentReference; booking: BookingRecord } | null> {
  if (!prefix) return null;
  const directSnap = await adminDb.collection('bookings').doc(prefix).get();
  if (directSnap.exists) {
    return { ref: directSnap.ref, booking: { id: directSnap.id, ...directSnap.data() } as BookingRecord };
  }
  const all = await adminDb.collection('bookings').get();
  const hits = all.docs.filter((d) => d.id.startsWith(prefix));
  const hit = hits.length === 1 ? hits[0] : undefined;
  if (hit) {
    return { ref: hit.ref, booking: { id: hit.id, ...hit.data() } as BookingRecord };
  }
  return null;
}

/**
 * Record a refund result on the booking. Idempotent on the refund's
 * transactionNo. Does not change balanceDue/status — the security-deposit
 * settlement flow and admin offline-payment tools own that math.
 */
async function handleRefundNotify(payload: KPayNotifyPayload) {
  // Refund outTradeNo is our own R<bookingIdFirst12>_<epoch>.
  const tradeNo = payload.outTradeNo || '';
  const bookingIdPrefix = tradeNo.startsWith('R')
    ? tradeNo.slice(1).split('_')[0]
    : '';
  const found = await findBookingByTradePrefix(bookingIdPrefix);
  if (!found) {
    console.error('[kpay/webhook] REFUND booking not found for', tradeNo);
    return NextResponse.json({ ok: true, notFound: true, tradeNo });
  }
  const { ref } = found;
  await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const existing = snap.data()?.kpayRefunds || [];
    const prior = existing.find((r: { kpayTransactionNo: string }) => r.kpayTransactionNo === payload.transactionNo);
    if (prior?.state === 2 || prior?.state === payload.transactionState) return;
    tx.update(ref, {
      kpayRefunds: [...existing.filter((r: { kpayTransactionNo: string }) => r.kpayTransactionNo !== payload.transactionNo), {
        amount: payload.payAmount, state: payload.transactionState,
        stateDesc: payload.transactionStateDesc || null, kpayOrderNo: payload.orderNo,
        kpayTransactionNo: payload.transactionNo, refundOutTradeNo: tradeNo,
        recordedAt: new Date().toISOString(),
      }], updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return NextResponse.json({ ok: true, bookingId: ref.id, refund: true });
}
