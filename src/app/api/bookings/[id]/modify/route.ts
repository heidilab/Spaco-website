import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { adminVerifyIdToken } from '@/lib/adminAuth';
import { getVenueById } from '@/lib/venues';
import {
  calculatePricing, calculateDeposit, freeDrinksVenues, subtractHours,
} from '@/lib/pricing';
import { calcPromoDiscount } from '@/lib/promoCodes';
import { computeGrandTotal, computeBalanceDue, paidBase } from '@/lib/bookingMoney';
import type { BookingRecord, AddOnOptions, PromoCode } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Food add-ons need supplier lead time → only addable ≥48h before start.
const FOOD_IDS = new Set([
  'bbq-standard', 'bbq-premium', 'bbq-grill',
  'hotpot-standard', 'hotpot-seafood', 'hotpot-extra-soup',
]);

// Mirrors venues.ts VENUE_CONFLICTS — keep in sync with new shared spaces.
const VENUE_CONFLICTS: Record<string, string[]> = {
  'sw-a':  ['sw-a', 'sw-ab'],
  'sw-b':  ['sw-b', 'sw-ab'],
  'sw-ab': ['sw-a', 'sw-b', 'sw-ab'],
};
function venuesSharingSpace(venueId: string): string[] {
  return VENUE_CONFLICTS[venueId] || [venueId];
}
function physicalSpaceLockKey(venueId: string): string {
  const swGroup = new Set(['sw-a', 'sw-b', 'sw-ab']);
  return swGroup.has(venueId) ? 'sw-physical' : venueId;
}
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

interface CartEntry { id: string; quantity: number; options?: AddOnOptions }

/**
 * POST /api/bookings/[id]/modify
 *
 * Customer self-service booking modification, done server-side so it can
 * rewrite the venue's blocked_slots (which the Firestore rules only let
 * staff write) AND recompute pricing/balanceDue with the Admin SDK — the
 * customer never writes pricing/balanceDue directly. Replaces the old
 * client updateDoc path (which broke on time changes with a permission
 * error, and would break entirely once the rules freeze balanceDue/pricing
 * on owner writes — Batch A2).
 *
 * Policy (all enforced server-side, not just in the UI):
 *   • Caller must own the booking (userId === token uid)
 *   • Status must be 'confirmed' or 'awaiting_payment'
 *   • ≥24h before start (self-service deadline)
 *   • Add-only: add-on qty can't drop below what's booked; pax can't drop;
 *     start can only move earlier, end only later (extend-only)
 *   • Food add-ons only addable ≥48h before start
 *
 * Body: { addOns?, adultCount?, childCount?, startTime?, endTime? }
 * Response 200: { balanceDue, subtotalDiff }
 * Response 409: { error: 'SLOT_CONFLICT' }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // ── AUTH ──
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'missing-token' }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminVerifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: 'invalid-token' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  const bookingRef = adminDb.collection('bookings').doc(id);
  const snap = await bookingRef.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const booking = { id: snap.id, ...snap.data() } as BookingRecord;

  // ── OWNERSHIP + eligibility ──
  if (booking.userId !== uid) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (booking.status !== 'confirmed' && booking.status !== 'awaiting_payment') {
    return NextResponse.json({ error: 'not-modifiable' }, { status: 400 });
  }
  if (booking.packageSlug) {
    // Package bookings are flat-priced with their own extra-pax logic —
    // out of scope for customer self-service.
    return NextResponse.json({ error: 'package-not-supported' }, { status: 400 });
  }

  const venue = getVenueById(booking.venueId);
  if (!venue) return NextResponse.json({ error: 'venue-not-found' }, { status: 400 });

  const startMs = new Date(`${booking.date}T${booking.startTime}:00+08:00`).getTime();
  const hoursUntilStart = (startMs - Date.now()) / 3600000;
  if (hoursUntilStart < 24) {
    return NextResponse.json({ error: 'deadline-passed' }, { status: 400 });
  }
  const canAddFood = hoursUntilStart >= 48;

  // ── Resolve + validate the requested changes (add-only) ──
  const isOvernight = !!booking.endDate && booking.endDate !== booking.date;
  const endDate = isOvernight && booking.endDate ? booking.endDate : booking.date;

  // Time — extend-only. Start ≤ booked start, end ≥ booked end.
  const startTime = typeof body.startTime === 'string' ? body.startTime : booking.startTime;
  const endTime = typeof body.endTime === 'string' ? body.endTime : booking.endTime;
  if (toMin(startTime) > toMin(booking.startTime)) {
    return NextResponse.json({ error: 'start-only-earlier' }, { status: 400 });
  }
  if (toMin(endTime) < toMin(booking.endTime)) {
    return NextResponse.json({ error: 'end-only-later' }, { status: 400 });
  }
  const timeChanged = startTime !== booking.startTime || endTime !== booking.endTime;

  // Guests — increase-only, children counted at floor too.
  const adultFloor = booking.adultCount ?? booking.guestCount ?? 0;
  const childFloor = booking.childCount ?? 0;
  const adultCount = typeof body.adultCount === 'number' ? Math.floor(body.adultCount) : adultFloor;
  const childCount = typeof body.childCount === 'number' ? Math.floor(body.childCount) : childFloor;
  if (adultCount < adultFloor || childCount < childFloor) {
    return NextResponse.json({ error: 'pax-only-increase' }, { status: 400 });
  }
  const newGuestCount = adultCount + childCount;

  // Add-ons — qty per id can't drop below what's booked.
  const floor: Record<string, number> = {};
  for (const a of (booking.addOns || [])) floor[a.id] = a.quantity;
  const reqAddOns: CartEntry[] = Array.isArray(body.addOns)
    ? body.addOns.map((a: CartEntry) => ({
        id: String(a.id),
        quantity: Math.max(0, Math.floor(Number(a.quantity) || 0)),
        ...(a.options ? { options: a.options } : {}),
      })).filter((a: CartEntry) => a.quantity > 0)
    : (booking.addOns || []);
  for (const id2 of Object.keys(floor)) {
    const reqQty = reqAddOns.find((a) => a.id === id2)?.quantity ?? 0;
    if (reqQty < floor[id2]) {
      return NextResponse.json({ error: 'addon-only-increase' }, { status: 400 });
    }
  }
  // Food add-ons past floor require ≥48h.
  if (!canAddFood) {
    for (const a of reqAddOns) {
      if (FOOD_IDS.has(a.id) && a.quantity > (floor[a.id] || 0)) {
        return NextResponse.json({ error: 'food-deadline-passed' }, { status: 400 });
      }
    }
  }

  // Early setup access (提早入場佈置) — locks hours BEFORE the start.
  // A change here must go through the slot-rewrite transaction so the
  // setup window is conflict-checked against the previous booking
  // (incl. its 1-hr cleaning buffer) before we commit anything.
  const newSetupHours = Math.max(0, Math.min(3,
    Math.floor(reqAddOns.find((a) => a.id === 'early-setup')?.quantity || 0)));
  const oldSetupHours = Math.max(0, Math.floor(floor['early-setup'] || 0));
  const setupChanged = newSetupHours !== oldSetupHours;
  if (newSetupHours > 0 && toMin(startTime) - newSetupHours * 60 < 0) {
    return NextResponse.json({ error: 'EARLY_SETUP_BEFORE_DAY' }, { status: 400 });
  }

  // ── Recompute pricing canonically (GROSS subtotal + promo/points) ──
  const startForHours = new Date(`${booking.date}T${startTime}:00+08:00`).getTime();
  const endForHours = new Date(`${endDate}T${endTime}:00+08:00`).getTime();
  const hours = Math.max(1, Math.round((endForHours - startForHours) / 3600000));

  const computed = calculatePricing(
    venue, booking.isWeekend, hours, newGuestCount, reqAddOns, childCount,
  );

  // Recompute the promo against the NEW pax / subtotal by reloading the
  // code doc. per_pax scales with adultEquiv, percent with subtotal,
  // free_drinks with the drinks line; cash stays fixed by its own formula.
  // (Same fix as updateBookingDateTime — #2p8F1WEp: pax 13 → 19 left a
  // per_pax discount at the 13-pax value.) If the code doc is gone or now
  // outside its window (calcPromoDiscount returns null), KEEP the stored
  // discount — it was locked in when the customer applied it; the
  // free_drinks fallback below still handles legacy bookings without a
  // promoCodeId.
  let promoDiscount = booking.promoDiscount || 0;
  const promoPatch: Record<string, unknown> = {};
  const isFreeDrinksPromo =
    typeof booking.promoFreeDrinksCost === 'number' && booking.promoFreeDrinksCost > 0;
  const hasDrinks = reqAddOns.some((a) => a.id === 'drinks');
  const promoAdults = Math.max(0, newGuestCount - childCount);
  const promoAdultEquiv = promoAdults + 0.5 * childCount;
  const promoDrinksCost = hasDrinks && !freeDrinksVenues.includes(booking.venueId)
    ? Math.round(25 * promoAdultEquiv)
    : 0;
  let promoRecomputed = false;
  if (promoDiscount > 0 && booking.promoCodeId) {
    try {
      const pcSnap = await adminDb.collection('promo_codes').doc(booking.promoCodeId).get();
      if (pcSnap.exists) {
        // Bypass eligibility gates (enabled / window / venue / minSubtotal)
        // — validated at apply time; a recompute only rescales the amount.
        // See updateBookingDateTime for the #2p8F1WEp rationale.
        const pcForRescale = {
          ...(pcSnap.data() as PromoCode), id: pcSnap.id,
          enabled: true, startDate: undefined, endDate: undefined,
          venueIds: undefined, minSubtotal: undefined,
        } as PromoCode;
        const d = calcPromoDiscount(
          pcForRescale,
          {
            subtotal: computed.subtotal,
            adultEquiv: promoAdultEquiv,
            drinksCost: promoDrinksCost,
            venueId: booking.venueId,
          },
        );
        if (d) {
          promoDiscount = d.amount;
          promoPatch.promoDiscount = d.amount;
          promoPatch.promoFreeDrinksCost = d.freeDrinks ? promoDrinksCost : 0;
          promoRecomputed = true;
        }
      }
    } catch (err) {
      console.warn('[bookings/modify] promo recompute failed, keeping stored discount:', err);
    }
  }
  if (!promoRecomputed && isFreeDrinksPromo && hasDrinks) {
    promoDiscount = promoDrinksCost;
    promoPatch.promoDiscount = promoDiscount;
    promoPatch.promoFreeDrinksCost = promoDiscount;
  } else if (!promoRecomputed && isFreeDrinksPromo && !hasDrinks) {
    promoDiscount = 0;
    promoPatch.promoDiscount = 0;
    promoPatch.promoFreeDrinksCost = 0;
  }
  const pointsDiscount = booking.pointsDiscount || 0;
  // Security deposit sticky — never auto-bump on a customer self-edit.
  const securityDeposit = booking.pricing?.securityDeposit || 0;
  // Canonical totals from the shared module — never re-derive inline.
  const repriced = {
    pricing: {
      baseCharge: computed.baseCharge,
      addOnTotal: computed.addOnTotal,
      securityDeposit,
    },
    promoDiscount,
    pointsDiscount,
    payments: booking.payments,
  };
  const grandTotal = computeGrandTotal(repriced);
  const effectiveDeposit = calculateDeposit(grandTotal, booking.date);
  const paidSoFar = paidBase(repriced);
  const balanceDue = computeBalanceDue(repriced);

  // Guard: self-service is add-only, so the new gross subtotal must never
  // be LOWER than what's booked. Defense-in-depth against a forged payload
  // that passes the per-field floors but nets a reduction.
  const oldSubtotal = booking.pricing?.subtotal ?? 0;
  if (computed.subtotal < oldSubtotal) {
    return NextResponse.json({ error: 'not-an-increase' }, { status: 400 });
  }

  const pricingPatch: Record<string, unknown> = {
    addOns: reqAddOns,
    'pricing.baseCharge': computed.baseCharge,
    'pricing.addOnTotal': computed.addOnTotal,
    'pricing.subtotal': computed.subtotal,   // GROSS (pre-promo)
    'pricing.securityDeposit': securityDeposit,
    'pricing.deposit': effectiveDeposit,
    balanceDue,
    guestCount: newGuestCount,
    adultCount,
    childCount,
    updatedAt: FieldValue.serverTimestamp(),
    ...promoPatch,
  };

  // ── No time/setup change → just patch the booking (schedule untouched) ──
  if (!timeChanged && !setupChanged) {
    await bookingRef.update(pricingPatch);
    return NextResponse.json({ balanceDue, subtotalDiff: computed.subtotal - oldSubtotal });
  }

  // ── Time or setup change → swap blocked_slots + conflict check atomically ──
  pricingPatch.startTime = startTime;
  pricingPatch.endTime = endTime;
  pricingPatch.hours = hours;
  pricingPatch.earlySetupHours = newSetupHours;
  const setupStart = newSetupHours > 0 ? subtractHours(startTime, newSetupHours) : null;

  const [endH, endM] = endTime.split(':').map(Number);
  const bufferEndH = endH + 1;
  const bufferEnd = bufferEndH >= 24
    ? '23:59'
    : `${String(bufferEndH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  const sharedVenues = venuesSharingSpace(booking.venueId);
  const lockKey = physicalSpaceLockKey(booking.venueId);
  const dates = endDate !== booking.date ? [booking.date, endDate] : [booking.date];

  const checkWindows = isOvernight
    ? [
        { date: booking.date, start: toMin(startTime), end: 24 * 60 },
        { date: endDate, start: 0, end: toMin(endTime) },
      ]
    : [{ date: booking.date, start: toMin(startTime), end: toMin(endTime) }];
  // Setup window collides with the previous booking's cleaning buffer
  // too — exactly Heidi's rule: previous booking must end early enough
  // to leave 1 hr cleaning before the setup handover.
  if (setupStart) {
    checkWindows.push({ date: booking.date, start: toMin(setupStart), end: toMin(startTime) });
  }

  try {
    await adminDb.runTransaction(async (t) => {
      // Lock the physical space so a concurrent booking on the same slot
      // can't slip in between our conflict check and our slot writes.
      const lockRefs = dates.map((d) =>
        adminDb.collection('_venue_booking_locks').doc(`${lockKey}_${d}`)
      );
      await Promise.all(lockRefs.map((r) => t.get(r)));

      // Read blocked_slots for the shared space on the affected dates.
      const allSlots: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const vid of sharedVenues) {
        for (const d of dates) {
          const s = await t.get(
            adminDb.collection('blocked_slots')
              .where('venueId', '==', vid)
              .where('date', '==', d)
          );
          allSlots.push(...s.docs);
        }
      }

      // Conflict check — ignore this booking's own slots.
      for (const w of checkWindows) {
        for (const docSnap of allSlots) {
          const b = docSnap.data() as { date: string; startTime: string; endTime: string; bookingId?: string };
          if (b.bookingId === id) continue;
          if (b.date !== w.date) continue;
          if (w.start < toMin(b.endTime) && toMin(b.startTime) < w.end) {
            throw new Error('SLOT_CONFLICT');
          }
        }
      }

      // Delete this booking's old slots, write the new ones.
      for (const docSnap of allSlots) {
        if ((docSnap.data() as { bookingId?: string }).bookingId === id) {
          t.delete(docSnap.ref);
        }
      }
      const vid = booking.venueId;
      const addSlot = (data: Record<string, unknown>) =>
        t.create(adminDb.collection('blocked_slots').doc(), data);
      if (isOvernight) {
        addSlot({ venueId: vid, date: booking.date, startTime, endTime: '23:59', reason: 'booking', bookingId: id });
        addSlot({ venueId: vid, date: endDate, startTime: '00:00', endTime, reason: 'booking', bookingId: id });
        addSlot({ venueId: vid, date: endDate, startTime: endTime, endTime: bufferEnd, reason: 'cleaning', bookingId: id });
      } else {
        addSlot({ venueId: vid, date: booking.date, startTime, endTime, reason: 'booking', bookingId: id });
        addSlot({ venueId: vid, date: booking.date, startTime: endTime, endTime: bufferEnd, reason: 'cleaning', bookingId: id });
      }
      if (setupStart) {
        addSlot({ venueId: vid, date: booking.date, startTime: setupStart, endTime: startTime, reason: 'setup', bookingId: id });
      }

      t.update(bookingRef, pricingPatch);

      for (const r of lockRefs) {
        t.set(r, { lastBookingAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SLOT_CONFLICT') {
      return NextResponse.json({ error: 'SLOT_CONFLICT' }, { status: 409 });
    }
    console.error('[/api/bookings/[id]/modify]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ balanceDue, subtotalDiff: computed.subtotal - oldSubtotal });
}
