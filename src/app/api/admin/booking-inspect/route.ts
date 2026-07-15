import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireCronSecret } from '@/lib/adminAuth';

export const runtime = 'nodejs';

/**
 * GET /api/admin/booking-inspect?id=BOOKING_ID
 *
 * Diagnostic: dump everything we know about a booking — pricing, raw
 * payments[], promo fields, and a computed 「what should be」 reference
 * (post-promo subtotal, grandTotal, sum of payments) so we can see at
 * a glance where stored values diverge from expected math.
 */
export async function GET(req: NextRequest) {
  const _gate = requireCronSecret(req);
  if (_gate) return _gate;

  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Try direct lookup first; fall back to prefix-scan so the admin UI
    // can paste the 8-char display id (e.g. "#DgmfwXjX") without having
    // to find the full 20-char Firestore doc id.
    let snap = await adminDb.collection('bookings').doc(id).get();
    let resolvedId = id;
    if (!snap.exists) {
      const all = await adminDb.collection('bookings').get();
      const hit = all.docs.find((d) => d.id.startsWith(id));
      if (!hit) return NextResponse.json({ error: 'Booking not found (tried direct + prefix)' }, { status: 404 });
      snap = hit;
      resolvedId = hit.id;
    }

    const b = snap.data() as Record<string, unknown> & {
      pricing?: {
        baseCharge?: number;
        addOnTotal?: number;
        subtotal?: number;
        securityDeposit?: number;
        deposit?: number;
      };
      payments?: Array<{
        amount?: number;
        rentalAmount?: number;
        addOnAmount?: number;
        depositAmount?: number;
        method?: string;
        kind?: string;
        note?: string | null;
        recordedAt?: unknown;
        recordedBy?: string;
      }>;
      promoDiscount?: number;
      promoCode?: string;
      promoCodeId?: string;
      promoFreeDrinksCost?: number;
      pointsDiscount?: number;
      balanceDue?: number;
      status?: string;
      addOns?: Array<{ id?: string; quantity?: number }>;
    };

    const p = b.pricing || {};
    const base = p.baseCharge ?? 0;
    const addOn = p.addOnTotal ?? 0;
    const promoDiscount = b.promoDiscount ?? 0;
    const securityDeposit = p.securityDeposit ?? 0;
    const storedSubtotal = p.subtotal ?? 0;
    const storedDeposit = p.deposit ?? 0;
    const storedBalanceDue = b.balanceDue ?? 0;

    const expectedPrePromo = base + addOn;
    const expectedPostPromo = Math.max(0, expectedPrePromo - promoDiscount);
    const expectedGrandTotal = expectedPostPromo + securityDeposit;

    const payments = b.payments || [];
    const paymentsSum = payments.reduce((s, x) => s + (x.amount ?? 0), 0);
    const expectedBalance = Math.max(0, expectedGrandTotal - paymentsSum);

    // Fetch promo doc if linked so we can see if it was free_drinks etc.
    let promoDoc: Record<string, unknown> | null = null;
    if (b.promoCodeId) {
      const promoSnap = await adminDb.collection('promo_codes').doc(b.promoCodeId).get();
      if (promoSnap.exists) promoDoc = promoSnap.data() ?? null;
    }

    return NextResponse.json({
      id: resolvedId,
      status: b.status,
      addOns: b.addOns ?? [],
      pricing: {
        baseCharge: base,
        addOnTotal: addOn,
        storedSubtotal,
        storedSecurityDeposit: securityDeposit,
        storedDeposit,
        storedBalanceDue,
      },
      promoCode: b.promoCode,
      promoCodeId: b.promoCodeId,
      promoDoc,
      promoFreeDrinksCost: b.promoFreeDrinksCost,
      promoDiscount,
      pointsDiscount: b.pointsDiscount ?? 0,
      expected: {
        prePromoSubtotal: expectedPrePromo,
        postPromoSubtotal: expectedPostPromo,
        grandTotal: expectedGrandTotal,
        paymentsSum,
        balanceDue: expectedBalance,
      },
      discrepancies: {
        subtotalStoresPrePromo: storedSubtotal === expectedPrePromo && promoDiscount > 0,
        subtotalIsPostPromo: storedSubtotal === expectedPostPromo,
        balanceMismatch: storedBalanceDue !== expectedBalance,
      },
      payments: payments.map((x, i) => ({
        i,
        amount: x.amount,
        method: x.method,
        kind: x.kind,
        note: x.note,
        recordedBy: x.recordedBy,
        recordedAt: (x.recordedAt as { toDate?: () => Date; seconds?: number })?.toDate?.()?.toISOString()
          ?? ((x.recordedAt as { seconds?: number })?.seconds
            ? new Date(((x.recordedAt as { seconds: number })).seconds * 1000).toISOString()
            : x.recordedAt),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
