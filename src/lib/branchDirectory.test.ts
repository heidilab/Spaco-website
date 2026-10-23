import { describe, expect, it } from 'vitest';
import { groupBranches, STATIC_BRANCHES } from './branchDirectory';
import { venues as staticVenues } from './venues';
import type { Venue } from '@/types';

const room = (over: Partial<Venue> & Pick<Venue, 'id' | 'slug'>): Venue => ({
  name: { zh: over.id, en: over.id }, subtitle: { zh: '', en: '' }, description: { zh: '', en: '' },
  address: { zh: '', en: '' }, branch: '', capacity: { min: 6, max: 40 }, size: '', vibes: [], amenities: [],
  images: [], pricing: { weekday: { perHead: 50 }, weekend: { perHead: 58 } },
  minHours: { weekday: 4, weekend: 4 }, minGuests: { weekday: 6, weekend: 8 }, ...over,
});

describe('branch directory (分店導覽 / header / hero)', () => {
  it('static fallback still yields the original four branches with Sheung Wan grouped', () => {
    expect(STATIC_BRANCHES.map((b) => b.slug).sort()).toEqual(['causeway-bay', 'sheung-wan', 'tsim-sha-tsui', 'wan-chai']);
    expect(STATIC_BRANCHES.find((b) => b.slug === 'sheung-wan')!.rooms).toHaveLength(3);
    expect(STATIC_BRANCHES.find((b) => b.slug === 'sheung-wan')!.name.zh).toBe('上環海景旗艦店');
  });
  it('a new multi-room branch from 分店管理 becomes one entry at /branches/<branchKey> (HART 2026-10-24)', () => {
    const hart = ['hart-a', 'hart-ab', 'hart-b'].map((id) => room({
      id, slug: id, branchKey: 'tsthart', branchName: { zh: '尖沙咀 HART ', en: 'TST HART' }, roomLabel: { zh: id }, active: true, sortOrder: 99,
      images: id === 'hart-b' ? ['https://x/img.jpg'] : [],
    }));
    const dir = groupBranches([...staticVenues.map((v, i) => ({ ...v, active: true, sortOrder: i + 1, branchKey: v.id.startsWith('sw-') ? 'sheung-wan' : v.id })), ...hart]);
    expect(dir).toHaveLength(5);
    const entry = dir.find((b) => b.key === 'tsthart')!;
    expect(entry.slug).toBe('tsthart');
    expect(entry.name.zh).toBe('尖沙咀 HART');
    expect(entry.rooms).toHaveLength(3);
    expect(entry.coverImage).toBe('https://x/img.jpg');
    expect(dir[dir.length - 1].key).toBe('tsthart');
  });
  it('single-space branches link to their own slug and keep registry names', () => {
    const dir = groupBranches([room({ id: 'cwb', slug: 'causeway-bay', branchKey: 'cwb', name: { zh: '銅鑼灣店', en: 'Causeway Bay' }, active: true, sortOrder: 1 })]);
    expect(dir[0]).toMatchObject({ key: 'cwb', slug: 'causeway-bay', name: { zh: '銅鑼灣店', en: 'Causeway Bay' } });
  });
  it('drops inactive (落架) spaces and whole branches', () => {
    const dir = groupBranches([
      room({ id: 'a', slug: 'a', active: false }),
      room({ id: 'b1', slug: 'b1', branchKey: 'b', active: false }),
      room({ id: 'b2', slug: 'b2', branchKey: 'b', active: true, branchName: { zh: 'B', en: 'B' } }),
    ]);
    expect(dir.map((b) => b.key)).toEqual(['b']);
    expect(dir[0].rooms.map((r) => r.id)).toEqual(['b2']);
  });
});
