import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';

/**
 * POST /api/admin/booking-settle-balance
 *   { bookingId, method?, note?, recordedBy }
 *
 * Marks the outstanding balance (booking.balanceDue) as PAID without
 * inflating booking.pricing.* — that distinction matters:
 *
 *   • The existing /api/admin/booking-edit-followup payment-recording
 *     branch ADDS the amount to pricing.subtotal / pricing.securityDeposit
 *     / pricing.deposit. That's correct when admin extends a booking
 *     (e.g. +1 extra hour costs $300 more) — the customer's bill
 *     genuinely grew.
 *
 *   • For balance settlement, the customer's bill DIDN'T grow — they're
 *     paying what they already owe. Bumping pricing would double-count
 *     and break the "已收 = grandTotal − balanceDue" math everywhere.
 *
 * So this endpoint only:
 *   1. Appends a payments[] audit entry split via REVERSE bucket-fill
 *      (附加項目 → 場租 → 按金) against the remaining capacity in each
 *      bucket. The reverse order mirrors how the initial payment
 *      filled deposit → rental → addOn from the other end.
 *   2. Sets balanceDue = 0 and balancePaidAt to now.
 *   3. Leaves pricing.* untouched.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      bookingId?: string;
      method?: 'fps' | 'bank' | 'cash' | 'other';
      note?: string;
      recordedBy?: string;
    };
    const { bookingId } = body;
    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
    }
    // Stripe entries must come from the webhook only — refuse to
    // record an offline-settled balance as a Stripe payment, even if
    // the caller asks (Heidi's spec post-#WIiQYL2I incident).
    if ((body.method as string) === 'stripe') {
      return NextResponse.json(
        { error: 'Stripe payments cannot be entered manually. Use FPS / bank / cash / other.' },
        { status: 400 },
      );
    }

    const ref = adminDb.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    const booking = { id: snap.id, ...snap.data() } as BookingRecord;
    const balance = booking.balanceDue ?? 0;
    if (balance <= 0) {
      return NextResponse.json({ error: 'No outstanding balance' }, { status: 400 });
    }

    // Per-bucket remaining capacity after subtracting what's already
    // been logged in payments[]. PaymentHistory's synth row will fill
    // anything left over from the initial payment.
    const baseCharge = booking.pricing.baseCharge || 0;
    const addOnTotal = booking.pricing.addOnTotal || 0;
    const securityDeposit = booking.pricing.securityDeposit || 0;
    const loggedRental = (booking.payments || []).reduce((s, p) => s + (p.rentalAmount || 0), 0);
    const loggedAddOn = (booking.payments || []).reduce((s, p) => s + (p.addOnAmount || 0), 0);
    const loggedDeposit = (booking.payments || []).reduce((s, p) => s + (p.depositAmount || 0), 0);
    let capRental = Math.max(0, baseCharge - loggedRental);
    let capAddOn = Math.max(0, addOnTotal - loggedAddOn);
    let capDeposit = Math.max(0, securityDeposit - loggedDeposit);

    let rentalAmount = 0;
    let addOnAmount = 0;
    let depositAmount = 0;
    let remaining = balance;
    // Reverse bucket-fill: 附加項目 → 場租 → 按金
    addOnAmount = Math.min(remaining, capAddOn); remaining -= addOnAmount; capAddOn -= addOnAmount;
    rentalAmount = Math.min(remaining, capRental); remaining -= rentalAmount; capRental -= rentalAmount;
    depositAmount = Math.min(remaining, capDeposit); remaining -= depositAmount; capDeposit -= depositAmount;
    // Edge case overflow — dump into add-ons so the entry total still matches.
    addOnAmount += remaining;

    await ref.update({
      balanceDue: 0,
      balancePaidAt: FieldValue.serverTimestamp(),
      payments: FieldValue.arrayUnion({
        rentalAmount,
        addOnAmount,
        depositAmount,
        amount: balance,
        method: (body.method || booking.paymentMethod || 'fps'),
        kind: 'balance',
        note: body.note || null,
        recordedBy: body.recordedBy || 'admin',
        recordedAt: new Date().toISOString(),
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, amountSettled: balance });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Settle failed' },
      { status: 500 },
    );
  }
}
