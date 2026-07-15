import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireCronSecret } from '@/lib/adminAuth';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-off repair: KPay payments recorded by the pre-batch-1 webhook
 * (go-live morning 2026-07-15) were hard-labelled method:'stripe' even
 * though they carry a kpayOrderNo. Relabel those payment entries (and
 * the booking-level paymentMethod) to 'kpay'.
 *
 * A payment is a mislabelled KPay charge iff it has a kpayOrderNo /
 * kpayTransactionNo but method !== 'kpay'. Genuine Stripe charges have
 * no kpayOrderNo, so they're left untouched.
 *
 * GET  ?dryRun=1  → report what WOULD change (default: dry-run)
 * GET  ?apply=1   → actually write
 * Gated by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const gate = requireCronSecret(req);
  if (gate) return gate;

  const apply = req.nextUrl.searchParams.get('apply') === '1';
  const snap = await adminDb.collection('bookings').get();
  const changes: unknown[] = [];
  let bookingsWritten = 0;

  for (const doc of snap.docs) {
    const b = { id: doc.id, ...doc.data() } as BookingRecord;
    const payments = b.payments || [];
    let touched = false;
    const newPayments = payments.map((p) => {
      const kp = p as typeof p & { kpayOrderNo?: string; kpayTransactionNo?: string };
      const isKpay = !!(kp.kpayOrderNo || kp.kpayTransactionNo);
      if (isKpay && p.method !== 'kpay') {
        touched = true;
        return { ...p, method: 'kpay' as const };
      }
      return p;
    });

    if (!touched) continue;

    // Fix booking-level paymentMethod too if it was the stripe placeholder
    // and every recorded payment is now KPay.
    const allKpay = newPayments.every((p) => {
      const kp = p as typeof p & { kpayOrderNo?: string };
      return !!kp.kpayOrderNo || p.method === 'kpay';
    });
    const newPaymentMethod =
      allKpay && b.paymentMethod === 'stripe' ? 'kpay' : b.paymentMethod;

    changes.push({
      id: b.id,
      date: b.date,
      relabelled: newPayments.filter((p, i) => p.method !== payments[i].method).length,
      paymentMethod: `${b.paymentMethod} → ${newPaymentMethod}`,
    });

    if (apply) {
      await doc.ref.update({
        payments: newPayments,
        ...(newPaymentMethod !== b.paymentMethod ? { paymentMethod: newPaymentMethod } : {}),
      });
      bookingsWritten++;
    }
  }

  return NextResponse.json({
    mode: apply ? 'APPLIED' : 'DRY_RUN',
    scannedAt: new Date().toISOString(),
    totalBookings: snap.size,
    affectedBookings: changes.length,
    bookingsWritten,
    changes,
  });
}
