import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  buildBookingConfirmationEmail, generateWhatsAppLink,
} from '@/lib/email';
import { sendAutomatedEmail } from '@/lib/emailAutomations';
import { updateBookingOnCalendar } from '@/lib/googleCalendar';
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
  amount: number;
  method: 'stripe' | 'fps' | 'bank' | 'cash' | 'other';
  note?: string;
  recordedBy: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      bookingId?: string;
      payment?: FollowupPayment;
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

    // 1. Optional payment recording
    let updatedBalance: number | null = null;
    if (body.payment && body.payment.amount > 0) {
      const newBalance = Math.max(0, (booking.balanceDue ?? 0) - body.payment.amount);
      await bookingRef.update({
        balanceDue: newBalance,
        balancePaidAt: newBalance === 0 ? FieldValue.serverTimestamp() : booking.balancePaidAt,
        payments: FieldValue.arrayUnion({
          ...body.payment,
          recordedAt: new Date().toISOString(),
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      updatedBalance = newBalance;
    }

    // 2. Re-send confirmation email so customer sees the new schedule
    const fresh = (await bookingRef.get()).data() as BookingRecord;
    fresh.id = bookingId;

    const userSnap = await adminDb.collection('users').doc(fresh.userId).get();
    const profile = userSnap.exists ? (userSnap.data() as UserProfile) : null;
    const customerEmail = profile?.email;
    const venue = getVenueById(fresh.venueId);
    const venueName = venue?.name.zh || fresh.branchSlug;

    if (customerEmail) {
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
        endTime: fresh.endTime + (fresh.endDate && fresh.endDate !== fresh.date ? `（次日）` : ''),
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

    // 3. Update the matching Google Calendar event
    try {
      const origin = req.nextUrl.origin;
      const redirectUri = `${origin}/api/google/callback`;
      await updateBookingOnCalendar(redirectUri, {
        booking: fresh,
        customerName: profile?.displayName,
      });
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
