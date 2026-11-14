// Google Calendar sync — bidirectional one-way (A + B).
//
//   A. Website → Google: when a booking is created/cancelled, push/delete
//      the corresponding event on the branch calendar so staff see it in
//      their normal Google workflow.
//   B. Google → website: periodic sync mirrors events from 4 branch
//      calendars into our `blocked_slots` collection so customers can't
//      double-book a slot that staff entered manually.
//
// Auth: OAuth 2.0 (refresh token stored in Firestore at `secrets/google_oauth`).

import { timedEventSegments, allDayEventSegments } from './gcalSegments';
import { google, calendar_v3 } from 'googleapis';
import { normalizeGcalCalendarId } from './gcalCalendarId';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { BlockedSlot, BookingRecord } from '@/types';
import { resolveVenueServer, venueStaffLabel } from './venueRegistryServer';
import { formatAddOnsForStaff } from './pricing';

// ──────────────────────────────────────────────────────────
// Calendar key ↔ venue mapping
// ──────────────────────────────────────────────────────────
//
// SW (Sheung Wan) is intentionally one calendar even though there are 3 venue
// variants (sw-a, sw-b, sw-ab). When we mirror a SW event into blocked_slots,
// we write a slot for every variant via `venuesSharingSpace`.

export type CalendarKey = 'cwb' | 'wc' | 'sw' | 'tst';

/** Which venue ids should be blocked when an event lands on this calendar. */
const CAL_KEY_TO_VENUE_IDS: Record<CalendarKey, string[]> = {
  cwb: ['cwb'],
  wc:  ['wanchai'],
  sw:  ['sw-a', 'sw-b', 'sw-ab'],
  tst: ['tst'],
};

/** Which calendar a venue id belongs to. */
export function venueIdToCalendarKey(venueId: string): CalendarKey | null {
  if (venueId === 'cwb') return 'cwb';
  if (venueId === 'wanchai') return 'wc';
  if (venueId === 'tst') return 'tst';
  if (venueId.startsWith('sw-')) return 'sw';
  return null;
}

/** Read the calendar IDs from env. Returns null entries when unset. */
export function getCalendarIds(): Record<CalendarKey, string | null> {
  return {
    cwb: process.env.GCAL_CWB_ID || null,
    wc:  process.env.GCAL_WC_ID  || null,
    sw:  process.env.GCAL_SW_ID  || null,
    tst: process.env.GCAL_TST_ID || null,
  };
}

/** Calendar id for a venue — venue doc (分店管理 →「連接設定」) first,
 *  legacy env vars as fallback. Dynamic venues therefore sync as soon
 *  as admin fills their Google Calendar ID field. */
export async function getCalendarIdForVenue(venueId: string): Promise<string | null> {
  try {
    const { getVenueByIdServer } = await import('./venueRegistryServer');
    const v = await getVenueByIdServer(venueId);
    const id = normalizeGcalCalendarId(v?.gcalCalendarId);
    if (id) return id;
  } catch { /* registry unreachable — fall back to env */ }
  const calKey = venueIdToCalendarKey(venueId);
  return calKey ? getCalendarIds()[calKey] : null;
}

/** Distinct calendars to sync, each with the venue ids it mirrors to.
 *  Built from venue docs (venues sharing one calendar id group
 *  together — the SW rooms model); env-based calendars are appended
 *  for venue ids not covered by a doc. */
export async function getCalendarGroups(): Promise<Array<{ key: string; calId: string; venueIds: string[] }>> {
  const byCal = new Map<string, string[]>();
  const covered = new Set<string>();
  try {
    const { loadAllVenuesServer } = await import('./venueRegistryServer');
    for (const v of await loadAllVenuesServer()) {
      const calId = normalizeGcalCalendarId(v.gcalCalendarId);
      if (!calId) continue;
      const arr = byCal.get(calId) || [];
      arr.push(v.id);
      byCal.set(calId, arr);
      covered.add(v.id);
    }
  } catch { /* registry unreachable */ }
  const groups: Array<{ key: string; calId: string; venueIds: string[] }> = [];
  let i = 0;
  for (const [calId, venueIds] of Array.from(byCal.entries())) {
    groups.push({ key: `cal${i++}:${venueIds[0]}`, calId, venueIds });
  }
  // Legacy env calendars for anything not covered by venue docs.
  const envIds = getCalendarIds();
  for (const [calKey, calId] of Object.entries(envIds) as [CalendarKey, string | null][]) {
    if (!calId) continue;
    const remaining = CAL_KEY_TO_VENUE_IDS[calKey].filter((vid) => !covered.has(vid));
    if (remaining.length > 0 && !byCal.has(calId)) {
      groups.push({ key: calKey, calId, venueIds: remaining });
    }
  }
  return groups;
}

// ──────────────────────────────────────────────────────────
// OAuth client / token storage
// ──────────────────────────────────────────────────────────

const TOKEN_DOC = 'secrets/google_oauth';
const SYNC_META_DOC = 'system/calendar_sync';

const SCOPES = [
  // Direction A needs write access to push events; B reads same scope.
  'https://www.googleapis.com/auth/calendar.events',
  // Used to identify the connected user (for the admin status panel)
  'https://www.googleapis.com/auth/userinfo.email',
];

export function buildOAuthClient(redirectUri: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set in env');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const oauth2 = buildOAuthClient(redirectUri);
  return oauth2.generateAuthUrl({
    access_type: 'offline',     // need refresh token
    prompt: 'consent',          // force re-consent so we always receive refresh_token
    scope: SCOPES,
    state,                      // CSRF protection
  });
}

interface StoredToken {
  refresh_token: string;
  scope: string;
  connected_email?: string;
  connected_at: unknown;
}

export async function exchangeCodeAndStore(
  code: string,
  redirectUri: string,
): Promise<{ email?: string }> {
  const oauth2 = buildOAuthClient(redirectUri);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh_token. Make sure access_type=offline and prompt=consent.');
  }
  oauth2.setCredentials(tokens);

  // Best-effort: identify which Google account just connected
  let email: string | undefined;
  try {
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const me = await oauth2Api.userinfo.get();
    email = me.data.email || undefined;
  } catch { /* non-fatal */ }

  const payload: StoredToken = {
    refresh_token: tokens.refresh_token,
    scope: tokens.scope || SCOPES.join(' '),
    connected_email: email,
    connected_at: FieldValue.serverTimestamp(),
  };
  await adminDb.doc(TOKEN_DOC).set(payload);
  return { email };
}

export async function getStoredToken(): Promise<StoredToken | null> {
  const snap = await adminDb.doc(TOKEN_DOC).get();
  if (!snap.exists) return null;
  return snap.data() as StoredToken;
}

export async function disconnectGoogle(): Promise<void> {
  await adminDb.doc(TOKEN_DOC).delete();
}

// ──────────────────────────────────────────────────────────
// Sync from Google → blocked_slots
// ──────────────────────────────────────────────────────────

/** HH:mm string from a Google event datetime in HKT (UTC+8).
 *  Critical: cron runs on Vercel (UTC), so getHours() would return
 *  UTC hours and store 19:00 HKT bookings as 11:00. Use Intl with
 *  explicit timeZone to format in Hong Kong time regardless of host. */

interface SyncResult {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  errors: string[];
  syncedAt: string;
}

/** Pull events from each branch calendar (next 6 months) and mirror into
 *  blocked_slots. Idempotent: events keyed by `googleEventId` are upserted,
 *  and any blocked_slot with `reason='gcal'` whose source event is gone
 *  is deleted. */
export async function syncCalendars(redirectUri: string): Promise<SyncResult> {
  const stored = await getStoredToken();
  if (!stored) throw new Error('Google Calendar not connected');

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const calendarGroups = await getCalendarGroups();
  const now = new Date();
  const horizon = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000); // 6 months

  // Existing gcal-mirrored slots → for diff
  const existingSnap = await adminDb
    .collection('blocked_slots')
    .where('reason', '==', 'gcal')
    .get();
  const existingByEventVenue = new Map<string, BlockedSlot>();
  existingSnap.docs.forEach((d) => {
    const data = { id: d.id, ...d.data() } as BlockedSlot;
    if (data.googleEventId && data.venueId) {
      existingByEventVenue.set(
        data.googleEventPart ? `${data.googleEventId}::${data.venueId}::${data.googleEventPart}` : `${data.googleEventId}::${data.venueId}`,
        data,
      );
    }
  });

  const result: SyncResult = {
    scanned: 0, added: 0, updated: 0, removed: 0,
    errors: [], syncedAt: now.toISOString(),
  };
  const seenKeys = new Set<string>();
  /** Venues whose calendar failed to load this run (see the catch below). */
  const unreadVenueIds = new Set<string>();

  // Fetch each calendar (venue-doc groups + legacy env fallback)
  for (const { key: calKey, calId, venueIds: groupVenueIds } of calendarGroups) {
    let pageToken: string | undefined;
    const events: calendar_v3.Schema$Event[] = [];
    try {
      do {
        const res = await cal.events.list({
          calendarId: calId,
          singleEvents: true,             // expand recurring events
          timeMin: now.toISOString(),
          timeMax: horizon.toISOString(),
          orderBy: 'startTime',
          maxResults: 250,
          pageToken,
          showDeleted: false,
        });
        events.push(...(res.data.items || []));
        pageToken = res.data.nextPageToken || undefined;
      } while (pageToken);
    } catch (err) {
      result.errors.push(`${calKey}: ${err instanceof Error ? err.message : String(err)}`);
      // This calendar could not be read: its mirrored slots are unknown,
      // not gone — keep them rather than unblock real events.
      for (const vid of groupVenueIds) unreadVenueIds.add(vid);
      continue;
    }

    for (const ev of events) {
      result.scanned++;
      const eventId = ev.id;
      if (!eventId) continue;
      // Skip cancelled or unparseable
      if (ev.status === 'cancelled') continue;
      if (!ev.start || !ev.end) continue;
      // Skip events WE pushed (direction A) — the booking already created
      // its own blocked_slot with reason='booking'; mirroring it back as
      // 'gcal' would just duplicate. Same for site visits / deliveries:
      // those are informational and must NOT become blocking slots.
      if (ev.extendedProperties?.private?.spaco_booking_id) continue;
      if (ev.extendedProperties?.private?.spaco_event_type) continue;

      // One slot per calendar day the event covers: an event crossing
      // midnight blocks both days, an all-day event every day in its
      // range (site review #17; before, only the first day was blocked).
      const segments = ev.start.dateTime && ev.end.dateTime
        ? timedEventSegments(ev.start.dateTime, ev.end.dateTime)
        : ev.start.date && ev.end.date ? allDayEventSegments(ev.start.date, ev.end.date) : [];
      if (segments.length === 0) continue;

      const venueIds = groupVenueIds;
      const eventTitle = ev.summary || '';
      const eventDescription = ev.description || '';
      for (const venueId of venueIds) for (let segIndex = 0; segIndex < segments.length; segIndex++) {
        const { date, startTime, endTime } = segments[segIndex];
        // The first day keeps the key rows have always had; later days are
        // keyed by their date so they get their own rows.
        const seenKey = segIndex === 0 ? `${eventId}::${venueId}` : `${eventId}::${venueId}::${date}`;
        seenKeys.add(seenKey);
        const existing = existingByEventVenue.get(seenKey);

        // The slot carries only what availability needs. The event's
        // title / description (customer names and phone numbers typed
        // into the staff calendar) go to `blocked_slot_details`, which
        // no Firestore rule opens — blocked_slots is readable by every
        // visitor so the booking page can show availability (site
        // review 2026-11-13 #9). The admin calendar gets the text
        // through /api/admin/calendar-bookings.
        const detailsHash = textHash(`${eventTitle}\n${eventDescription}`);
        const slotPayload: Omit<BlockedSlot, 'id'> = {
          venueId,
          date,
          startTime,
          endTime,
          reason: 'gcal',
          bookingId: null,
          googleEventId: eventId,
          googleCalendarKey: calKey,
          googleEventDetailsHash: detailsHash,
          ...(segIndex > 0 ? { googleEventPart: date } : {}),
        };
        const details = { venueId, date, googleEventId: eventId, title: eventTitle, description: eventDescription };

        if (!existing) {
          // Add new
          const ref = await adminDb.collection('blocked_slots').add(slotPayload);
          await adminDb.collection('blocked_slot_details').doc(ref.id).set(details);
          result.added++;
        } else if (
          existing.date !== date ||
          existing.startTime !== startTime ||
          existing.endTime !== endTime ||
          existing.googleEventDetailsHash !== detailsHash ||
          // Rows written before 2026-11-13 still carry the text: rewrite
          // them once so it moves out of the public collection.
          existing.googleEventTitle !== undefined ||
          existing.googleEventDescription !== undefined
        ) {
          // Update timing or details (set() replaces the row, so legacy
          // title / description fields are dropped).
          await adminDb.collection('blocked_slots').doc(existing.id).set(slotPayload);
          await adminDb.collection('blocked_slot_details').doc(existing.id).set(details);
          result.updated++;
        }
      }
    }
  }

  // Delete blocked_slots whose source event no longer exists (or was cancelled).
  // Use writeBatch for efficiency.
  const toRemove: string[] = [];
  existingByEventVenue.forEach((slot, key) => {
    if (!seenKeys.has(key) && !unreadVenueIds.has(slot.venueId)) toRemove.push(slot.id);
  });
  // Firestore batches take at most 500 writes. One oversized batch threw
  // here, which aborted the run before anything was removed — and the
  // same backlog then failed every later run, so a deleted Google event
  // kept blocking its slot indefinitely (Heidi 2026-11-13: still
  // "conflicting" two hours after the event was deleted).
  // Two deletes per slot (the slot and its details row) — 200 slots a batch.
  for (let i = 0; i < toRemove.length; i += 200) {
    const batch = adminDb.batch();
    for (const id of toRemove.slice(i, i + 200)) {
      batch.delete(adminDb.collection('blocked_slots').doc(id));
      batch.delete(adminDb.collection('blocked_slot_details').doc(id));
    }
    await batch.commit();
    result.removed += Math.min(200, toRemove.length - i);
  }

  // Persist sync metadata
  await adminDb.doc(SYNC_META_DOC).set({
    lastSyncedAt: FieldValue.serverTimestamp(),
    scanned: result.scanned,
    added: result.added,
    updated: result.updated,
    removed: result.removed,
    errors: result.errors,
  });

  return result;
}

/** Short stable hash of the event text, kept on the public slot row so
 *  the sync can tell whether the (private) details changed. */
function textHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export interface GcalSlotDetails { title: string; description: string }

/** Title / description of the Google Calendar events mirrored onto the
 *  month's slots, keyed by blocked_slots id. Staff-only (Admin SDK). */
export async function loadGcalDetailsForMonth(month: string): Promise<Record<string, GcalSlotDetails>> {
  const snap = await adminDb.collection('blocked_slot_details')
    .where('date', '>=', `${month}-01`)
    .where('date', '<=', `${month}-31`)
    .get();
  const out: Record<string, GcalSlotDetails> = {};
  for (const d of snap.docs) {
    const data = d.data() as Partial<GcalSlotDetails>;
    out[d.id] = { title: data.title || '', description: data.description || '' };
  }
  return out;
}

/** The title of a mirrored event, for a slot row that no longer carries it. */
export async function gcalEventTitle(googleEventId: string): Promise<string> {
  const snap = await adminDb.collection('blocked_slot_details')
    .where('googleEventId', '==', googleEventId).limit(1).get();
  return snap.empty ? '' : ((snap.docs[0].data() as Partial<GcalSlotDetails>).title || '');
}

export async function getSyncMeta() {
  const snap = await adminDb.doc(SYNC_META_DOC).get();
  if (!snap.exists) return null;
  return snap.data();
}

// ──────────────────────────────────────────────────────────
// Direction A — push a website booking to Google Calendar
// ──────────────────────────────────────────────────────────

interface PushBookingInput {
  booking: BookingRecord;
  /** Optional human-readable customer name (admin can override later). */
  customerName?: string;
  /** Optional notes line (e.g. add-ons summary). */
  notes?: string;
}

/** Format an HK phone for display: 9123 4966 (8 digits) or 5 1234 5678 etc. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  // Strip a leading 852 country code if present.
  const local = digits.startsWith('852') && digits.length > 8 ? digits.slice(3) : digits;
  if (local.length === 8) return `${local.slice(0, 4)} ${local.slice(4)}`;
  return local;
}

/** Legacy room tags for the built-in Sheung Wan rooms (registry venues
 *  carry their own roomLabel). */
function legacyRoomTag(venueId: string): string {
  return venueId === 'sw-a' ? '[Room A] '
    : venueId === 'sw-b' ? '[Room B] '
    : venueId === 'sw-ab' ? '[全層 A+B] '
    : '';
}

/** `[Room B] HART`-style label for an event title: the registry venue's
 *  room label + branch tag; built-in rooms keep their old tags. */
async function calendarVenueLabel(venueId: string): Promise<string> {
  const venue = await resolveVenueServer(venueId);
  if (!venue) return venueId;
  if (venue.roomLabel?.en || venue.roomLabel?.zh) return venueStaffLabel(venue, venueId, 'en');
  return `${legacyRoomTag(venueId)}${venue.branch || venue.name.en}`;
}

/** Build the canonical event title used by direction A pushes. */
async function buildEventSummary(b: BookingRecord, customerName?: string): Promise<string> {
  const venueLabel = await calendarVenueLabel(b.venueId);
  const phone = b.whatsappPhone ? ` ${formatPhone(b.whatsappPhone)}` : '';
  const name = customerName ? ` · ${customerName}${phone}` : phone ? ` ·${phone}` : '';
  // 商業租場 bookings may have no head count (0) — leave the suffix off.
  const guestSuffix = b.guestCount > 0 ? ` (${b.guestCount}人)` : '';
  return `${venueLabel}${name}${guestSuffix}`;
}

/** "HH:MM" minus N hours (clamped at 00:00) — early setup window start. */
function gcalSubtractHours(time: string, hoursBack: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.max(0, h * 60 + (m || 0) - Math.round(hoursBack * 60));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Event start = setup start when the booking has early setup hours, so
 *  the gcal block covers the full locked window (e.g. 15:00–21:00 for a
 *  16:00 booking with 1 hr setup). */
function eventStartTime(b: BookingRecord): string {
  const setupHours = b.earlySetupHours || 0;
  return setupHours > 0 ? gcalSubtractHours(b.startTime, setupHours) : b.startTime;
}

function buildEventDescription(b: BookingRecord, customerName?: string, notes?: string): string {
  const lines: string[] = [];
  // Early setup note at the top — staff must know the customer arrives
  // before the "real" booking start (e.g. "15:00-16:00 提早入場佈置").
  if ((b.earlySetupHours || 0) > 0) {
    lines.push(`🎈 ${eventStartTime(b)}-${b.startTime} 提早入場佈置`, '');
  }
  // Outstanding balance warning — surfaced at the top so staff scanning the
  // calendar see it before clicking in.
  if (typeof b.balanceDue === 'number' && b.balanceDue > 0) {
    const dueDate = b.balanceDueDate ? `（限期 ${b.balanceDueDate}）` : '';
    lines.push(`⚠️ 未找清尾數 HK$${b.balanceDue.toLocaleString()}${dueDate}`, '');
  }
  // Staff remark (內部備註) — written on the admin calendar for colleagues
  // and the cleaner, who reads Google Calendar only. Kept at the top.
  if (b.staffRemark) lines.push(`📝 備註 Remark: ${b.staffRemark}`, '');
  lines.push(`Booking ID: ${b.id}`);
  if (customerName) lines.push(`姓名: ${customerName}`);
  if (b.whatsappPhone) lines.push(`WhatsApp: ${formatPhone(b.whatsappPhone)}`);
  if (b.guestCount) {
    // English format on gcal description per Heidi's 2026-05-23 spec.
    // Example: "No. of people: 15 (13 adults + 2 kids)".
    const split = (b.adultCount ?? 0) > 0 || (b.childCount ?? 0) > 0
      ? ` (${b.adultCount ?? b.guestCount} adults${(b.childCount ?? 0) > 0 ? ` + ${b.childCount} kids` : ''})`
      : '';
    lines.push(`No. of people: ${b.guestCount}${split}`);
  }
  if (b.hasBYOFood) lines.push('BYO food');
  const addOnsLine = formatAddOnsForStaff(b.addOns);
  if (addOnsLine) lines.push(`Add-ons: ${addOnsLine}`);
  if (notes) lines.push('', notes);
  lines.push('', '— Auto-synced from spacohk.com');
  return lines.join('\n');
}

/** Push a booking to Google Calendar. Returns the created event id, or
 *  null if Google is not connected (silent no-op so booking still succeeds).
 *  Call after `createBooking()`; persist the returned id back on the booking
 *  via a follow-up update.
 *
 *  Heidi's "先到先得" rule (2026-05-23): only paid bookings hold a slot
 *  on the public calendars. Awaiting-payment / pending / draft bookings
 *  must NOT create events — otherwise CS sees a "booked" slot for
 *  someone who hasn't actually paid and turns away real customers. */
export async function pushBookingToCalendar(
  redirectUri: string,
  input: PushBookingInput,
): Promise<string | null> {
  const b = input.booking;
  const isPaid =
    b.status === 'confirmed'
    || b.status === 'completed'
    || !!b.paymentVerifiedAt;
  if (!isPaid) return null;
  // A cancelled / dead booking that was once paid, and test bookings,
  // never reach the real calendar (site review #18).
  if (b.status === 'cancelled' || b.status === 'payment_not_completed' || b.isTest) return null;

  const stored = await getStoredToken();
  if (!stored) return null;
  const calendarId = await getCalendarIdForVenue(b.venueId);
  if (!calendarId) return null;

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const endDate = input.booking.endDate || input.booking.date;
  const startISO = `${input.booking.date}T${eventStartTime(input.booking)}:00+08:00`;
  const endISO   = `${endDate}T${input.booking.endTime}:00+08:00`;

  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: await buildEventSummary(input.booking, input.customerName),
      description: buildEventDescription(input.booking, input.customerName, input.notes),
      start: { dateTime: startISO, timeZone: 'Asia/Hong_Kong' },
      end:   { dateTime: endISO,   timeZone: 'Asia/Hong_Kong' },
      // Mark synced events so direction-B sync can skip them (we don't want
      // to mirror our own pushed events back into blocked_slots — booking
      // already created its own slot).
      extendedProperties: {
        private: {
          spaco_booking_id: input.booking.id,
          spaco_synced_from: 'website',
        },
      },
    },
  });
  return res.data.id || null;
}

/** Update the time / summary / description of an existing event. Used
 *  when admin edits a booking (date / time / guest count / add-ons).
 *  Silently no-ops if Google isn't connected or the event doesn't
 *  exist on the calendar. */
export async function updateBookingOnCalendar(
  redirectUri: string,
  input: PushBookingInput,
): Promise<void> {
  if (!input.booking.googleEventId) return;
  const stored = await getStoredToken();
  if (!stored) return;
  const calendarId = await getCalendarIdForVenue(input.booking.venueId);
  if (!calendarId) return;

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const endDate = input.booking.endDate || input.booking.date;
  const startISO = `${input.booking.date}T${eventStartTime(input.booking)}:00+08:00`;
  const endISO   = `${endDate}T${input.booking.endTime}:00+08:00`;

  try {
    await cal.events.update({
      calendarId,
      eventId: input.booking.googleEventId,
      requestBody: {
        summary: await buildEventSummary(input.booking, input.customerName),
        description: buildEventDescription(input.booking, input.customerName, input.notes),
        start: { dateTime: startISO, timeZone: 'Asia/Hong_Kong' },
        end:   { dateTime: endISO,   timeZone: 'Asia/Hong_Kong' },
        extendedProperties: {
          private: {
            spaco_booking_id: input.booking.id,
            spaco_synced_from: 'website',
          },
        },
      },
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 404 || code === 410) return; // event gone — no-op
    throw err;
  }
}

/** Update an existing event's status to cancelled OR delete it.
 *  Used when a booking is cancelled. Idempotent — silently ignores 404. */
export async function removeBookingFromCalendar(
  redirectUri: string,
  booking: Pick<BookingRecord, 'venueId' | 'googleEventId'>,
): Promise<void> {
  if (!booking.googleEventId) return;
  const stored = await getStoredToken();
  if (!stored) return;
  const calendarId = await getCalendarIdForVenue(booking.venueId);
  if (!calendarId) return;

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  try {
    await cal.events.delete({
      calendarId,
      eventId: booking.googleEventId,
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    // 404 / 410 means already gone — fine. Anything else, rethrow so the
    // caller can decide.
    if (code !== 404 && code !== 410) throw err;
  }
}

// ──────────────────────────────────────────────────────────
// Generic event push (used by site visits / deliveries)
// ──────────────────────────────────────────────────────────

interface GenericEventInput {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Used for the event title prefix, e.g. "Site Visit" / "Delivery". */
  label: string;
  /** Stored in extendedProperties.private.spaco_event_type so direction-B
   *  sync can skip it (these events must NOT block bookings). */
  eventType: string;
  notes?: string;
}

/** Push a generic event (site visit, delivery, etc.) to the relevant branch
 *  Google Calendar. Returns the new event id, or null if Google is not
 *  connected. */
export async function pushEventToCalendar(
  redirectUri: string,
  input: GenericEventInput,
): Promise<string | null> {
  const stored = await getStoredToken();
  if (!stored) return null;
  const calendarId = await getCalendarIdForVenue(input.venueId);
  if (!calendarId) return null;

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const venueLabel = await calendarVenueLabel(input.venueId);
  const summary = `${input.label} · ${venueLabel}`;

  const startISO = `${input.date}T${input.startTime}:00+08:00`;
  const endISO   = `${input.date}T${input.endTime}:00+08:00`;

  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary,
      description: input.notes || undefined,
      start: { dateTime: startISO, timeZone: 'Asia/Hong_Kong' },
      end:   { dateTime: endISO,   timeZone: 'Asia/Hong_Kong' },
      extendedProperties: {
        private: {
          spaco_event_type: input.eventType,
          spaco_synced_from: 'website',
        },
      },
    },
  });
  return res.data.id || null;
}

/** Update an existing pushed event's time or details. */
export async function updatePushedEvent(
  redirectUri: string,
  args: {
    venueId: string;
    googleEventId: string;
    date: string;
    startTime: string;
    endTime: string;
    label: string;
    eventType: string;
    notes?: string;
  },
): Promise<void> {
  const stored = await getStoredToken();
  if (!stored) return;
  const calendarId = await getCalendarIdForVenue(args.venueId);
  if (!calendarId) return;

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const venueLabel = await calendarVenueLabel(args.venueId);
  const summary = `${args.label} · ${venueLabel}`;

  const startISO = `${args.date}T${args.startTime}:00+08:00`;
  const endISO   = `${args.date}T${args.endTime}:00+08:00`;

  try {
    await cal.events.patch({
      calendarId,
      eventId: args.googleEventId,
      requestBody: {
        summary,
        description: args.notes || undefined,
        start: { dateTime: startISO, timeZone: 'Asia/Hong_Kong' },
        end:   { dateTime: endISO,   timeZone: 'Asia/Hong_Kong' },
        extendedProperties: {
          private: {
            spaco_event_type: args.eventType,
            spaco_synced_from: 'website',
          },
        },
      },
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code !== 404 && code !== 410) throw err;
  }
}

/** Delete a previously pushed event. Idempotent — silently ignores 404. */
export async function deletePushedEvent(
  redirectUri: string,
  args: { venueId: string; googleEventId: string },
): Promise<void> {
  const stored = await getStoredToken();
  if (!stored) return;
  const calendarId = await getCalendarIdForVenue(args.venueId);
  if (!calendarId) return;

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  try {
    await cal.events.delete({ calendarId, eventId: args.googleEventId });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code !== 404 && code !== 410) throw err;
  }
}
