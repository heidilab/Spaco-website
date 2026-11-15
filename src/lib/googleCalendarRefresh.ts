// Google Calendar self-heal — keep the text of events the website pushed
// in step with what the website would write today.
//
// The event text is rewritten only when its booking changes
// (`updateBookingOnCalendar` from the edit / lifecycle / remark paths).
// A change to the generator itself — a renamed add-on label such as
// `bbq-premium` "BBQ Premium Package" → "BBQ Seafood Package"
// (2026-11-13) — therefore never reached events created earlier; Heidi
// found booking 6l14DRb0IBSmzCNXG9ic still showing the old label on
// 2026-11-15. The sync cron now rebuilds the title + description of every
// future pushed event and updates Google only where the text differs.
//
// Firestore reads only, plus at most MAX_REFRESH_WRITES Google writes a
// run. Nothing here touches payments, emails, locks or blocked_slots.

import { adminDb } from './firebaseAdmin';
import { BookingRecord, UserProfile } from '@/types';
import {
  GENERATED_DESCRIPTION_PREFIXES,
  PushedEventSnapshot,
  buildEventDescription,
  buildEventSummary,
  updateBookingOnCalendar,
} from './googleCalendar';

/** Google writes per cron run (every 15 min). A rename that touches
 *  every future event catches up over a few runs instead of one burst. */
export const MAX_REFRESH_WRITES = 20;

export type RefreshSkipReason =
  | 'booking_missing'   // event points at a booking that no longer exists
  | 'not_live'          // cancelled / payment_not_completed / test / unpaid
  | 'event_mismatch'    // booking's googleEventId is a different event (orphan)
  | 'past'              // booking already over
  | 'write_cap';        // stale, but this run's write budget is spent

export interface RefreshResult {
  candidates: number;
  refreshed: number;
  unchanged: number;
  skipped: number;
  skippedBy: Partial<Record<RefreshSkipReason, number>>;
  errors: number;
  /** Dry run only: the events a real run would rewrite (ids and slot,
   *  no customer data). */
  stale?: Array<{ bookingId: string; eventId: string; venueId: string; date: string }>;
}

export interface RefreshDecision {
  action: 'refresh' | 'unchanged';
  /** Lines on the Google event that no generator wrote (a person typed
   *  them); carried over as `notes` so a refresh does not erase them. */
  notes?: string;
}

/** Google may hand the description back HTML-rendered (`<br>` for line
 *  breaks, escaped `&`). Compare line sets, not raw strings. */
export function descriptionLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function isGeneratedLine(line: string): boolean {
  return GENERATED_DESCRIPTION_PREFIXES.some((p) => line.startsWith(p));
}

/** Pure decision: does what Google holds differ from a fresh rebuild?
 *  Human-typed extra lines alone never trigger a write; a missing or
 *  stale generated line (or a changed title) does. */
export function decideEventRefresh(
  current: { summary: string; description: string },
  rebuilt: { summary: string; description: string },
): RefreshDecision {
  const summaryChanged = current.summary.trim() !== rebuilt.summary.trim();
  const curLines = descriptionLines(current.description);
  const newLines = descriptionLines(rebuilt.description);
  const curSet = new Set(curLines);
  const newSet = new Set(newLines);
  const missing = newLines.filter((l) => !curSet.has(l));
  const extra = curLines.filter((l) => !newSet.has(l));
  const extraGenerated = extra.filter(isGeneratedLine);
  const extraHuman = extra.filter((l) => !isGeneratedLine(l));
  if (!summaryChanged && missing.length === 0 && extraGenerated.length === 0) {
    return { action: 'unchanged' };
  }
  return { action: 'refresh', notes: extraHuman.length ? extraHuman.join('\n') : undefined };
}

/** Same lookup the push paths use: profile display name first, then the
 *  name stored on the booking (guest / CS-made bookings have no profile). */
export function calendarCustomerName(b: BookingRecord, profile: UserProfile | undefined): string | undefined {
  return profile?.displayName || b.customerName || undefined;
}

function isLiveForCalendar(b: BookingRecord): boolean {
  if (b.status === 'cancelled' || b.status === 'payment_not_completed' || b.isTest) return false;
  return b.status === 'confirmed' || b.status === 'completed' || !!b.paymentVerifiedAt;
}

/** True once the booking's end (HKT) is behind `now`. */
function isOver(b: BookingRecord, now: Date): boolean {
  const end = Date.parse(`${b.endDate || b.date}T${b.endTime}:00+08:00`);
  return Number.isFinite(end) && end < now.getTime();
}

async function loadByIds<T>(collection: string, ids: string[]): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => adminDb.collection(collection).doc(id));
    const snaps = await adminDb.getAll(...refs);
    for (const s of snaps) if (s.exists) out.set(s.id, { id: s.id, ...s.data() } as T);
  }
  return out;
}

/** Rebuild the text of every pushed event and update Google where it
 *  differs. Counts only — no customer data — are logged and kept on
 *  `system/calendar_sync.refresh` for the admin status page. */
export async function refreshStaleBookingEvents(
  redirectUri: string,
  events: PushedEventSnapshot[],
  opts: { maxWrites?: number; now?: Date; dryRun?: boolean } = {},
): Promise<RefreshResult> {
  const maxWrites = opts.maxWrites ?? MAX_REFRESH_WRITES;
  const now = opts.now ?? new Date();
  const result: RefreshResult = { candidates: events.length, refreshed: 0, unchanged: 0, skipped: 0, skippedBy: {}, errors: 0 };
  if (opts.dryRun) result.stale = [];
  const skip = (reason: RefreshSkipReason) => {
    result.skipped++;
    result.skippedBy[reason] = (result.skippedBy[reason] || 0) + 1;
  };

  const bookings = await loadByIds<BookingRecord>('bookings', events.map((e) => e.bookingId));
  const profiles = await loadByIds<UserProfile>(
    'users',
    Array.from(bookings.values()).map((b) => b.userId).filter((u): u is string => !!u),
  );

  for (const ev of events) {
    const booking = bookings.get(ev.bookingId);
    if (!booking) { skip('booking_missing'); continue; }
    if (!isLiveForCalendar(booking)) { skip('not_live'); continue; }
    if (booking.googleEventId !== ev.eventId) { skip('event_mismatch'); continue; }
    if (isOver(booking, now)) { skip('past'); continue; }

    try {
      const customerName = calendarCustomerName(booking, booking.userId ? profiles.get(booking.userId) : undefined);
      const rebuilt = {
        summary: await buildEventSummary(booking, customerName),
        description: buildEventDescription(booking, customerName),
      };
      const decision = decideEventRefresh(ev, rebuilt);
      if (decision.action === 'unchanged') { result.unchanged++; continue; }
      if (opts.dryRun) {
        result.stale!.push({ bookingId: booking.id, eventId: ev.eventId, venueId: booking.venueId, date: booking.date });
        continue;
      }
      if (result.refreshed >= maxWrites) { skip('write_cap'); continue; }
      await updateBookingOnCalendar(redirectUri, { booking, customerName, notes: decision.notes });
      result.refreshed++;
    } catch (err) {
      result.errors++;
      console.warn(`[gcal-refresh] booking ${ev.bookingId} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('[gcal-refresh]', JSON.stringify({ ...result, stale: result.stale?.length }));
  if (opts.dryRun) return result;
  try {
    await adminDb.doc('system/calendar_sync').set({ refresh: { ...result, at: now.toISOString() } }, { merge: true });
  } catch { /* status only — never fail the run over it */ }
  return result;
}
