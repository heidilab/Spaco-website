import { adminDb } from '@/lib/firebaseAdmin';
import { buildBookingConfirmationEmail, generateWhatsAppLink } from '@/lib/email';
import {
  sendAutomatedEmail,
  sendStaffBookingNotification,
  sendStaffSupplierOrderNotification,
} from '@/lib/emailAutomations';
import { resolveVenueServer } from '@/lib/venueRegistryServer';
import { processBookingForLockAccess } from '@/lib/lockPasscode';
import { pushBookingToCalendar, updateBookingOnCalendar } from '@/lib/googleCalendar';
import { formatAddOnsForStaff } from '@/lib/pricing';
import { venuesSharingSpaceServer } from '@/lib/venueRegistryServer';
import { bookingWindows, windowsOverlap } from '@/lib/bookingOverlap';
import { FieldValue } from 'firebase-admin/firestore';
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
// Canonical money math now lives in the pure, testable bookingMoney
// module so client pages can import the SAME functions instead of
// re-typing them (the drift that caused #2qzYQOU4 / #LSi5Z31A). These
// re-exports keep every existing server import working unchanged.
export { computeGrandTotal, computeBalanceDue } from './bookingMoney';

/**
 * Rebuild the blocked_slots for a booking if the expire cron deleted
 * them in the race window (customer paid at the last second, cron swept
 * the slot, webhook then re-confirms). No-op when slots already exist.
 */
export async function restoreBlockedSlotsIfMissing(booking: BookingRecord): Promise<boolean> {
  const bookingId = booking.id;
  // Rooms that share this booking's space (分店管理), read outside the
  // transaction (cached registry).
  const sharedVenues = await venuesSharingSpaceServer(booking.venueId).catch(() => [booking.venueId]);
  const production = process.env.VERCEL_ENV === 'production';
  return adminDb.runTransaction(async tx => {
  const current = await tx.get(adminDb.collection('bookings').doc(bookingId));
  if (!current.exists || !['confirmed', 'completed'].includes(current.data()!.status) || current.data()!.paymentReviewRequired) return false;
  booking = { ...current.data(), id: bookingId } as BookingRecord;
  const existing = await tx.get(adminDb.collection('blocked_slots').where('bookingId', '==', bookingId));
  if (!existing.empty) return false;

  // The time may have been resold while the booking was expired (an FPS
  // hold lapsed, another customer paid, then staff recorded the late
  // FPS). Never silently stack two confirmed bookings on one slot: flag
  // the booking for review instead (site review 2026-11-13 #5).
  const windows = bookingWindows(booking);
  const dates = Array.from(new Set(windows.map((w) => w.date)));
  for (const vid of sharedVenues) {
    for (const d of dates) {
      const slots = await tx.get(adminDb.collection('blocked_slots').where('venueId', '==', vid).where('date', '==', d));
      for (const s of slots.docs) {
        const slot = s.data() as { bookingId?: string | null; startTime: string; endTime: string; date: string; isTest?: boolean; reason?: string };
        if (slot.bookingId === bookingId) continue;
        if (slot.isTest && production) continue;
        if (windows.some((w) => windowsOverlap(w, { date: slot.date, startTime: slot.startTime, endTime: slot.endTime }))) {
          tx.update(adminDb.collection('bookings').doc(bookingId), {
            paymentReviewRequired: true,
            paymentReviewReason: 'slot_taken_on_restore',
            updatedAt: FieldValue.serverTimestamp(),
          });
          console.error('[finalizeBooking] slot already taken, booking flagged for review', bookingId, vid, d, slot.reason);
          return false;
        }
      }
    }
  }

  const overnight = !!booking.endDate && booking.endDate !== booking.date;
  const endDate = overnight ? (booking.endDate as string) : booking.date;
  const [endH, endM] = booking.endTime.split(':').map(Number);
  const bufferEndH = endH + 1;
  const bufferEnd =
    bufferEndH >= 24
      ? '23:59'
      : `${String(bufferEndH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  // Test bookings stamp their slots so production ignores them.
  const stamp = booking.isTest ? { isTest: true } : {};
  const newSlot = (data: object) =>
    tx.create(adminDb.collection('blocked_slots').doc(), { ...data, ...stamp });
  if (overnight) {
    newSlot({ venueId: booking.venueId, date: booking.date, startTime: booking.startTime, endTime: '23:59', reason: 'booking', bookingId });
    newSlot({ venueId: booking.venueId, date: endDate, startTime: '00:00', endTime: booking.endTime, reason: 'booking', bookingId });
    newSlot({ venueId: booking.venueId, date: endDate, startTime: booking.endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
  } else {
    newSlot({ venueId: booking.venueId, date: booking.date, startTime: booking.startTime, endTime: booking.endTime, reason: 'booking', bookingId });
    newSlot({ venueId: booking.venueId, date: booking.date, startTime: booking.endTime, endTime: bufferEnd, reason: 'cleaning', bookingId });
  }
  console.warn('[finalizeBooking] restored deleted blocked_slots for booking', bookingId);
  return true;
  });
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
 *   3. Confirmation email to the customer
 *   4. Lock passcode (or balance reminder) if within the window
 *   5. Google Calendar sync
 *   6. Staff booking + supplier-order notifications
 *
 * Money and rewards have already committed atomically. Failures are reported
 * to the durable job so a later attempt can retry external side effects.
 * External notifications use at-least-once delivery; a crash may repeat them.
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

  const current = await bookingRef.get();
  const currentBooking = current.data();
  if (!currentBooking || !['confirmed', 'completed'].includes(currentBooking.status) || currentBooking.paymentReviewRequired) return;
  const failures: unknown[] = [];

  // 1. blocked_slots restore (initial payment only).
  if (!isBalancePayment) {
    try {
      const snap = await bookingRef.get();
      const b = snap.data() as BookingRecord | undefined;
      if (b) await restoreBlockedSlotsIfMissing({ ...b, id: bookingId });
    } catch (err) {
      failures.push(err);
      console.error('[finalizeBooking] blocked_slots restore failed:', err);
    }
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
        const venue = await resolveVenueServer(booking.venueId);
        const venueName = venue?.name.zh || booking.branchSlug;
        const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '85292823060';
        const whatsappLink = generateWhatsAppLink(
          whatsappNumber,
          `你好，我已完成預訂付款。\n預訂編號：${bookingId}\n場地：${venueName}\n日期：${booking.date}`,
        );
        const tpl = buildBookingConfirmationEmail({
          customerName: profile?.displayName || customerEmail.split('@')[0],
          venueId: booking.venueId,
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
          securityDeposit: booking.pricing.securityDeposit,
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
      failures.push(err);
    console.warn('[finalizeBooking] confirmation email failed:', err);
  }

  // 4. Lock passcode / balance reminder.
  try {
    const lock = await processBookingForLockAccess(bookingId);
    // The processor reports problems as a result, not an exception. Log
    // anything other than a successful issue so a silent 'error' /
    // 'skipped' (e.g. gateway failure after a balance payment) is visible
    // in the function logs instead of surfacing only at the daily sweep.
    if (lock.action !== 'generated') {
      console.warn('[finalizeBooking] lock passcode not issued', { bookingId, action: lock.action, reason: lock.reason, error: lock.error });
    }
  } catch (err) {
      failures.push(err);
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
      const venue = await resolveVenueServer(bookingForNotify.venueId);
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
        securityDeposit: bookingForNotify.pricing.securityDeposit,
        promoCode: bookingForNotify.promoCode,
        promoDiscount: bookingForNotify.promoDiscount,
        pointsDiscount: bookingForNotify.pointsDiscount,
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
      failures.push(err);
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
      failures.push(err);
    console.warn('[finalizeBooking] gcal sync failed:', err);
  }
  if (failures.length) throw new Error('Payment side effects incomplete');
}
