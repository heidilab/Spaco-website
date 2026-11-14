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

import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { addKeyboardPasscode, deleteKeyboardPasscode, isTTLockConfigured } from './ttlock';
import { resolveVenueServer, loadAllVenuesServer } from './venueRegistryServer';
import { getSiteContent } from './content';
import { buildLockPasscodeEmail, buildBalanceDueReminderEmail } from './email';
import { lockConfirmKey } from './lockConfirmKey';
import { sendAutomatedEmail } from './emailAutomations';
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

/** When a booking's passcode is valid: from the start of its early
 *  set-up window (or 60 minutes before start, whichever is earlier) to
 *  the end time (day 2 for overnight bookings). Site review 2026-11-13
 *  (lock #5): a customer who paid for two set-up hours could not get in. */
export function passcodeWindow(b: Pick<BookingRecord, 'date' | 'startTime' | 'endTime' | 'endDate' | 'earlySetupHours'>): { validFrom: number; validTo: number } {
  const startMs = hkDateTimeToMs(b.date, b.startTime);
  const endMs   = hkDateTimeToMs(b.endDate || b.date, b.endTime);
  const setupMs = Math.max(0, Math.min(6, b.earlySetupHours || 0)) * 60 * 60 * 1000;
  const graceMs = PASSCODE_GRACE_MINUTES_BEFORE * 60 * 1000;
  return { validFrom: startMs - Math.max(graceMs, setupMs), validTo: endMs };
}

/** Convert "YYYY-MM-DD" + "HH:mm" (Hong Kong local time) → Unix ms. */
function hkDateTimeToMs(dateYmd: string, timeHm: string): number {
  // Hong Kong is UTC+8 with no DST. Construct a UTC timestamp by shifting:
  //   localMs = parseAsUtc(dateYmd + timeHm) − 8h
  const [y, m, d] = dateYmd.split('-').map(Number);
  const [hh, mm]  = timeHm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, 0) - 8 * 60 * 60 * 1000;
}

/** Read the venueId → ttlockId map. Venue docs (分店管理 →「連接設定」)
 *  are the primary source since 2026-08; legacy 系統設定 `ttlock_*`
 *  entries remain as fallback for ids not yet on a venue doc. */
export async function getVenueLockMap(): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  // Legacy settings first (lower precedence)…
  try {
    const cms = await getSiteContent('settings');
    if (cms) {
      for (const [k, v] of Object.entries(cms)) {
        if (!k.startsWith('ttlock_')) continue;
        const venueId = k.slice('ttlock_'.length);
        const parsed = parseInt((v?.zh || v?.en || '').trim(), 10);
        if (Number.isFinite(parsed) && parsed > 0) map[venueId] = parsed;
      }
    }
  } catch { /* settings unreadable — venue docs still apply */ }
  // …venue docs override (server registry — the client SDK registry
  // cannot read here).
  try {
    for (const v of await loadAllVenuesServer()) {
      const parsed = parseInt(String(v.ttlockLockId || '').trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) map[v.id] = parsed;
    }
  } catch { /* registry unreachable — legacy map stands */ }
  return map;
}

/** Look up a single lockId by venueId (or null if not configured). */
export async function getLockIdForVenue(venueId: string): Promise<number | null> {
  const map = await getVenueLockMap();
  return map[venueId] ?? null;
}

/** Read the venueId → lock-guide image URL map from Firestore. Admins set
 *  `lockguide_<venueId>` (legacy slots; 門鎖設定 now writes the venue doc). */
async function getLockGuideMap(): Promise<Record<string, string>> {
  const cms = await getSiteContent('settings');
  const map: Record<string, string> = {};
  if (!cms) return map;
  for (const [k, v] of Object.entries(cms)) {
    if (!k.startsWith('lockguide_')) continue;
    const venueId = k.slice('lockguide_'.length);
    const url = (v?.zh || v?.en || '').trim();
    if (url) map[venueId] = url;
  }
  return map;
}

/** Lock-guide image URL for a venue. Special case: `sw-ab` (the whole-floor
 *  booking) uses the Room B entrance, so it falls back to `lockguide_sw-b`
 *  when no `lockguide_sw-ab` is explicitly set. */
export async function getLockGuideUrlForVenue(venueId: string): Promise<string | undefined> {
  // 分店管理 first (any branch), then the legacy 系統設定 slots.
  try {
    const venue = await resolveVenueServer(venueId);
    const own = (venue?.lockGuideUrl || '').trim();
    if (own) return own;
  } catch { /* registry unreachable — legacy slots below */ }
  const map = await getLockGuideMap();
  if (map[venueId]) return map[venueId];
  if (venueId === 'sw-ab' && map['sw-b']) return map['sw-b'];
  return undefined;
}

/** Read the customer's email + display name (from BookingRecord.userId). */
async function getCustomerContact(userId: string): Promise<{ email: string; name: string } | null> {
  const snap = await adminDb.collection('users').doc(userId).get();
  if (!snap.exists) return null;
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
  /** A passcode exists but its email never went out — send it. */
  shouldEmailPending?: boolean;
  /** Booking status text (for logging) */
  reason: string;
}

function checkEligibility(b: BookingRecord, now: number): EligibilityCheck {
  if (b.status === 'cancelled' || b.status === 'completed') {
    return { shouldGenerate: false, shouldRemindBalance: false, reason: `status=${b.status}` };
  }
  if (b.status !== 'confirmed') {
    return { shouldGenerate: false, shouldRemindBalance: false, reason: `status=${b.status}` };
  }
  if (b.lockPasscode?.passcode) {
    // Generated, but the customer never got the email (send failed, or
    // the automation was off at the time): retry until the booking starts.
    const emailPending = !b.lockPasscode.emailSentAt && now < hkDateTimeToMs(b.date, b.startTime);
    return { shouldGenerate: false, shouldRemindBalance: false, shouldEmailPending: emailPending, reason: emailPending ? 'email-pending' : 'passcode-exists' };
  }
  const startMs = hkDateTimeToMs(b.date, b.startTime);
  const windowOpensAt = startMs - PASSCODE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (now < windowOpensAt) {
    return { shouldGenerate: false, shouldRemindBalance: false, reason: 'window-not-open' };
  }
  if (now > startMs) {
    return { shouldGenerate: false, shouldRemindBalance: false, reason: 'booking-already-started' };
  }
  const balanceDue = b.balanceDue ?? 0;
  if (balanceDue > 0) {
    const lastReminder = (b.balanceReminderSentAt as Timestamp | null)?.toMillis?.() ?? 0;
    const oneDay = 24 * 60 * 60 * 1000;
    return {
      shouldGenerate: false,
      shouldRemindBalance: now - lastReminder > oneDay,
      reason: 'balance-due',
    };
  }
  return { shouldGenerate: true, shouldRemindBalance: false, reason: 'eligible' };
}

// ─────────────────────────────────────────────────────────────
// Main processing
// ─────────────────────────────────────────────────────────────

export interface ProcessResult {
  bookingId: string;
  action: 'generated' | 'reminded' | 'emailed' | 'skipped' | 'error';
  reason: string;
  error?: string;
}

/**
 * Email an existing passcode to the booking's customer. Marks
 * `emailSentAt` only when the email really went out — when the Email
 * 自動化 switch is off the record used to say "sent" anyway (site review,
 * lock #3). Returns whether it was sent.
 */
export async function emailPasscode(bookingId: string): Promise<{ sent: boolean; reason?: string }> {
  const ref = adminDb.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) return { sent: false, reason: 'booking-not-found' };
  const b = { id: bookingId, ...snap.data() } as BookingRecord;
  if (!b.lockPasscode?.passcode) return { sent: false, reason: 'no-passcode' };
  const contact = await getCustomerContact(b.userId);
  if (!contact) return { sent: false, reason: 'no-contact' };
  const venue = await resolveVenueServer(b.venueId);
  const lockGuideImageUrl = await getLockGuideUrlForVenue(b.venueId);
  const tpl = buildLockPasscodeEmail({
    customerName: contact.name,
    venueName:    venue?.name.zh || b.branchSlug,
    venueAddress: venue?.address.zh,
    date:         b.date,
    startTime:    b.startTime,
    endTime:      b.endTime,
    endDate:      b.endDate,
    passcode:     b.lockPasscode.passcode,
    confirmKey:   lockConfirmKey(b.venueId, venue),
    validFromMs:  b.lockPasscode.validFrom,
    validToMs:    b.lockPasscode.validTo,
    whatsappLink: 'https://wa.me/85292823060',
    lockGuideImageUrl,
  });
  const out = await sendAutomatedEmail({ automationKey: 'lock_passcode', to: contact.email, subject: tpl.subject, html: tpl.html });
  if (out.sent) {
    await ref.update({ 'lockPasscode.emailSentAt': FieldValue.serverTimestamp(), 'lockPasscode.emailSkipped': FieldValue.delete() });
  } else {
    await ref.update({ 'lockPasscode.emailSkipped': out.reason || 'not-sent' });
  }
  return out;
}

/**
 * Idempotent processor for a single booking. Safe to call from anywhere —
 * the cron sweeps every booking with this; manual-trigger endpoints call it
 * for one specific id.
 */
export async function processBookingForLockAccess(bookingId: string): Promise<ProcessResult> {
  const ref = adminDb.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { bookingId, action: 'skipped', reason: 'not-found' };
  }
  const b = { id: snap.id, ...snap.data() } as BookingRecord;

  // Test bookings (made on the preview site) must never open a real door
  // or email a real-looking passcode from production.
  if (b.isTest && process.env.VERCEL_ENV === 'production') {
    return { bookingId, action: 'skipped', reason: 'test-booking' };
  }

  const now = Date.now();
  const check = checkEligibility(b, now);

  if (check.shouldEmailPending) {
    try {
      const out = await emailPasscode(bookingId);
      return out.sent
        ? { bookingId, action: 'emailed', reason: 'email-pending' }
        : { bookingId, action: 'skipped', reason: `email-not-sent:${out.reason || 'unknown'}` };
    } catch (err) {
      return { bookingId, action: 'error', reason: 'email-failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

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
      const venue = await resolveVenueServer(b.venueId);
      const venueName = venue?.name.zh || b.branchSlug;
      const tpl = buildBalanceDueReminderEmail({
        customerName: contact.name,
        venueName,
        date:         b.date,
        startTime:    b.startTime,
        endTime:      b.endTime,
        endDate:      b.endDate,
        balanceDue:   b.balanceDue ?? 0,
        whatsappLink: 'https://wa.me/85292823060',
      });
      await sendAutomatedEmail({
        automationKey: 'balance_due_reminder',
        to: contact.email,
        subject: tpl.subject,
        html: tpl.html,
      });
      await ref.update({ balanceReminderSentAt: FieldValue.serverTimestamp() });
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

  // Overnight bookings carry the day-2 date as `endDate` — the window
  // runs to the actual end time on day 2; early set-up hours open it.
  const { validFrom, validTo } = passcodeWindow(b);

  try {
    const passcodeName = `SPACO-${b.date.replace(/-/g, '')}-${bookingId.slice(0, 6)}`;

    const { passcode, keyboardPwdId } = await addKeyboardPasscode({
      lockId,
      startMs: validFrom,
      endMs:   validTo,
      name:    passcodeName,
    });

    await ref.update({
      lockPasscode: {
        passcode,
        ttlockPwdId:  keyboardPwdId,
        lockId,
        source:       'ttlock',
        validFrom,
        validTo,
        generatedAt:  FieldValue.serverTimestamp(),
        emailSentAt:  null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    // The code is on the door now. A failed email is NOT a failed
    // generation: it stays pending and the next run retries it.
    try {
      await emailPasscode(bookingId);
    } catch (err) {
      console.error('[lockPasscode] passcode email failed, will retry', bookingId, err);
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
 */
export async function sweepUpcomingBookings(): Promise<{
  scanned: number;
  results: ProcessResult[];
}> {
  const todayMs = Date.now();
  const upperMs = todayMs + (PASSCODE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000;

  const fromYmd = ymdInHkt(todayMs);
  const toYmd   = ymdInHkt(upperMs);

  // Range on `date` ONLY — adding `.where('status','==',…)` turns this into
  // a composite-index query, and that index was missing in prod, so the
  // cron threw FAILED_PRECONDITION every morning and no advance booking
  // ever got its passcode (2026-10-07). Filter status in memory instead;
  // a 3-day window is a handful of docs.
  const snap = await adminDb
    .collection('bookings')
    .where('date', '>=', fromYmd)
    .where('date', '<=', toYmd)
    .get();
  const ids = snap.docs
    .filter((d) => (d.data() as BookingRecord).status === 'confirmed')
    .map((d) => d.id);

  const results: ProcessResult[] = [];
  for (const id of ids) {
    results.push(await processBookingForLockAccess(id));
  }
  // What happened, for the 門鎖設定 page (the cron's JSON went nowhere).
  try {
    const count = (a: ProcessResult['action']) => results.filter((r) => r.action === a).length;
    await adminDb.collection('system').doc('ttlock_status').set({
      lastRunAt: FieldValue.serverTimestamp(),
      scanned: ids.length,
      generated: count('generated'), reminded: count('reminded'), emailed: count('emailed'),
      skipped: count('skipped'), errors: count('error'),
      problems: results.filter((r) => r.action === 'error').map((r) => ({ bookingId: r.bookingId, reason: r.reason, error: (r.error || '').slice(0, 300) })),
    }, { merge: true });
  } catch (err) {
    console.warn('[lockPasscode] status write failed', err);
  }
  // Failures reach a person (site review, lock #4): one email per sweep
  // listing the bookings whose passcode could not be issued.
  const failed = results.filter((r) => r.action === 'error');
  if (failed.length > 0) {
    try {
      const { getStaffNotificationRecipients } = await import('./emailAutomations');
      const { sendEmail } = await import('./email');
      const to = await getStaffNotificationRecipients();
      const base = process.env.NEXT_PUBLIC_APP_URL || 'https://spacohk.com';
      const lines = failed.map((r) => `• <a href="${base}/zh/admin/bookings/${r.bookingId}">#${r.bookingId.slice(0, 8)}</a>：${r.reason || ''} ${(r.error || '').slice(0, 160)}`).join('<br>');
      await Promise.all(to.map((addr) => sendEmail({
        to: addr,
        subject: `⚠️ 門鎖密碼未能發出（${failed.length} 張單）`,
        html: `<p>今日 09:00 嘅門鎖密碼掃描有 ${failed.length} 張單未能發出密碼：</p><p>${lines}</p><p>請去 後台 → 門鎖設定 查看並重試，或者手動設定密碼。</p>`,
      })));
    } catch (err) {
      console.warn('[lockPasscode] failure alert failed', err);
    }
  }
  return { scanned: ids.length, results };
}

/**
 * The booking's time changed after a TTLock passcode was issued: delete
 * the old code and issue one for the new window, then email it (site
 * review, lock #6). Manual passcodes are left alone (staff set them).
 * No-op when nothing changed or there is no passcode.
 */
export async function refreshPasscodeAfterTimeChange(bookingId: string): Promise<{ refreshed: boolean; reason?: string }> {
  const ref = adminDb.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) return { refreshed: false, reason: 'not-found' };
  const b = { id: bookingId, ...snap.data() } as BookingRecord;
  const lp = b.lockPasscode;
  if (!lp?.passcode || lp.source === 'manual' || lp.ttlockPwdId == null || lp.lockId == null) return { refreshed: false, reason: 'no-ttlock-passcode' };
  if (b.status !== 'confirmed') return { refreshed: false, reason: `status=${b.status}` };
  const { validFrom, validTo } = passcodeWindow(b);
  if (validFrom === lp.validFrom && validTo === lp.validTo) return { refreshed: false, reason: 'unchanged' };
  if (!isTTLockConfigured()) return { refreshed: false, reason: 'ttlock-not-configured' };
  const lockId = (await getLockIdForVenue(b.venueId)) ?? lp.lockId;
  try {
    await deleteKeyboardPasscode({ lockId: lp.lockId, keyboardPwdId: lp.ttlockPwdId });
  } catch (err) {
    console.error('[lockPasscode] old passcode delete failed on time change', bookingId, err);
    await ref.update({ 'lockPasscode.revokeFailedAt': FieldValue.serverTimestamp(), 'lockPasscode.revokeError': err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) });
    return { refreshed: false, reason: 'old-passcode-delete-failed' };
  }
  const { passcode, keyboardPwdId } = await addKeyboardPasscode({
    lockId, startMs: validFrom, endMs: validTo, name: `SPACO-${b.date.replace(/-/g, '')}-${bookingId.slice(0, 6)}`,
  });
  await ref.update({
    lockPasscode: { passcode, ttlockPwdId: keyboardPwdId, lockId, source: 'ttlock', validFrom, validTo, generatedAt: FieldValue.serverTimestamp(), emailSentAt: null },
    updatedAt: FieldValue.serverTimestamp(),
  });
  try { await emailPasscode(bookingId); } catch (err) { console.error('[lockPasscode] email after time change failed', bookingId, err); }
  return { refreshed: true };
}

/**
 * Everything the 門鎖設定 page shows about bookings: the next days'
 * confirmed bookings and where each stands with its passcode.
 */
export async function upcomingLockReport(): Promise<Array<{
  bookingId: string; date: string; startTime: string; endTime: string; venueId: string;
  state: 'has-code' | 'email-pending' | 'revoke-failed' | 'no-code' | 'manual';
  reason: string; passcodeValidFrom?: number; passcodeValidTo?: number; balanceDue: number;
}>> {
  const todayMs = Date.now();
  const fromYmd = ymdInHkt(todayMs);
  const toYmd = ymdInHkt(todayMs + (PASSCODE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
  const snap = await adminDb.collection('bookings').where('date', '>=', fromYmd).where('date', '<=', toYmd).get();
  const lockMap = await getVenueLockMap();
  const out: Awaited<ReturnType<typeof upcomingLockReport>> = [];
  for (const d of snap.docs) {
    const b = { id: d.id, ...d.data() } as BookingRecord;
    if (b.status !== 'confirmed') continue;
    if (b.isTest && process.env.VERCEL_ENV === 'production') continue;
    const lp = b.lockPasscode;
    const base = { bookingId: b.id, date: b.date, startTime: b.startTime, endTime: b.endTime, venueId: b.venueId, balanceDue: b.balanceDue ?? 0 };
    if (lp?.passcode) {
      const state = (lp as { revokeFailedAt?: unknown }).revokeFailedAt ? 'revoke-failed' : lp.source === 'manual' ? 'manual' : !lp.emailSentAt ? 'email-pending' : 'has-code';
      out.push({ ...base, state, reason: state, passcodeValidFrom: lp.validFrom, passcodeValidTo: lp.validTo });
      continue;
    }
    const check = checkEligibility(b, todayMs);
    const reason = !lockMap[b.venueId] ? 'no-lockid' : check.reason;
    out.push({ ...base, state: 'no-code', reason });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
}

/** "YYYY-MM-DD" for the given Unix ms in HKT. */
function ymdInHkt(ms: number): string {
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Admin enters a passcode by hand for venues whose physical door isn't on
 * TTLock yet. The flow mirrors the TTLock auto-generation path: save the
 * passcode + validity window to the booking, then email the customer.
 *
 * @param bookingId
 * @param passcode  Customer-facing digits (4–9 chars, validated upstream)
 */
export async function setManualPasscode(
  bookingId: string,
  passcode: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ref = adminDb.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'booking-not-found' };
  const b = snap.data() as BookingRecord;

  const { validFrom, validTo } = passcodeWindow(b);

  await ref.update({
    lockPasscode: {
      passcode,
      source:      'manual',
      validFrom,
      validTo,
      generatedAt: FieldValue.serverTimestamp(),
      emailSentAt: null,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });

  const out = await emailPasscode(bookingId);
  if (!out.sent && out.reason === 'no-contact') return { ok: false, reason: 'no-contact' };
  return { ok: true };
}

/**
 * Revoke a booking's passcode (used when a booking is cancelled).
 * Idempotent — no-ops if there's no passcode.
 */
export async function revokeBookingPasscode(bookingId: string): Promise<void> {
  const ref = adminDb.collection('bookings').doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const b = snap.data() as BookingRecord;
  if (!b.lockPasscode) return;

  // Manual passcodes (no ttlockPwdId) have nothing to delete remotely —
  // the lock is physical / off-platform. Just clear the booking field.
  const isManual = b.lockPasscode.source === 'manual'
    || b.lockPasscode.ttlockPwdId == null
    || b.lockPasscode.lockId == null;
  if (!isManual && isTTLockConfigured()) {
    try {
      await deleteKeyboardPasscode({
        lockId:        b.lockPasscode.lockId as number,
        keyboardPwdId: b.lockPasscode.ttlockPwdId as number,
      });
    } catch (err) {
      // The code is still live on the door. Keep it on the booking so it
      // stays visible and can be revoked again — clearing it here hid a
      // working passcode from everyone (site review 2026-11-13, lock #1).
      console.error('[lockPasscode] revoke failed for', bookingId, err);
      await ref.update({
        'lockPasscode.revokeFailedAt': FieldValue.serverTimestamp(),
        'lockPasscode.revokeError': err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw err;
    }
  }

  await ref.update({
    lockPasscode: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}
