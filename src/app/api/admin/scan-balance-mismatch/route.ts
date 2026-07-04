import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/admin/scan-balance-mismatch
 *
 * Scans all confirmed/completed bookings where balanceDue > 0 and checks
 * whether the STORED balanceDue matches the CALCULATED outstanding:
 *
 *   calculatedOutstanding = grandTotal − sum(payments[])
 *   grandTotal = baseCharge + addOnTotal − promoDiscount − pointsDiscount
 *                + securityDeposit
 *
 * A mismatch means the pay-balance link will charge the wrong amount.
 * Root cause: pricing fields were edited after balanceDue was last set
 * (e.g. add-on added, pricing recalculated, synth entry frozen), but
 * balanceDue was not updated to reflect the change.
 *
 * Also flags bookings where balanceDue > 0 but payments[] sum already
 * covers the full grandTotal (i.e. the balance is phantom).
 */
export async function GET() {
  const snap = await adminDb.collection('bookings').get();

  const mismatches: Array<Record<string, unknown>> = [];
  const phantoms: Array<Record<string, unknown>> = [];

  for (const docSnap of snap.docs) {
    const b = docSnap.data() as {
      status?: string;
      balanceDue?: number;
      date?: string;
      venueId?: string;
      branchSlug?: string;
      pricing?: {
        baseCharge?: number;
        addOnTotal?: number;
        securityDeposit?: number;
      };
      promoDiscount?: number;
      pointsDiscount?: number;
      payments?: Array<{ amount?: number }>;
    };

    const status = b.status || '';
    if (status !== 'confirmed' && status !== 'completed') continue;

    const storedBalance = b.balanceDue ?? 0;
    if (storedBalance <= 0) continue;

    const grandTotal = Math.max(
      0,
      (b.pricing?.baseCharge || 0)
        + (b.pricing?.addOnTotal || 0)
        - (b.promoDiscount || 0)
        - (b.pointsDiscount || 0),
    ) + (b.pricing?.securityDeposit || 0);

    const paymentsSum = (b.payments || []).reduce(
      (s: number, p: { amount?: number }) => s + (p.amount || 0),
      0,
    );

    const calculatedOutstanding = Math.max(0, grandTotal - paymentsSum);
    const diff = calculatedOutstanding - storedBalance;

    // Phantom: storedBalance > 0 but payments already cover grandTotal
    if (calculatedOutstanding === 0 && storedBalance > 0) {
      phantoms.push({
        id: docSnap.id,
        shortId: docSnap.id.slice(0, 8),
        venue: b.branchSlug || b.venueId,
        date: b.date,
        status,
        storedBalanceDue: storedBalance,
        grandTotal,
        paymentsSum,
        calculatedOutstanding: 0,
        issue: 'phantom — payments cover full grandTotal but balanceDue not cleared',
      });
      continue;
    }

    // Mismatch: stored vs calculated differ by more than $1 (rounding tolerance)
    if (Math.abs(diff) > 1) {
      mismatches.push({
        id: docSnap.id,
        shortId: docSnap.id.slice(0, 8),
        venue: b.branchSlug || b.venueId,
        date: b.date,
        status,
        grandTotal,
        paymentsSum,
        storedBalanceDue: storedBalance,
        calculatedOutstanding,
        diff,
        issue: diff > 0
          ? `pay-balance link will UNDERCHARGE by HK$${diff} (stored $${storedBalance} < calculated $${calculatedOutstanding})`
          : `pay-balance link will OVERCHARGE by HK$${Math.abs(diff)} (stored $${storedBalance} > calculated $${calculatedOutstanding})`,
      });
    }
  }

  return NextResponse.json({
    scanned: snap.size,
    mismatches,
    phantoms,
    mismatchCount: mismatches.length,
    phantomCount: phantoms.length,
    summary: mismatches.length === 0 && phantoms.length === 0
      ? '✓ All confirmed/completed bookings with outstanding balances are consistent.'
      : `⚠️ Found ${mismatches.length} mismatch(es) and ${phantoms.length} phantom balance(s).`,
  });
}
