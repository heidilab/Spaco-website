import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireCronSecret } from '@/lib/adminAuth';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Repair bookings STUCK at 'awaiting_payment' despite having a recorded
 * payment. The pre-batch-1 KPay webhook set status =
 * (balanceDue===0 ? 'confirmed' : 'awaiting_payment'), so any booking
 * that paid a deposit but still owed a balance was left 'awaiting_payment'
 * forever. Consequences: the customer's pay-balance button was hidden
 * (now fixed separately), the door-passcode cron never loads them (it
 * queries status=='confirmed'), and they don't count as confirmed in
 * reports. The batch-1 webhook now confirms on any payment; this fixes
 * the rows written before it.
 *
 * A booking qualifies iff status === 'awaiting_payment' AND payments[] is
 * non-empty. It becomes 'confirmed'; if the balance is already 0 we also
 * stamp balancePaidAt / paymentVerifiedAt to match what the webhook does.
 * ('awaiting_review' = receipt pending admin approval — deliberately left
 * alone.)
 *
 * GET (default) dry-run; GET ?apply=1 writes. CRON_SECRET (or DIAG_TOKEN).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const diagOk = !!process.env.DIAG_TOKEN && auth === `Bearer ${process.env.DIAG_TOKEN}`;
  if (!diagOk) {
    const gate = requireCronSecret(req);
    if (gate) return gate;
  }
  const apply = req.nextUrl.searchParams.get('apply') === '1';

  const snap = await adminDb
    .collection('bookings')
    .where('status', '==', 'awaiting_payment')
    .get();

  const fixes: unknown[] = [];
  let written = 0;

  for (const doc of snap.docs) {
    const b = { id: doc.id, ...doc.data() } as BookingRecord;
    const paid = (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    if ((b.payments?.length ?? 0) === 0) continue;   // never paid — leave as-is

    const balanceDue = b.balanceDue ?? 0;
    fixes.push({
      id: b.id, date: b.date, venueId: b.venueId,
      paidSum: paid, balanceDue,
      to: 'confirmed',
      willStampPaid: balanceDue === 0,
    });

    if (apply) {
      const patch: Record<string, unknown> = {
        status: 'confirmed',
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (balanceDue === 0) {
        if (!b.balancePaidAt) patch.balancePaidAt = FieldValue.serverTimestamp();
        if (!b.paymentVerifiedAt) patch.paymentVerifiedAt = FieldValue.serverTimestamp();
      }
      await doc.ref.update(patch);
      written++;
    }
  }

  return NextResponse.json({
    mode: apply ? 'APPLIED' : 'DRY_RUN',
    scannedAt: new Date().toISOString(),
    awaitingPaymentTotal: snap.size,
    stuckWithPayment: fixes.length,
    bookingsWritten: written,
    fixes,
  });
}
