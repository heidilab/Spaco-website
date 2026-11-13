// Per-booking transaction rows shared by the Sales Record export
// (財務總覽) and the Financial Master monthly tabs (月結).
//
// PURE module — no firebase, no xlsx.

import { hkDateOf } from './kpayReconcile';
import type { BookingRecord } from '@/types';

export interface BookingTransaction {
  /** HK calendar day the money moved, YYYY-MM-DD ('' when unknown). */
  date: string;
  /** Payment rail; refunds read `退款(<rail>)`. */
  method: string;
  /** Amount credited to the booking (negative for a refund). */
  amount: number;
  /** Card surcharge the customer paid on top of `amount`. */
  surcharge: number;
  note?: string;
}

/** Combine the synthetic initial payment with the audit log so each
 *  booking surfaces every transaction as its own row in the export. */
export function bookingTransactions(b: BookingRecord): BookingTransaction[] {
  const tx: BookingTransaction[] = [];
  const logged = b.payments || [];
  // Synthetic-initial derivation counts only money IN — a refund
  // entry must not resurrect a phantom initial-payment row.
  const loggedAmount = logged.reduce((s, p) => s + Math.max(0, p.amount || 0), 0);
  const totalPaid = b.pricing.deposit || 0;
  // Synthetic initial row covers LEGACY paid bookings whose deposit
  // predates the payments[] freeze. Never fabricate one for a booking
  // with no paid status — that's how unpaid ghosts grew fake FPS rows.
  const isPaid = b.status === 'confirmed' || b.status === 'completed' || !!b.paymentVerifiedAt;
  const initial = isPaid ? Math.max(0, totalPaid - loggedAmount) : 0;
  if (initial > 0) {
    tx.push({
      date: b.date,  // use booking date as proxy when createdAt isn't easily extractable here
      method: b.paymentMethod || 'stripe',
      amount: initial,
      surcharge: 0,
      note: 'Initial confirmation',
    });
  }
  for (const p of logged) {
    const isRefund = (p.amount || 0) < 0;
    tx.push({
      // HK calendar day — the same day the KPay statement shows. Slicing
      // the stored UTC timestamp put a 01:00 HKT payment on the day before.
      date: hkDateOf(p.recordedAt),
      method: isRefund ? `退款(${p.method})` : p.method,
      amount: p.amount || 0,
      surcharge: p.cardSurcharge || 0,
      note: p.note || undefined,
    });
  }
  return tx;
}
