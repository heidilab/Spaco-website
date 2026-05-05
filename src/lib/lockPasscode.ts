/**
 * Lock-passcode orchestration. Server-side only.
 *
 * This module is the "should this booking get a passcode right now?" brain.
 * It's called from two places:
 *
 *   1. The daily Vercel cron (/api/cron/lock-passcodes) — sweeps every booking
 *      whose date is ≤ 2 days away.
 *   2. Immediate-trigger paths — when admin marks the balance paid, or when
 *      a customer pays in full at booking time within the lock window.
 *
 * Both call `processBookingForLockAccess(bookingId)` which is idempotent:
 *   - Fully paid + within 2-day window → generate passcode + email customer
 *   - Has outstanding balance + within 2-day window → email balance reminder
 *     (once per day max, not on every cron run)
 *   - Already has a lockPasscode → no-op
 *   - Cancelled / outside window / no lockId → no-op
 */

import { Timestamp, doc, getDoc, getDocs, collection, query, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { addKeyboardPasscode, deleteKeyboardPasscode, isTTLockConfigured } from './ttlock';
import { getVenueById } from './venues';
import { getSiteContent } from './content';
import { sendEmail, buildLockPasscodeEmail, buildBalanceDueReminderEmail } from './email';
import type { BookingRecord, UserProfile } from '@/types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** How many days before the booking we open the passcode window. */
export const PASSCODE_WINDOW_DAYS = 2;
/** Passcode becomes valid this many minutes BEFORE booking startTime
 *  (so customers arriving early can let themselves in). */
export const PASSCODE_GRACE_MINUTES_BEFORE = 60;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Convert "YYYY-MM-DD" + "HH:mm" (Hong Kong local time) → Unix ms. */
function hkDateTimeToMs(dateYmd: string, timeHm: string): number {
  // Hong Kong is UTC+8 with no DST. Construct a UTC timestamp by shifting:
  //   localMs = parseAsUtc(dateYmd + timeHm) − 8h
  const [y, m, d] = dateYmd.split('-').map(Number);
  const [hh, mm]  = timeHm.split(':').map(Number);
  // Date.UTC returns the UTC ms; subtract 8h to shift HKT-as-UTC into actual UTC
  return Date.UTC(y, m - 1, d, hh, mm, 0) - 8 * 60 * 60 * 1000;
}

/** Read the venueId → ttlockId map from Firestore (admin sets these). */
async function getVenueLockMap(): Promise<Record<string, number>> {
  const cms = await getSiteContent('settings');
  // Admin stores each venue's ttlockId in a flat field `ttlock_<venueId>`.
  // Use `.zh` (we only need the value, not localized — the field is numeric).
  const map: Record<string, number> = {};
  if (!cms) return map;
  for (const [k, v] of Object.entries(cms)) {
    if (!k.startsWith('ttlock_')) continue;
    const venueId = k.slice('ttlock_'.length);
    const raw = (v?.zh || v?.en || '').trim();
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) map[venueId] = parsed;
  }
  return map;
}

/** Look up a single lockId by venueId (or null if not configured). */
export async function getLockIdForVenue(venueId: string): Promise<number | null> {
  const map = await getVenueLockMap();
  return map[venueId] ?? null;
}

/** Read the customer's email + display name (from BookingRecord.userId). */
async function getCustomerContact(userId: string): Promise<{ email: string; name: string } | null> {
  const snap = await getDoc(doc(db, 'users', userId));
  if (!snap.exists()) return null;
  const profile = snap.data() as UserProfile;
  return {
    email: profile.email,
    name:  profile.displayName || profile.email.split('@')[0],
  };
}

// ─────────────────────────────────────────────────────────────
// Status checks
// ─────────────────────────────────────────────────────────────

interface EligibilityCheck {
  /** Should we generate a passcode now? */
  shouldGenerate: boolean;
  /** Should we send a balance-due reminder? */
  shouldRemindBalance: boolean;
  /** Booking status text (for logging) */
  reason: string;
}

function checkEligibility(b: BookingRecord, now: number): EligibilityCheck {
  // Cancelled / completed bookings — never act.
  if (b.status === 'cancelled' || b.status === 'completed') {
    return { shouldGenerate: false, shouldRemindBalance: false, reason: `status=${b.status}` };
  }
  // Must be confirmed (i.e. booking flow finished, deposit paid).
  if (b.status !== 'confirmed') {
    return { shouldGenerate: false, shouldRemindBalance: false, reason: `status=${b.status}` };
  }
  // Already has a passcode — done.
  if (b.lockPasscode?.passcode) {
    return { shouldGenerate: false, shouldRemindBalance: false, reason: 'passcode-exists' };
  }
  const startMs = hkDateTimeToMs(b.date, b.startTime);
  const windowOpensAt = startMs - PASSCODE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  // Outside the 2-day window — wait.
  if (now < windowOpensAt) {
    return { shouldGenerate: false, shouldRemindBalance: false, reason: 'window-not-open' };
  }
  // Past the booking — too late.
  if (now > startMs) {
    return { shouldGenerate: false, shouldRemindBalance: false, reason: 'booking-already-started' };
  }
  // Inside window: branch on balance.
  const balanceDue = b.balanceDue ?? 0;
  if (balanceDue > 0) {
    // Has balance — remind, but only if we haven't reminded today.
    const lastReminder = (b.balanceReminderSentAt as Timestamp | null)?.toMillis?.() ?? 0;
    const oneDay = 24 * 60 * 60 * 1000;
    return {
      shouldGenerate: false,
      shouldRemindBalance: now - lastReminder > oneDay,
      reason: 'balance-due',
    };
  }
  // Fully paid + within window → green light.
  return { shouldGenerate: true, shouldRemindBalance: false, reason: 'eligible' };
}

// ─────────────────────────────────────────────────────────────
// Main processing
// ─────────────────────────────────────────────────────────────

export interface ProcessResult {
  bookingId: string;
  action: 'generated' | 'reminded' | 'skipped' | 'error';
  reason: string;
  error?: string;
}

/**
 * Idempotent processor for a single booking. Safe to call from anywhere —
 * the cron sweeps every booking with this; manual-trigger endpoints call it
 * for one specific id.
 */
export async function processBookingForLockAccess(bookingId: string): Promise<ProcessResult> {
  const ref = doc(db, 'bookings', bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { bookingId, action: 'skipped', reason: 'not-found' };
  }
  const b = { id: snap.id, ...snap.data() } as BookingRecord;

  const now = Date.now();
  const check = checkEligibility(b, now);

  if (!check.shouldGenerate && !check.shouldRemindBalance) {
    return { bookingId, action: 'skipped', reason: check.reason };
  }

  // ─── Branch A: Send balance reminder ───
  if (check.shouldRemindBalance) {
    try {
      const contact = await getCustomerContact(b.userId);
      if (!contact) {
        return { bookingId, action: 'error', reason: 'no-contact', error: 'user profile missing' };
      }
      const venue = getVenueById(b.venueId);
      const venueName = venue?.name.zh || b.branchSlug;
      const tpl = buildBalanceDueReminderEmail({
        customerName: contact.name,
        venueName,
        date:         b.date,
        startTime:    b.startTime,
        endTime:      b.endTime,
        balanceDue:   b.balanceDue ?? 0,
        whatsappLink: 'https://wa.me/85292823060',
      });
      await sendEmail({ to: contact.email, subject: tpl.subject, html: tpl.html });
      await updateDoc(ref, { balanceReminderSentAt: serverTimestamp() });
      return { bookingId, action: 'reminded', reason: 'balance-due' };
    } catch (err) {
      return {
        bookingId,
        action: 'error',
        reason: 'balance-reminder-failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ─── Branch B: Generate passcode + email ───
  // 1. Look up the lock id for this venue.
  const lockId = await getLockIdForVenue(b.venueId);
  if (!lockId) {
    return {
      bookingId,
      action: 'error',
      reason: 'no-lockid',
      error: `Venue ${b.venueId} has no TTLock lockId configured`,
    };
  }

  if (!isTTLockConfigured()) {
    return {
      bookingId,
      action: 'error',
      reason: 'ttlock-not-configured',
      error: 'TTLock env vars missing',
    };
  }

  const startMs = hkDateTimeToMs(b.date, b.startTime);
  const endMs   = hkDateTimeToMs(b.date, b.endTime);
  const validFrom = startMs - PASSCODE_GRACE_MINUTES_BEFORE * 60 * 1000;
  const validTo   = endMs;

  try {
    const venue = getVenueById(b.venueId);
    const venueName = venue?.name.zh || b.branchSlug;
    const passcodeName = `SPACO-${b.date.replace(/-/g, '')}-${bookingId.slice(0, 6)}`;

    // 2. Generate the passcode on TTLock.
    const { passcode, keyboardPwdId } = await addKeyboardPasscode({
      lockId,
      startMs: validFrom,
      endMs:   validTo,
      name:    passcodeName,
    });

    // 3. Persist on the booking record (write FIRST so we don't lose the
    //    passcode if email fails — admin can manually re-send).
    await updateDoc(ref, {
      lockPasscode: {
        passcode,
        ttlockPwdId:  keyboardPwdId,
        lockId,
        validFrom,
        validTo,
        generatedAt:  serverTimestamp(),
        emailSentAt:  null,
      },
      updatedAt: serverTimestamp(),
    });

    // 4. Email the customer.
    const contact = await getCustomerContact(b.userId);
    if (contact) {
      const tpl = buildLockPasscodeEmail({
        customerName: contact.name,
        venueName,
        date:         b.date,
        startTime:    b.startTime,
        endTime:      b.endTime,
        passcode,
        validFromMs:  validFrom,
        validToMs:    validTo,
        whatsappLink: 'https://wa.me/85292823060',
      });
      await sendEmail({ to: contact.email, subject: tpl.subject, html: tpl.html });
      await updateDoc(ref, { 'lockPasscode.emailSentAt': serverTimestamp() });
    }

    return { bookingId, action: 'generated', reason: 'eligible' };
  } catch (err) {
    return {
      bookingId,
      action: 'error',
      reason: 'generation-failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Daily sweep used by the cron. Loads every confirmed booking whose date is
 * within `PASSCODE_WINDOW_DAYS + 1` days from today (1-day buffer for retries
 * on failures), and processes each through the same idempotent logic.
 *
 * Returns a summary with per-booking results so the cron output is auditable.
 */
export async function sweepUpcomingBookings(): Promise<{
  scanned: number;
  results: ProcessResult[];
}> {
  // Build the YYYY-MM-DD lower & upper bounds. We scan a slightly wider
  // window than strictly necessary (today through T+3) so retries land.
  const todayMs = Date.now();
  const upperMs = todayMs + (PASSCODE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000;

  const fromYmd = ymdInHkt(todayMs);
  const toYmd   = ymdInHkt(upperMs);

  const q = query(
    collection(db, 'bookings'),
    where('status', '==', 'confirmed'),
    where('date', '>=', fromYmd),
    where('date', '<=', toYmd),
  );
  const snap = await getDocs(q);
  const ids = snap.docs.map((d) => d.id);

  const results: ProcessResult[] = [];
  // Sequential to avoid hammering TTLock + Resend in parallel
  for (const id of ids) {
    results.push(await processBookingForLockAccess(id));
  }
  return { scanned: ids.length, results };
}

/** "YYYY-MM-DD" for the given Unix ms in HKT. */
function ymdInHkt(ms: number): string {
  // Shift to HKT, then read UTC components (because we're treating the shifted
  // time as if it were UTC).
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Revoke a booking's passcode (used when a booking is cancelled).
 * Idempotent — no-ops if there's no passcode.
 */
export async function revokeBookingPasscode(bookingId: string): Promise<void> {
  const ref = doc(db, 'bookings', bookingId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const b = snap.data() as BookingRecord;
  if (!b.lockPasscode) return;

  if (isTTLockConfigured()) {
    try {
      await deleteKeyboardPasscode({
        lockId:        b.lockPasscode.lockId,
        keyboardPwdId: b.lockPasscode.ttlockPwdId,
      });
    } catch (err) {
      // Log but don't block — admin can manually clean up if TTLock is down.
      console.warn('[lockPasscode] revoke failed for', bookingId, err);
    }
  }

  await updateDoc(ref, {
    lockPasscode: null,
    updatedAt: serverTimestamp(),
  });
}
