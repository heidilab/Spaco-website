import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { removeBookingFromCalendar } from '@/lib/googleCalendar';

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

  return NextResponse.json({ ok: true, testBookings: snap.size, slotsStamped, gcalRemoved });
}
