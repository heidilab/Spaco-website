/**
 * Client-side wrapper for the admin lock-passcode API. Used by admin UIs
 * (receipt approval, booking cancellation, manual triggers) to talk to the
 * server-only TTLock helpers without leaking secrets to the browser.
 *
 * All calls go through `/api/admin/lock-passcode` which verifies the
 * caller's Firebase ID token + admin role.
 */

import { auth } from './firebase';

type Action = 'generate' | 'resend' | 'revoke';

async function getIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return user.getIdToken();
}

async function callLockPasscodeApi(bookingId: string, action: Action) {
  const token = await getIdToken();
  const res = await fetch('/api/admin/lock-passcode', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${token}`,
    },
    body: JSON.stringify({ bookingId, action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `lock-passcode API failed (${res.status})`);
  }
  return data;
}

/** Eligibility-check + generate. Safe to call any time — no-ops if the
 *  booking is outside the 2-day window or already has a passcode. */
export function tryGenerateLockPasscode(bookingId: string) {
  // Fire-and-forget — admin UI doesn't block on TTLock latency. Errors are
  // surfaced via the result returned from the API call.
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
