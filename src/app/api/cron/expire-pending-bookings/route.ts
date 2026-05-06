import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sweeps `pending` bookings whose `pendingExpiresAt` has passed and:
 *   1. Marks them `cancelled` (status flips so the slot is logically released).
 *   2. Deletes any blocked_slots created for the booking so the slot is
 *      actually re-bookable by the next customer.
 *
 * Runs every 5 minutes via Vercel cron. Idempotent — re-running on the
 * same expired booking is a no-op (status check filters them out).
 */
export async function GET(request: NextRequest) {
  // Vercel cron sends an Authorization: Bearer ${CRON_SECRET} header.
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();

  const snap = await adminDb
    .collection('bookings')
    .where('status', '==', 'pending')
    .where('pendingExpiresAt', '<=', now)
    .get();

  const cancelled: string[] = [];
  for (const docSnap of snap.docs) {
    const bookingId = docSnap.id;
    try {
      await docSnap.ref.update({
        status: 'cancelled',
        updatedAt: FieldValue.serverTimestamp(),
      });
      const blockedSnap = await adminDb
        .collection('blocked_slots')
        .where('bookingId', '==', bookingId)
        .get();
      const batch = adminDb.batch();
      for (const b of blockedSnap.docs) batch.delete(b.ref);
      if (blockedSnap.size > 0) await batch.commit();
      cancelled.push(bookingId);
    } catch (err) {
      console.error('[expire-pending-bookings] failed for', bookingId, err);
    }
  }

  return NextResponse.json({ scanned: snap.size, cancelled });
}
