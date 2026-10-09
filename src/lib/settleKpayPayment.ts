import { adminDb } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { BookingRecord, PromoCode } from '@/types';
import { settlementDecision } from './paymentSettlement';

export interface SalePayment {
  transactionNo: string; orderNo: string; payAmount: number; payMethodId?: number;
}

/** Marker, ledger and reward consumption commit together, or not at all. */
export async function settleKpayPayment(bookingId: string, tradeNo: string, payment: SalePayment, isBalancePayment: boolean) {
  const ref = adminDb.collection('bookings').doc(bookingId);
  const marker = adminDb.collection('_kpay_webhook_events').doc(payment.transactionNo);
  return adminDb.runTransaction(async tx => {
    const [event, snap, order] = await Promise.all([tx.get(marker), tx.get(ref), tx.get(adminDb.collection('_kpay_orders').doc(tradeNo))]);
    if (event.exists) return { duplicate: true, review: event.data()?.review || null };
    if (!snap.exists) throw new Error('BOOKING_NOT_FOUND');
    const b = snap.data() as BookingRecord;
    // Also handles retries of legacy callbacks whose marker was lost.
    if (b.payments?.some(p => p.kpayTransactionNo === payment.transactionNo)) {
      tx.create(marker, { bookingId, legacy: true, processedAt: FieldValue.serverTimestamp() });
      return { duplicate: true, review: null };
    }
    const userRef = adminDb.collection('users').doc(b.userId);
    const user = await tx.get(userRef);
    const promoRef = b.promoCodeId ? adminDb.collection('promo_codes').doc(b.promoCodeId) : null;
    const promo = promoRef ? await tx.get(promoRef) : null;
    // Query legacy redemption records too; concurrent redemptions serialize on promoRef.
    const previous = b.promoCodeId && !b.promoRedeemedAt
      ? await tx.get(adminDb.collection('bookings').where('userId', '==', b.userId)) : null;
    const userUses = previous?.docs.filter(d => d.data().promoCodeId === b.promoCodeId && d.data().promoRedeemedAt).length || 0;
    const surcharge = order.exists ? order.data()!.surcharge : b.kpaySurcharges?.[tradeNo] || 0;
    const credit = Math.round((payment.payAmount - surcharge) * 100) / 100;
    if (!Number.isFinite(credit) || credit <= 0) throw new Error('INVALID_CREDIT');
    const decision = settlementDecision(b, credit, user.data()?.loyaltyPoints || 0, promo?.data() as PromoCode | undefined, userUses, Date.now());
    if (order.exists && (order.data()!.bookingId !== bookingId || Math.abs(order.data()!.amount - credit) > 0.005)) {
      decision.review = 'payment_amount_mismatch';
      decision.status = ['cancelled', 'payment_not_completed'].includes(b.status) ? b.status : 'awaiting_review';
    }
    const patch: Record<string, unknown> = {
      payments: [...(b.payments || []), {
        rentalAmount: 0, addOnAmount: 0, depositAmount: 0, amount: credit,
        method: 'kpay', kind: isBalancePayment ? 'balance' : 'initial', note: 'KPay',
        recordedBy: 'kpay-webhook', recordedAt: new Date().toISOString(),
        cardSurcharge: surcharge, kpayTransactionNo: payment.transactionNo,
        kpayOrderNo: payment.orderNo, kpayPayMethodId: payment.payMethodId ?? null,
      }],
      balanceDue: decision.balanceDue, status: decision.status, paymentMethod: 'kpay',
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (decision.review) {
      patch.paymentReviewRequired = true;
      patch.paymentReviewReason = decision.review;
      // No slot/lock/email side effects; the payment remains visible for reconciliation.
    } else {
      patch.pendingExpiresAt = FieldValue.delete();
      if (!b.pointsRedeemedAt && (b.pointsUsed || 0) > 0) {
        tx.update(userRef, { loyaltyPoints: (user.data()?.loyaltyPoints || 0) - b.pointsUsed! });
        patch.pointsRedeemedAt = FieldValue.serverTimestamp();
        patch.pointsActuallyDeducted = b.pointsUsed;
      }
      if (promoRef && !b.promoRedeemedAt) {
        tx.update(promoRef, { totalUsageCount: FieldValue.increment(1) });
        patch.promoRedeemedAt = FieldValue.serverTimestamp();
      }
      if (!decision.balanceDue) {
        if (!b.balancePaidAt) patch.balancePaidAt = FieldValue.serverTimestamp();
        if (!b.paymentVerifiedAt) patch.paymentVerifiedAt = FieldValue.serverTimestamp();
      }
      tx.set(adminDb.collection('_payment_finalizations').doc(payment.transactionNo), {
        bookingId, isBalancePayment, status: 'pending', createdAt: Date.now(), leaseUntil: 0,
      });
    }
    tx.update(ref, patch);
    tx.create(marker, { bookingId, transactionNo: payment.transactionNo, review: decision.review, processedAt: FieldValue.serverTimestamp() });
    return { duplicate: false, review: decision.review };
  });
}
