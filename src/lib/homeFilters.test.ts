// Home 篩選 on venue attributes + 全場優先 for any split-room branch
// (site review 2026-11-13, phase 4e).

import { describe, it, expect } from 'vitest';
import { capacityRange, filterVenueList, fallbackSuggestions } from './homeFilters';
import { isPartRoom, fullFloorSplitBlocked, swSplitBlocked } from './peakDayRules';
import { venues } from './venues';
import type { Venue } from '@/types';

const hart = (id: string, roomLabel: string, conflictsWith: string[], capacity: { min: number; max: number }): Venue => ({
  ...venues.find((v) => v.id === 'tst')!,
  id, slug: id, branchKey: 'tsthart', branchName: { zh: '尖沙咀 HART', en: 'TST HART' }, roomLabel: { zh: roomLabel, en: roomLabel },
  spaceGroup: 'hart-physical', conflictsWith, capacity, active: true, sortOrder: 50,
  name: { zh: `HART ${roomLabel}`, en: `HART ${roomLabel}` },
  vibes: ['chill', 'corporate'], amenities: ['mahjong', 'pool-table'],
});
const registry: Venue[] = [
  ...venues.map((v) => ({ ...v, active: true })),
  hart('hart-a', 'Room A', ['hart-ab'], { min: 8, max: 30 }),
  hart('hart-b', 'Room B', ['hart-ab'], { min: 10, max: 40 }),
  hart('hart-ab', 'A+B', ['hart-a', 'hart-b'], { min: 20, max: 80 }),
];

describe('home filters on the venues\' own attributes', () => {
  it('reads capacity options, the top one open-ended', () => {
    expect(capacityRange('6-10')).toEqual([6, 10]);
    expect(capacityRange('71-100')).toEqual([71, Infinity]);
    expect(capacityRange('weird')).toBeNull();
  });
  it('matches a branch added in 分店管理 like the original ones', () => {
    const ids = (f: Parameters<typeof filterVenueList>[1]) => filterVenueList(registry, f).map((v) => v.id);
    expect(ids({ capacity: '6-10', vibe: null, amenities: [] })).toEqual(['wanchai', 'sw-a', 'hart-a', 'hart-b']);
    expect(ids({ capacity: '71-100', vibe: null, amenities: [] })).toEqual(['sw-ab', 'hart-ab']);
    expect(ids({ capacity: null, vibe: 'corporate', amenities: [] })).toEqual(['wanchai', 'hart-a', 'hart-b', 'hart-ab']);
    expect(ids({ capacity: null, vibe: null, amenities: ['pool-table', 'private-kitchen'] })).toEqual(['sw-b', 'sw-ab']);
    expect(ids({ capacity: null, vibe: null, amenities: [] })).toHaveLength(registry.length);
  });
  it('suggests from the live list when nothing matches', () => {
    const s = fallbackSuggestions({ capacity: '6-10', vibe: null, amenities: ['private-kitchen'] }, registry);
    expect(s[0].type).toBe('upsell');
    expect(s[0].venues.map((v) => v.id)).toEqual(['sw-b', 'sw-ab']);
    expect(s[1].venues.length).toBeGreaterThan(0);
    expect(s[1].venues.every((v) => v.capacity.min <= 10)).toBe(true);
    const g = fallbackSuggestions({ capacity: '71-100', vibe: 'family', amenities: ['hotpot'] }, registry);
    expect(g).toHaveLength(1);
    expect(g[0].venues.length).toBeLessThanOrEqual(3);
    // one card per branch
    expect(new Set(g[0].venues.map((v) => v.branchKey || v.id)).size).toBe(g[0].venues.length);
  });
});

describe('全場優先 on any branch with split rooms', () => {
  const cfg = { date: '2026-12-25', swFullFloorFirst: true, swSplitReleaseDays: 14 };
  const early = new Date('2026-12-01T12:00:00+08:00').getTime();
  it('knows which rooms are parts of a combined room', () => {
    expect(isPartRoom('sw-a')).toBe(true);
    expect(isPartRoom('sw-ab')).toBe(false);
    expect(isPartRoom('cwb')).toBe(false);
    expect(isPartRoom('hart-a', registry)).toBe(true);
    expect(isPartRoom('hart-b', registry)).toBe(true);
    expect(isPartRoom('hart-ab', registry)).toBe(false);
    expect(isPartRoom('tst', registry)).toBe(false);
  });
  it('blocks HART Room A / B like 上環 Room A / B, never the whole floor', () => {
    expect(fullFloorSplitBlocked(cfg, 'hart-a', registry, early)).toBe(true);
    expect(fullFloorSplitBlocked(cfg, 'hart-ab', registry, early)).toBe(false);
    expect(fullFloorSplitBlocked(cfg, 'sw-b', registry, early)).toBe(true);
    expect(fullFloorSplitBlocked(cfg, 'hart-a', registry, new Date('2026-12-11T00:00:01+08:00').getTime())).toBe(false);
    expect(fullFloorSplitBlocked({ ...cfg, swFullFloorFirst: false }, 'hart-a', registry, early)).toBe(false);
    // the old 上環-only form still works on the static rooms
    expect(swSplitBlocked(cfg, 'sw-a', early)).toBe(true);
  });
});
