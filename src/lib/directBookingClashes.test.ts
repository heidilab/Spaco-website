// Offline orders entered by staff (直接落單) and what may stop them —
// Heidi 2026-11-13: a part-timer marks a broker / Airbnb booking straight
// into Google Calendar; the website then refused the offline order for
// that same booking, and went on refusing after the calendar entry was
// deleted.

import { describe, it, expect } from 'vitest';
import { slotClashes, clashesNeedingConfirmation, type ClashSlot } from './directBookingClashes';
import { getAddOnLabel, formatAddOnsForStaff } from './pricing';

// 2026-11-20 19:00–23:00
const evening = [{ date: '2026-11-20', start: 19 * 60, end: 23 * 60 }];
const gcal = (over: Partial<ClashSlot> = {}): ClashSlot => ({
  date: '2026-11-20', startTime: '18:00', endTime: '23:00', reason: 'gcal',
  bookingId: null, googleEventId: 'ev1', googleEventTitle: '行家 Amy 20人', ...over,
});

describe('a Google Calendar entry never stops an offline order', () => {
  it('is reported, but needs no confirmation', () => {
    const clashes = slotClashes(evening, [gcal()], { production: true });
    expect(clashes).toEqual([
      { kind: 'calendar', date: '2026-11-20', startTime: '18:00', endTime: '23:00', label: '行家 Amy 20人', googleEventId: 'ev1' },
    ]);
    expect(clashesNeedingConfirmation(clashes)).toEqual([]);
  });

  it('counts one event once when it is mirrored onto every room of a shared space', () => {
    // 上環: the same event blocks Room A, Room B and A+B.
    const clashes = slotClashes(evening, [gcal(), gcal(), gcal()], { production: true });
    expect(clashes).toHaveLength(1);
  });

  it('still names an untitled event', () => {
    expect(slotClashes(evening, [gcal({ googleEventTitle: '' })], { production: true })[0].label).toBe('Google Calendar');
  });
});

describe('another booking or a site block asks first', () => {
  it('a booking and its cleaning buffer need a decision', () => {
    const clashes = slotClashes(evening, [
      { date: '2026-11-20', startTime: '14:00', endTime: '19:30', reason: 'booking', bookingId: 'bk1' },
      { date: '2026-11-20', startTime: '19:30', endTime: '20:30', reason: 'cleaning', bookingId: 'bk1' },
    ], { production: true });
    expect(clashes.map((c) => [c.kind, c.label, c.bookingId])).toEqual([
      ['booking', '預訂', 'bk1'], ['booking', '清潔時間', 'bk1'],
    ]);
    expect(clashesNeedingConfirmation(clashes)).toHaveLength(2);
  });

  it('a block staff put on the site needs a decision', () => {
    const clashes = slotClashes(evening, [
      { date: '2026-11-20', startTime: '00:00', endTime: '23:59', reason: 'admin_block', bookingId: null },
    ], { production: true });
    expect(clashes[0].kind).toBe('block');
    expect(clashesNeedingConfirmation(clashes)).toHaveLength(1);
  });

  it('with both, only the booking asks — the calendar entry rides along', () => {
    const clashes = slotClashes(evening, [
      gcal(),
      { date: '2026-11-20', startTime: '20:00', endTime: '23:00', reason: 'booking', bookingId: 'bk2' },
    ], { production: true });
    expect(clashes.map((c) => c.kind)).toEqual(['calendar', 'booking']);
    expect(clashesNeedingConfirmation(clashes).map((c) => c.bookingId)).toEqual(['bk2']);
  });
});

describe('what does not clash', () => {
  it('another day, or a slot that only touches the edge', () => {
    const clashes = slotClashes(evening, [
      gcal({ date: '2026-11-21' }),
      gcal({ googleEventId: 'ev2', startTime: '15:00', endTime: '19:00' }), // ends as it starts
      gcal({ googleEventId: 'ev3', startTime: '23:00', endTime: '23:59' }), // starts as it ends
    ], { production: true });
    expect(clashes).toEqual([]);
  });

  it('test bookings on production; they do count on the test site', () => {
    const slot: ClashSlot = { date: '2026-11-20', startTime: '19:00', endTime: '23:00', reason: 'booking', bookingId: 't1', isTest: true };
    expect(slotClashes(evening, [slot], { production: true })).toEqual([]);
    expect(slotClashes(evening, [slot], { production: false })).toHaveLength(1);
  });

  it('an overnight order checks each day against its own slots', () => {
    const overnight = [
      { date: '2026-11-20', start: 21 * 60, end: 24 * 60 },
      { date: '2026-11-21', start: 0, end: 2 * 60 },
    ];
    const clashes = slotClashes(overnight, [
      gcal({ googleEventId: 'late', date: '2026-11-21', startTime: '01:00', endTime: '03:00' }),
      gcal({ googleEventId: 'next-evening', date: '2026-11-21', startTime: '21:00', endTime: '23:00' }),
    ], { production: true });
    expect(clashes.map((c) => c.startTime)).toEqual(['01:00']);
  });
});

describe('staff label of the premium BBQ package says SEAFOOD', () => {
  // The cleaner reads Google Calendar: "Premium" did not tell them there
  // is seafood to order and handle (Heidi 2026-11-13).
  it('Google Calendar / staff text reads BBQ Seafood Package', () => {
    expect(getAddOnLabel('bbq-premium', 'en')).toBe('BBQ Seafood Package');
    expect(getAddOnLabel('bbq-premium', 'zh')).toBe('BBQ 豪華海鮮套餐');
    expect(formatAddOnsForStaff([{ id: 'bbq-premium', quantity: 1 }], 'en')).toBe('BBQ Seafood Package');
    expect(formatAddOnsForStaff([{ id: 'bbq-premium', quantity: 1, options: { pax: 12 } }], 'en')).toBe('BBQ Seafood Package ×12 pax');
    expect(getAddOnLabel('bbq-standard', 'en')).toBe('BBQ Standard Package');
  });
});
