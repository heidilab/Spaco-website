import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireAdmin } from '@/lib/adminAuth';
import { pushBookingToCalendar, updateBookingOnCalendar } from '@/lib/googleCalendar';
import { STAFF_REMARK_MAX } from '@/lib/staffRemark';
import type { BookingRecord, UserProfile } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Save the internal staff remark on a booking (內部備註) and push it to
 * the booking's Google Calendar event straight away.
 *
 * Why a route rather than a client write: cleaners read Google Calendar
 * only (Heidi 2026-11-13), and the calendar is pushed on write — the
 * 15-minute cron only pulls Google → website. So saving the remark and
 * updating the event have to happen together, server side.
 *
 * POST { bookingId, remark }   (empty remark clears it)
 * → { ok, remark, calendar: 'updated' | 'created' | 'not_on_calendar' | 'failed' }
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, 'bookings');
  if (!gate.ok) return gate.res;

  let body: { bookingId?: unknown; remark?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 }); }
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId : '';
  if (!bookingId || typeof body.remark !== 'string') {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }
  const remark = body.remark.replace(/\r\n/g, '\n').trim().slice(0, STAFF_REMARK_MAX);

  const ref = adminDb.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await ref.update({
    staffRemark: remark || FieldValue.delete(),
    staffRemarkUpdatedAt: FieldValue.serverTimestamp(),
    staffRemarkUpdatedBy: gate.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Google Calendar — the event is rewritten whole, so re-read the booking.
  let calendar: 'updated' | 'created' | 'not_on_calendar' | 'failed' = 'not_on_calendar';
  try {
    const fresh = { id: bookingId, ...(await ref.get()).data() } as BookingRecord;
    const userSnap = fresh.userId ? await adminDb.collection('users').doc(fresh.userId).get() : null;
    const profile = userSnap?.exists ? (userSnap.data() as UserProfile) : null;
    const customerName = profile?.displayName || fresh.customerName || undefined;
    const redirectUri = `${req.nextUrl.origin}/api/google/callback`;
    if (fresh.googleEventId) {
      await updateBookingOnCalendar(redirectUri, { booking: fresh, customerName });
      calendar = 'updated';
    } else {
      // Unpaid bookings are not on the calendar yet (push returns null);
      // the remark goes out with the event when the booking is confirmed.
      const eventId = await pushBookingToCalendar(redirectUri, { booking: fresh, customerName });
      if (eventId) {
        await ref.update({ googleEventId: eventId, updatedAt: FieldValue.serverTimestamp() });
        calendar = 'created';
      }
    }
  } catch (err) {
    console.warn('[booking-remark] gcal update failed:', err);
    calendar = 'failed';
  }

  return NextResponse.json({ ok: true, remark, calendar });
}
