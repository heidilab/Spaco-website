import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/admin/scan-payment-display
 *
 * Audits every confirmed/completed booking for PaymentHistory display
 * correctness. Reports bookings where the old grandTotal formula
 * (subtotal + securityDeposit) would have produced a phantom synth
 * row, vs the new primitives-based formula
 * (baseCharge + addOnTotal − promo + securityDeposit).
 *
 * After commit 295b68b, the new formula is live. This sweep should
 * return bookings where the OLD formula would have inflated 已收總額,
 * so we can spot-check that the new render fixes them.
 */
export async function GET() {
  const all = await adminDb.collection('bookings').get();
  const affected: Array<Record<string, unknown>> = [];
  for (const doc of all.docs) {
    const b = doc.data() as {
      pricing?: { baseCharge?: number; addOnTotal?: number; subtotal?: number; securityDeposit?: number; deposit?: number };
      promoDiscount?: number;
      payments?: Array<{ amount?: number }>;
      balanceDue?: number;
      status?: string;
      date?: string;
      venueId?: string;
      promoCode?: string;
    };
    if (b.status !== 'confirmed' && b.status !== 'completed') continue;

    const baseCharge = b.pricing?.baseCharge ?? 0;
    const addOnTotal = b.pricing?.addOnTotal ?? 0;
    const storedSubtotal = b.pricing?.subtotal ?? 0;
    const securityDeposit = b.pricing?.securityDeposit ?? 0;
    const promoDiscount = b.promoDiscount ?? 0;
    const balanceDue = b.balanceDue ?? 0;
    const paymentsSum = (b.payments || []).reduce((s, p) => s + (p.amount ?? 0), 0);

    // Old PaymentHistory formula (before commit 295b68b).
    const oldGrandTotal = storedSubtotal + securityDeposit;
    const oldActualPaid = Math.max(0, oldGrandTotal - balanceDue);
    const oldSynth = Math.max(0, oldActualPaid - paymentsSum);
    const oldDisplayedTotal = paymentsSum + oldSynth;

    // New PaymentHistory formula (after commit 295b68b).
    const newGrandTotal = Math.max(0, baseCharge + addOnTotal - promoDiscount) + securityDeposit;
    const newActualPaid = Math.max(0, newGrandTotal - balanceDue);
    const newSynth = Math.max(0, newActualPaid - paymentsSum);
    const newDisplayedTotal = paymentsSum + newSynth;

    if (oldDisplayedTotal === newDisplayedTotal) continue;  // display unchanged

    affected.push({
      id: doc.id.slice(0, 8),
      fullId: doc.id,
      venueId: b.venueId,
      date: b.date,
      promoCode: b.promoCode,
      promoDiscount,
      paymentsSum,
      balanceDue,
      oldDisplayedTotal,
      newDisplayedTotal,
      delta: oldDisplayedTotal - newDisplayedTotal,
      oldSynth,
      newSynth,
    });
  }
  affected.sort((a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number));
  return NextResponse.json({ count: affected.length, affected });
}
