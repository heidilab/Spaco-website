import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';

/**
 * POST /api/admin/booking-freeze-synth-payment
 *   { bookingId, method?, kind?, note?, recordedBy }
 *
 * The PaymentHistory component renders a "synthetic" initial payment
 * row for legacy bookings (paid before the webhook started writing
 * payments[] entries). That row is computed live from
 *   `actualPaidTotal − sum(payments[]) → bucket-fill on remaining`
 * so it MOVES whenever admin edits pricing — exactly the behaviour
 * Heidi flagged on #hlJJh9K5 ("付款記錄應該不會隨時更改, 是嚴格跟從
 * 收款金額, 而且是過去式不會改變").
 *
 * This endpoint converts that ephemeral synth row into a permanent
 * payments[] entry, replicating the bucket-fill server-side so the
 * client can't supply mismatched amounts. Once stored, the entry is
 * historical — pricing edits no longer change it.
 *
 * Refuses to fire when the synth amount would be 0 (i.e. payments[]
 * already cover what was paid) or when the booking is unpaid.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      bookingId?: string;
      method?: 'stripe' | 'fps' | 'bank' | 'cash' | 'other';
      kind?: 'initial' | 'balance' | 'topup';
      note?: string;
      recordedBy?: string;
    };
    const { bookingId } = body;
    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
    }

    const ref = adminDb.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    const booking = { id: snap.id, ...snap.data() } as BookingRecord;

    const isPaid =
      booking.status === 'confirmed'
      || booking.status === 'completed'
      || !!booking.paymentVerifiedAt;
    if (!isPaid) {
      return NextResponse.json(
        { error: 'Booking is not paid yet — nothing to freeze.' },
        { status: 400 },
      );
    }

    // Replicate the synth math exactly (PaymentHistory.tsx). Keep this
    // in sync if the synth bucket-fill rules change there.
    //
    // pricing.subtotal is already stored post-promo by
    // updateBookingDateTime, so no further promo subtraction here.
    const grandTotal =
      (booking.pricing.subtotal || 0) + (booking.pricing.securityDeposit || 0);
    const actualPaidTotal = Math.max(0, grandTotal - (booking.balanceDue || 0));
    const loggedTotalAmount =
      (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    const synthAmount = Math.max(0, actualPaidTotal - loggedTotalAmount);

    if (synthAmount <= 0) {
      return NextResponse.json(
        { error: 'payments[] already cover what was paid — no synth row to freeze.' },
        { status: 400 },
      );
    }

    const baseCharge = booking.pricing.baseCharge || 0;
    const addOnTotal = booking.pricing.addOnTotal || 0;
    const securityDeposit = booking.pricing.securityDeposit || 0;
    const loggedRental = (booking.payments || []).reduce((s, p) => s + (p.rentalAmount || 0), 0);
    const loggedAddOn = (booking.payments || []).reduce((s, p) => s + (p.addOnAmount || 0), 0);
    const loggedDeposit = (booking.payments || []).reduce((s, p) => s + (p.depositAmount || 0), 0);
    const remainingRental = Math.max(0, baseCharge - loggedRental);
    const remainingAddOn = Math.max(0, addOnTotal - loggedAddOn);
    const remainingDeposit = Math.max(0, securityDeposit - loggedDeposit);

    let remaining = synthAmount;
    const depositAmount = Math.min(remaining, remainingDeposit);
    remaining -= depositAmount;
    const rentalAmount = Math.min(remaining, remainingRental);
    remaining -= rentalAmount;
    const addOnAmount = Math.min(remaining, remainingAddOn);
    remaining -= addOnAmount;
    // `remaining` here = overpayment (synth amount exceeds the bucket
    // totals). Refuse to freeze in that case — admin needs to repair
    // pricing.subtotal / securityDeposit first (via the override
    // fields) or the frozen entry would itself be wrong.
    if (remaining > 0) {
      return NextResponse.json(
        {
          error: 'OVERPAYMENT',
          message:
            '已付款金額超過張單總額 HK$'
            + remaining.toLocaleString()
            + '。請先用「消費小計」/「可退按金」override 修正金額後再凍結。',
          overflow: remaining,
        },
        { status: 400 },
      );
    }

    const actualAmount = depositAmount + rentalAmount + addOnAmount;

    await ref.update({
      payments: FieldValue.arrayUnion({
        rentalAmount,
        addOnAmount,
        depositAmount,
        amount: actualAmount,
        method: body.method || booking.paymentMethod || 'stripe',
        kind: body.kind || 'initial',
        note: body.note || 'Frozen from synthesized historical row',
        recordedBy: body.recordedBy || 'admin-freeze-synth',
        recordedAt: new Date().toISOString(),
      }),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      frozen: { rentalAmount, addOnAmount, depositAmount, amount: actualAmount },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Freeze failed' },
      { status: 500 },
    );
  }
}
