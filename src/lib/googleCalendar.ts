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

import { google, calendar_v3 } from 'googleapis';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { BlockedSlot, BookingRecord } from '@/types';
import { venues, venuesSharingSpace } from './venues';

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

/** Local helper: HH:mm string from a Google event datetime. */
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

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

  const calendarIds = getCalendarIds();
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
      existingByEventVenue.set(`${data.googleEventId}::${data.venueId}`, data);
    }
  });

  const result: SyncResult = {
    scanned: 0, added: 0, updated: 0, removed: 0,
    errors: [], syncedAt: now.toISOString(),
  };
  const seenKeys = new Set<string>();

  // Fetch each calendar
  for (const [calKey, calId] of Object.entries(calendarIds) as [CalendarKey, string | null][]) {
    if (!calId) {
      result.errors.push(`No calendar ID configured for ${calKey}`);
      continue;
    }
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

      // Time-only slots from start.dateTime (skip all-day for now: dateTime
      // would be undefined and only `date` set; treat all-day as full-day block)
      let date: string;
      let startTime: string;
      let endTime: string;
      if (ev.start.dateTime && ev.end.dateTime) {
        const s = new Date(ev.start.dateTime);
        const e = new Date(ev.end.dateTime);
        date = ymd(s);
        startTime = hhmm(s);
        endTime = hhmm(e);
        // If event spans midnight, clamp to the start day
        if (ymd(e) !== date) endTime = '23:59';
      } else if (ev.start.date && ev.end.date) {
        // All-day event — block 00:00–23:59 of every day in range
        date = ev.start.date;
        startTime = '00:00';
        endTime = '23:59';
      } else {
        continue;
      }

      const venueIds = CAL_KEY_TO_VENUE_IDS[calKey];
      // For SW: also expand via venuesSharingSpace defensive guard.
      // Here venueIds is already the full set so just iterate.
      const eventTitle = ev.summary || '';
      const eventDescription = ev.description || '';
      for (const venueId of venueIds) {
        const seenKey = `${eventId}::${venueId}`;
        seenKeys.add(seenKey);
        const existing = existingByEventVenue.get(seenKey);

        const slotPayload: Omit<BlockedSlot, 'id'> = {
          venueId,
          date,
          startTime,
          endTime,
          reason: 'gcal',
          bookingId: null,
          googleEventId: eventId,
          googleCalendarKey: calKey,
          googleEventTitle: eventTitle,
          googleEventDescription: eventDescription,
        };

        if (!existing) {
          // Add new
          await adminDb.collection('blocked_slots').add(slotPayload);
          result.added++;
        } else if (
          existing.date !== date ||
          existing.startTime !== startTime ||
          existing.endTime !== endTime ||
          existing.googleEventTitle !== eventTitle ||
          existing.googleEventDescription !== eventDescription
        ) {
          // Update timing or details
          await adminDb.collection('blocked_slots').doc(existing.id).set(slotPayload);
          result.updated++;
        }
      }
    }
  }

  // Delete blocked_slots whose source event no longer exists (or was cancelled).
  // Use writeBatch for efficiency.
  const toRemove: string[] = [];
  existingByEventVenue.forEach((slot, key) => {
    if (!seenKeys.has(key)) toRemove.push(slot.id);
  });
  if (toRemove.length > 0) {
    const batch = adminDb.batch();
    for (const id of toRemove) batch.delete(adminDb.collection('blocked_slots').doc(id));
    await batch.commit();
    result.removed = toRemove.length;
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

/** Build the canonical event title used by direction A pushes. */
function buildEventSummary(b: BookingRecord, customerName?: string): string {
  const venue = venues.find((v) => v.id === b.venueId);
  // For SW variants, prepend the room tag so staff scanning the SW calendar
  // can tell which configuration was booked.
  const swTag =
    b.venueId === 'sw-a' ? '[Room A] '
    : b.venueId === 'sw-b' ? '[Room B] '
    : b.venueId === 'sw-ab' ? '[全層 A+B] '
    : '';
  const venueLabel = venue ? `${swTag}${venue.branch}` : b.venueId;
  const guestSuffix = ` (${b.guestCount}p)`;
  const name = customerName ? ` · ${customerName}` : '';
  return `${venueLabel}${name}${guestSuffix}`;
}

function buildEventDescription(b: BookingRecord, notes?: string): string {
  const lines: string[] = [];
  lines.push(`Booking ID: ${b.id}`);
  if (b.whatsappPhone) lines.push(`WhatsApp: ${b.whatsappPhone}`);
  if (b.guestCount) lines.push(`Guests: ${b.guestCount}`);
  if (b.pricing?.subtotal) {
    lines.push(`Total: HK$${b.pricing.subtotal.toLocaleString()} (+ HK$${b.pricing.deposit.toLocaleString()} deposit)`);
  }
  if (b.hasBYOFood) lines.push('BYO food');
  if (b.addOns && b.addOns.length > 0) {
    lines.push('Add-ons: ' + b.addOns.map((a) => `${a.id}×${a.quantity}`).join(', '));
  }
  if (notes) lines.push('', notes);
  lines.push('', '— Auto-synced from spacohk.com');
  return lines.join('\n');
}

/** Push a booking to Google Calendar. Returns the created event id, or
 *  null if Google is not connected (silent no-op so booking still succeeds).
 *  Call after `createBooking()`; persist the returned id back on the booking
 *  via a follow-up update. */
export async function pushBookingToCalendar(
  redirectUri: string,
  input: PushBookingInput,
): Promise<string | null> {
  const stored = await getStoredToken();
  if (!stored) return null;
  const calKey = venueIdToCalendarKey(input.booking.venueId);
  if (!calKey) return null;
  const calendarId = getCalendarIds()[calKey];
  if (!calendarId) return null;

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const startISO = `${input.booking.date}T${input.booking.startTime}:00+08:00`;
  const endISO   = `${input.booking.date}T${input.booking.endTime}:00+08:00`;

  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: buildEventSummary(input.booking, input.customerName),
      description: buildEventDescription(input.booking, input.notes),
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

/** Update an existing event's status to cancelled OR delete it.
 *  Used when a booking is cancelled. Idempotent — silently ignores 404. */
export async function removeBookingFromCalendar(
  redirectUri: string,
  booking: Pick<BookingRecord, 'venueId' | 'googleEventId'>,
): Promise<void> {
  if (!booking.googleEventId) return;
  const stored = await getStoredToken();
  if (!stored) return;
  const calKey = venueIdToCalendarKey(booking.venueId);
  if (!calKey) return;
  const calendarId = getCalendarIds()[calKey];
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
  const calKey = venueIdToCalendarKey(input.venueId);
  if (!calKey) return null;
  const calendarId = getCalendarIds()[calKey];
  if (!calendarId) return null;

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const venue = venues.find((v) => v.id === input.venueId);
  const swTag =
    input.venueId === 'sw-a' ? '[Room A] '
    : input.venueId === 'sw-b' ? '[Room B] '
    : input.venueId === 'sw-ab' ? '[Full Floor] '
    : '';
  const venueLabel = venue ? `${swTag}${venue.branch}` : input.venueId;
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
  const calKey = venueIdToCalendarKey(args.venueId);
  if (!calKey) return;
  const calendarId = getCalendarIds()[calKey];
  if (!calendarId) return;

  const oauth2 = buildOAuthClient(redirectUri);
  oauth2.setCredentials({ refresh_token: stored.refresh_token });
  const cal = google.calendar({ version: 'v3', auth: oauth2 });

  const venue = venues.find((v) => v.id === args.venueId);
  const swTag =
    args.venueId === 'sw-a' ? '[Room A] '
    : args.venueId === 'sw-b' ? '[Room B] '
    : args.venueId === 'sw-ab' ? '[Full Floor] '
    : '';
  const venueLabel = venue ? `${swTag}${venue.branch}` : args.venueId;
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
  const calKey = venueIdToCalendarKey(args.venueId);
  if (!calKey) return;
  const calendarId = getCalendarIds()[calKey];
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
