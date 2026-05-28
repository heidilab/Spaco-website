import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { refundOrder, isKpayConfigured } from '@/lib/kpay';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';

/**
 * POST /api/kpay/refund
 *   { bookingId, kpayOrderNo?, refundAmount?, recordedBy? }
 *
 * Admin-triggered refund against a KPay card/QR payment. Refunds are
 * issued against the ORIGINAL transaction's orderNo (stored on the
 * payments[] entry as kpayOrderNo by the sales webhook) — NOT the
 * managedOrderNo. KPay rejects the managedOrderNo here.
 *
 * - kpayOrderNo omitted → refund the most recent KPay payment.
 * - refundAmount omitted → refund that payment's full amount.
 *
 * This endpoint only FIRES the refund and returns KPay's synchronous
 * result. The booking record is updated by the REFUND webhook
 * (idempotent), so a missed/duplicated sync response can't double-book
 * a refund entry.
 */
export async function POST(req: NextRequest) {
  try {
    if (!isKpayConfigured()) {
      return NextResponse.json({ error: 'KPay is not configured' }, { status: 500 });
    }

    const body = (await req.json()) as {
      bookingId?: string;
      kpayOrderNo?: string;
      refundAmount?: number;
      recordedBy?: string;
    };
    const { bookingId } = body;
    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
    }

    const ref = adminDb.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    const booking = { id: snap.id, ...snap.data() } as BookingRecord;

    // Find the KPay payment to refund against. Each KPay sales entry
    // carries kpayOrderNo (the original transaction's orderNo).
    type KPayPayment = NonNullable<BookingRecord['payments']>[number] & {
      kpayOrderNo?: string;
      kpayTransactionNo?: string;
    };
    const kpayPayments = (booking.payments || []).filter(
      (p): p is KPayPayment => !!(p as KPayPayment).kpayOrderNo,
    );
    if (kpayPayments.length === 0) {
      return NextResponse.json(
        { error: 'No KPay payment found on this booking to refund' },
        { status: 400 },
      );
    }

    const target = body.kpayOrderNo
      ? kpayPayments.find((p) => p.kpayOrderNo === body.kpayOrderNo)
      : kpayPayments[kpayPayments.length - 1];
    if (!target || !target.kpayOrderNo) {
      return NextResponse.json(
        { error: 'Matching KPay payment not found' },
        { status: 400 },
      );
    }

    const refundAmount =
      typeof body.refundAmount === 'number' && body.refundAmount > 0
        ? body.refundAmount
        : target.amount;
    if (!refundAmount || refundAmount <= 0) {
      return NextResponse.json({ error: 'refundAmount must be > 0' }, { status: 400 });
    }

    // Unique merchant trade number for this refund (≤32 chars):
    //   R<bookingIdFirst12>_<epoch>
    const refundOutTradeNo = `R${bookingId.slice(0, 12)}_${Date.now()}`;
    const origin = req.nextUrl.origin;
    const notifyUrl = `${origin}/api/kpay/webhook`;

    const result = await refundOrder({
      outTradeNo: refundOutTradeNo,
      oriOrderNo: target.kpayOrderNo,
      refundAmount,
      notifyUrl,
    });

    return NextResponse.json({
      ok: result.ok,
      code: result.code,
      result: result.result,          // 1 pending / 2 success / 3 failed
      reason: result.reason,
      message: result.message,
      refundOrderNo: result.orderNo,
      refundOutTradeNo,
      oriOrderNo: target.kpayOrderNo,
      refundAmount,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'refund failed' },
      { status: 500 },
    );
  }
}
