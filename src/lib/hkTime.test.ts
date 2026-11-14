// Hong Kong dates (review #22) and the calendar segments (review #17).

import { describe, it, expect } from 'vitest';
import { hkTodayYmd, shiftYmd, ymdInHkt } from './hkTime';
import { timedEventSegments, allDayEventSegments } from './gcalSegments';

describe('hkTime', () => {
  it('is Hong Kong\'s date even before 08:00 HKT', () => {
    // 2026-12-24 23:30 UTC = 2026-12-25 07:30 HKT
    expect(hkTodayYmd(Date.parse('2026-12-24T23:30:00Z'))).toBe('2026-12-25');
    expect(ymdInHkt(Date.parse('2026-12-25T15:59:00Z'))).toBe('2026-12-25');
    expect(ymdInHkt(Date.parse('2026-12-25T16:00:00Z'))).toBe('2026-12-26');
    expect(shiftYmd('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftYmd('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('calendar event segments', () => {
  it('a same-day event is one segment in Hong Kong time', () => {
    expect(timedEventSegments('2026-12-25T19:00:00+08:00', '2026-12-25T23:00:00+08:00')).toEqual([
      { date: '2026-12-25', startTime: '19:00', endTime: '23:00' },
    ]);
  });
  it('an event crossing midnight blocks both days', () => {
    expect(timedEventSegments('2026-12-25T21:00:00+08:00', '2026-12-26T02:00:00+08:00')).toEqual([
      { date: '2026-12-25', startTime: '21:00', endTime: '23:59' },
      { date: '2026-12-26', startTime: '00:00', endTime: '02:00' },
    ]);
    // ends exactly at midnight: nothing of the next day
    expect(timedEventSegments('2026-12-25T21:00:00+08:00', '2026-12-26T00:00:00+08:00')).toEqual([
      { date: '2026-12-25', startTime: '21:00', endTime: '23:59' },
    ]);
    // UTC input is read in Hong Kong time
    expect(timedEventSegments('2026-12-25T13:00:00Z', '2026-12-25T18:00:00Z')).toEqual([
      { date: '2026-12-25', startTime: '21:00', endTime: '23:59' },
      { date: '2026-12-26', startTime: '00:00', endTime: '02:00' },
    ]);
  });
  it('a three-day event blocks the middle day whole', () => {
    expect(timedEventSegments('2026-12-25T10:00:00+08:00', '2026-12-27T09:00:00+08:00').map((s) => `${s.date} ${s.startTime}-${s.endTime}`)).toEqual([
      '2026-12-25 10:00-23:59', '2026-12-26 00:00-23:59', '2026-12-27 00:00-09:00',
    ]);
  });
  it('an all-day event covers every day; the end date is exclusive', () => {
    expect(allDayEventSegments('2026-12-25', '2026-12-26').map((s) => s.date)).toEqual(['2026-12-25']);
    expect(allDayEventSegments('2026-12-25', '2026-12-28').map((s) => s.date)).toEqual(['2026-12-25', '2026-12-26', '2026-12-27']);
    expect(allDayEventSegments('2026-12-25', '2026-12-25')).toHaveLength(1);
  });
});
