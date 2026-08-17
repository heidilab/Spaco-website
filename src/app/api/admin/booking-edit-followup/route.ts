import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  buildBookingConfirmationEmail, generateWhatsAppLink,
} from '@/lib/email';
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import {
  updateBookingOnCalendar, pushBookingToCalendar,
} from '@/lib/googleCalendar';
import { getVenueById } from '@/lib/venues';
import { formatAddOnsForStaff } from '@/lib/pricing';
import type { BookingRecord, UserProfile } from '@/types';
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
    }

    // 2. Re-send confirmation email so customer sees the new schedule.
    //    Firestore .data() drops the doc id, so re-attach it on every
    //    BookingRecord we hand off — gcal description + email body
    //    both surface Booking ID and we don't want "undefined".
    const freshData = (await bookingRef.get()).data() as BookingRecord;
    const fresh: BookingRecord = { ...freshData, id: bookingId };

    const userSnap = await adminDb.collection('users').doc(fresh.userId).get();
    const profile = userSnap.exists ? (userSnap.data() as UserProfile) : null;
    const customerEmail = profile?.email;
    const venue = getVenueById(fresh.venueId);
    const venueName = venue?.name.zh || fresh.branchSlug;

    // Build the human-readable diff list when caller supplied a snapshot
    // of pre-edit values. Each entry is shown as a bullet in the email's
    // "🔄 你嘅預訂已更新" banner so customer sees exactly what moved.
    const changes: string[] = [];
    const prev = body.previousSnapshot;
    if (prev) {
      const venueLabel = (id?: string) => {
        if (!id) return '';
        return getVenueById(id)?.name.zh || id;
      };
      if (prev.date && prev.date !== fresh.date) {
        changes.push(`日期: ${prev.date} → ${fresh.date}`);
      }
      const newRange = `${fresh.startTime}-${fresh.endTime}`;
      const oldRange = `${prev.startTime || ''}-${prev.endTime || ''}`;
      if ((prev.startTime || prev.endTime) && newRange !== oldRange) {
        changes.push(`時段: ${oldRange} → ${newRange}`);
      }
      if (prev.venueId && prev.venueId !== fresh.venueId) {
        changes.push(`場地: ${venueLabel(prev.venueId)} → ${venueLabel(fresh.venueId)}`);
      }
      if (typeof prev.guestCount === 'number' && prev.guestCount !== fresh.guestCount) {
        changes.push(`人數: ${prev.guestCount} 人 → ${fresh.guestCount} 人`);
      }
      const newAddOnsLine = formatAddOnsForStaff(fresh.addOns, 'zh');
      if (prev.addOnsLine !== undefined && prev.addOnsLine !== newAddOnsLine) {
        changes.push(`附加服務: ${prev.addOnsLine || '(無)'} → ${newAddOnsLine || '(無)'}`);
      }
    }

    // Email triggers:
    //   - syncOnly=false (default for admin edits + "重新發送")  → email
    //   - syncOnly=true                                          → skip
    //   - resendEmail=true forces email regardless of syncOnly
    const shouldEmail = (!syncOnly || body.resendEmail) && !!customerEmail;
    if (shouldEmail) {
      const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '85292823060';
      const whatsappLink = generateWhatsAppLink(
        whatsappNumber,
        `你好，我嘅預訂編號：${bookingId}\n場地：${venueName}\n日期：${fresh.date}`,
      );
      const tpl = buildBookingConfirmationEmail({
        customerName: profile?.displayName || customerEmail.split('@')[0],
        venueId: booking.venueId,
        venueName,
        venueAddress: venue?.address.zh,
        date: fresh.date,
        startTime: fresh.startTime,
        endTime: fresh.endTime,
        endDate: fresh.endDate,
        guestCount: fresh.guestCount,
        adultCount: fresh.adultCount,
        childCount: fresh.childCount,
        subtotal: fresh.pricing.subtotal,
        deposit: fresh.pricing.deposit,
        securityDeposit: fresh.pricing.securityDeposit,
        promoCode: fresh.promoCode,
        promoDiscount: fresh.promoDiscount,
        pointsUsed: fresh.pointsUsed,
        pointsDiscount: fresh.pointsDiscount,
        balanceDue: updatedBalance ?? fresh.balanceDue,
        balanceDueDate: fresh.balanceDueDate,
        addOnsLine: formatAddOnsForStaff(fresh.addOns, 'zh'),
        paymentMethod: fresh.paymentMethod || 'Online',
        whatsappLink,
        // Show the diff banner only when admin's edit actually changed
        // something. Resends with no snapshot use the default subject.
        changes: changes.length > 0 ? changes : undefined,
      });
      await sendAutomatedEmail({
        automationKey: 'booking_confirmation',
        to: customerEmail,
        subject: tpl.subject,
        html: tpl.html,
      });
    }

    // 3. Update / re-create the matching Google Calendar event.
    //    When admin changes the booking's venue, lib/firestore.ts clears
    //    `googleEventId` (the old event lives on a different calendar).
    //    In that case updateBookingOnCalendar would no-op, so we push a
    //    fresh event on the new venue's calendar instead. The old
    //    orphaned event on the previous venue's calendar needs manual
    //    cleanup — admin is told in the success message.
    try {
      const origin = req.nextUrl.origin;
      const redirectUri = `${origin}/api/google/callback`;
      if (fresh.googleEventId) {
        await updateBookingOnCalendar(redirectUri, {
          booking: fresh,
          customerName: profile?.displayName,
        });
      } else {
        const newEventId = await pushBookingToCalendar(redirectUri, {
          booking: fresh,
          customerName: profile?.displayName,
        });
        if (newEventId) {
          // Persist so subsequent edits / cancellations can find the event.
          await bookingRef.update({
            googleEventId: newEventId,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (err) {
      console.warn('[booking-edit-followup] gcal update failed:', err);
      // Non-fatal — booking is already updated; admin can resync.
    }

    return NextResponse.json({ ok: true, newBalance: updatedBalance });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Edit followup failed' },
      { status: 500 },
    );
  }
}
