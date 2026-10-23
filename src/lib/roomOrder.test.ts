import { describe, expect, it } from 'vitest';
import { isCombinedRoom, optionLetter, orderRooms } from './roomOrder';
import { venues as staticVenues } from './venues';
import type { Venue } from '@/types';

const room = (over: Partial<Venue> & Pick<Venue, 'id'>): Venue => ({
  slug: over.id, name: { zh: over.id, en: over.id }, subtitle: { zh: '', en: '' }, description: { zh: '', en: '' },
  address: { zh: '', en: '' }, branch: '', capacity: { min: 6, max: 40 }, size: '', vibes: [], amenities: [],
  images: [], pricing: { weekday: { perHead: 50 }, weekend: { perHead: 58 } },
  minHours: { weekday: 5, weekend: 5 }, minGuests: { weekday: 6, weekend: 8 }, ...over,
});

describe('multi-space room order — Room A, Room B, then A+B (Heidi 2026-10-24)', () => {
  const hart = [
    room({ id: 'hart-ab', roomLabel: { zh: 'Hart Room A+B（全場）' }, conflictsWith: ['hart-b', 'hart-a'], capacity: { min: 20, max: 90 }, sortOrder: 99 }),
    room({ id: 'hart-b', roomLabel: { zh: 'Hart Room B' }, conflictsWith: ['hart-ab'], capacity: { min: 15, max: 60 }, sortOrder: 99 }),
    room({ id: 'hart-a', roomLabel: { zh: 'Hart Room A' }, conflictsWith: ['hart-ab'], capacity: { min: 6, max: 25 }, sortOrder: 99 }),
  ];
  it('orders HART as A, B, A+B regardless of registry order', () => {
    expect(orderRooms(hart).map((r) => r.id)).toEqual(['hart-a', 'hart-b', 'hart-ab']);
  });
  it('labels the options A, B and A+B', () => {
    const ordered = orderRooms(hart);
    expect(ordered.map((_, i) => optionLetter(ordered, i))).toEqual(['A', 'B', 'A+B']);
  });
  it('recognises the combined space by conflicts or by label', () => {
    expect(isCombinedRoom(hart[0])).toBe(true);
    expect(isCombinedRoom(room({ id: 'x', roomLabel: { zh: '全層' } }))).toBe(true);
    expect(isCombinedRoom(room({ id: 'y', roomLabel: { zh: 'Room C' }, conflictsWith: ['z'] }))).toBe(false);
  });
  it('keeps the Sheung Wan static rooms as A, B, A+B too', () => {
    const sw = staticVenues.filter((v) => v.id.startsWith('sw-'));
    expect(orderRooms(sw).map((r) => r.id)).toEqual(['sw-a', 'sw-b', 'sw-ab']);
  });
  it('respects an explicit admin sortOrder inside the singles group', () => {
    const rooms = [room({ id: 'p', roomLabel: { zh: 'Room B' }, sortOrder: 1 }), room({ id: 'q', roomLabel: { zh: 'Room A' }, sortOrder: 2 })];
    expect(orderRooms(rooms).map((r) => r.id)).toEqual(['p', 'q']);
  });
});
