import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '@/lib/adminAuth';
import { computeGrandTotal, computeBalanceDue, paidBase } from '@/lib/bookingMoney';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    addOns, hasBYOFood, pricing, packageSlug,
    customerName, whatsappPhone, customerEmail, notes,
    marketingChannel, marketingChannelLabel,
    payments,
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

  const cleanPayments = (Array.isArray(payments) ? payments : [])
    .filter((p) => p && Number(p.amount) > 0 && p.date)
    .map((p) => ({
      amount: Math.round(Number(p.amount) * 100) / 100,
      method: (['fps', 'bank', 'cash', 'kpay', 'other'] as const).includes(p.method) ? p.method : 'other',
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

  const sharedVenues = venuesSharingSpace(venueId);
  const lockKey = physicalSpaceLockKey(venueId);
  const lockDates = resolvedEndDate !== date ? [date, resolvedEndDate] : [date];
  const checkWindows = overnight
    ? [
        { date: date as string, start: toMin(startTime), end: 24 * 60 },
        { date: resolvedEndDate, start: 0, end: toMin(endTime) },
      ]
    : [{ date: date as string, start: toMin(startTime), end: toMin(endTime) }];

  // Money derived through the shared module so balanceDue always agrees
  // with the rest of the system.
  const moneyShape = { pricing, payments: cleanPayments };
  const grandTotal = computeGrandTotal(moneyShape);
  const balanceDue = computeBalanceDue(moneyShape);
  const paid = paidBase(moneyShape);

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
      for (const w of checkWindows) {
        for (const docSnap of blockedDocs) {
          const bd = docSnap.data() as { date: string; startTime: string; endTime: string };
          if (bd.date !== w.date) continue;
          if (w.start < toMin(bd.endTime) && toMin(bd.startTime) < w.end) {
            throw new Error('SLOT_CONFLICT');
          }
        }
      }

      const bookingRef = adminDb.collection('bookings').doc();
      bookingId = bookingRef.id;
      t.create(bookingRef, {
        ...(process.env.VERCEL_ENV !== 'production' ? { isTest: true } : {}),
        userId: null,                    // offline customer — no account
        createdVia: 'admin-direct',
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
        guestCount: guestCount ?? 1,
        adultCount: adultCount ?? guestCount ?? 1,
        childCount: childCount ?? 0,
        isWeekend: !!isWeekend,
        addOns: Array.isArray(addOns) ? addOns : [],
        hasBYOFood: !!hasBYOFood,
        pricing,
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

    return NextResponse.json({ bookingId, grandTotal, paid, balanceDue });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'SLOT_CONFLICT') {
      return NextResponse.json({ error: 'SLOT_CONFLICT' }, { status: 409 });
    }
    console.error('[/api/admin/booking-direct]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
