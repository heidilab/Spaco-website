import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';

/**
 * POST /api/admin/booking-backfill-stripe-payments { bookingId }
 *
 * For bookings paid via Stripe BEFORE the webhook started writing to
 * payments[] (mid-2026 rewrite), this endpoint reconstructs the audit
 * log by querying Stripe directly:
 *
 *   1. Stripe Search: every checkout session whose metadata.bookingId
 *      matches AND payment_status === 'paid'.
 *   2. For each paid session, append a payments[] entry split across
 *      the three buckets (場租 / 附加項目 / 按金) using the booking's
 *      pricing snapshot — same pro-rata logic as the current webhook.
 *   3. Tag the entry with the Stripe session id (in `note`) so a
 *      second invocation skips already-backfilled charges. This makes
 *      the endpoint safe to re-run.
 *
 * Does NOT touch pricing.* / balanceDue — those already reflect the
 * historical state (Stripe webhook updated them at the time even
 * though it didn't write the audit log entry).
 */
export async function POST(req: NextRequest) {
  try {
    const { bookingId } = await req.json() as { bookingId?: string };
    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
    }

    const bookingRef = adminDb.collection('bookings').doc(bookingId);
    const snap = await bookingRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    const booking = { id: snap.id, ...snap.data() } as BookingRecord;

    // Query Stripe for every checkout session tied to this booking.
    // The Stripe Node SDK v21 types don't expose checkout.sessions
    // .search(), but the REST endpoint exists since API version
    // 2023-08-16 (we're on 2023-10-16). Call it directly via the
    // SDK's lower-level request helper, which inherits auth + retry
    // behaviour from the configured stripe instance.
    const escaped = bookingId.replace(/'/g, "\\'");
    const search = await (
      stripe.checkout.sessions as unknown as {
        search: (params: { query: string; limit?: number }) => Promise<{
          data: Array<{
            id: string;
            payment_status: string;
            amount_total: number | null;
            created: number;
            metadata: Record<string, string> | null;
          }>;
        }>;
      }
    ).search({
      query: `metadata['bookingId']:'${escaped}'`,
      limit: 100,
    });

    // Build a set of session ids already in payments[] so we don't
    // double-append. We tag each backfilled entry's note with
    // "stripe_session:cs_XXX" — webhook entries don't carry the id,
    // so a webhook-recorded entry won't dedupe against a backfill
    // entry of the same charge. To keep that case sane we ALSO
    // dedupe by exact amount + method=stripe.
    const existing = booking.payments || [];
    const existingSessionIds = new Set<string>();
    const existingStripeAmounts: number[] = [];
    for (const p of existing) {
      const m = p.note?.match(/stripe_session:(cs_\w+)/);
      if (m) existingSessionIds.add(m[1]);
      if (p.method === 'stripe' && p.amount) existingStripeAmounts.push(p.amount);
    }

    const baseCharge = booking.pricing.baseCharge || 0;
    const addOnTotal = booking.pricing.addOnTotal || 0;
    const securityDeposit = booking.pricing.securityDeposit || 0;
    const grandTotal = baseCharge + addOnTotal + securityDeposit;

    const added: { sessionId: string; amount: number }[] = [];
    const skipped: { sessionId: string; reason: string }[] = [];

    // Stripe returns sessions in any order — sort by created so the
    // payments[] reads chronologically (initial first, balance second).
    const sortedSessions = [...search.data].sort(
      (a, b) => (a.created || 0) - (b.created || 0),
    );

    for (const session of sortedSessions) {
      if (session.payment_status !== 'paid') {
        skipped.push({ sessionId: session.id, reason: `payment_status=${session.payment_status}` });
        continue;
      }
      if (existingSessionIds.has(session.id)) {
        skipped.push({ sessionId: session.id, reason: 'already-backfilled' });
        continue;
      }
      const paidAmount = session.amount_total ? Math.round(session.amount_total / 100) : 0;
      if (paidAmount <= 0) {
        skipped.push({ sessionId: session.id, reason: 'zero-amount' });
        continue;
      }
      // Best-effort dedupe against webhook-recorded entries (no
      // session id in note) — if any existing stripe entry matches
      // this amount exactly, skip. Imperfect but rare in practice.
      const idx = existingStripeAmounts.indexOf(paidAmount);
      if (idx >= 0) {
        existingStripeAmounts.splice(idx, 1); // consume so two equal-amount sessions aren't both skipped
        skipped.push({ sessionId: session.id, reason: 'amount-match-existing' });
        continue;
      }

      // Pro-rata the paid amount across the three buckets. Deposit
      // slot absorbs the rounding remainder so the three numbers sum
      // exactly to `paidAmount` (no $1 drift).
      let rentalAmount = 0;
      let addOnAmount = 0;
      let depositAmount = paidAmount;
      if (grandTotal > 0) {
        rentalAmount = Math.round((baseCharge / grandTotal) * paidAmount);
        addOnAmount = Math.round((addOnTotal / grandTotal) * paidAmount);
        depositAmount = paidAmount - rentalAmount - addOnAmount;
        if (depositAmount < 0) {
          addOnAmount += depositAmount;
          depositAmount = 0;
          if (addOnAmount < 0) {
            rentalAmount += addOnAmount;
            addOnAmount = 0;
          }
        }
      }
      const isBalance = session.metadata?.isBalancePayment === 'true';
      const createdISO = session.created
        ? new Date(session.created * 1000).toISOString()
        : new Date().toISOString();

      await bookingRef.update({
        payments: FieldValue.arrayUnion({
          rentalAmount,
          addOnAmount,
          depositAmount,
          amount: paidAmount,
          method: 'stripe',
          kind: isBalance ? 'balance' : 'initial',
          note: `stripe_session:${session.id}`,
          recordedBy: 'stripe-backfill',
          recordedAt: createdISO,
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      added.push({ sessionId: session.id, amount: paidAmount });
    }

    return NextResponse.json({
      ok: true,
      added,
      skipped,
      scanned: search.data.length,
    });
  } catch (err) {
    console.error('[backfill-stripe-payments] failed:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Backfill failed' },
      { status: 500 },
    );
  }
}
