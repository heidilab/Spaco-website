import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';

/**
 * POST /api/admin/booking-cleanup-fix
 *   { id: string; dryRun?: boolean; dropPaymentIndexes?: number[] }
 *
 * One-off repair tool for bookings whose pricing.subtotal got stored
 * pre-promo by the old admin-link flow + whose payments[] has duplicate
 * entries from the receipt-approve flow firing on top of a manual
 * "已於線下付款" record.
 *
 * Behaviour:
 *  - Recompute pricing.subtotal = max(0, baseCharge + addOnTotal − promoDiscount)
 *  - Drop the payments[] entries at the given indexes (descending, so
 *    later indexes don't shift earlier ones).
 *  - Recompute pricing.deposit:
 *      grandTotal ≤ 10000 → grandTotal (full)
 *      grandTotal >  10000 → round(grandTotal × 0.5)
 *  - Recompute balanceDue = max(0, grandTotal − sum(remaining payments))
 *  - dryRun=true reports proposed changes without writing.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      id?: string;
      dryRun?: boolean;
      dropPaymentIndexes?: number[];
      /** Drop custom add-ons whose id starts with these prefixes (e.g. "custom-"). */
      dropAddOnIdPrefixes?: string[];
      /** Drop custom add-ons by exact id match. */
      dropAddOnIds?: string[];
      /** Override promoDiscount (HK$). */
      setPromoDiscount?: number;
      /** Override addOnTotal (HK$). */
      setAddOnTotal?: number;
      /** Override adultCount (resync after admin guestCount edit drift). */
      setAdultCount?: number;
    };
    const id = body.id;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const dryRun = body.dryRun !== false;            // default TRUE for safety
    const drops = (body.dropPaymentIndexes || []).filter((n) => Number.isInteger(n) && n >= 0);
    const dropAddOnIdPrefixes = body.dropAddOnIdPrefixes || [];
    const dropAddOnIds = body.dropAddOnIds || [];

    // Resolve full id (allow 8-char prefix).
    let snap = await adminDb.collection('bookings').doc(id).get();
    let resolvedId = id;
    if (!snap.exists) {
      const all = await adminDb.collection('bookings').get();
      const hit = all.docs.find((d) => d.id.startsWith(id));
      if (!hit) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      snap = hit;
      resolvedId = hit.id;
    }
    const b = snap.data() as {
      pricing?: { baseCharge?: number; addOnTotal?: number; subtotal?: number; securityDeposit?: number; deposit?: number };
      promoDiscount?: number;
      balanceDue?: number;
      payments?: Array<{ amount?: number }>;
      addOns?: Array<{ id?: string; quantity?: number; options?: { customName?: string; customPrice?: number } }>;
    };

    const baseCharge = b.pricing?.baseCharge ?? 0;
    const storedAddOnTotal = b.pricing?.addOnTotal ?? 0;
    const storedPromoDiscount = b.promoDiscount ?? 0;
    const securityDeposit = b.pricing?.securityDeposit ?? 0;

    // Filter add-ons.
    const allAddOns = b.addOns || [];
    const droppedAddOns = allAddOns.filter((a) =>
      (a.id ? dropAddOnIds.includes(a.id) : false)
      || (a.id ? dropAddOnIdPrefixes.some((pfx) => a.id!.startsWith(pfx)) : false)
    );
    const remainingAddOns = allAddOns.filter((a) => !droppedAddOns.includes(a));

    // Apply overrides if supplied; otherwise keep stored.
    const addOnTotal = typeof body.setAddOnTotal === 'number'
      ? Math.max(0, body.setAddOnTotal)
      : storedAddOnTotal;
    const promoDiscount = typeof body.setPromoDiscount === 'number'
      ? Math.max(0, body.setPromoDiscount)
      : storedPromoDiscount;

    const newSubtotal = Math.max(0, baseCharge + addOnTotal - promoDiscount);

    // Filter remaining payments after dropping the requested indexes.
    const allPayments = b.payments || [];
    const remaining = allPayments.filter((_, i) => !drops.includes(i));
    const dropped = drops.map((i) => ({ index: i, entry: allPayments[i] })).filter((d) => d.entry);

    const newGrandTotal = newSubtotal + securityDeposit;
    const newDeposit = newGrandTotal <= 10000 ? newGrandTotal : Math.round(newGrandTotal * 0.5);
    const remainingSum = remaining.reduce((s, p) => s + (p.amount ?? 0), 0);
    const newBalanceDue = Math.max(0, newGrandTotal - remainingSum);

    const proposal = {
      id: resolvedId,
      dryRun,
      before: {
        subtotal: b.pricing?.subtotal,
        deposit: b.pricing?.deposit,
        balanceDue: b.balanceDue,
        paymentsCount: allPayments.length,
        paymentsSum: allPayments.reduce((s, p) => s + (p.amount ?? 0), 0),
        addOnsCount: allAddOns.length,
        promoDiscount: storedPromoDiscount,
        addOnTotal: storedAddOnTotal,
      },
      after: {
        subtotal: newSubtotal,
        deposit: newDeposit,
        balanceDue: newBalanceDue,
        paymentsCount: remaining.length,
        paymentsSum: remainingSum,
        addOnsCount: remainingAddOns.length,
        promoDiscount,
        addOnTotal,
      },
      dropped,
      droppedAddOns,
      formula: `subtotal = max(0, baseCharge ${baseCharge} + addOnTotal ${addOnTotal} − promo ${promoDiscount}) = ${newSubtotal}`,
    };

    if (!dryRun) {
      const update: Record<string, unknown> = {
        'pricing.subtotal': newSubtotal,
        'pricing.deposit': newDeposit,
        'pricing.addOnTotal': addOnTotal,
        balanceDue: newBalanceDue,
        payments: remaining,                              // overwrite array
        addOns: remainingAddOns,                          // overwrite array
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (typeof body.setPromoDiscount === 'number') {
        update.promoDiscount = promoDiscount;
        // Keep promoFreeDrinksCost in lockstep when this booking has a
        // free_drinks promo — otherwise updateBookingDateTime's later
        // recompute treats the old promoFreeDrinksCost as the
        // free_drinks marker but the actual promo amount drifts.
        if (
          typeof b.promoFreeDrinksCost === 'number'
          && b.promoFreeDrinksCost > 0
        ) {
          update.promoFreeDrinksCost = promoDiscount;
        }
      }
      if (typeof body.setAdultCount === 'number') {
        update.adultCount = Math.max(0, body.setAdultCount);
      }
      await adminDb.collection('bookings').doc(resolvedId).update(update);
    }

    return NextResponse.json({ ok: true, ...proposal });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
