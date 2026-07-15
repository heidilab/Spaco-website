import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { computeGrandTotal } from '@/lib/finalizeBooking';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only diagnostic — surfaces bookings damaged by the pre-fix KPay
 * webhook / expire cron:
 *   A) PAID BUT KILLED — has payments[] yet status is
 *      payment_not_completed / cancelled (cron swept a paid deposit).
 *   B) PHANTOM BALANCE — payments already cover the canonical grand
 *      total, but balanceDue is still > 0 (webhook ignored promo/points).
 *   C) STUCK AWAITING — has payments[] but status awaiting_payment
 *      (should be confirmed).
 *
 * Gated by CRON_SECRET (Authorization: Bearer <secret>) since the
 * broader admin-auth pass lands in a later batch. Mutates nothing.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const snap = await adminDb.collection('bookings').get();
  const paidButKilled: unknown[] = [];
  const phantomBalance: unknown[] = [];
  const stuckAwaiting: unknown[] = [];

  for (const doc of snap.docs) {
    const b = { id: doc.id, ...doc.data() } as BookingRecord;
    const payments = b.payments || [];
    const paidSum = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const hasPayments = payments.length > 0;
    const status = b.status || '';
    const grandTotal = computeGrandTotal(b);
    const correctBalance = Math.max(0, Math.round((grandTotal - paidSum) * 100) / 100);
    const storedBalance = b.balanceDue ?? 0;

    const row = {
      id: b.id, status, storedBalance, correctBalance,
      grandTotal, paidSum,
      promoDiscount: b.promoDiscount || 0,
      pointsDiscount: b.pointsDiscount || 0,
      date: b.date, venueId: b.venueId,
    };

    if (hasPayments && (status === 'payment_not_completed' || status === 'cancelled')) {
      paidButKilled.push(row);
    } else if (hasPayments && Math.abs(storedBalance - correctBalance) >= 1) {
      phantomBalance.push(row);
    } else if (hasPayments && status === 'awaiting_payment') {
      stuckAwaiting.push(row);
    }
  }

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    totalBookings: snap.size,
    counts: {
      paidButKilled: paidButKilled.length,
      phantomBalance: phantomBalance.length,
      stuckAwaiting: stuckAwaiting.length,
    },
    paidButKilled,
    phantomBalance,
    stuckAwaiting,
  });
}
