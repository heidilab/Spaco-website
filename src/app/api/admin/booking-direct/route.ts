import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '@/lib/adminAuth';
import { computeGrandTotal, computeBalanceDue, paidBase } from '@/lib/bookingMoney';
import { BookingInputError, sanitizeAdminDiscount } from '@/lib/bookingSecurity';
import { overlappingBookings, type OverlapBooking, type OverlapWindow } from '@/lib/bookingOverlap';
import { slotClashes, clashesNeedingConfirmation, type ClashSlot, type DirectBookingClash } from '@/lib/directBookingClashes';
import { getVenueByIdServer, venuesSharingSpaceServer } from '@/lib/venueRegistryServer';
import { gcalEventTitle } from '@/lib/googleCalendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Which rooms share a space, and the lock document a booking contends
// on, come from the venue registry (分店管理) — the same source as
// /api/bookings/create. A hard-coded Sheung Wan table here never knew
// HART's rooms, so a full-floor offline order did not see a Room A
// booking (site review 2026-11-13 #2).
const physicalSpaceLockKey = (v: string) =>
  new Set(['sw-a', 'sw-b', 'sw-ab']).has(v) ? 'sw-physical' : v;
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Slot rows no longer carry the Google event's title; name the
 *  calendar clashes from the staff-only details collection. */
async function withEventTitles(clashes: DirectBookingClash[]): Promise<DirectBookingClash[]> {
  return Promise.all(clashes.map(async (c) => {
    if (c.kind !== 'calendar' || c.label !== 'Google Calendar' || !c.googleEventId) return c;
    try {
      const title = await gcalEventTitle(c.googleEventId);
      return title ? { ...c, label: title } : c;
    } catch { return c; }
  }));
}

interface DirectPayment {
  date: string;                 // YYYY-MM-DD the money was received
  method: 'fps' | 'bank' | 'cash' | 'kpay' | 'other';
  amount: number;
}

/**
 * POST /api/admin/booking-direct — Finance Phase 1 (線下訂單).
 *
 * CS/admin records a booking that happened OFF the website — broker
 * bookings (行家 / Reubird), walk-ins, WhatsApp customers who paid FPS
 * directly. Until now these lived only in Google Calendar + Excel, so
 * the finance reports could never reconcile.
 *
 * Creates a CONFIRMED booking atomically (same physical-space lock +
 * conflict check + blocked_slots as /api/bookings/create), with the
 * already-received payments logged into payments[] — the single source
 * of truth the finance pipeline reads. The admin-supplied pricing block
 * is trusted (staff-gated route; broker deals are negotiated prices).
 *
 * Extra fields vs a customer booking:
 *   marketingChannel/-Label — 行家 / reubird / etc. (drives Phase-2
 *   commission rules) · customerName on the booking itself (walk-ins
 *   have no user profile) · createdVia: 'admin-direct' for traceability.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'bad-json' }, { status: 400 });
  const {
    venueId, branchSlug, date, startTime, endTime, endDate,
    hours, guestCount, adultCount, childCount, isWeekend,
    addOns, hasBYOFood, pricing, peakSurchargeOverride, isAirbnb, isCommercial, packageSlug, allowOverlap,
    customerName, whatsappPhone, customerEmail, notes,
    marketingChannel, marketingChannelLabel,
    payments, adminDiscount: rawAdminDiscount,
  } = body as Record<string, never> & {
    payments?: DirectPayment[];
    pricing?: { baseCharge?: number; addOnTotal?: number; subtotal?: number; securityDeposit?: number; deposit?: number };
  };

  if (!venueId || !date || !startTime || !endTime || !pricing) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!customerName || !String(customerName).trim()) {
    return NextResponse.json({ error: 'customer-name-required' }, { status: 400 });
  }
  // Optional staff 折扣優惠 typed on the form (same shape as the CS link).
  let adminDiscount: ReturnType<typeof sanitizeAdminDiscount> = null;
  try { adminDiscount = sanitizeAdminDiscount(rawAdminDiscount); }
  catch (err) {
    if (err instanceof BookingInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const cleanPayments = (Array.isArray(payments) ? payments : [])
    .filter((p) => p && Number(p.amount) > 0 && p.date)
    .map((p) => ({
      amount: Math.round(Number(p.amount) * 100) / 100,
      // A bank transfer is recorded as FPS — one method for money into
      // the bank account (Heidi 2026-11-13).
      method: p.method === 'bank' ? 'fps' : (['fps', 'cash', 'kpay', 'other'] as const).includes(p.method) ? p.method : 'other',
      kind: 'initial' as const,
      note: '線下直接落單',
      recordedBy: gate.uid,
      recordedAt: `${p.date}T12:00:00+08:00`,
    }));

  const overnight = !!endDate && endDate !== date;
  const resolvedEndDate = overnight ? (endDate as string) : (date as string);
  const [endH, endM] = String(endTime).split(':').map(Number);
  const bufferEndH = endH + 1;
  const bufferEnd = bufferEndH >= 24
    ? '23:59'
    : `${String(bufferEndH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  const venueDoc = await getVenueByIdServer(venueId);
  const sharedVenues = await venuesSharingSpaceServer(venueId);
  const lockKey = venueDoc?.spaceGroup ?? physicalSpaceLockKey(venueId);
  const lockDates = resolvedEndDate !== date ? [date, resolvedEndDate] : [date];
  const checkWindows = overnight
    ? [
        { date: date as string, start: toMin(startTime), end: 24 * 60 },
        { date: resolvedEndDate, start: 0, end: toMin(endTime) },
      ]
    : [{ date: date as string, start: toMin(startTime), end: toMin(endTime) }];

  // Money derived through the shared module so balanceDue always agrees
  // with the rest of the system.
  const moneyShape = { pricing, payments: cleanPayments, adminDiscount };
  const grandTotal = computeGrandTotal(moneyShape);
  const balanceDue = computeBalanceDue(moneyShape);
  const paid = paidBase(moneyShape);

  let clashes: DirectBookingClash[] = [];
  try {
    let bookingId!: string;
    await adminDb.runTransaction(async (t) => {
      const lockRefs = lockDates.map((d) =>
        adminDb.collection('_venue_booking_locks').doc(`${lockKey}_${d}`));
      await Promise.all(lockRefs.map((r) => t.get(r)));

      const blockedDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const vid of sharedVenues) {
        for (const d of lockDates) {
          const snap = await t.get(
            adminDb.collection('blocked_slots')
              .where('venueId', '==', vid)
              .where('date', '==', d),
          );
          blockedDocs.push(...snap.docs);
        }
      }
      // What the order overlaps (lib/directBookingClashes). A Google
      // Calendar entry never refuses an offline order — it is usually the
      // same booking, marked there first by a part-timer. Another
      // booking / its buffers / a site block refuses it once; staff may
      // then add it anyway (`allowOverlap`).
      clashes = slotClashes(
        checkWindows,
        blockedDocs.map((d) => d.data() as ClashSlot),
        { production: process.env.VERCEL_ENV === 'production' },
      );
      // Bookings themselves are the final authority when blocked_slots are
      // missing or hidden (CWB 2026-10-31 double booking).
      const candidateDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const vid of sharedVenues) {
        for (const d of lockDates) {
          for (const field of ['date', 'endDate'] as const) {
            const snap = await t.get(adminDb.collection('bookings').where('venueId', '==', vid).where(field, '==', d));
            candidateDocs.push(...snap.docs);
          }
        }
      }
      const requestedWindows: OverlapWindow[] = overnight
        ? [{ date: date as string, startTime, endTime: '23:59' }, { date: resolvedEndDate, startTime: '00:00', endTime }]
        : [{ date: date as string, startTime, endTime }];
      const seen = new Set<string>();
      const bookingClashes = overlappingBookings(requestedWindows,
        candidateDocs.filter((d) => !seen.has(d.id) && seen.add(d.id)).map((d) => ({ id: d.id, ...(d.data() as Omit<OverlapBooking, 'id'>) })),
        { production: process.env.VERCEL_ENV === 'production' });
      for (const b of bookingClashes) {
        // Already listed through its blocked slot?
        if (clashes.some((c) => c.kind === 'booking' && c.bookingId === b.id && c.label === '預訂')) continue;
        clashes.push({ kind: 'booking', date: b.date, startTime: b.startTime, endTime: b.endTime, label: '預訂', bookingId: b.id });
      }
      if (clashesNeedingConfirmation(clashes).length > 0 && allowOverlap !== true) {
        throw new Error('SLOT_CONFLICT');
      }
      if (clashes.length > 0) {
        console.warn('[booking-direct] offline order recorded over existing entries', { venueId, date, allowOverlap: allowOverlap === true, clashes });
      }

      const bookingRef = adminDb.collection('bookings').doc();
      bookingId = bookingRef.id;
      t.create(bookingRef, {
        ...(process.env.VERCEL_ENV !== 'production' ? { isTest: true } : {}),
        userId: null,                    // offline customer — no account
        createdVia: 'admin-direct',
      ...(typeof peakSurchargeOverride === 'number' ? { peakSurchargeOverride: Math.max(0, peakSurchargeOverride) } : {}),
      ...(isAirbnb === true ? { isAirbnb: true } : {}),
      ...(isCommercial === true ? { isCommercial: true } : {}),
        createdBy: gate.uid,
        venueId,
        branchSlug: branchSlug ?? null,
        date,
        startTime,
        endTime,
        ...(overnight ? { endDate } : {}),
        hours: hours ?? Math.max(1, Math.round(
          (new Date(`${resolvedEndDate}T${endTime}:00+08:00`).getTime()
            - new Date(`${date}T${startTime}:00+08:00`).getTime()) / 3600000)),
        // 商業租場: the head count is optional — 0 = not given.
        guestCount: guestCount ?? (isCommercial === true ? 0 : 1),
        adultCount: adultCount ?? guestCount ?? (isCommercial === true ? 0 : 1),
        childCount: childCount ?? 0,
        isWeekend: !!isWeekend,
        addOns: Array.isArray(addOns) ? addOns : [],
        hasBYOFood: !!hasBYOFood,
        pricing,
        ...(adminDiscount ? { adminDiscount } : {}),
        // Paid offline → confirmed immediately; nothing received yet →
        // awaiting_payment so it still surfaces as money-to-chase.
        status: cleanPayments.length > 0 ? 'confirmed' : 'awaiting_payment',
        paymentMethod: cleanPayments[0]?.method ?? null,
        receiptUrl: null,
        refundDetails: null,
        balanceDue,
        payments: cleanPayments,
        depositRefund: null,
        customerName: String(customerName).trim(),
        whatsappPhone: whatsappPhone ?? null,
        ...(customerEmail ? { customerEmail } : {}),
        ...(notes ? { notes } : {}),
        ...(packageSlug ? { packageSlug } : {}),
        ...(marketingChannel ? { marketingChannel } : {}),
        ...(marketingChannelLabel ? { marketingChannelLabel } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const slotTestStamp = process.env.VERCEL_ENV !== 'production' ? { isTest: true } : {};
      const addSlot = (data: Record<string, unknown>) =>
        t.create(adminDb.collection('blocked_slots').doc(), { ...data, ...slotTestStamp });
      if (overnight) {
        addSlot({ venueId, date, startTime, endTime: '23:59', reason: 'booking', bookingId });
        addSlot({ venueId, date: resolvedEndDate, startTime: '00:00', endTime, reason: 'booking', bookingId });
        addSlot({ venueId, date: resolvedEndDate, startTime: endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
      } else {
        addSlot({ venueId, date, startTime, endTime, reason: 'booking', bookingId });
        addSlot({ venueId, date, startTime: endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
      }

      for (const r of lockRefs) {
        t.set(r, { lastBookingAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });

    // Best-effort Google Calendar push so cleaners/CS see it — never
    // blocks the booking creation.
    try {
      const { pushBookingToCalendar } = await import('@/lib/googleCalendar');
      const snap = await adminDb.collection('bookings').doc(bookingId).get();
      const redirectUri = `${req.nextUrl.origin}/api/google/callback`;
      const evId = await pushBookingToCalendar(redirectUri, {
        booking: { id: bookingId, ...snap.data() } as never,
        customerName: String(customerName).trim(),
      });
      if (evId) await snap.ref.update({ googleEventId: evId });
    } catch (err) {
      console.warn('[booking-direct] gcal push failed (non-fatal):', err);
    }

    // `overlaps`: what the order sits on top of (e.g. the Google Calendar
    // entry a part-timer made for it) so staff can tidy up.
    return NextResponse.json({ bookingId, grandTotal, paid, balanceDue, overlaps: await withEventTitles(clashes) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SLOT_CONFLICT') {
      // `conflicts` lets the form say what is in the way and offer
      // 「照樣加入」 (resubmit with allowOverlap: true).
      const named = await withEventTitles(clashes);
      return NextResponse.json({ error: 'SLOT_CONFLICT', conflicts: clashesNeedingConfirmation(named), overlaps: named }, { status: 409 });
    }
    console.error('[/api/admin/booking-direct]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
