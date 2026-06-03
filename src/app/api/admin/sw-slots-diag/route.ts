import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

/**
 * GET /api/admin/sw-slots-diag?date=YYYY-MM-DD
 *
 * Dumps every blocked_slot on sw-a / sw-b / sw-ab for the given date,
 * with the owning booking's venueId resolved so we can quickly tell
 * which slot is real vs phantom vs admin-block. Used to debug
 * "Room A 喺呢個時段已經有其他預訂" errors after the phantom cleanup.
 */
const SW_GROUP = ['sw-a', 'sw-b', 'sw-ab'];

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date');
    if (!date) {
      return NextResponse.json({ error: 'date query param (YYYY-MM-DD) required' }, { status: 400 });
    }

    const snap = await adminDb
      .collection('blocked_slots')
      .where('date', '==', date)
      .get();

    const rows: Array<Record<string, unknown>> = [];
    const bookingCache = new Map<string, { venueId: string; status: string } | null>();

    for (const d of snap.docs) {
      const slot = d.data() as {
        venueId: string;
        bookingId?: string;
        startTime: string;
        endTime: string;
        reason: string;
      };
      if (!SW_GROUP.includes(slot.venueId)) continue;

      let booking = slot.bookingId ? bookingCache.get(slot.bookingId) : null;
      if (slot.bookingId && booking === undefined) {
        const bSnap = await adminDb.collection('bookings').doc(slot.bookingId).get();
        booking = bSnap.exists ? (bSnap.data() as { venueId: string; status: string }) : null;
        bookingCache.set(slot.bookingId, booking);
      }

      rows.push({
        slotId: d.id,
        venueId: slot.venueId,
        startTime: slot.startTime,
        endTime: slot.endTime,
        reason: slot.reason,
        bookingId: slot.bookingId || '(admin-block)',
        bookingVenueId: booking?.venueId || '-',
        bookingStatus: booking?.status || '-',
        kind: !slot.bookingId
          ? 'ADMIN-BLOCK'
          : !booking
            ? 'ORPHAN (booking gone)'
            : booking.venueId === slot.venueId
              ? 'REAL'
              : 'PHANTOM',
      });
    }

    // Sort by time for readability.
    rows.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

    return NextResponse.json({
      date,
      total: rows.length,
      slots: rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
