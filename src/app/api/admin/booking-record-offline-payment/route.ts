import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { BookingRecord } from '@/types';

export const runtime = 'nodejs';

/**
 * POST /api/admin/booking-record-offline-payment
 *   { bookingId, rentalAmount, addOnAmount, depositAmount, method, note?, recordedBy }
 *
 * Records an offline payment (FPS / bank / cash / other — Stripe is
 * REJECTED per Heidi's spec) on the booking WITHOUT inflating
 * pricing.subtotal / pricing.securityDeposit / pricing.deposit. This
 * is the canonical "已於線下付款" path: the booking's owed total was
 * already locked in at creation / edit time, and recording what the
 * customer paid offline only updates payments[] + balanceDue —
 * never changes what they're supposed to owe.
 *
 * Contrast with the legacy booking-edit-followup payment branch
 * which bumped pricing.subtotal by `rental + addOn` (designed for
 * "extend booking + record the extra charge" — that flow is gone now
 * because admin edits add-ons in the edit panel; pricing recompute
 * happens via updateBookingDateTime on save).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      bookingId?: string;
      amount?: number;
      method?: 'fps' | 'bank' | 'cash' | 'other';
      note?: string;
      recordedBy?: string;
    };
    const { bookingId } = body;
    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
    }
    // Stripe entries are webhook-only.
    if ((body.method as string) === 'stripe') {
      return NextResponse.json(
        { error: 'Stripe payments cannot be entered manually. Use FPS / bank / cash / other.' },
        { status: 400 },
      );
    }
    const total = Math.max(0, Math.floor(body.amount || 0));
    if (total <= 0) {
      return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 });
    }

    const ref = adminDb.collection('bookings').doc(bookingId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    const booking = { id: snap.id, ...snap.data() } as BookingRecord;

    // Recompute balanceDue from scratch using payments[] as the source
    // of truth (Option C). pricing.subtotal is ALREADY stored post-
    // promo by updateBookingDateTime (see lib/firestore.ts where it
    // assigns `effectiveSubtotal = baseSubtotal − promoDiscount`), so
    // no further promo subtraction here — that would double-count
    // (the $18,960 vs $19,960 bug on #WIiQYL2I).
    const subtotal = booking.pricing?.subtotal || 0;
    const securityDeposit = booking.pricing?.securityDeposit || 0;
    const grandTotal = subtotal + securityDeposit;
    const loggedSum = (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    const newBalanceDue = Math.max(0, grandTotal - loggedSum - total);

    // Status advancement (mirrors booking-edit-followup):
    // only from upstream states; never downgrade confirmed/completed.
    const upstreamStates = new Set([
      'pending',
      'awaiting_payment',
      'awaiting_review',
      'payment_not_completed',
    ]);
    // Special case: deposit-settlement overflow.
    // If the booking is already 'confirmed' AND has a depositRefund
    // (post-event settlement was done) AND balance now hits 0, the
    // remaining payment was the deductions-exceed-deposit overflow.
    // Flip to 'completed' since the event is over and we're square.
    const settledWithOverflow =
      booking.status === 'confirmed' && !!booking.depositRefund;
    let nextStatus = booking.status;
    if (settledWithOverflow && newBalanceDue === 0) {
      nextStatus = 'completed';
    } else if (upstreamStates.has(booking.status)) {
      nextStatus = newBalanceDue === 0 ? 'confirmed' : 'awaiting_payment';
    }

    const entryKind: 'initial' | 'balance' | 'topup' =
      loggedSum === 0
        ? 'initial'
        : newBalanceDue === 0
          ? 'balance'
          : 'topup';

    const update: Record<string, unknown> = {
      payments: FieldValue.arrayUnion({
        // Per-bucket allocation is no longer tracked on new offline
        // payments (Heidi's 2026-05-23 spec) — only the running total
        // matters. Legacy entries keep their bucket fields.
        rentalAmount: 0,
        addOnAmount: 0,
        depositAmount: 0,
        amount: total,
        method: body.method || 'fps',
        kind: entryKind,
        note: body.note?.trim() || null,
        recordedBy: body.recordedBy || 'admin',
        recordedAt: new Date().toISOString(),
      }),
      balanceDue: newBalanceDue,
      status: nextStatus,
      updatedAt: FieldValue.serverTimestamp(),
      ...(newBalanceDue === 0 && !booking.balancePaidAt
        ? { balancePaidAt: FieldValue.serverTimestamp() }
        : {}),
      ...(nextStatus === 'confirmed' && booking.status !== 'confirmed'
        ? { paymentVerifiedAt: FieldValue.serverTimestamp() }
        : {}),
    };
    await ref.update(update);

    return NextResponse.json({
      ok: true,
      bookingId,
      newBalanceDue,
      status: nextStatus,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
