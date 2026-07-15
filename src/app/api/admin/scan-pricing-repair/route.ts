import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { requireCronSecret } from '@/lib/adminAuth';
import { computeGrandTotal } from '@/lib/finalizeBooking';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Batch-3 data repair. Normalises every booking to the single canonical
 * pricing convention after the code was unified:
 *
 *   • pricing.subtotal  → GROSS (pre-promo) = baseCharge + addOnTotal.
 *     Old updateBookingDateTime stored it POST-promo; this restores gross.
 *     (Money-neutral: subtotal is derived; balanceDue is separate.)
 *   • balanceDue        → recomputed from the canonical primitives
 *     formula (computeGrandTotal − Σ payments[].amount), for OPEN
 *     bookings only. Fixes phantom balances left by the old KPay
 *     webhook / offline-payment paths that ignored promo/points.
 *     Skips 'completed' / 'cancelled' (closed — don't disturb).
 *
 * GET  (default)   → dry-run: report every proposed change.
 * GET  ?apply=1    → write the changes.
 * Gated by CRON_SECRET.
 */
const OPEN_STATES = new Set(['confirmed', 'awaiting_payment', 'awaiting_review', 'payment_not_completed']);

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const diagOk = !!process.env.DIAG_TOKEN && auth === `Bearer ${process.env.DIAG_TOKEN}`;
  if (!diagOk) {
    const gate = requireCronSecret(req);
    if (gate) return gate;
  }
  const apply = req.nextUrl.searchParams.get('apply') === '1';

  const snap = await adminDb.collection('bookings').get();
  const subtotalFixes: unknown[] = [];
  const balanceFixes: unknown[] = [];
  let written = 0;

  for (const doc of snap.docs) {
    const b = { id: doc.id, ...doc.data() } as BookingRecord;
    const pricing = b.pricing || ({} as BookingRecord['pricing']);
    const baseCharge = pricing.baseCharge || 0;
    const addOnTotal = pricing.addOnTotal || 0;
    const grossSubtotal = baseCharge + addOnTotal;
    const storedSubtotal = pricing.subtotal ?? 0;

    const patch: Record<string, unknown> = {};

    // 1. subtotal → gross (only if it drifted, tolerance $1 for rounding).
    if (Math.abs(storedSubtotal - grossSubtotal) >= 1) {
      patch['pricing.subtotal'] = grossSubtotal;
      subtotalFixes.push({ id: b.id, date: b.date, from: storedSubtotal, to: grossSubtotal });
    }

    // 2. balanceDue → canonical, open bookings only.
    if (OPEN_STATES.has(b.status || '')) {
      const paid = (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
      const grand = computeGrandTotal(b);
      const canonicalBalance = Math.max(0, Math.round((grand - paid) * 100) / 100);
      const storedBalance = b.balanceDue ?? 0;
      if (Math.abs(canonicalBalance - storedBalance) >= 1) {
        patch.balanceDue = canonicalBalance;
        balanceFixes.push({
          id: b.id, date: b.date, status: b.status,
          from: storedBalance, to: canonicalBalance,
          delta: Math.round((canonicalBalance - storedBalance) * 100) / 100,
          promo: b.promoDiscount || 0, points: b.pointsDiscount || 0,
        });
      }
    }

    if (apply && Object.keys(patch).length > 0) {
      await doc.ref.update(patch);
      written++;
    }
  }

  return NextResponse.json({
    mode: apply ? 'APPLIED' : 'DRY_RUN',
    scannedAt: new Date().toISOString(),
    totalBookings: snap.size,
    counts: { subtotalFixes: subtotalFixes.length, balanceFixes: balanceFixes.length },
    bookingsWritten: written,
    subtotalFixes,
    balanceFixes,
  });
}
