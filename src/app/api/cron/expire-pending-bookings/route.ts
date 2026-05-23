import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { removeBookingFromCalendar } from '@/lib/googleCalendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sweeps offline-payment bookings whose 30-minute "upload your receipt"
 * window has lapsed without a receipt or admin intervention, and:
 *   1. Flips status to `payment_not_completed` — the booking stays in the
 *      system as a record (CS can follow up with the customer) but is
 *      logically out of the active pipeline.
 *   2. Deletes any blocked_slots created for the booking so the time is
 *      immediately re-bookable by the next customer.
 *   3. Removes the matching Google Calendar event so staff don't see a
 *      ghost booking.
 *
 * Two cases are swept:
 *   a) `status='pending'` legacy rows from before the 2026-05 rewrite
 *      (customer-flow bookings now skip pending entirely). Treat them the
 *      same as offline-payment lapse so they don't linger.
 *   b) `status='awaiting_payment'` for ANY paymentMethod once
 *      `pendingExpiresAt` lapses — including Stripe. Heidi's 2026-05-23
 *      "先到先得" rule: no unpaid booking holds a slot past 30 min.
 *      The Stripe checkout session is configured with the same 30-min
 *      expiry (/api/stripe/checkout) so the customer can't pay through
 *      a stale link after we sweep. Skip rows where the customer
 *      already uploaded an offline receipt — those go to admin review,
 *      not auto-flip.
 *
 * Runs every 15 minutes via Vercel cron. Idempotent — re-running on the
 * same expired booking is a no-op (status check filters them out).
 */
export async function GET(request: NextRequest) {
  // Vercel cron sends an Authorization: Bearer ${CRON_SECRET} header.
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();

  // Single-field where queries only — combining `status` + `pendingExpiresAt`
  // would require a composite index that this project doesn't have set up.
  // Filter the deadline in JS instead; the result sets are small (<100 rows
  // each) so the in-memory pass is cheap.
  const pendingSnap = await adminDb
    .collection('bookings')
    .where('status', '==', 'pending')
    .get();

  const offlineAwaitingSnap = await adminDb
    .collection('bookings')
    .where('status', '==', 'awaiting_payment')
    .get();

  // In-JS deadline filter — keep only bookings whose pendingExpiresAt
  // has already elapsed (or is missing, in which case they're legacy
  // rows that should also be swept).
  const isExpired = (d: { data: () => { pendingExpiresAt?: unknown } }) => {
    const ts = d.data().pendingExpiresAt;
    if (typeof ts !== 'number') return true; // no deadline ⇒ treat as expired
    return ts <= now;
  };

  const flipped: string[] = [];
  const candidates = [
    ...pendingSnap.docs.filter(isExpired),
    // Sweep ANY paymentMethod (incl. Stripe — its checkout session
    // expires at the same 30-min mark). Skip only when the customer
    // already uploaded an offline receipt; those rows go to admin
    // review on /admin/receipts and shouldn't auto-flip.
    ...offlineAwaitingSnap.docs.filter((d) => isExpired(d) && !d.data().receiptUrl),
  ];

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/google/callback`;
  for (const docSnap of candidates) {
    const bookingId = docSnap.id;
    try {
      const data = docSnap.data() as { venueId?: string; googleEventId?: string };
      await docSnap.ref.update({
        status: 'payment_not_completed',
        updatedAt: FieldValue.serverTimestamp(),
      });
      const blockedSnap = await adminDb
        .collection('blocked_slots')
        .where('bookingId', '==', bookingId)
        .get();
      const batch = adminDb.batch();
      for (const b of blockedSnap.docs) batch.delete(b.ref);
      if (blockedSnap.size > 0) await batch.commit();
      // Remove the orphaned Google Calendar event so staff don't see a
      // ghost booking. Non-fatal on failure (e.g. gcal disconnected).
      if (data.googleEventId && data.venueId) {
        try {
          await removeBookingFromCalendar(redirectUri, {
            venueId: data.venueId,
            googleEventId: data.googleEventId,
          });
          await docSnap.ref.update({ googleEventId: null });
        } catch (err) {
          console.warn('[expire-pending] gcal cleanup failed for', bookingId, err);
        }
      }
      flipped.push(bookingId);
    } catch (err) {
      console.error('[expire-pending-bookings] failed for', bookingId, err);
    }
  }

  return NextResponse.json({
    scanned: pendingSnap.size + offlineAwaitingSnap.size,
    flippedToPaymentNotCompleted: flipped,
  });
}
