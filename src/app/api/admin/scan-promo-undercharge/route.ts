import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/admin/scan-promo-undercharge
 *
 * Sweep every confirmed/completed booking that has a promo applied and
 * flag the ones where the customer was UNDERCHARGED by exactly the
 * promo amount — the #QotleDvT pattern caused by commit c2e617a:
 * admin/bookings/new stored POST-promo subtotal, then claim → confirm
 * page subtracted promo a SECOND time, so Stripe charged
 * (subtotal − promo) + securityDeposit instead of the correct
 * (subtotal + securityDeposit).
 *
 * For each suspect booking, report:
 *  - 8-char display id
 *  - venue + date
 *  - expected grand total vs sum(payments)
 *  - delta the customer still owes
 *  - whether deposit field was undercharged by exactly promoDiscount
 */
export async function GET() {
  const all = await adminDb.collection('bookings').get();
  const suspects: Array<Record<string, unknown>> = [];
  for (const doc of all.docs) {
    const b = doc.data() as {
      pricing?: { baseCharge?: number; addOnTotal?: number; subtotal?: number; securityDeposit?: number; deposit?: number };
      promoDiscount?: number;
      promoCode?: string;
      payments?: Array<{ amount?: number }>;
      balanceDue?: number;
      status?: string;
      date?: string;
      venueId?: string;
    };
    if (!b.promoDiscount || b.promoDiscount <= 0) continue;
    if (b.status !== 'confirmed' && b.status !== 'completed') continue;

    const baseCharge = b.pricing?.baseCharge ?? 0;
    const addOnTotal = b.pricing?.addOnTotal ?? 0;
    const securityDeposit = b.pricing?.securityDeposit ?? 0;
    const storedSubtotal = b.pricing?.subtotal ?? 0;
    const promoDiscount = b.promoDiscount;

    // Expected math (PRE-promo convention):
    //   effectiveSubtotal = baseCharge + addOnTotal − promo
    //   grandTotal        = effectiveSubtotal + securityDeposit
    const effectiveSubtotal = Math.max(0, baseCharge + addOnTotal - promoDiscount);
    const expectedGrandTotal = effectiveSubtotal + securityDeposit;
    const paymentsSum = (b.payments || []).reduce((s, p) => s + (p.amount ?? 0), 0);
    const delta = expectedGrandTotal - paymentsSum;

    if (Math.abs(delta) < 1) continue;          // already balanced
    const exactPromoUndercharge = Math.abs(delta - promoDiscount) < 1;

    suspects.push({
      id: doc.id.slice(0, 8),
      fullId: doc.id,
      venueId: b.venueId,
      date: b.date,
      promoCode: b.promoCode,
      promoDiscount,
      baseCharge,
      addOnTotal,
      storedSubtotal,
      securityDeposit,
      expectedGrandTotal,
      paymentsSum,
      delta,
      balanceDue: b.balanceDue ?? 0,
      exactPromoUndercharge,
      // Display whether the stored subtotal looks POST-promo (the
      // c2e617a artifact). When true, claim+confirm pages would have
      // double-subtracted the promo at confirmation time.
      subtotalStoresPostPromo: storedSubtotal === effectiveSubtotal,
    });
  }
  // Most-impacted first
  suspects.sort((a, b) => (b.delta as number) - (a.delta as number));
  return NextResponse.json({ count: suspects.length, suspects });
}
