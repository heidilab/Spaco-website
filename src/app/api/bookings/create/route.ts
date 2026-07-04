import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const overnight = !!endDate && endDate !== date;
  const resolvedEndDate = overnight ? (endDate as string) : date;

  // Cleaning buffer: 1 hour after end time. Capped at 23:59.
  const [endH, endM] = (endTime as string).split(':').map(Number);
  const bufferEndH = endH + 1;
  const bufferEnd = bufferEndH >= 24
    ? '23:59'
    : `${String(bufferEndH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  const sharedVenues = venuesSharingSpace(venueId);
  const lockKey = physicalSpaceLockKey(venueId);

  // Time windows to check for conflicts (each window belongs to one calendar date).
  const checkWindows = overnight
    ? [
        { date: date as string, start: toMin(startTime), end: 24 * 60 },
        { date: resolvedEndDate, start: 0, end: toMin(endTime) },
      ]
    : [{ date: date as string, start: toMin(startTime), end: toMin(endTime) }];

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
      t.create(bookingRef, {
        venueId,
        date,
        startTime,
        endTime,
        ...(overnight ? { endDate } : {}),
        // Rename draftIdField → draftId so the booking record stores the
        // correct field name (consistent with BookingRecord type).
        ...(draftIdField ? { draftId: draftIdField } : {}),
        ...rest,
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

      // ── 7. Mark booking draft as claimed ──────────────────────────────
      if (draftRef) {
        t.update(draftRef, {
          claimedBy: rest.userId ?? null,
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
