import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { adminVerifyIdToken } from '@/lib/adminAuth';
import { getVenueById } from '@/lib/venues';
import { getVenueByIdServer, venuesSharingSpaceServer } from '@/lib/venueRegistryServer';
import { calculatePricing, calculateDeposit, adultEquivalent, freeDrinksVenues, subtractHours } from '@/lib/pricing';
import { calcPromoDiscount } from '@/lib/promoCodes';
import { getHoliday } from '@/lib/hkHolidays';
import type { PromoCode } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server-side isWeekend from a date string (Fri/Sat/public holiday/eve),
 *  matching updateBookingDateTime + the booking form. */
function serverIsWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  const holiday = getHoliday(dateStr);
  const next = new Date(`${dateStr}T00:00:00`);
  next.setDate(next.getDate() + 1);
  const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  const eve = getHoliday(nextStr);
  return day === 5 || day === 6 || holiday?.type === 'public' || eve?.type === 'public';
}

// Mirrors venues.ts VENUE_CONFLICTS — must stay in sync when new shared-space
// venues are added.
const VENUE_CONFLICTS: Record<string, string[]> = {
  'sw-a':  ['sw-a', 'sw-ab'],
  'sw-b':  ['sw-b', 'sw-ab'],
  'sw-ab': ['sw-a', 'sw-b', 'sw-ab'],
};

function venuesSharingSpace(venueId: string): string[] {
  return VENUE_CONFLICTS[venueId] || [venueId];
}

// Returns a stable lock-document key for the physical space containing
// venueId. All venues sharing the same room map to the same key so that
// concurrent bookings for sw-a and sw-ab contend on the same lock.
function physicalSpaceLockKey(venueId: string): string {
  const swGroup = new Set(['sw-a', 'sw-b', 'sw-ab']);
  if (swGroup.has(venueId)) return 'sw-physical';
  return venueId;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * POST /api/bookings/create
 *
 * Atomic alternative to the client-side createBooking() in firestore.ts.
 * Runs a Firestore Admin SDK transaction that:
 *   1. Reads a physical-space lock document to force transaction contention
 *      between any two concurrent bookings for the same venue + date.
 *   2. Reads all blocked_slots for the affected venue group + dates.
 *   3. Checks for time-window conflicts (throws SLOT_CONFLICT on overlap).
 *   4. Creates the booking document.
 *   5. Creates booking + cleaning blocked_slot documents.
 *   6. Optionally marks a booking_draft as claimed (when draftId is present).
 *
 * Because steps 1–6 are inside a single Firestore transaction, two
 * simultaneous requests for the same slot cannot both succeed: the one that
 * commits first updates the lock document, causing the other to retry; on
 * retry it finds the blocked_slots and returns SLOT_CONFLICT.
 *
 * Body: all fields that createBooking() accepts, plus an optional `draftId`
 * to atomically claim an admin-issued booking draft.
 *
 * Response 200: { bookingId: string }
 * Response 409: { error: "SLOT_CONFLICT" | "DRAFT_CLAIMED" | "DRAFT_NOT_FOUND" }
 * Response 500: { error: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    venueId,
    date,
    startTime,
    endTime,
    endDate,
    draftId,       // route param: if set, claim this draft atomically
    draftIdField,  // booking-record field: link back to the draft doc
    ...rest
  } = body;

  if (!venueId || !date || !startTime || !endTime) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // ── AUTH ── verify the caller's Firebase ID token and force the
  // booking's userId to the token's uid. Without this the route was
  // unauthenticated and trusted a client-supplied userId (book in anyone's
  // name) + client pricing/status/balanceDue/payments (free bookings).
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'missing-token' }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminVerifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: 'invalid-token' }, { status: 401 });
  }

  // ── SERVER-RECOMPUTE the money fields (override, never reject — a legit
  // booking's client values already match, a tampered one gets corrected).
  // Registry first (admin-managed pricing/flags), static as fallback.
  const venue = (await getVenueByIdServer(venueId)) ?? getVenueById(venueId);
  if (venue?.active === false) {
    return NextResponse.json({ error: 'VENUE_OFFLINE' }, { status: 400 });
  }
  const guestCount = Math.max(1, Number(rest.guestCount) || 1);
  const childCount = Math.max(0, Number(rest.childCount) || 0);
  const adultCount = Math.max(0, Number(rest.adultCount ?? (guestCount - childCount)));
  const addOns = Array.isArray(rest.addOns) ? rest.addOns : [];
  const isWeekend = serverIsWeekend(date as string);
  const endDayForHours = (endDate && endDate !== date) ? (endDate as string) : (date as string);
  const startMs = new Date(`${date}T${startTime}:00+08:00`).getTime();
  const endMs = new Date(`${endDayForHours}T${endTime}:00+08:00`).getTime();
  const hours = Math.max(1, Math.round((((endMs - startMs)) / 3600000) * 2) / 2);

  // Package bookings are priced by a fixed package, not the venue formula —
  // trust their stored pricing but still lock down the safety fields below.
  const isPackage = !!rest.packageSlug;
  let sanitizedPricing = rest.pricing;
  let promoDiscount = 0;
  let promoFreeDrinksCost = 0;
  let promoCode: string | null = null;
  let promoCodeId: string | null = null;

  if (!isPackage && venue) {
    const computed = calculatePricing(venue, isWeekend, hours, guestCount, addOns, childCount);
    // Revalidate the promo server-side (window / venue / min-subtotal /
    // usage limits all enforced inside calcPromoDiscount).
    if (rest.promoCodeId) {
      try {
        const pcSnap = await adminDb.collection('promo_codes').doc(String(rest.promoCodeId)).get();
        if (pcSnap.exists) {
          const pc = { id: pcSnap.id, ...pcSnap.data() } as PromoCode;
          const equiv = adultEquivalent(Math.max(0, guestCount - childCount), childCount);
          const drinksCost = freeDrinksVenues.includes(venueId) ? 0 : Math.round(25 * equiv);
          const d = calcPromoDiscount(pc, { subtotal: computed.subtotal, adultEquiv: equiv, drinksCost, venueId });
          const withinTotal = pc.totalUsageLimit == null || pc.totalUsageCount < pc.totalUsageLimit;
          if (d && d.amount > 0 && pc.enabled !== false && withinTotal) {
            promoDiscount = Math.min(d.amount, computed.subtotal);
            promoFreeDrinksCost = d.freeDrinks ? drinksCost : 0;
            promoCode = pc.code;
            promoCodeId = pc.id;
          }
        }
      } catch (err) {
        console.warn('[bookings/create] promo revalidation failed, dropping promo:', err);
      }
    }
    sanitizedPricing = {
      baseCharge: computed.baseCharge,
      addOnTotal: computed.addOnTotal,
      subtotal: computed.subtotal,   // GROSS (pre-promo)
      securityDeposit: computed.securityDeposit,
      deposit: computed.deposit,     // recomputed below with promo/points
    };
  }

  // Clamp points redemption to the user's actual balance (a tamperer
  // can't claim more than they hold to shrink the charge to $1).
  let pointsUsed = Math.max(0, Math.floor(Number(rest.pointsUsed) || 0));
  if (pointsUsed > 0) {
    try {
      const uSnap = await adminDb.collection('users').doc(uid).get();
      const bal = (uSnap.data() as { loyaltyPoints?: number } | undefined)?.loyaltyPoints || 0;
      pointsUsed = Math.min(pointsUsed, bal);
    } catch { pointsUsed = 0; }
  }
  // 100 loyalty points = HK$1 (POINTS_PER_HKD). pointsUsed is in POINTS;
  // pointsDiscount is the HK$ value. The old `= pointsUsed` treated 1pt=$1,
  // storing a 100× discount (1,500 pts showed −$1,500 instead of −$15).
  const pointsDiscount = Math.round((pointsUsed / 100) * 100) / 100;

  // Deposit + balanceDue, matching the confirm/payment pages exactly so
  // nothing drifts. Points do NOT reduce the stored deposit/balance — they
  // reduce only what the customer pays UPFRONT (kpay/checkout charges
  // pricing.deposit − pointsDiscount). The remaining balance is
  // grandTotal(excl. points) − deposit; the KPay webhook reconciles the
  // points against the smaller payment amount so the two agree.
  const addOnTotal = Number(sanitizedPricing?.addOnTotal) || 0;
  const securityDeposit = Number(sanitizedPricing?.securityDeposit) || 0;
  // PACKAGE bookings: the stored subtotal (flat package price + extras)
  // is authoritative — deriving it from baseCharge + addOnTotal is WRONG
  // because package drafts carry the per-head calculatePricing artifact
  // in baseCharge (#2026-09-27 CWB: $6,800+$500 package rebuilt as
  // 15×$50×3h+$500 = $2,750 and the customer underpaid by $4,550).
  const storedSubtotal = Number(sanitizedPricing?.subtotal) || 0;
  const grossSubtotal = isPackage && storedSubtotal > 0
    ? storedSubtotal
    : (Number(sanitizedPricing?.baseCharge) || 0) + addOnTotal;
  // Keep baseCharge display-consistent: for packages it's the flat
  // package portion (subtotal − add-ons), never the per-head figure.
  const baseCharge = isPackage
    ? Math.max(0, grossSubtotal - addOnTotal)
    : Number(sanitizedPricing?.baseCharge) || 0;
  const grandTotalForDeposit = Math.max(0, grossSubtotal - promoDiscount) + securityDeposit;
  const deposit = calculateDeposit(grandTotalForDeposit, date as string);
  const balanceDue = Math.max(0, grandTotalForDeposit - deposit);
  sanitizedPricing = {
    baseCharge, addOnTotal, subtotal: grossSubtotal, securityDeposit, deposit,
  };

  const overnight = !!endDate && endDate !== date;
  const resolvedEndDate = overnight ? (endDate as string) : date;

  // Cleaning buffer: 1 hour after end time. Capped at 23:59.
  const [endH, endM] = (endTime as string).split(':').map(Number);
  const bufferEndH = endH + 1;
  const bufferEnd = bufferEndH >= 24
    ? '23:59'
    : `${String(bufferEndH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  const sharedVenues = await venuesSharingSpaceServer(venueId);
  // Space-group venues contend on one lock doc (dynamic 上環-style groups).
  const lockKey = venue?.spaceGroup ?? physicalSpaceLockKey(venueId);

  // Early setup access (提早入場佈置) — locks N hours BEFORE startTime.
  // The window is conflict-checked like the booking itself, so it also
  // collides with the previous booking's 1-hr cleaning buffer (i.e. the
  // previous booking must end ≥ setup hours + 1 hr before this start).
  const earlySetupHours = Math.max(0, Math.min(3,
    Math.floor(addOns.find((a: { id: string; quantity: number }) => a.id === 'early-setup')?.quantity || 0)));
  const setupStart = earlySetupHours > 0 ? subtractHours(startTime as string, earlySetupHours) : null;
  if (earlySetupHours > 0 && toMin(startTime) - earlySetupHours * 60 < 0) {
    return NextResponse.json({ error: 'EARLY_SETUP_BEFORE_DAY' }, { status: 400 });
  }

  // Time windows to check for conflicts (each window belongs to one calendar date).
  const checkWindows = overnight
    ? [
        { date: date as string, start: toMin(startTime), end: 24 * 60 },
        { date: resolvedEndDate, start: 0, end: toMin(endTime) },
      ]
    : [{ date: date as string, start: toMin(startTime), end: toMin(endTime) }];
  if (setupStart) {
    checkWindows.push({ date: date as string, start: toMin(setupStart), end: toMin(startTime) });
  }

  // Dates that need the lock touched (covers overnight Day 2 as well).
  const lockDates = resolvedEndDate !== date
    ? [date as string, resolvedEndDate]
    : [date as string];

  try {
    let bookingId!: string;

    await adminDb.runTransaction(async (t) => {
      // ── 1. Lock documents ──────────────────────────────────────────────
      // Reading these forces transaction contention: if two concurrent
      // requests for the same physical space + date both reach this point,
      // only one can commit; the other retries. On retry it will find the
      // blocked_slots written by the winner and throw SLOT_CONFLICT below.
      const lockRefs = lockDates.map((d) =>
        adminDb.collection('_venue_booking_locks').doc(`${lockKey}_${d}`)
      );
      await Promise.all(lockRefs.map((r) => t.get(r)));

      // ── 2. Read existing blocked_slots ────────────────────────────────
      const blockedDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const vid of sharedVenues) {
        for (const d of lockDates) {
          const snap = await t.get(
            adminDb.collection('blocked_slots')
              .where('venueId', '==', vid)
              .where('date', '==', d)
          );
          blockedDocs.push(...snap.docs);
        }
      }

      // ── 3. Optionally read booking draft (must come before any writes) ─
      let draftRef: FirebaseFirestore.DocumentReference | null = null;
      if (draftId) {
        draftRef = adminDb.collection('booking_drafts').doc(draftId as string);
        const draftSnap = await t.get(draftRef);
        if (!draftSnap.exists) throw new Error('DRAFT_NOT_FOUND');
        const draft = draftSnap.data() as { status: string; claimedBy: string | null };
        if (draft.status !== 'pending' || draft.claimedBy) throw new Error('DRAFT_CLAIMED');
      }

      // ── 4. Conflict check ──────────────────────────────────────────────
      for (const w of checkWindows) {
        for (const docSnap of blockedDocs) {
          const bData = docSnap.data() as { date: string; startTime: string; endTime: string };
          if (bData.date !== w.date) continue;
          const bStart = toMin(bData.startTime);
          const bEnd = toMin(bData.endTime);
          if (w.start < bEnd && bStart < w.end) {
            throw new Error('SLOT_CONFLICT');
          }
        }
      }

      // ── 5. Create booking document ────────────────────────────────────
      const bookingRef = adminDb.collection('bookings').doc();
      bookingId = bookingRef.id;
      // WHITELIST — persist only trusted/server-derived fields. Never
      // spread ...rest (that let a client set status/payments/balanceDue).
      const pendingExpiresAt = typeof rest.pendingExpiresAt === 'number'
        ? rest.pendingExpiresAt
        : Date.now() + 30 * 60 * 1000;
      t.create(bookingRef, {
        userId: uid,                    // forced from the verified token
        venueId,
        branchSlug: rest.branchSlug ?? null,
        date,
        startTime,
        endTime,
        ...(overnight ? { endDate } : {}),
        ...(draftIdField ? { draftId: draftIdField } : {}),
        hours,
        guestCount,
        adultCount,
        childCount,
        isWeekend,
        addOns,
        hasBYOFood: !!rest.hasBYOFood,
        ...(earlySetupHours > 0 ? { earlySetupHours } : {}),
        pricing: sanitizedPricing,      // server-recomputed
        status: 'awaiting_payment',     // forced — never client 'confirmed'
        paymentMethod: rest.paymentMethod ?? null,
        receiptUrl: rest.receiptUrl ?? null,
        refundDetails: rest.refundDetails ?? null,
        balanceDue,                     // server-derived
        payments: [],                   // never trust client-supplied payments
        pendingExpiresAt,
        depositRefund: null,
        whatsappPhone: rest.whatsappPhone ?? null,
        ...(promoCode ? { promoCode } : {}),
        ...(promoCodeId ? { promoCodeId } : {}),
        ...(promoDiscount > 0 ? { promoDiscount } : {}),
        ...(promoFreeDrinksCost > 0 ? { promoFreeDrinksCost } : {}),
        ...(pointsUsed > 0 ? { pointsUsed, pointsDiscount } : {}),
        ...(rest.marketingChannel ? { marketingChannel: rest.marketingChannel } : {}),
        ...(rest.marketingChannelOther ? { marketingChannelOther: rest.marketingChannelOther } : {}),
        ...(rest.packageSlug ? { packageSlug: rest.packageSlug } : {}),
        ...(typeof rest.visitorId === 'string' && rest.visitorId
          ? { visitorId: String(rest.visitorId).slice(0, 64) } : {}),
        ...(typeof rest.firstTouchSource === 'string' && rest.firstTouchSource
          ? { firstTouchSource: String(rest.firstTouchSource).slice(0, 32) } : {}),
        ...(rest.decorationStyle ? { decorationStyle: rest.decorationStyle } : {}),
        ...(rest.balanceDueDate ? { balanceDueDate: rest.balanceDueDate } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // ── 6. Create blocked_slots ────────────────────────────────────────
      const addSlot = (data: Record<string, unknown>) =>
        t.create(adminDb.collection('blocked_slots').doc(), data);

      if (overnight) {
        addSlot({ venueId, date, startTime, endTime: '23:59', reason: 'booking', bookingId });
        addSlot({ venueId, date: resolvedEndDate, startTime: '00:00', endTime, reason: 'booking', bookingId });
        addSlot({ venueId, date: resolvedEndDate, startTime: endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
      } else {
        addSlot({ venueId, date, startTime, endTime, reason: 'booking', bookingId });
        addSlot({ venueId, date, startTime: endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
      }
      // Early setup window — locked before the booking start with its
      // own labelled slot (提早入場佈置) so the calendar shows it.
      if (setupStart) {
        addSlot({ venueId, date, startTime: setupStart, endTime: startTime, reason: 'setup', bookingId });
      }

      // ── 7. Mark booking draft as claimed ──────────────────────────────
      if (draftRef) {
        t.update(draftRef, {
          claimedBy: uid,
          claimedAt: FieldValue.serverTimestamp(),
          bookingId,
          status: 'claimed',
        });
      }

      // ── 8. Touch lock documents ────────────────────────────────────────
      // Writing to the lock documents after reads ensures any concurrent
      // transaction that read the same lock will be forced to retry.
      for (const r of lockRefs) {
        t.set(r, { lastBookingAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });

    // Best-effort: sync phone number back to user profile (non-fatal).
    if (rest.userId && rest.whatsappPhone) {
      adminDb.collection('users').doc(rest.userId as string)
        .update({ phone: rest.whatsappPhone })
        .catch(() => {});
    }

    return NextResponse.json({ bookingId });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SLOT_CONFLICT') {
      return NextResponse.json({ error: 'SLOT_CONFLICT' }, { status: 409 });
    }
    if (msg === 'DRAFT_CLAIMED') {
      return NextResponse.json({ error: 'DRAFT_CLAIMED' }, { status: 409 });
    }
    if (msg === 'DRAFT_NOT_FOUND') {
      return NextResponse.json({ error: 'DRAFT_NOT_FOUND' }, { status: 404 });
    }
    console.error('[/api/bookings/create]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
