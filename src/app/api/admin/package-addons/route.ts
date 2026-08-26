import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '@/lib/adminAuth';
import {
  earlySetupPriceByVenue, calcCateringTotal, subtractHours,
} from '@/lib/pricing';
import type { BookingRecord, AddOnOptions } from '@/types';
import { venuesSharingSpaceServer, getVenueByIdServer } from '@/lib/venueRegistryServer';

export const runtime = 'nodejs';

// Mirrors venues.ts VENUE_CONFLICTS — keep in sync with new shared spaces.
const VENUE_CONFLICTS: Record<string, string[]> = {
  'sw-a':  ['sw-a', 'sw-ab'],
  'sw-b':  ['sw-b', 'sw-ab'],
  'sw-ab': ['sw-a', 'sw-b', 'sw-ab'],
};
const venuesSharingSpace = (v: string) => VENUE_CONFLICTS[v] || [v];
const physicalSpaceLockKey = (v: string) =>
  new Set(['sw-a', 'sw-b', 'sw-ab']).has(v) ? 'sw-physical' : v;
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * POST /api/admin/package-addons
 *   { bookingId, earlySetupHours?, catering? }
 *
 * Admin-side add-on adjustment for PACKAGE bookings (flat-priced; the
 * normal add-ons editor + updateBookingDateTime recompute are disabled
 * for them). Supports:
 *   • earlySetupHours (0-3) — replaces the current value; the setup
 *     blocked_slot is rewritten and, on increase, conflict-checked
 *     against the previous booking (incl. cleaning buffer).
 *   • catering — CateringSelection options (null = remove).
 *
 * Pricing is ADDITIVE: diffs go onto addOnTotal / subtotal /
 * balanceDue; the flat package price is never recomputed. Admin may
 * decrease (refund handled out of band; balanceDue clamps at 0).
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => ({})) as {
    bookingId?: string;
    earlySetupHours?: number;
    catering?: AddOnOptions | null;
  };
  const { bookingId } = body;
  if (!bookingId) {
    return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  }

  const bookingRef = adminDb.collection('bookings').doc(bookingId);
  const snap = await bookingRef.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const booking = { id: snap.id, ...snap.data() } as BookingRecord;
  if (!booking.packageSlug) {
    return NextResponse.json({ error: 'not-a-package-booking' }, { status: 400 });
  }

  // ── Early setup diff ──
  const oldSetupHours = Math.max(0, Math.floor(booking.earlySetupHours
    ?? booking.addOns?.find((a) => a.id === 'early-setup')?.quantity ?? 0));
  const newSetupHours = typeof body.earlySetupHours === 'number'
    ? Math.max(0, Math.min(3, Math.floor(body.earlySetupHours)))
    : oldSetupHours;
  if (newSetupHours > 0 && toMin(booking.startTime) - newSetupHours * 60 < 0) {
    return NextResponse.json({ error: 'EARLY_SETUP_BEFORE_DAY' }, { status: 400 });
  }
  const setupPrice = (await getVenueByIdServer(booking.venueId))?.earlySetupPricePerHour
    ?? earlySetupPriceByVenue[booking.venueId] ?? 500;
  const setupDiff = setupPrice * (newSetupHours - oldSetupHours);
  const setupChanged = newSetupHours !== oldSetupHours;

  // ── Catering diff ── ('catering' in body distinguishes "no change"
  // from "remove" (null)).
  const hasCateringField = 'catering' in body;
  const oldCat = booking.addOns?.find((a) => a.id === 'catering');
  const oldCatTotal = oldCat ? calcCateringTotal(oldCat.options || {}) : 0;
  const newCatOptions = hasCateringField ? body.catering : (oldCat?.options ?? null);
  const newCatTotal = newCatOptions ? calcCateringTotal(newCatOptions) : 0;
  const cateringDiff = newCatTotal - oldCatTotal;
  const cateringChanged = hasCateringField
    && (JSON.stringify(newCatOptions ?? null) !== JSON.stringify(oldCat?.options ?? null));

  if (!setupChanged && !cateringChanged) {
    return NextResponse.json({ error: 'nothing-changed' }, { status: 400 });
  }

  // ── New addOns array ──
  const newAddOns = (booking.addOns || [])
    .filter((a) => a.id !== 'early-setup' && a.id !== 'catering')
    .map((a) => ({ ...a }));
  if (newSetupHours > 0) newAddOns.push({ id: 'early-setup', quantity: newSetupHours });
  if (newCatOptions) newAddOns.push({ id: 'catering', quantity: 1, options: newCatOptions });

  const addDiff = setupDiff + cateringDiff;
  const patch: Record<string, unknown> = {
    addOns: newAddOns,
    earlySetupHours: newSetupHours,
    'pricing.addOnTotal': Math.max(0, (booking.pricing?.addOnTotal || 0) + addDiff),
    'pricing.subtotal': Math.max(0, (booking.pricing?.subtotal || 0) + addDiff),
    balanceDue: Math.max(0, (booking.balanceDue || 0) + addDiff),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const setupStart = newSetupHours > 0 ? subtractHours(booking.startTime, newSetupHours) : null;
  const sharedVenues = await venuesSharingSpaceServer(booking.venueId);
  const lockKey = (await getVenueByIdServer(booking.venueId))?.spaceGroup ?? physicalSpaceLockKey(booking.venueId);

  try {
    await adminDb.runTransaction(async (t) => {
      const lockRef = adminDb.collection('_venue_booking_locks').doc(`${lockKey}_${booking.date}`);
      await t.get(lockRef);
      const allSlots: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const vid of sharedVenues) {
        const s = await t.get(
          adminDb.collection('blocked_slots')
            .where('venueId', '==', vid)
            .where('date', '==', booking.date)
        );
        allSlots.push(...s.docs);
      }
      // Conflict check on the setup window when it grows.
      if (setupStart && newSetupHours > oldSetupHours) {
        const wStart = toMin(setupStart);
        const wEnd = toMin(booking.startTime);
        for (const docSnap of allSlots) {
          const b = docSnap.data() as { date: string; startTime: string; endTime: string; bookingId?: string };
          if (b.bookingId === bookingId) continue;
          if (b.date !== booking.date) continue;
          if (wStart < toMin(b.endTime) && toMin(b.startTime) < wEnd) {
            throw new Error('SLOT_CONFLICT');
          }
        }
      }
      // Replace this booking's setup slot.
      for (const docSnap of allSlots) {
        const b = docSnap.data() as { bookingId?: string; reason?: string };
        if (b.bookingId === bookingId && b.reason === 'setup') t.delete(docSnap.ref);
      }
      if (setupStart) {
        t.create(adminDb.collection('blocked_slots').doc(), {
          venueId: booking.venueId, date: booking.date,
          startTime: setupStart, endTime: booking.startTime,
          reason: 'setup', bookingId,
        });
      }
      t.update(bookingRef, patch);
      t.set(lockRef, { lastBookingAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SLOT_CONFLICT') {
      return NextResponse.json({ error: 'SLOT_CONFLICT' }, { status: 409 });
    }
    console.error('[/api/admin/package-addons]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    addDiff,
    newBalanceDue: Math.max(0, (booking.balanceDue || 0) + addDiff),
  });
}
