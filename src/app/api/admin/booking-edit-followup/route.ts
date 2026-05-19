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
  /** HK$ paid against rental (場租 + add-ons). Adds to pricing.subtotal
   *  so loyalty-point credit at deposit settlement stays accurate. */
  rentalAmount: number;
  /** HK$ paid into the refundable security deposit. Adds to
   *  pricing.securityDeposit so the eventual refund math is right. */
  depositAmount: number;
  method: 'stripe' | 'fps' | 'bank' | 'cash' | 'other';
  note?: string;
  recordedBy: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      bookingId?: string;
      payment?: FollowupPayment;
      /** When true, ONLY do the Google Calendar sync — no payment recording,
       *  no customer email. Used by the admin-detail save flow to guarantee
       *  gcal mirrors every edit (time / guests / venue / date) immediately
       *  without spamming the customer with a fresh "預訂已更新" email each
       *  time admin tweaks something. The payment-modal path falls back to
       *  the full flow (payment + email + gcal). */
      syncOnly?: boolean;
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
    if (!syncOnly && body.payment && (body.payment.rentalAmount > 0 || body.payment.depositAmount > 0)) {
      const rental = Math.max(0, body.payment.rentalAmount || 0);
      const dep = Math.max(0, body.payment.depositAmount || 0);
      const total = rental + dep;
      const newSubtotal = (booking.pricing.subtotal || 0) + rental;
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
        balancePaidAt: newBalance === 0 ? FieldValue.serverTimestamp() : booking.balancePaidAt,
        payments: FieldValue.arrayUnion({
          rentalAmount: rental,
          depositAmount: dep,
          amount: total,
          method: body.payment.method,
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

    if (!syncOnly && customerEmail) {
      const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '85292823060';
      const whatsappLink = generateWhatsAppLink(
        whatsappNumber,
        `你好，我嘅預訂編號：${bookingId}\n場地：${venueName}\n日期：${fresh.date}`,
      );
      const tpl = buildBookingConfirmationEmail({
        customerName: profile?.displayName || customerEmail.split('@')[0],
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
        promoCode: fresh.promoCode,
        promoDiscount: fresh.promoDiscount,
        pointsUsed: fresh.pointsUsed,
        pointsDiscount: fresh.pointsDiscount,
        balanceDue: updatedBalance ?? fresh.balanceDue,
        balanceDueDate: fresh.balanceDueDate,
        addOnsLine: formatAddOnsForStaff(fresh.addOns, 'zh'),
        paymentMethod: fresh.paymentMethod || 'Online',
        whatsappLink,
      });
      // Custom subject so the customer knows it's an update, not a new
      // booking — without bypassing the toggle wrapper.
      const updateSubject = (locale: string = 'zh') =>
        locale === 'zh'
          ? `🔄 SPACO 預訂已更新 — ${venueName} (${fresh.date})`
          : `🔄 SPACO Booking Updated — ${venueName} (${fresh.date})`;
      await sendAutomatedEmail({
        automationKey: 'booking_confirmation',
        to: customerEmail,
        subject: updateSubject('zh'),
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
