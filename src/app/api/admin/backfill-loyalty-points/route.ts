import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/backfill-loyalty-points
 *   { dryRun?: boolean; ids?: string[] }
 *
 * Backfills under-credited loyalty points across all bookings whose
 * pointsActuallyCredited was computed with the old buggy formula
 * (subtotal − promo), which under-credited POST-promo bookings by
 * exactly the promo amount.
 *
 * For each booking:
 *  - Computes expectedPoints from primitives:
 *      effectiveSpend = max(0, baseCharge + addOnTotal − promo − pointsDiscount)
 *      expected = effectiveSpend + consumedDeposit
 *  - Compares to stored pointsActuallyCredited
 *  - If delta > 0 (under-credited), credits the delta to userId via
 *    a direct loyaltyPoints increment + updates pointsActuallyCredited
 *  - If delta < 0 (over-credited), SKIPS — never deducts points from a
 *    customer; that's a CS nightmare and not what Heidi asked for.
 *  - If delta == 0, skips silently.
 *
 * dryRun = true (default) reports what WOULD be backfilled.
 * ids = optional list of booking ids (8-char prefix or full) to limit
 *       backfill to a specific subset.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    dryRun?: boolean;
    ids?: string[];
  };
  const dryRun = body.dryRun !== false;
  const idFilter = body.ids && body.ids.length > 0
    ? new Set(body.ids.map((s) => s.toLowerCase()))
    : null;

  const all = await adminDb.collection('bookings').get();
  const patched: Array<Record<string, unknown>> = [];
  const overCredited: Array<Record<string, unknown>> = [];
  const inSync: number[] = [];

  for (const doc of all.docs) {
    if (idFilter) {
      const lower = doc.id.toLowerCase();
      const matched = Array.from(idFilter).some((idf) => lower.startsWith(idf));
      if (!matched) continue;
    }
    const b = doc.data() as {
      pricing?: { baseCharge?: number; addOnTotal?: number; securityDeposit?: number };
      promoDiscount?: number;
      promoCode?: string;
      pointsDiscount?: number;
      pointsActuallyCredited?: number;
      depositRefund?: { deductions?: Array<{ amount?: number }> };
      userId?: string;
      date?: string;
      venueId?: string;
    };
    const stored = b.pointsActuallyCredited;
    if (typeof stored !== 'number' || stored <= 0) continue;
    if (!b.userId) continue;
    const baseCharge = b.pricing?.baseCharge ?? 0;
    const addOnTotal = b.pricing?.addOnTotal ?? 0;
    const securityDeposit = b.pricing?.securityDeposit ?? 0;
    const promoDiscount = b.promoDiscount ?? 0;
    const pointsDiscount = b.pointsDiscount ?? 0;
    const deductionsTotal = (b.depositRefund?.deductions || []).reduce((s, d) => s + (d.amount ?? 0), 0);
    const consumedDeposit = Math.min(securityDeposit, deductionsTotal);
    const overflowPaid = Math.max(0, deductionsTotal - securityDeposit);
    const effectiveSpend = Math.max(0, baseCharge + addOnTotal - promoDiscount - pointsDiscount);
    const expected = effectiveSpend + consumedDeposit + overflowPaid;
    const delta = expected - stored;

    if (Math.abs(delta) < 1) {
      inSync.push(stored);
      continue;
    }

    if (delta < 0) {
      overCredited.push({
        id: doc.id.slice(0, 8),
        fullId: doc.id,
        userId: b.userId,
        venueId: b.venueId,
        date: b.date,
        promoCode: b.promoCode,
        stored,
        expected,
        delta,
        note: 'over-credited; SKIPPED (no auto-deduction)',
      });
      continue;
    }

    // Under-credited — credit the delta.
    patched.push({
      id: doc.id.slice(0, 8),
      fullId: doc.id,
      userId: b.userId,
      venueId: b.venueId,
      date: b.date,
      promoCode: b.promoCode,
      promoDiscount,
      stored,
      expected,
      delta,
    });

    if (!dryRun) {
      // Increment user's loyalty balance by delta, and update the
      // booking's pointsActuallyCredited record to the new total so
      // subsequent runs are idempotent.
      const userRef = adminDb.collection('users').doc(b.userId);
      await userRef.update({ loyaltyPoints: FieldValue.increment(delta) });
      await adminDb.collection('bookings').doc(doc.id).update({
        pointsActuallyCredited: expected,
        pointsBackfilledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    totalUnderCreditedBookings: patched.length,
    totalOverCreditedBookings: overCredited.length,
    inSyncCount: inSync.length,
    totalDeltaToCredit: patched.reduce((s, p) => s + (p.delta as number), 0),
    underCredited: patched,
    overCredited,
  });
}
