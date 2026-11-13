// 尖沙咀 landing page for Google Ads (Heidi 2026-11-13): the two 尖沙咀
// branches, each with main photo, name, size, capacity and a short intro,
// linking to the branch's own page.

import { describe, it, expect } from 'vitest';
import { districtBranchCards, DISTRICTS } from './districtLanding';
import { venues as staticVenues } from './venues';
import type { Venue } from '@/types';

const room = (over: Partial<Venue> & Pick<Venue, 'id' | 'slug'>): Venue => ({
  name: { zh: over.id, en: over.id }, subtitle: { zh: '', en: '' }, description: { zh: '', en: '' },
  address: { zh: '', en: '' }, branch: '', capacity: { min: 6, max: 40 }, size: '', vibes: [], amenities: [],
  images: [], pricing: { weekday: { perHead: 50 }, weekend: { perHead: 58 } },
  minHours: { weekday: 4, weekend: 4 }, minGuests: { weekday: 6, weekend: 8 }, active: true, ...over,
});

// The registry as it stood on 2026-11-13 (trimmed to what the page reads).
const hart = (id: string, label: string, over: Partial<Venue>) => room({
  id, slug: id, branchKey: 'tsthart', sortOrder: 99,
  name: { zh: `尖沙咀 HART 店 ${label}`, en: `TST HART ${label}` },
  branchName: { zh: '尖沙咀 HART ', en: 'TST HART' }, roomLabel: { zh: `Hart ${label}`, en: `Hart ${label}` },
  address: { zh: '尖沙咀赫德道 12 - 15 號', en: '12-15 Hart Avenue, Tsim Sha Tsui' }, ...over,
});
const registry: Venue[] = [
  room({ id: 'cwb', slug: 'causeway-bay', branchKey: 'cwb', sortOrder: 1, name: { zh: '銅鑼灣店', en: 'Causeway Bay' }, address: { zh: '銅鑼灣', en: 'Causeway Bay' } }),
  room({ id: 'wanchai', slug: 'wan-chai', branchKey: 'wanchai', sortOrder: 2, name: { zh: '灣仔店', en: 'Wan Chai' }, address: { zh: '灣仔', en: 'Wan Chai' } }),
  room({
    id: 'tst', slug: 'tsim-sha-tsui', branchKey: 'tst', sortOrder: 3, name: { zh: '尖沙咀店', en: 'Tsim Sha Tsui' },
    branchName: { zh: '尖沙咀店', en: 'Tsim Sha Tsui' },
    description: { zh: '尖沙咀獨特複式單位連露台，送無酒精飲品任飲。', en: 'Duplex with terrace.' },
    address: { zh: '尖沙咀寶勒巷22-24號雲龍商業大廈17樓A1室', en: 'Prat Avenue, Tsim Sha Tsui' },
    size: '900呎（室內）＋400呎（天台）', capacity: { min: 8, max: 70 },
    images: ['https://img.test/tst-main.jpg', 'https://img.test/tst-2.jpg'],
  }),
  hart('hart-ab', 'Room A+B（全場）', { size: '2000 sq ft Indoor +600 sq ft Terrace', capacity: { min: 20, max: 90 }, images: [] }),
  hart('hart-b', 'Room B', { size: '1300 sq ft Indoor +600 sq ft Terrace', capacity: { min: 15, max: 60 }, images: ['https://img.test/hart-b.jpg'] }),
  hart('hart-a', 'Room A', { size: '700 sq. ft', capacity: { min: 6, max: 25 }, images: ['https://img.test/hart-a.jpg'] }),
  room({ id: 'sw-a', slug: 'sheung-wan-a', branchKey: 'sheung-wan', sortOrder: 4, name: { zh: '上環 Room A', en: 'Sheung Wan A' }, address: { zh: '上環', en: 'Sheung Wan' } }),
];

describe('尖沙咀 landing page', () => {
  const cards = districtBranchCards(registry, DISTRICTS.tst);

  it('lists exactly the two 尖沙咀 branches, each linking to its own page', () => {
    expect(cards.map((c) => [c.key, c.slug])).toEqual([['tst', 'tsim-sha-tsui'], ['tsthart', 'tsthart']]);
  });

  it('single-space branch: its own photo, size, capacity and intro', () => {
    const tst = cards[0];
    expect(tst.name.zh).toBe('尖沙咀店');
    expect(tst.image).toBe('https://img.test/tst-main.jpg');
    expect(tst.size).toBe('900呎（室內）＋400呎（天台）');
    expect(tst.capacity).toEqual({ min: 8, max: 70 });
    expect(tst.intro.zh).toBe('尖沙咀獨特複式單位連露台，送無酒精飲品任飲。');
    expect(tst.rooms).toEqual([]);
  });

  it('multi-room branch: whole-floor size, smallest-to-largest capacity, first room photo', () => {
    const h = cards[1];
    expect(h.name.zh).toBe('尖沙咀 HART');
    expect(h.size).toBe('2000 sq ft Indoor +600 sq ft Terrace');
    expect(h.capacity).toEqual({ min: 6, max: 90 });
    // Room A+B has no photos of its own — Room A's first photo stands in.
    expect(h.image).toBe('https://img.test/hart-a.jpg');
    expect(h.rooms.map((r) => [r.label.zh, r.combined])).toEqual([
      ['Hart Room A', false], ['Hart Room B', false], ['Hart Room A+B（全場）', true],
    ]);
    expect(h.address.zh).toBe('尖沙咀赫德道 12 - 15 號');
  });

  it('no intro filled in → empty (the page then describes the room options)', () => {
    expect(cards[1].intro).toEqual({ zh: '', en: '' });
  });

  it('a branch taken down (落架) disappears; other districts never show', () => {
    const down = registry.map((v) => (v.branchKey === 'tsthart' ? { ...v, active: false } : v));
    expect(districtBranchCards(down, DISTRICTS.tst).map((c) => c.key)).toEqual(['tst']);
    expect(cards.some((c) => ['cwb', 'wanchai', 'sheung-wan'].includes(c.key))).toBe(false);
  });

  it('still shows the original 尖沙咀 branch when only the built-in venue list is available', () => {
    const fallback = districtBranchCards(staticVenues.map((v) => ({ ...v, active: true })), DISTRICTS.tst);
    expect(fallback.map((c) => c.slug)).toEqual(['tsim-sha-tsui']);
    // Built-in photo paths are not real files — no broken image.
    expect(fallback[0].image).toBeNull();
  });
});
