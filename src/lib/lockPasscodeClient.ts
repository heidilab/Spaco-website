/**
 * Client-side wrapper for the admin lock-passcode API. Used by admin UIs
 * (receipt approval, booking cancellation, manual triggers) to talk to the
 * server-only TTLock helpers without leaking secrets to the browser.
 *
 * All calls go through `/api/admin/lock-passcode` which verifies the
 * caller's Firebase ID token + admin role.
 */

import { auth } from './firebase';

type Action = 'generate' | 'resend' | 'revoke' | 'set-manual';

async function getIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return user.getIdToken();
}

async function callLockPasscodeApi(
  bookingId: string,
  action: Action,
  extra?: Record<string, unknown>,
) {
  const token = await getIdToken();
  const res = await fetch('/api/admin/lock-passcode', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${token}`,
    },
    body: JSON.stringify({ bookingId, action, ...(extra || {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `lock-passcode API failed (${res.status})`);
  }
  return data;
}

/** Eligibility-check + generate. Safe to call any time — no-ops if the
 *  booking is outside the 2-day window or already has a passcode.
 *
 *  Returns the raw API payload — admins clicking the "Generate now" button
 *  on the booking detail page want to see the `result.reason` (e.g.
 *  `no-lockid`, `ttlock-not-configured`) so they know what to fix. */
export function tryGenerateLockPasscode(bookingId: string) {
  return callLockPasscodeApi(bookingId, 'generate');
}

/** Re-email an existing passcode to the customer. */
export function resendLockPasscode(bookingId: string) {
  return callLockPasscodeApi(bookingId, 'resend');
}

/** Delete the passcode on TTLock + clear it from the booking. Used when
 *  a booking is cancelled. */
export function revokeLockPasscode(bookingId: string) {
  return callLockPasscodeApi(bookingId, 'revoke');
}

/** Save an admin-entered passcode (for venues without a TTLock lock) and
 *  email it to the customer. The passcode must be 4–9 digits. */
export function setManualLockPasscode(bookingId: string, passcode: string) {
  return callLockPasscodeApi(bookingId, 'set-manual', { passcode });
}
