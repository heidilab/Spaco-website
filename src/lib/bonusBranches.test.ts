import { describe, expect, it } from 'vitest';
import { salesBranchKey, salesBranches } from './bonusBranches';
import { venues as staticVenues } from './venues';

// CS 獎金 hard-coded the original four branches, so 尖沙咀 HART (added in
// 分店管理, branchKey `tsthart`, three rooms) had no card and no settings.
const hart = [
  { id: 'hart-ab', name: { zh: 'Hart Room A+B', en: 'Hart Room A+B' }, active: true, sortOrder: 52, branchKey: 'tsthart', branchName: { zh: '尖沙咀 HART', en: 'TST HART' } },
  { id: 'hart-a',  name: { zh: 'Hart Room A',   en: 'Hart Room A' },   active: true, sortOrder: 50, branchKey: 'tsthart', branchName: { zh: '尖沙咀 HART', en: 'TST HART' } },
  { id: 'hart-b',  name: { zh: 'Hart Room B',   en: 'Hart Room B' },   active: true, sortOrder: 51, branchKey: 'tsthart', branchName: { zh: '尖沙咀 HART', en: 'TST HART' } },
];
// Registry copies of the original venues: single spaces carry
// branchKey === id, the 上環 rooms share a key of their own.
const legacy = staticVenues.map((v, i) => ({
  ...v, active: true, sortOrder: i,
  branchKey: v.id.startsWith('sw-') ? 'sheung-wan' : v.id,
}));
const registry = [...legacy, ...hart];

describe('which branch a booking counts toward', () => {
  it('keeps the original keys so saved targets and alert records still match', () => {
    expect(salesBranchKey('cwb', registry)).toBe('cwb');
    expect(salesBranchKey('tst', registry)).toBe('tst');
    expect(salesBranchKey('wanchai', registry)).toBe('wanchai');
    for (const id of ['sw-a', 'sw-b', 'sw-ab']) expect(salesBranchKey(id, registry)).toBe('sw');
  });

  it('rolls every room of a new branch up to its 分店管理 branch', () => {
    for (const id of ['hart-a', 'hart-b', 'hart-ab']) expect(salesBranchKey(id, registry)).toBe('tsthart');
  });

  it('a room added to Sheung Wan in 分店管理 (branchKey sheung-wan) still books to sw', () => {
    const withNewRoom = [...registry, { id: 'sw-c', name: { zh: 'Room C', en: 'Room C' }, active: true, sortOrder: 7, branchKey: 'sheung-wan' } as (typeof registry)[number]];
    expect(salesBranchKey('sw-c', withNewRoom)).toBe('sw');
  });

  it('falls back to the venue id when the registry does not know the venue', () => {
    expect(salesBranchKey('gone-venue', registry)).toBe('gone-venue');
    expect(salesBranchKey('hart-a', [])).toBe('hart-a');
  });
});

describe('branches listed on the CS bonus page', () => {
  it('lists the original four, then the new branch once (not one per room)', () => {
    const list = salesBranches(registry);
    expect(list.map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai', 'tsthart']);
    expect(list[4].name).toEqual({ zh: '尖沙咀 HART', en: 'TST HART' });
  });

  it('shows just the original four from the static fallback list', () => {
    expect(salesBranches(staticVenues).map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai']);
  });

  it('hides a branch that is fully offline unless it already has targets', () => {
    const offline = [...legacy, ...hart.map((v) => ({ ...v, active: false }))];
    expect(salesBranches(offline).map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai']);
    expect(salesBranches(offline, ['tsthart']).map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai', 'tsthart']);
  });

  it('keeps a row for saved targets whose branch left the registry', () => {
    expect(salesBranches(legacy, ['cwb', 'oldbranch']).map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai', 'oldbranch']);
  });

  it('orders several new branches by their 分店管理 sort order', () => {
    const more = [...registry, { id: 'kt', name: { zh: '觀塘店', en: 'Kwun Tong' }, active: true, sortOrder: 10, branchKey: 'kt' }];
    expect(salesBranches(more).map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai', 'kt', 'tsthart']);
    expect(salesBranches(more)[4].name.zh).toBe('觀塘店');
  });
});
