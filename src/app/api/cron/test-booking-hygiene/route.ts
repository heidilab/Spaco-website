import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { removeBookingFromCalendar } from '@/lib/googleCalendar';
import { restoreBlockedSlotsIfMissing } from '@/lib/finalizeBooking';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 🧪 Test-booking hygiene (Heidi 2026-09-15) — test bookings are fake:
 * they must never block a real timeslot or sit on the real Google
 * Calendar. New test bookings are handled at write time (blocked_slots
 * stamped isTest, gcal push refused); this sweep retro-fixes the ones
 * created before that (e.g. #percQzxr):
 *   • stamps isTest onto their blocked_slots (prod conflict checks and
 *     calendars skip those; the TEST site still honours them)
 *   • deletes any Google Calendar event they pushed
 * Idempotent — safe to run daily.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const snap = await adminDb.collection('bookings')
    .where('isTest', '==', true)
    .limit(500)
    .get();

  let slotsStamped = 0;
  let gcalRemoved = 0;
  const redirectUri = `${request.nextUrl.origin}/api/google/callback`;

  for (const d of snap.docs) {
    const b = d.data() as { venueId: string; googleEventId?: string | null };

    const slots = await adminDb.collection('blocked_slots')
      .where('bookingId', '==', d.id)
      .get();
    for (const slot of slots.docs) {
      if ((slot.data() as { isTest?: boolean }).isTest) continue;
      await slot.ref.set({ isTest: true }, { merge: true });
      slotsStamped++;
    }

    if (b.googleEventId) {
      try {
        await removeBookingFromCalendar(redirectUri, {
          venueId: b.venueId,
          googleEventId: b.googleEventId,
        });
        await d.ref.set({ googleEventId: null }, { merge: true });
        gcalRemoved++;
      } catch (err) {
        console.warn('[test-hygiene] gcal removal failed', d.id, err);
      }
    }
  }

  // ── Slot integrity for REAL upcoming bookings (2026-10-23) ──────────
  // A real booking whose blocked_slots are missing, or still stamped isTest
  // from a period when it was flagged as a test, shows as AVAILABLE on the
  // site (CWB 2026-10-31 was sold twice). Rebuild / un-stamp them daily.
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  let slotsRestored = 0;
  let slotsUnstamped = 0;
  const repaired: string[] = [];
  const upcoming = await adminDb.collection('bookings').where('date', '>=', today).get();
  for (const d of upcoming.docs) {
    const b = d.data() as BookingRecord;
    if (b.isTest || !['confirmed', 'awaiting_payment', 'awaiting_review'].includes(b.status)) continue;
    const slots = await adminDb.collection('blocked_slots').where('bookingId', '==', d.id).get();
    for (const slot of slots.docs) {
      if ((slot.data() as { isTest?: boolean }).isTest) {
        await slot.ref.set({ isTest: false, repairedAt: new Date().toISOString() }, { merge: true });
        slotsUnstamped++;
        repaired.push(d.id);
      }
    }
    if (!slots.docs.some((s) => (s.data() as { reason?: string }).reason === 'booking')) {
      if (await restoreBlockedSlotsIfMissing({ ...b, id: d.id })) { slotsRestored++; repaired.push(d.id); }
    }
  }
  if (repaired.length) console.warn('[test-hygiene] repaired real-booking slots', Array.from(new Set(repaired)));
  return NextResponse.json({ ok: true, testBookings: snap.size, slotsStamped, gcalRemoved, slotsRestored, slotsUnstamped });
}
