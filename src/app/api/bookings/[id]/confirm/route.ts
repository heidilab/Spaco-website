import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { adminVerifyIdToken } from '@/lib/adminAuth';
import { calculateDeposit, adultEquivalent, freeDrinksVenues } from '@/lib/pricing';
import { calcPromoDiscount } from '@/lib/promoCodes';
import { BookingInputError, finiteNumber } from '@/lib/bookingSecurity';
import type { BookingRecord, PromoCode } from '@/types';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return NextResponse.json({ error: 'missing-token' }, { status: 401 });
  let uid: string;
  try { uid = (await adminVerifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }
  try {
    const body = await req.json();
    const ref = adminDb.collection('bookings').doc(params.id);
    await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new BookingInputError('BOOKING_NOT_FOUND');
      const booking = snap.data() as BookingRecord;
      if (booking.userId !== uid) throw new BookingInputError('FORBIDDEN');
      if (!['awaiting_payment', 'awaiting_review'].includes(booking.status) || booking.payments?.length
        || (booking.pendingExpiresAt && booking.pendingExpiresAt <= Date.now())) throw new BookingInputError('BOOKING_NOT_EDITABLE');
      // Never rewrite the price while a signed payment link may still be open.
      const orders = await tx.get(adminDb.collection('_checkout_orders').where('bookingId', '==', params.id));
      if (!orders.empty) throw new BookingInputError('PAYMENT_ALREADY_STARTED');
      const profile = await tx.get(adminDb.collection('users').doc(uid));
      let addOns = booking.addOns || [];
      const pricing = { ...booking.pricing };
      let discount = booking.promoDiscount || 0;
      let codeId = booking.promoCodeId || null;
      let codeText = booking.promoCode || null;
      let freeDrinksCost = booking.promoFreeDrinksCost || 0;
      // CS quotes are immutable commercial terms. Customers may add points,
      // contact/refund details, but cannot remove or replace the agreed deal.
      if (!booking.draftId && !booking.packageSlug) {
        const drinks = freeDrinksVenues.includes(booking.venueId) ? 0
          : Math.round(25 * adultEquivalent(booking.guestCount - (booking.childCount || 0), booking.childCount || 0));
        const autoDrinks = !!(booking as BookingRecord & { promoAutoDrinks?: boolean }).promoAutoDrinks;
        if (autoDrinks) {
          addOns = addOns.filter(a => a.id !== 'drinks');
          pricing.addOnTotal -= drinks;
          pricing.subtotal -= drinks;
        }
        discount = 0; codeId = null; codeText = null; freeDrinksCost = 0;
        let addDrinks = false;
        if (body.promoCodeId) {
          if (typeof body.promoCodeId !== 'string' || body.promoCodeId.includes('/')) throw new BookingInputError('INVALID_PROMO');
          const ps = await tx.get(adminDb.collection('promo_codes').doc(body.promoCodeId));
          if (!ps.exists) throw new BookingInputError('INVALID_PROMO');
          const pc = { ...ps.data(), id: ps.id } as PromoCode;
          addDrinks = (pc.type === 'free_drinks' || pc.freeDrinks === true) && drinks > 0 && !addOns.some(a => a.id === 'drinks');
          const subtotal = pricing.subtotal + (addDrinks ? drinks : 0);
          const result = calcPromoDiscount(pc, { subtotal, baseCharge: pricing.baseCharge,
            adultEquiv: adultEquivalent(booking.guestCount - (booking.childCount || 0), booking.childCount || 0),
            drinksCost: drinks, venueId: booking.venueId });
          if (!result || (pc.totalUsageLimit != null && pc.totalUsageCount >= pc.totalUsageLimit)) throw new BookingInputError('INVALID_PROMO');
          if (pc.perUserLimit != null) {
            const used = await tx.get(adminDb.collection('bookings').where('userId', '==', uid));
            if (used.docs.filter(d => d.data().promoCodeId === pc.id && d.data().promoRedeemedAt).length >= pc.perUserLimit) throw new BookingInputError('PROMO_LIMIT');
          }
          discount = result.amount; codeId = pc.id; codeText = pc.code; freeDrinksCost = result.freeDrinks ? drinks : 0;
        }
        if (addDrinks) { addOns = [...addOns, { id: 'drinks', quantity: 1 }]; pricing.addOnTotal += drinks; pricing.subtotal += drinks; }
        tx.update(ref, { promoAutoDrinks: addDrinks });
      }
      const grand = Math.max(0, pricing.subtotal - discount) + (pricing.securityDeposit || 0);
      pricing.deposit = calculateDeposit(grand, booking.date);
      const requested = finiteNumber(body.pointsUsed ?? 0);
      const pointsDiscount = Math.min(Math.floor(requested / 100), Math.floor((profile.data()?.loyaltyPoints || 0) / 100),
        Math.max(0, Math.floor(pricing.deposit - 1)), Math.max(0, Math.floor(pricing.subtotal - discount)));
      const patch: Record<string, unknown> = {
        pricing, addOns, promoCodeId: codeId, promoCode: codeText, promoDiscount: discount,
        promoFreeDrinksCost: freeDrinksCost, pointsUsed: pointsDiscount * 100, pointsDiscount,
        balanceDue: Math.max(0, grand - pricing.deposit), updatedAt: FieldValue.serverTimestamp(),
      };
      for (const field of ['marketingChannel', 'marketingChannelLabel', 'marketingChannelOther']) {
        if (typeof body[field] === 'string' && body[field].length <= 300) patch[field] = body[field];
      }
      tx.update(ref, patch);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof BookingInputError ? err.message : 'CONFIRM_FAILED';
    return NextResponse.json({ error: message }, { status: message === 'FORBIDDEN' ? 403 : 400 });
  }
}
