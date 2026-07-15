import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

/**
 * POST /api/admin/fix-free-drinks-promo
 *   { bookingId: string }
 *
 * Recalculates promoDiscount for bookings where the promo is free_drinks
 * type and the stored promoDiscount no longer matches the current pax
 * (e.g. after a customer self-modify). Also adjusts balanceDue by the diff.
 *
 * Does NOT touch blocked_slots or run a slot conflict check — pure pricing
 * patch, never throws SLOT_CONFLICT.
 */
export async function POST(req: NextRequest) {
  const _gate = await requireAdmin(req, 'bookings');
  if (!_gate.ok) return _gate.res;

  const { bookingId } = await req.json() as { bookingId: string };
  if (!bookingId) {
    return NextResponse.json({ error: 'missing bookingId' }, { status: 400 });
  }

  const ref = adminDb.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const b = snap.data() as {
    promoFreeDrinksCost?: number;
    promoDiscount?: number;
    balanceDue?: number;
    guestCount?: number;
    childCount?: number;
    addOns?: Array<{ id: string }>;
    venueId?: string;
  };

  const isFreeDrinksPromo = typeof b.promoFreeDrinksCost === 'number' && b.promoFreeDrinksCost > 0;
  if (!isFreeDrinksPromo) {
    return NextResponse.json({ ok: true, message: 'not a free_drinks promo — nothing to fix' });
  }

  const hasDrinks = (b.addOns || []).some((a) => a.id === 'drinks');
  if (!hasDrinks) {
    return NextResponse.json({ ok: true, message: 'drinks add-on not present — nothing to fix' });
  }

  const guests = b.guestCount ?? 0;
  const children = b.childCount ?? 0;
  const adults = Math.max(0, guests - children);
  const adultEquiv = adults + 0.5 * children;

  // TST includes non-alcoholic drinks in the base rate — no extra discount.
  const freeDrinksVenues = ['tst'];
  const newPromoDiscount = freeDrinksVenues.includes(b.venueId ?? '')
    ? 0
    : Math.round(25 * adultEquiv);

  const oldPromoDiscount = b.promoDiscount ?? 0;
  const promoDiff = newPromoDiscount - oldPromoDiscount;

  if (promoDiff === 0) {
    return NextResponse.json({ ok: true, message: 'already correct — no change needed' });
  }

  // balanceDue decreases when promo increases (more discount = less owed).
  const oldBalance = b.balanceDue ?? 0;
  const newBalance = Math.max(0, oldBalance - promoDiff);

  await ref.update({
    promoDiscount: newPromoDiscount,
    promoFreeDrinksCost: newPromoDiscount,
    balanceDue: newBalance,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
    ok: true,
    oldPromoDiscount,
    newPromoDiscount,
    promoDiff,
    oldBalance,
    newBalance,
  });
}
