import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/admin/scan-loyalty-points
 *
 * Sweep every booking that's been credited loyalty points and compare:
 *   stored pointsActuallyCredited
 *   vs
 *   expectedPoints = max(0, baseCharge + addOnTotal − promo − pointsDiscount)
 *                    + consumedDeposit
 *
 * Surfaces bookings whose credited points drifted from the spend the
 * customer actually made (convention-drift bug — code used to subtract
 * promo from stored subtotal regardless of whether subtotal was PRE-
 * or POST-promo, causing under-credit on POST-promo bookings like
 * #CS27eAN4 by exactly the promo amount).
 *
 * Returns negative `delta` = under-credited (customer owed more pts),
 * positive `delta` = over-credited (customer got extra).
 */
export async function GET() {
  const all = await adminDb.collection('bookings').get();
  const affected: Array<Record<string, unknown>> = [];
  for (const doc of all.docs) {
    const b = doc.data() as {
      pricing?: { baseCharge?: number; addOnTotal?: number; subtotal?: number; securityDeposit?: number };
      promoDiscount?: number;
      promoCode?: string;
      pointsDiscount?: number;
      pointsActuallyCredited?: number;
      depositRefund?: { deductions?: Array<{ amount?: number }> };
      status?: string;
      userId?: string;
      date?: string;
      venueId?: string;
    };
    const stored = b.pointsActuallyCredited;
    if (typeof stored !== 'number' || stored <= 0) continue;
    const baseCharge = b.pricing?.baseCharge ?? 0;
    const addOnTotal = b.pricing?.addOnTotal ?? 0;
    const securityDeposit = b.pricing?.securityDeposit ?? 0;
    const promoDiscount = b.promoDiscount ?? 0;
    const pointsDiscount = b.pointsDiscount ?? 0;
    const deductionsTotal = (b.depositRefund?.deductions || []).reduce((s, d) => s + (d.amount ?? 0), 0);
    const consumedDeposit = Math.min(securityDeposit, deductionsTotal);
    const overflowPaid = Math.max(0, deductionsTotal - securityDeposit);
    const expected = Math.max(0, baseCharge + addOnTotal - promoDiscount - pointsDiscount) + consumedDeposit + overflowPaid;
    const delta = expected - stored;
    if (Math.abs(delta) < 1) continue;
    affected.push({
      id: doc.id.slice(0, 8),
      fullId: doc.id,
      userId: b.userId,
      venueId: b.venueId,
      date: b.date,
      promoCode: b.promoCode,
      promoDiscount,
      baseCharge,
      addOnTotal,
      storedSubtotal: b.pricing?.subtotal,
      securityDeposit,
      consumedDeposit,
      stored,
      expected,
      delta,
      direction: delta > 0 ? 'under-credited (owe customer)' : 'over-credited (customer has extra)',
    });
  }
  affected.sort((a, b) => Math.abs((b.delta as number)) - Math.abs((a.delta as number)));
  return NextResponse.json({ count: affected.length, affected });
}
