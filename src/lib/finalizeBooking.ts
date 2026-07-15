import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { buildBookingConfirmationEmail, generateWhatsAppLink } from '@/lib/email';
import {
  sendAutomatedEmail,
  sendStaffBookingNotification,
  sendStaffSupplierOrderNotification,
} from '@/lib/emailAutomations';
import { getVenueById } from '@/lib/venues';
import { processBookingForLockAccess } from '@/lib/lockPasscode';
import { pushBookingToCalendar, updateBookingOnCalendar } from '@/lib/googleCalendar';
import { formatAddOnsForStaff } from '@/lib/pricing';
import { deductLoyaltyPoints } from '@/lib/loyaltyServer';
import type { BookingRecord, UserProfile } from '@/types';

/**
 * The ONE canonical order-total formula. Every writer of balanceDue
 * MUST derive from this so front-end, back-end and admin never disagree.
 *
 *   grandTotal = max(0, baseCharge + addOnTotal − promo − points) + securityDeposit
 *   balanceDue = max(0, grandTotal − Σ payments[].amount)
 *
 * `pricing.subtotal` is intentionally NOT used here — it has drifted
 * between pre-/post-promo conventions across the codebase. Deriving
 * from primitives (baseCharge/addOnTotal/promoDiscount/pointsDiscount)
 * sidesteps that entirely. Mirrors scan-balance-mismatch.
 */
export function computeGrandTotal(booking: {
  pricing?: { baseCharge?: number; addOnTotal?: number; securityDeposit?: number };
  promoDiscount?: number;
  pointsDiscount?: number;
}): number {
  const p = booking.pricing || {};
  return (
    Math.max(
      0,
      (p.baseCharge || 0) +
        (p.addOnTotal || 0) -
        (booking.promoDiscount || 0) -
        (booking.pointsDiscount || 0),
    ) + (p.securityDeposit || 0)
  );
}

/** balanceDue derived from the canonical grand total and payments so far. */
export function computeBalanceDue(booking: {
  pricing?: { baseCharge?: number; addOnTotal?: number; securityDeposit?: number };
  promoDiscount?: number;
  pointsDiscount?: number;
  payments?: Array<{ amount?: number }>;
}): number {
  const paid = (booking.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  return Math.max(0, computeGrandTotal(booking) - paid);
}

/**
 * Rebuild the blocked_slots for a booking if the expire cron deleted
 * them in the race window (customer paid at the last second, cron swept
 * the slot, webhook then re-confirms). No-op when slots already exist.
 */
export async function restoreBlockedSlotsIfMissing(booking: BookingRecord): Promise<boolean> {
  const bookingId = booking.id;
  const existing = await adminDb
    .collection('blocked_slots')
    .where('bookingId', '==', bookingId)
    .get();
  if (!existing.empty) return false;

  const overnight = !!booking.endDate && booking.endDate !== booking.date;
  const endDate = overnight ? (booking.endDate as string) : booking.date;
  const [endH, endM] = booking.endTime.split(':').map(Number);
  const bufferEndH = endH + 1;
  const bufferEnd =
    bufferEndH >= 24
      ? '23:59'
      : `${String(bufferEndH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  const batch = adminDb.batch();
  const newSlot = (data: object) =>
    batch.create(adminDb.collection('blocked_slots').doc(), data);
  if (overnight) {
    newSlot({ venueId: booking.venueId, date: booking.date, startTime: booking.startTime, endTime: '23:59', reason: 'booking', bookingId });
    newSlot({ venueId: booking.venueId, date: endDate, startTime: '00:00', endTime: booking.endTime, reason: 'booking', bookingId });
    newSlot({ venueId: booking.venueId, date: endDate, startTime: booking.endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
  } else {
    newSlot({ venueId: booking.venueId, date: booking.date, startTime: booking.startTime, endTime: booking.endTime, reason: 'booking', bookingId });
    newSlot({ venueId: booking.venueId, date: booking.date, startTime: booking.endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
  }
  await batch.commit();
  console.warn('[finalizeBooking] restored deleted blocked_slots for booking', bookingId);
  return true;
}

interface FinalizeOpts {
  isBalancePayment: boolean;
  /** Human label for emails/notifications, e.g. 'KPay' or 'Stripe'. */
  paymentMethodLabel: string;
  /** Request origin for gcal redirectUri + admin URLs. */
  origin: string;
}

/**
 * Everything that must happen AFTER a booking is confirmed by a
 * successful payment, shared by every payment rail so no rail can
 * silently skip a step:
 *   1. Restore blocked_slots if the cron swept them (initial only)
 *   2. Deduct loyalty points + increment promo usage (initial only)
 *   3. Confirmation email to the customer
 *   4. Lock passcode (or balance reminder) if within the window
 *   5. Google Calendar sync
 *   6. Staff booking + supplier-order notifications
 *
 * Every step is individually try/caught and non-fatal — the booking is
 * already confirmed; a failing side-effect must not 500 the webhook and
 * trigger a duplicate retry. Idempotent: points/promo guarded by
 * pointsRedeemedAt/promoRedeemedAt flags.
 *
 * The caller MUST have already written status='confirmed' + the
 * payments[] entry before calling this.
 */
export async function finalizeConfirmedBooking(
  bookingId: string,
  opts: FinalizeOpts,
): Promise<void> {
  const { isBalancePayment, paymentMethodLabel, origin } = opts;
  const bookingRef = adminDb.collection('bookings').doc(bookingId);
  const redirectUri = `${origin}/api/google/callback`;

  // 1. blocked_slots restore (initial payment only).
  if (!isBalancePayment) {
    try {
      const snap = await bookingRef.get();
      const b = snap.data() as BookingRecord | undefined;
      if (b) await restoreBlockedSlotsIfMissing({ ...b, id: bookingId });
    } catch (err) {
      console.error('[finalizeBooking] blocked_slots restore failed:', err);
    }
  }

  // 2. Loyalty points + promo (initial payment only, idempotent).
  try {
    const snap = await bookingRef.get();
    const data = snap.data() as BookingRecord | undefined;
    const booking = data ? ({ ...data, id: bookingId } as BookingRecord) : undefined;
    if (booking && !isBalancePayment) {
      if (booking.pointsUsed && booking.pointsUsed > 0 && !booking.pointsRedeemedAt) {
        const deducted = await deductLoyaltyPoints(booking.userId, booking.pointsUsed);
        await bookingRef.update({
          pointsRedeemedAt: FieldValue.serverTimestamp(),
          pointsActuallyDeducted: deducted,
        });
      }
      if (booking.promoCodeId && !booking.promoRedeemedAt) {
        await adminDb.collection('promo_codes').doc(booking.promoCodeId).update({
          totalUsageCount: FieldValue.increment(1),
        });
        await bookingRef.update({ promoRedeemedAt: FieldValue.serverTimestamp() });
      }
    }
  } catch (err) {
    console.warn('[finalizeBooking] points/promo deduction failed:', err);
  }

  // 3. Confirmation email.
  try {
    const snap = await bookingRef.get();
    const data = snap.data() as BookingRecord | undefined;
    const booking = data ? ({ ...data, id: bookingId } as BookingRecord) : undefined;
    if (booking) {
      const userSnap = await adminDb.collection('users').doc(booking.userId).get();
      const profile = userSnap.data() as UserProfile | undefined;
      const customerEmail = profile?.email;
      if (customerEmail) {
        const venue = getVenueById(booking.venueId);
        const venueName = venue?.name.zh || booking.branchSlug;
        const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '85292823060';
        const whatsappLink = generateWhatsAppLink(
          whatsappNumber,
          `你好，我已完成預訂付款。\n預訂編號：${bookingId}\n場地：${venueName}\n日期：${booking.date}`,
        );
        const tpl = buildBookingConfirmationEmail({
          customerName: profile?.displayName || customerEmail.split('@')[0],
          venueName,
          venueAddress: venue?.address.zh,
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
          endDate: booking.endDate,
          guestCount: booking.guestCount,
          adultCount: booking.adultCount,
          childCount: booking.childCount,
          subtotal: booking.pricing.subtotal,
          deposit: booking.pricing.deposit,
          promoCode: booking.promoCode,
          promoDiscount: booking.promoDiscount,
          pointsUsed: booking.pointsUsed,
          pointsDiscount: booking.pointsDiscount,
          balanceDue: booking.balanceDue,
          balanceDueDate: booking.balanceDueDate,
          addOnsLine: formatAddOnsForStaff(booking.addOns, 'zh'),
          paymentMethod: paymentMethodLabel,
          whatsappLink,
        });
        await sendAutomatedEmail({
          automationKey: 'booking_confirmation',
          to: customerEmail,
          subject: tpl.subject,
          html: tpl.html,
        });
      }
    }
  } catch (err) {
    console.warn('[finalizeBooking] confirmation email failed:', err);
  }

  // 4. Lock passcode / balance reminder.
  try {
    await processBookingForLockAccess(bookingId);
  } catch (err) {
    console.warn('[finalizeBooking] lock passcode trigger failed:', err);
  }

  // Fetch booking + customer profile ONCE for the remaining steps.
  const snap = await bookingRef.get();
  const data = snap.data() as BookingRecord | undefined;
  const bookingForNotify = data ? ({ ...data, id: bookingId } as BookingRecord) : undefined;
  let profileForNotify: UserProfile | undefined;
  if (bookingForNotify) {
    try {
      const userSnap = await adminDb.collection('users').doc(bookingForNotify.userId).get();
      profileForNotify = userSnap.data() as UserProfile | undefined;
    } catch { /* profile optional */ }
  }

  // 5. Staff booking + supplier-order notifications. Ordered BEFORE the
  //    Google Calendar sync (slower, external) so the ops-critical "new
  //    booking" alert to staff goes out first — if a later step is slow
  //    or the function is near its time budget, staff are still notified.
  try {
    if (bookingForNotify) {
      const venue = getVenueById(bookingForNotify.venueId);
      await sendStaffBookingNotification({
        bookingId: bookingForNotify.id,
        venueName: venue?.name.zh || bookingForNotify.branchSlug,
        date: bookingForNotify.date,
        startTime: bookingForNotify.startTime,
        endTime: bookingForNotify.endTime,
        endDate: bookingForNotify.endDate,
        guestCount: bookingForNotify.guestCount,
        adultCount: bookingForNotify.adultCount,
        childCount: bookingForNotify.childCount,
        customerName: profileForNotify?.displayName || '—',
        customerEmail: profileForNotify?.email,
        whatsappPhone: bookingForNotify.whatsappPhone,
        subtotal: bookingForNotify.pricing.subtotal,
        deposit: bookingForNotify.pricing.deposit,
        balanceDue: bookingForNotify.balanceDue ?? 0,
        addOnsLine: formatAddOnsForStaff(bookingForNotify.addOns, 'zh'),
        hasBYOFood: !!bookingForNotify.hasBYOFood,
        paymentMethod: paymentMethodLabel,
        adminUrl: `${origin}/zh/admin/bookings/${bookingForNotify.id}`,
      });
      await sendStaffSupplierOrderNotification({
        booking: bookingForNotify,
        venueName: venue?.name.zh || bookingForNotify.branchSlug,
        customerName: profileForNotify?.displayName || '—',
        customerEmail: profileForNotify?.email,
        adminUrl: `${origin}/zh/admin/bookings/${bookingForNotify.id}`,
      });
    }
  } catch (err) {
    console.warn('[finalizeBooking] staff notify failed:', err);
  }

  // 6. Google Calendar sync (last — external + slowest, least critical).
  try {
    if (bookingForNotify) {
      const customerName = profileForNotify?.displayName;
      if (bookingForNotify.googleEventId) {
        await updateBookingOnCalendar(redirectUri, { booking: bookingForNotify, customerName });
      } else {
        const eventId = await pushBookingToCalendar(redirectUri, { booking: bookingForNotify, customerName });
        if (eventId) await bookingRef.update({ googleEventId: eventId });
      }
    }
  } catch (err) {
    console.warn('[finalizeBooking] gcal sync failed:', err);
  }
}
