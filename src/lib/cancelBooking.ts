/**
 * Centralised "cancel a booking" cleanup. Every admin cancel surface
 * (receipts page reject, bookings list cancel button, booking detail
 * status dropdown) goes through this so the side effects can't drift.
 *
 *   1. Flip status to 'cancelled' (idempotent — skipped if already there)
 *   2. Delete the blocked_slots so the timeslot reopens on the calendar
 *   3. Remove the event from Google Calendar
 *   4. Revoke the TTLock passcode if one was already minted
 *   5. Email the customer that the booking is cancelled
 *
 * Steps 1–2 are awaited (the UI depends on them); steps 3–5 are fire-
 * and-forget so a flaky Google / Resend / TTLock side never blocks the
 * status flip itself.
 */

import { getBooking, updateBookingStatus, deleteBlockedSlotsByBooking } from './firestore';
import { revokeLockPasscode } from './lockPasscodeClient';

export async function cancelBooking(bookingId: string): Promise<void> {
  const booking = await getBooking(bookingId);
  if (!booking) return;

  if (booking.status !== 'cancelled') {
    await updateBookingStatus(bookingId, 'cancelled');
  }
  await deleteBlockedSlotsByBooking(bookingId);

  // Best-effort side effects — never block the cancel itself.
  fetch(`/api/google/push-booking?bookingId=${encodeURIComponent(bookingId)}`, {
    method: 'DELETE',
  }).catch(() => { /* gcal disconnected — fine */ });

  fetch('/api/email/booking-cancelled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId }),
  }).catch((err) => console.warn('[booking-cancelled email] failed:', err));

  if (booking.lockPasscode) {
    revokeLockPasscode(bookingId).catch((err) =>
      console.warn('[ttlock] revoke on cancel failed:', err),
    );
  }
}
