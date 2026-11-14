import { NextRequest, NextResponse } from 'next/server';
import { consumeBookingRewards } from '@/lib/bookingRewards';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { followUpAfterEdit } from '@/lib/bookingEditServer';
import { getPublicOrigin } from '@/lib/kpay';
import type { BookingRecord } from '@/types';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

// POST /api/admin/booking-edit-followup { bookingId, payment? }
//
// Called by /admin/bookings/[id] after admin edits a booking's date /
// time / guest count. Performs the side effects that the existing
// inline edit didn't cover:
//   1. (Optional) Record a manual payment top-up on the booking
//   2. Re-send the booking confirmation email to the customer
//   3. Update the matching Google Calendar event (start/end + summary)
//
// `payment` is optional: when present, we append it to booking.payments
// and zero balanceDue if the payment covers it.

interface FollowupPayment {
  /** HK$ paid against venue rental (場租, baseCharge only). */
  rentalAmount: number;
  /** HK$ paid against add-ons (附加項目, addOnTotal). Optional —
   *  legacy callers that don't split this bucket pass 0 and the
   *  amount falls into rentalAmount as before. */
  addOnAmount?: number;
  /** HK$ paid into the refundable security deposit (按金). */
  depositAmount: number;
  /** Stripe is REJECTED on this admin path — Stripe entries must come
   *  from the webhook only (Heidi's spec post-#WIiQYL2I incident). */
  method: 'fps' | 'bank' | 'cash' | 'other';
  note?: string;
  recordedBy: string;
}

export async function POST(req: NextRequest) {
  const _gate = await requireAdmin(req, 'bookings');
  if (!_gate.ok) return _gate.res;

  try {
    const body = await req.json() as {
      bookingId?: string;
      payment?: FollowupPayment;
      /** When true, ONLY do the Google Calendar sync — no payment recording,
       *  no customer email. Use this for silent server-side resync flows
       *  (e.g. periodic cron). For admin edits we WANT the customer to know
       *  what changed, so handleSave passes syncOnly=false + previousSnapshot
       *  to surface a 「預訂已更新」 banner with the diff. */
      syncOnly?: boolean;
      /** Snapshot of booking fields BEFORE the admin's updateBookingDateTime
       *  call. Used to build the human-readable change list shown in the
       *  update email so the customer sees exactly what moved. */
      previousSnapshot?: {
        date?: string;
        startTime?: string;
        endTime?: string;
        endDate?: string | null;
        venueId?: string;
        guestCount?: number;
        adultCount?: number;
        childCount?: number;
        addOnsLine?: string;
      };
      /** When true, force-send the confirmation email even without payment
       *  or pricing changes — used by the "重新發送確認 email" admin button. */
      resendEmail?: boolean;
    };
    const bookingId = body.bookingId;
    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
    }

    const bookingRef = adminDb.collection('bookings').doc(bookingId);
    const snap = await bookingRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    const booking = { id: snap.id, ...snap.data() } as BookingRecord;
    const syncOnly = !!body.syncOnly;

    // 1. Optional payment recording — split rental / deposit.
    //    Bumps pricing.subtotal + securityDeposit accordingly so
    //    downstream loyalty-credit math + refund math stay accurate.
    //
    //    ALSO advances booking.status — recording a payment without
    //    moving the booking forward leaves the system in an inconsistent
    //    state (booking shows "待處理" yet has a payment record). Rule:
    //    - balance fully cleared  → status = 'confirmed'
    //    - still has balance      → status = 'awaiting_payment'
    //    We never downgrade a status (e.g. 'completed' or 'cancelled'
    //    stays put), so admin can correct mistakes without losing state.
    let updatedBalance: number | null = null;
    if (
      !syncOnly
      && body.payment
      && (
        body.payment.rentalAmount > 0
        || (body.payment.addOnAmount || 0) > 0
        || body.payment.depositAmount > 0
      )
    ) {
      // Stripe entries must only be created by the webhook, never by
      // an admin form (Heidi's spec). Refuse the request so a CS
      // mistake can't fabricate a Stripe charge that never happened.
      if ((body.payment.method as string) === 'stripe') {
        return NextResponse.json(
          { error: 'Stripe payments cannot be entered manually. Use FPS / bank / cash / other.' },
          { status: 400 },
        );
      }
      const rental = Math.max(0, body.payment.rentalAmount || 0);
      const addOn = Math.max(0, body.payment.addOnAmount || 0);
      const dep = Math.max(0, body.payment.depositAmount || 0);
      const total = rental + addOn + dep;
      // For the booking's running totals, lump rental + addOn into
      // pricing.subtotal — that field has always represented the rental
      // side (場租 + 附加項目). The per-payment audit entry keeps them
      // split so PaymentHistory can show three buckets.
      const newSubtotal = (booking.pricing.subtotal || 0) + rental + addOn;
      const newSecurityDeposit = (booking.pricing.securityDeposit || 0) + dep;
      const newDeposit = (booking.pricing.deposit || 0) + total;
      const newBalance = Math.max(0, (booking.balanceDue ?? 0) - total);

      // Status advancement — only from upstream states.
      // payment_not_completed is included so that when admin records a
      // late offline payment (customer paid after the 30-min window), the
      // booking advances forward instead of being stuck.
      const upstreamStates = new Set([
        'pending',
        'awaiting_payment',
        'awaiting_review',
        'payment_not_completed',
      ]);
      const nextStatus = upstreamStates.has(booking.status)
        ? (newBalance === 0 ? 'confirmed' : 'awaiting_payment')
        : booking.status;

      const update: Record<string, unknown> = {
        'pricing.subtotal': newSubtotal,
        'pricing.securityDeposit': newSecurityDeposit,
        'pricing.deposit': newDeposit,
        balanceDue: newBalance,
        // Only stamp balancePaidAt when balance hits 0 AND it isn't
        // already stamped — Firestore admin SDK rejects undefined
        // values, so we can't fall back to `booking.balancePaidAt`
        // which is undefined on bookings that never had a balance.
        ...(newBalance === 0 && !booking.balancePaidAt
          ? { balancePaidAt: FieldValue.serverTimestamp() }
          : {}),
        payments: FieldValue.arrayUnion({
          rentalAmount: rental,
          addOnAmount: addOn,
          depositAmount: dep,
          amount: total,
          method: body.payment.method,
          kind: 'topup',
          note: body.payment.note || null,
          recordedBy: body.payment.recordedBy,
          recordedAt: new Date().toISOString(),
        }),
        status: nextStatus,
        updatedAt: FieldValue.serverTimestamp(),
        // Money credited → the 30-minute slot hold no longer applies.
        ...(booking.pendingExpiresAt ? { pendingExpiresAt: FieldValue.delete() } : {}),
      };
      // Capture the chosen payment method on the booking if it wasn't
      // already set — useful for finance reports + receipt rendering.
      if (!booking.paymentMethod && body.payment.method !== 'cash' && body.payment.method !== 'other') {
        update.paymentMethod = body.payment.method;
      }
      // Mark verified-at the moment we flip to 'confirmed' so the
      // downstream automations (lock passcode, calendar) trigger.
      if (nextStatus === 'confirmed' && booking.status !== 'confirmed') {
        update.paymentVerifiedAt = FieldValue.serverTimestamp();
      }
      await bookingRef.update(update);
      updatedBalance = newBalance;
      if (nextStatus === 'confirmed' && booking.status !== 'confirmed') {
        try { await consumeBookingRewards(bookingId); } catch (err) { console.error('[booking-edit-followup] rewards consumption failed:', err); }
      }
    }

    // 2–3. Passcode re-issued, customer update email, Calendar event —
    //      the shared follow-up (lib/bookingEditServer), also used by the
    //      staff edit route.
    const follow = await followUpAfterEdit(bookingId, getPublicOrigin(req.nextUrl.origin), {
      previousSnapshot: body.previousSnapshot as never,
      email: !syncOnly || !!body.resendEmail,
      resend: !!body.resendEmail,
      updatedBalance,
    });

    return NextResponse.json({ ok: true, newBalance: updatedBalance, effects: follow.effects, errors: follow.errors });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Edit followup failed' },
      { status: 500 },
    );
  }
}
