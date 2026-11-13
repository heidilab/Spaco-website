// 總日曆 branch filter (Heidi 2026-11-13): 尖沙咀 HART's three rooms are
// one entry, like 上環店.

import { describe, it, expect } from 'vitest';
import { calendarFilterOptions, filterVenueIds, isGroupFilter, preferredGcalRow } from './calendarBranchFilter';
import { venues as staticVenues } from './venues';
import type { Venue } from '@/types';

const room = (over: Partial<Venue> & Pick<Venue, 'id' | 'slug'>): Venue => ({
  name: { zh: over.id, en: over.id }, subtitle: { zh: '', en: '' }, description: { zh: '', en: '' },
  address: { zh: '', en: '' }, branch: '', capacity: { min: 6, max: 40 }, size: '', vibes: [], amenities: [],
  images: [], pricing: { weekday: { perHead: 50 }, weekend: { perHead: 58 } },
  minHours: { weekday: 4, weekend: 4 }, minGuests: { weekday: 6, weekend: 8 }, active: true, ...over,
});
const hart = (id: string, label: string, max: number) => room({
  id, slug: id, branchKey: 'tsthart', sortOrder: 99, capacity: { min: 6, max },
  name: { zh: `尖沙咀 HART 店 ${label}`, en: `TST HART ${label}` },
  branchName: { zh: '尖沙咀 HART ', en: 'TST HART' }, roomLabel: { zh: `Hart ${label}` },
});
const registry: Venue[] = [
  ...staticVenues.map((v, i) => ({ ...v, active: true, sortOrder: i + 1, branchKey: v.id.startsWith('sw-') ? 'sheung-wan' : v.id })),
  hart('hart-ab', 'Room A+B（全場）', 90), hart('hart-b', 'Room B', 60), hart('hart-a', 'Room A', 25),
];

describe('calendarFilterOptions', () => {
  const opts = calendarFilterOptions(registry);
  it('one entry per branch: the four single spaces, 上環店, 尖沙咀 HART', () => {
    expect(opts.map((o) => o.value)).toEqual(['cwb', 'wanchai', 'group:sheung-wan', 'tst', 'group:tsthart']);
    expect(opts.find((o) => o.value === 'group:tsthart')!.name.zh).toBe('尖沙咀 HART');
    expect(opts.find((o) => o.value === 'group:sheung-wan')!.name.zh).toBe('上環海景旗艦店');
  });
  it('a multi-room entry covers every room and defaults a new block to the whole floor', () => {
    const h = opts.find((o) => o.value === 'group:tsthart')!;
    expect(h.venueIds).toEqual(['hart-a', 'hart-b', 'hart-ab']);
    expect(h.defaultVenueId).toBe('hart-ab');
    expect(opts.find((o) => o.value === 'group:sheung-wan')!.defaultVenueId).toBe('sw-ab');
  });
  it('a single space stays its own venue id', () => {
    const c = opts.find((o) => o.value === 'cwb')!;
    expect(c.venueIds).toEqual(['cwb']);
    expect(c.defaultVenueId).toBe('cwb');
    expect(isGroupFilter('cwb')).toBe(false);
    expect(isGroupFilter('group:tsthart')).toBe(true);
  });
  it('a room taken down (落架) leaves the entry; a branch of one remaining room is single', () => {
    const down = registry.map((v) => (v.id === 'hart-b' || v.id === 'hart-ab' ? { ...v, active: false } : v));
    const o = calendarFilterOptions(down).find((x) => x.venueIds.includes('hart-a'))!;
    expect(o.value).toBe('hart-a');
  });
});

describe('filterVenueIds', () => {
  const opts = calendarFilterOptions(registry);
  it('全部分店 → none (the page loads everything); group → its rooms; venue → itself', () => {
    expect(filterVenueIds(opts, 'all')).toEqual([]);
    expect(filterVenueIds(opts, 'group:tsthart')).toEqual(['hart-a', 'hart-b', 'hart-ab']);
    expect(filterVenueIds(opts, 'cwb')).toEqual(['cwb']);
    expect(filterVenueIds(opts, 'unknown-id')).toEqual(['unknown-id']);
  });
});

describe('preferredGcalRow', () => {
  it('shows the whole-floor copy of a mirrored Google Calendar event', () => {
    const rows = [{ venueId: 'hart-a', id: 1 }, { venueId: 'hart-ab', id: 2 }, { venueId: 'hart-b', id: 3 }];
    expect(preferredGcalRow(rows, registry).id).toBe(2);
    expect(preferredGcalRow([{ venueId: 'sw-b', id: 1 }, { venueId: 'sw-ab', id: 2 }], registry).id).toBe(2);
    expect(preferredGcalRow([{ venueId: 'cwb', id: 1 }], registry).id).toBe(1);
  });
});
