// 提早入場佈置 holds the room from the set-up start (Heidi 2026-11-26:
// #rJr2PlOw, 15:00–20:00 with one set-up hour, must hold from 14:00 and
// say 「14:00-15:00 提早入場佈置」).

import { describe, expect, it } from 'vitest';
import { bookingHoldStart, earlySetupHoursOf, earlySetupNote, setupWindowStart } from './earlySetup';

describe('earlySetupHoursOf', () => {
  it('reads the stored hours first, then the add-on quantity', () => {
    expect(earlySetupHoursOf({ earlySetupHours: 1, addOns: [{ id: 'early-setup', quantity: 2 }] })).toBe(1);
    expect(earlySetupHoursOf({ addOns: [{ id: 'early-setup', quantity: 2 }] })).toBe(2);
    expect(earlySetupHoursOf({ addOns: [{ id: 'drinks', quantity: 1 }] })).toBe(0);
    expect(earlySetupHoursOf(undefined)).toBe(0);
  });
  it('clamps to whole hours between 0 and 3', () => {
    expect(earlySetupHoursOf({ earlySetupHours: 5 })).toBe(3);
    expect(earlySetupHoursOf({ earlySetupHours: -1 })).toBe(0);
    expect(earlySetupHoursOf({ earlySetupHours: 1.5 })).toBe(1);
  });
});

describe('setupWindowStart / bookingHoldStart', () => {
  it('a 15:00 booking with one hour holds from 14:00', () => {
    expect(setupWindowStart('15:00', 1)).toBe('14:00');
    expect(bookingHoldStart({ startTime: '15:00', earlySetupHours: 1 })).toBe('14:00');
  });
  it('two hours bought as an add-on hold from two hours before', () => {
    expect(bookingHoldStart({ startTime: '19:00', addOns: [{ id: 'early-setup', quantity: 2 }] })).toBe('17:00');
  });
  it('without set-up hours the hold starts at the booking start', () => {
    expect(bookingHoldStart({ startTime: '15:00' })).toBe('15:00');
    expect(bookingHoldStart({ startTime: '15:00', earlySetupHours: 0 })).toBe('15:00');
  });
  it('refuses a window that would start before midnight of the same day', () => {
    expect(setupWindowStart('01:00', 2)).toBeNull();
    expect(bookingHoldStart({ startTime: '01:00', earlySetupHours: 2 })).toBe('01:00');
  });
});

describe('earlySetupNote', () => {
  it('names the set-up part of the window for staff', () => {
    expect(earlySetupNote({ startTime: '15:00', earlySetupHours: 1 })).toBe('14:00-15:00 提早入場佈置');
    expect(earlySetupNote({ startTime: '15:00', earlySetupHours: 1 }, 'en')).toBe('14:00-15:00 early set-up');
    expect(earlySetupNote({ startTime: '15:00' })).toBe('');
  });
});
