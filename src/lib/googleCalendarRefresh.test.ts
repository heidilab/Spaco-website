import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingRecord } from '@/types';

// Google client: only `events.update` matters here. Everything else the
// module touches (token, bookings, profiles) is served by the adminDb stub.
const m = vi.hoisted(() => ({
  update: vi.fn(),
  bookings: new Map<string, unknown>(),
  users: new Map<string, unknown>(),
  metaSet: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() { /* noop */ } } },
    calendar: () => ({ events: { update: m.update } }),
  },
}));

vi.mock('@/lib/firebaseAdmin', () => {
  const docRef = (collection: string, id: string) => ({ __c: collection, id });
  const snapFor = (ref: { __c: string; id: string }) => {
    const store = ref.__c === 'bookings' ? m.bookings : ref.__c === 'users' ? m.users : new Map();
    const data = store.get(ref.id);
    return { id: ref.id, exists: !!data, data: () => data as Record<string, unknown> | undefined };
  };
  return {
    adminDb: {
      collection: (name: string) => ({
        doc: (id: string) => docRef(name, id),
        // venueRegistryServer: empty → falls back to the static venue list.
        get: async () => ({ empty: true, docs: [] }),
      }),
      getAll: async (...refs: Array<{ __c: string; id: string }>) => refs.map(snapFor),
      doc: (path: string) => ({
        get: async () => path === 'secrets/google_oauth'
          ? { exists: true, data: () => ({ refresh_token: 'rt', scope: '' }) }
          : { exists: false, data: () => undefined },
        set: m.metaSet,
      }),
    },
  };
});

import { buildEventDescription, buildEventSummary } from './googleCalendar';
import { MAX_REFRESH_WRITES, decideEventRefresh, refreshStaleBookingEvents } from './googleCalendarRefresh';

process.env.GOOGLE_OAUTH_CLIENT_ID = 'id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret';
process.env.GCAL_TST_ID = 'tst-calendar@group.calendar.google.com';

const NOW = new Date('2026-11-15T12:00:00+08:00');
const REDIRECT = 'https://spaco.test/api/google/callback';

const booking = (over: Partial<BookingRecord> = {}): BookingRecord => ({
  id: 'bk1',
  userId: 'u1',
  venueId: 'tst',
  branchSlug: 'tsim-sha-tsui',
  date: '2026-11-20',
  startTime: '18:00',
  endTime: '23:00',
  hours: 5,
  guestCount: 12,
  status: 'confirmed',
  paymentMethod: 'fps',
  receiptUrl: null,
  whatsappPhone: '+85291234966',
  googleEventId: 'ev1',
  addOns: [{ id: 'bbq-premium', quantity: 1 }],
  ...over,
} as BookingRecord);

/** What Google holds for a booking's event — by default the text the
 *  generator wrote at push time (`description` lets a test age it). */
const snapshot = (b: BookingRecord, over: Partial<{ eventId: string; summary: string; description: string }> = {}) => ({
  calendarId: 'tst-calendar@group.calendar.google.com',
  eventId: b.googleEventId || 'ev1',
  bookingId: b.id,
  summary: over.summary ?? '',
  description: over.description ?? '',
});

const currentText = async (b: BookingRecord, name = 'Alice') => ({
  summary: await buildEventSummary(b, name),
  description: buildEventDescription(b, name),
});

beforeEach(() => {
  m.update.mockReset();
  m.update.mockResolvedValue({ data: {} });
  m.metaSet.mockReset();
  m.metaSet.mockResolvedValue(undefined);
  m.bookings.clear();
  m.users.clear();
  m.users.set('u1', { uid: 'u1', displayName: 'Alice' });
});

describe('decideEventRefresh', () => {
  const rebuilt = { summary: 'TST · Alice 9123 4966 (12人)', description: 'Booking ID: bk1\nAdd-ons: BBQ Seafood Package\n\n— Auto-synced from spacohk.com' };

  it('is unchanged when Google holds the same text', () => {
    expect(decideEventRefresh({ ...rebuilt }, rebuilt)).toEqual({ action: 'unchanged' });
  });

  it('refreshes when a generated line is stale (renamed add-on label)', () => {
    const current = { ...rebuilt, description: rebuilt.description.replace('BBQ Seafood Package', 'BBQ Premium Package') };
    expect(decideEventRefresh(current, rebuilt)).toEqual({ action: 'refresh', notes: undefined });
  });

  it('refreshes when only the title changed', () => {
    expect(decideEventRefresh({ ...rebuilt, summary: 'TST · Alice (12人)' }, rebuilt).action).toBe('refresh');
  });

  it('leaves text a person typed alone, and carries it over when a refresh is due', () => {
    const typed = { ...rebuilt, description: `${rebuilt.description}\n客人要生日蛋糕` };
    expect(decideEventRefresh(typed, rebuilt)).toEqual({ action: 'unchanged' });
    const typedAndStale = { ...typed, description: typed.description.replace('Seafood', 'Premium') };
    expect(decideEventRefresh(typedAndStale, rebuilt)).toEqual({ action: 'refresh', notes: '客人要生日蛋糕' });
  });

  it('reads an HTML-rendered description as the same text', () => {
    const html = { ...rebuilt, description: 'Booking ID: bk1<br>Add-ons: BBQ Seafood Package<br><br>— Auto-synced from spacohk.com' };
    expect(decideEventRefresh(html, rebuilt)).toEqual({ action: 'unchanged' });
  });
});

describe('calendar title venue label', () => {
  it('spells the Sheung Wan full floor as SW(A+B) (Heidi 2026-11-15)', async () => {
    const title = await buildEventSummary(booking({ venueId: 'sw-ab' }), 'Alice');
    expect(title.startsWith('SW(A+B) · ')).toBe(true);
    expect(title).not.toContain('Full Floor');
  });
});

describe('refreshStaleBookingEvents', () => {
  it('updates Google when the stored text differs from the rebuilt text', async () => {
    const b = booking();
    m.bookings.set(b.id, b);
    const stale = await currentText(b);
    stale.description = stale.description.replace('BBQ Seafood Package', 'BBQ Premium Package');
    expect(stale.description).toContain('BBQ Premium Package');

    const r = await refreshStaleBookingEvents(REDIRECT, [snapshot(b, stale)], { now: NOW });

    expect(r).toMatchObject({ candidates: 1, refreshed: 1, unchanged: 0, skipped: 0, errors: 0 });
    expect(m.update).toHaveBeenCalledTimes(1);
    const call = m.update.mock.calls[0][0];
    expect(call.calendarId).toBe('tst-calendar@group.calendar.google.com');
    expect(call.eventId).toBe('ev1');
    expect(call.requestBody.description).toContain('Add-ons: BBQ Seafood Package');
    expect(call.requestBody.description).not.toContain('Premium');
    expect(call.requestBody.summary).toBe(stale.summary);
    // Counts only — no customer data on the status doc.
    expect(JSON.stringify(m.metaSet.mock.calls[0][0])).not.toContain('Alice');
  });

  it('does not touch Google when the text already matches', async () => {
    const b = booking();
    m.bookings.set(b.id, b);
    const r = await refreshStaleBookingEvents(REDIRECT, [snapshot(b, await currentText(b))], { now: NOW });
    expect(r).toMatchObject({ candidates: 1, refreshed: 0, unchanged: 1, skipped: 0 });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('uses the booking name when there is no profile (guest / CS booking)', async () => {
    const b = booking({ userId: '', customerName: 'Bob Chan' });
    m.bookings.set(b.id, b);
    const r = await refreshStaleBookingEvents(REDIRECT, [snapshot(b, await currentText(b, 'Bob Chan'))], { now: NOW });
    expect(r.unchanged).toBe(1);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('skips cancelled, test, past, missing and orphaned bookings without calling Google', async () => {
    const cancelled = booking({ id: 'c', status: 'cancelled', googleEventId: 'evc' });
    const test = booking({ id: 't', isTest: true, googleEventId: 'evt' });
    const past = booking({ id: 'p', date: '2026-11-01', googleEventId: 'evp' });
    const orphan = booking({ id: 'o', googleEventId: 'ev-current' });
    for (const b of [cancelled, test, past, orphan]) m.bookings.set(b.id, b);
    const events = [
      snapshot(cancelled, { description: 'old' }),
      snapshot(test, { description: 'old' }),
      snapshot(past, { description: 'old' }),
      { ...snapshot(orphan, { description: 'old' }), eventId: 'ev-older-duplicate' },
      { ...snapshot(booking({ id: 'gone' }), { description: 'old' }), bookingId: 'gone' },
    ];
    const r = await refreshStaleBookingEvents(REDIRECT, events, { now: NOW });
    expect(r).toMatchObject({ candidates: 5, refreshed: 0, unchanged: 0, skipped: 5 });
    expect(r.skippedBy).toEqual({ not_live: 2, past: 1, event_mismatch: 1, booking_missing: 1 });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('caps Google writes per run and counts the rest as skipped', async () => {
    const events = [];
    for (let i = 0; i < MAX_REFRESH_WRITES + 5; i++) {
      const b = booking({ id: `b${i}`, googleEventId: `ev${i}` });
      m.bookings.set(b.id, b);
      events.push(snapshot(b, { summary: 'stale', description: 'stale' }));
    }
    const r = await refreshStaleBookingEvents(REDIRECT, events, { now: NOW });
    expect(r.refreshed).toBe(MAX_REFRESH_WRITES);
    expect(r.skippedBy.write_cap).toBe(5);
    expect(m.update).toHaveBeenCalledTimes(MAX_REFRESH_WRITES);
  });

  it('dry run lists what would change and writes nothing', async () => {
    const b = booking();
    m.bookings.set(b.id, b);
    const r = await refreshStaleBookingEvents(REDIRECT, [snapshot(b, { description: 'old' })], { now: NOW, dryRun: true });
    expect(r.refreshed).toBe(0);
    expect(r.stale).toEqual([{ bookingId: 'bk1', eventId: 'ev1', venueId: 'tst', date: '2026-11-20' }]);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.metaSet).not.toHaveBeenCalled();
  });

  it('counts a Google failure as an error and keeps going', async () => {
    const a = booking({ id: 'a', googleEventId: 'eva' });
    const b = booking({ id: 'b', googleEventId: 'evb' });
    m.bookings.set(a.id, a); m.bookings.set(b.id, b);
    m.update.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 500 }));
    const r = await refreshStaleBookingEvents(REDIRECT, [snapshot(a, { description: 'old' }), snapshot(b, { description: 'old' })], { now: NOW });
    expect(r).toMatchObject({ refreshed: 1, errors: 1 });
    expect(m.update).toHaveBeenCalledTimes(2);
  });
});
