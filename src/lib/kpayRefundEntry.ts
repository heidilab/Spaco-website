// A KPay refund as a payments[] entry (site review 2026-11-13 #26): the
// money out shows in finance and on the booking without staff adding a
// negative payment by hand. Idempotent on the refund's trade number;
// balanceDue is never touched (review #7).

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';

export async function recordKpayRefundEntry(bookingId: string, refund: {
  amount: number; kpayOrderNo?: string | null; refundOutTradeNo: string; kpayRefundOrderNo?: string | null; recordedBy?: string;
}): Promise<boolean> {
  const ref = adminDb.collection('bookings').doc(bookingId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const payments = (snap.data()?.payments || []) as Array<{ refundOutTradeNo?: string }>;
    if (payments.some((p) => p.refundOutTradeNo === refund.refundOutTradeNo)) return false;
    tx.update(ref, {
      payments: FieldValue.arrayUnion({
        amount: Math.round(refund.amount * 100) / 100,
        rentalAmount: 0, addOnAmount: 0, depositAmount: 0,
        isRefund: true, kind: 'refund', method: 'kpay',
        kpayOrderNo: refund.kpayOrderNo || null, refundOutTradeNo: refund.refundOutTradeNo, kpayRefundOrderNo: refund.kpayRefundOrderNo || null,
        note: 'KPay 退款', recordedBy: refund.recordedBy || 'kpay', recordedAt: new Date().toISOString(),
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}
