import { describe, expect, it } from 'vitest';
import { bookingWindows, editStaysWithinReservation, overlappingBookings, windowsOverlap } from './bookingOverlap';

const cwb = { id: 'sold', venueId: 'cwb', date: '2026-10-31', startTime: '18:00', endTime: '23:00', status: 'confirmed' };

describe('booking overlap guard — CWB 2026-10-31 double booking', () => {
  it('finds the paid booking even when its blocked_slots are gone', () => {
    const req = [{ date: '2026-10-31', startTime: '19:00', endTime: '22:00' }];
    expect(overlappingBookings(req, [cwb]).map((b) => b.id)).toEqual(['sold']);
  });
  it('includes the 60-minute cleaning buffer after the booking', () => {
    expect(overlappingBookings([{ date: '2026-10-31', startTime: '23:30', endTime: '23:59' }], [cwb])).toHaveLength(1);
    expect(overlappingBookings([{ date: '2026-10-31', startTime: '08:00', endTime: '13:00' }], [cwb])).toHaveLength(0);
  });
  it('ignores cancelled and expired bookings, and the booking being modified', () => {
    const req = [{ date: '2026-10-31', startTime: '19:00', endTime: '22:00' }];
    expect(overlappingBookings(req, [{ ...cwb, status: 'cancelled' }, { ...cwb, status: 'payment_not_completed' }])).toHaveLength(0);
    expect(overlappingBookings(req, [cwb], { production: true, excludeId: 'sold' })).toHaveLength(0);
  });
  it('ignores test bookings on production but counts them on preview', () => {
    const req = [{ date: '2026-10-31', startTime: '19:00', endTime: '22:00' }];
    expect(overlappingBookings(req, [{ ...cwb, isTest: true }], { production: true })).toHaveLength(0);
    expect(overlappingBookings(req, [{ ...cwb, isTest: true }], { production: false })).toHaveLength(1);
  });
  it('splits overnight bookings across both days with the buffer on day two', () => {
    const w = bookingWindows({ date: '2026-10-30', endDate: '2026-10-31', startTime: '20:00', endTime: '02:00' });
    expect(w).toEqual([
      { date: '2026-10-30', startTime: '20:00', endTime: '23:59' },
      { date: '2026-10-31', startTime: '00:00', endTime: '02:00' },
      { date: '2026-10-31', startTime: '02:00', endTime: '03:00' },
    ]);
    expect(windowsOverlap({ date: '2026-10-31', startTime: '02:30', endTime: '06:00' }, w[2])).toBe(true);
  });
  it('treats back-to-back windows as non-overlapping', () => {
    expect(windowsOverlap({ date: 'd', startTime: '10:00', endTime: '12:00' }, { date: 'd', startTime: '12:00', endTime: '14:00' })).toBe(false);
  });
});

describe('editStaysWithinReservation — HART Room B 2026-11-06 re-save blocked by a gcal mirror slot', () => {
  const held = { venueId: 'hart-b', date: '2026-11-06', endDate: '2026-11-07', startTime: '19:00', endTime: '01:00' };
  it('shrinking 6h → 5h on the same venue stays within the held window', () => {
    expect(editStaysWithinReservation(held, { date: '2026-11-06', endDate: '2026-11-07', startTime: '19:00', endTime: '00:00' })).toBe(true);
  });
  it('a pure repricing save with the time unchanged stays within', () => {
    expect(editStaysWithinReservation(held, { ...held })).toBe(true);
  });
  it('widening, moving, or changing venue is still checked', () => {
    expect(editStaysWithinReservation(held, { date: '2026-11-06', endDate: '2026-11-07', startTime: '18:00', endTime: '01:00' })).toBe(false);
    expect(editStaysWithinReservation(held, { date: '2026-11-06', endDate: '2026-11-07', startTime: '19:00', endTime: '02:00' })).toBe(false);
    expect(editStaysWithinReservation(held, { date: '2026-11-07', startTime: '19:00', endTime: '23:00' })).toBe(false);
    expect(editStaysWithinReservation(held, { venueId: 'hart-ab', date: '2026-11-06', endDate: '2026-11-07', startTime: '19:00', endTime: '00:00' })).toBe(false);
  });
  it('early-setup hours count as part of the window', () => {
    const withSetup = { ...held, earlySetupHours: 1 };
    expect(editStaysWithinReservation(withSetup, { date: '2026-11-06', endDate: '2026-11-07', startTime: '19:00', endTime: '00:00', earlySetupHours: 1 })).toBe(true);
    expect(editStaysWithinReservation(held, { date: '2026-11-06', endDate: '2026-11-07', startTime: '19:00', endTime: '00:00', earlySetupHours: 1 })).toBe(false);
  });
  it('unparseable stored times fall back to the full check', () => {
    expect(editStaysWithinReservation({ ...held, startTime: '' }, { date: '2026-11-06', startTime: '19:00', endTime: '23:00' })).toBe(false);
  });
});
