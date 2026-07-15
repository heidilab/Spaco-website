import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireCronSecret } from '@/lib/adminAuth';

export const runtime = 'nodejs';

/**
 * POST /api/admin/cleanup-phantom-slots
 *   { dryRun?: boolean }  (default true)
 *
 * One-off migration: remove blocked_slot rows that were written by the
 * old shared-space expansion (createBooking / updateBookingDateTime
 * pre-Heidi-2026-06-fix). For Sheung Wan, a sw-b booking would create
 * a phantom sw-ab slot, which then made sw-a appear unbookable via the
 * conflict-check broad query.
 *
 * Definition of phantom: the slot has a bookingId AND the owning
 * booking's venueId is different from the slot's venueId AND both are
 * in the same Sheung Wan sharing group (sw-a / sw-b / sw-ab).
 *
 * dryRun=true (default) just reports what would be deleted. Pass
 * { dryRun: false } in the body to actually delete.
 */
const SW_GROUP = new Set(['sw-a', 'sw-b', 'sw-ab']);

export async function POST(req: NextRequest) {
  const _gate = requireCronSecret(req);
  if (_gate) return _gate;

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false; // default true

    const slotsSnap = await adminDb.collection('blocked_slots').get();
    const phantoms: Array<{
      slotId: string;
      slotVenueId: string;
      bookingId: string;
      bookingVenueId: string;
      date: string;
      startTime: string;
      endTime: string;
    }> = [];
    const missingBookings: string[] = [];
    const bookingCache = new Map<string, { venueId: string } | null>();

    for (const slotDoc of slotsSnap.docs) {
      const slot = slotDoc.data() as {
        venueId: string;
        bookingId?: string;
        date: string;
        startTime: string;
        endTime: string;
      };
      if (!slot.bookingId) continue;                    // admin manual block — leave alone
      if (!SW_GROUP.has(slot.venueId)) continue;        // not in shared group — not a phantom candidate

      // Resolve the owning booking's venueId (cached).
      let booking = bookingCache.get(slot.bookingId);
      if (booking === undefined) {
        const bSnap = await adminDb.collection('bookings').doc(slot.bookingId).get();
        booking = bSnap.exists ? (bSnap.data() as { venueId: string }) : null;
        bookingCache.set(slot.bookingId, booking);
      }
      if (!booking) {
        // Booking gone but slot remains — orphan. Distinct from phantom but
        // also worth flagging (these would normally be cleaned by cancel).
        missingBookings.push(slotDoc.id);
        continue;
      }
      if (booking.venueId === slot.venueId) continue;   // legit (own venue's slot)
      // Phantom: slot is for a sibling venue in the SW group.
      phantoms.push({
        slotId: slotDoc.id,
        slotVenueId: slot.venueId,
        bookingId: slot.bookingId,
        bookingVenueId: booking.venueId,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
      });
    }

    if (!dryRun) {
      for (const p of phantoms) {
        await adminDb.collection('blocked_slots').doc(p.slotId).delete();
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      phantomCount: phantoms.length,
      missingBookingSlotCount: missingBookings.length,
      phantoms,
      missingBookingSlots: missingBookings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
