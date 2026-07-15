import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { BookingRecord } from '@/types';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// POST /api/admin/booking-fix-payment-split
//
// One-off rectification for legacy payment entries that pre-date the
// rental/deposit split (entries where rentalAmount + depositAmount = 0
// but amount > 0). Lets admin retroactively split a recorded payment
// into its rental and deposit components, bumping pricing.subtotal +
// pricing.securityDeposit accordingly.
//
// Body: { bookingId, paymentIndex, rentalAmount, depositAmount }
// Sum of rental + deposit must equal the entry's existing amount —
// otherwise the booking's pricing.deposit (= total paid) would drift.

interface Body {
  bookingId?: string;
  paymentIndex?: number;
  rentalAmount?: number;
  depositAmount?: number;
}

export async function POST(req: NextRequest) {
  const _gate = await requireAdmin(req, 'bookings');
  if (!_gate.ok) return _gate.res;

  try {
    const body: Body = await req.json();
    const { bookingId, paymentIndex } = body;
    const rental = Math.max(0, body.rentalAmount || 0);
    const dep = Math.max(0, body.depositAmount || 0);

    if (!bookingId || typeof paymentIndex !== 'number') {
      return NextResponse.json({ error: 'bookingId + paymentIndex required' }, { status: 400 });
    }

    const bookingRef = adminDb.collection('bookings').doc(bookingId);
    const snap = await bookingRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    const booking = snap.data() as BookingRecord;
    const payments = booking.payments || [];

    if (paymentIndex < 0 || paymentIndex >= payments.length) {
      return NextResponse.json({ error: 'paymentIndex out of range' }, { status: 400 });
    }
    const entry = payments[paymentIndex];

    // Reject if already split (avoid double-bumping subtotal/securityDeposit)
    if ((entry.rentalAmount || 0) > 0 || (entry.depositAmount || 0) > 0) {
      return NextResponse.json({ error: 'Entry already has a split' }, { status: 400 });
    }

    // Sanity check — sum must equal the entry's total.
    if (rental + dep !== entry.amount) {
      return NextResponse.json({
        error: `Rental + deposit (${rental + dep}) must equal entry amount (${entry.amount})`,
      }, { status: 400 });
    }

    // Rewrite the entry in place; arrayUnion doesn't support index
    // updates, so we splice the array client-side and overwrite.
    const updated = payments.slice();
    updated[paymentIndex] = {
      ...entry,
      rentalAmount: rental,
      depositAmount: dep,
    };

    const newSubtotal = (booking.pricing.subtotal || 0) + rental;
    const newSecurityDeposit = (booking.pricing.securityDeposit || 0) + dep;
    // Legacy entries (pre-Ship F) never bumped pricing.deposit when
    // the payment was first recorded — they only decremented balanceDue.
    // So when admin retroactively splits one, we ALSO bump pricing.deposit
    // by the total so the "已收" display reflects every dollar received.
    const newDeposit = (booking.pricing.deposit || 0) + entry.amount;

    await bookingRef.update({
      payments: updated,
      'pricing.subtotal': newSubtotal,
      'pricing.securityDeposit': newSecurityDeposit,
      'pricing.deposit': newDeposit,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      newSubtotal,
      newSecurityDeposit,
      newDeposit,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fix split failed' },
      { status: 500 },
    );
  }
}
