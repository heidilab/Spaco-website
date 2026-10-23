import { describe, expect, it } from 'vitest';
import { normalizeGcalCalendarId } from './gcalCalendarId';

const id = 'b39d07abcdef@group.calendar.google.com';
describe('normalizeGcalCalendarId — embed URL pasted into 分店管理 (HART, 2026-10-24)', () => {
  it('extracts the id from an embed URL with %40', () => {
    expect(normalizeGcalCalendarId(`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(id)}&ctz=Asia%2FHong_Kong`)).toBe(id);
  });
  it('extracts from cid= and ical links', () => {
    expect(normalizeGcalCalendarId(`https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(id)}`)).toBe(id);
    expect(normalizeGcalCalendarId(`https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`)).toBe(id);
  });
  it('leaves a bare id, a gmail address and blanks alone', () => {
    expect(normalizeGcalCalendarId(`  ${id} `)).toBe(id);
    expect(normalizeGcalCalendarId('spaco@gmail.com')).toBe('spaco@gmail.com');
    expect(normalizeGcalCalendarId('')).toBeNull();
    expect(normalizeGcalCalendarId(undefined)).toBeNull();
  });
});
