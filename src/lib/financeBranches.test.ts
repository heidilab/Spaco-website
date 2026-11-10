/**
 * Branch roll-up for the finance pages (控制中心 / 財務總覽 / 支出 / 月結).
 *
 * finance.branchKey used to know only the `sw-` prefix, so each room of a
 * branch added in 分店管理 (尖沙咀 HART: hart-a / hart-b / hart-ab, branchKey
 * `tsthart`) was its own "branch" and appeared on no page that listed the
 * original four. The roll-up now reads the venue registry — the same rule
 * as the CS 獎金 page (lib/bonusBranches).
 */

import { describe, expect, it } from 'vitest';
import { aggregateBookings, branchGroupName, branchKey, financeBranches } from './finance';
import { salesBranchKey } from './bonusBranches';
import { venues as staticVenues } from './venues';
import type { BookingRecord } from '@/types';

const hartBranch = { branchKey: 'tsthart', branchName: { zh: '尖沙咀 HART', en: 'TST HART' } };
const hart = [
  { id: 'hart-a',  name: { zh: 'Hart Room A',   en: 'Hart Room A' },   active: true, sortOrder: 50, ...hartBranch },
  { id: 'hart-b',  name: { zh: 'Hart Room B',   en: 'Hart Room B' },   active: true, sortOrder: 51, ...hartBranch },
  { id: 'hart-ab', name: { zh: 'Hart Room A+B', en: 'Hart Room A+B' }, active: true, sortOrder: 52, ...hartBranch },
];
// Registry copies of the original venues: single spaces carry
// branchKey === id, the 上環 rooms share a key of their own.
const legacy = staticVenues.map((v, i) => ({
  ...v, active: true, sortOrder: i,
  branchKey: v.id.startsWith('sw-') ? 'sheung-wan' : v.id,
}));
const registry = [...legacy, ...hart];

const paid = (id: string, venueId: string, subtotal: number, date = '2026-11-08') => ({
  id, venueId, date, status: 'confirmed',
  payments: [{ amount: subtotal }],
  pricing: { baseCharge: subtotal, addOnTotal: 0, subtotal, securityDeposit: 0, deposit: subtotal },
} as unknown as BookingRecord);

describe('which branch a venue rolls up to on the finance pages', () => {
  it('keeps the original four keys so existing month-close records and expenses still match', () => {
    expect(branchKey('cwb', registry)).toBe('cwb');
    expect(branchKey('tst', registry)).toBe('tst');
    expect(branchKey('wanchai', registry)).toBe('wanchai');
    for (const id of ['sw-a', 'sw-b', 'sw-ab']) expect(branchKey(id, registry)).toBe('sw');
  });

  it('rolls every HART room up to the one tsthart branch', () => {
    for (const id of ['hart-a', 'hart-b', 'hart-ab']) expect(branchKey(id, registry)).toBe('tsthart');
  });

  it('agrees with the CS bonus page for every venue', () => {
    for (const v of registry) expect(branchKey(v.id, registry)).toBe(salesBranchKey(v.id, registry));
  });

  it('leaves a venue the registry does not know under its own id', () => {
    expect(branchKey('gone-venue', registry)).toBe('gone-venue');
    // Registry unreachable → static fallback list: HART rooms are not merged
    // under a key nobody chose.
    expect(branchKey('hart-a', staticVenues)).toBe('hart-a');
  });
});

describe('branch names on the finance pages', () => {
  it('keeps the long-standing names of the original four', () => {
    expect(branchGroupName('sw', registry)).toEqual({ zh: '上環海景旗艦店', en: 'Sheung Wan Flagship' });
    expect(branchGroupName('cwb', registry).zh).toBe('銅鑼灣店');
    expect(branchGroupName('cwb').zh).toBe('銅鑼灣店');
  });

  it('names a 分店管理 branch by its branch name, not by a room', () => {
    expect(branchGroupName('tsthart', registry)).toEqual({ zh: '尖沙咀 HART', en: 'TST HART' });
  });

  it('falls back to the key when nothing knows the branch', () => {
    expect(branchGroupName('gone-venue', registry)).toEqual({ zh: 'gone-venue', en: 'gone-venue' });
    expect(branchGroupName('tsthart')).toEqual({ zh: 'tsthart', en: 'tsthart' });
  });
});

describe('branches a finance page lists', () => {
  it('lists the original four, then HART once', () => {
    const list = financeBranches(registry);
    expect(list.map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai', 'tsthart']);
    expect(list[1].name.zh).toBe('上環海景旗艦店');
    expect(list[4].name.zh).toBe('尖沙咀 HART');
  });

  it('shows just the original four when the registry is unreachable', () => {
    expect(financeBranches(staticVenues).map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai']);
    expect(financeBranches([]).map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai']);
  });

  it('hides a fully offline branch unless it already has data', () => {
    const offline = [...legacy, ...hart.map((v) => ({ ...v, active: false }))];
    expect(financeBranches(offline).map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai']);
    const withData = financeBranches(offline, ['tsthart', 'cwb']);
    expect(withData.map((b) => b.key)).toEqual(['cwb', 'sw', 'tst', 'wanchai', 'tsthart']);
    expect(withData[4].name.zh).toBe('尖沙咀 HART');
  });

  it('keeps a row for sales booked under a venue that left the registry', () => {
    expect(financeBranches(registry, ['gone-venue']).map((b) => b.key))
      .toEqual(['cwb', 'sw', 'tst', 'wanchai', 'tsthart', 'gone-venue']);
  });
});

describe('revenue by branch (財務總覽)', () => {
  const bookings = [
    paid('b1', 'hart-a', 1000),
    paid('b2', 'hart-b', 2000),
    paid('b3', 'hart-ab', 4000),
    paid('b4', 'sw-a', 500),
    paid('b5', 'sw-ab', 700),
    paid('b6', 'cwb', 300),
  ];

  it('shows HART as one branch row, like 上環', () => {
    const r = aggregateBookings(bookings, {}, registry);
    const rows = Object.fromEntries(r.byBranch.map((b) => [b.branchId, b]));
    expect(Object.keys(rows).sort()).toEqual(['cwb', 'sw', 'tsthart']);
    expect(rows.tsthart).toMatchObject({ revenue: 7000, bookings: 3, branchName: { zh: '尖沙咀 HART', en: 'TST HART' } });
    expect(rows.sw).toMatchObject({ revenue: 1200, bookings: 2 });
    expect(r.totalRevenue).toBe(8500);
  });

  it('filters to the whole HART branch', () => {
    const r = aggregateBookings(bookings, { branch: 'tsthart' }, registry);
    expect(r.bookingCount).toBe(3);
    expect(r.totalRevenue).toBe(7000);
  });

  it('leaves the original branch filters unchanged', () => {
    expect(aggregateBookings(bookings, { branch: 'sw' }, registry).totalRevenue).toBe(1200);
    expect(aggregateBookings(bookings, { branch: 'cwb' }, registry).totalRevenue).toBe(300);
    expect(aggregateBookings(bookings, { branch: 'tst' }, registry).bookingCount).toBe(0);
    expect(aggregateBookings(bookings, { branch: 'all' }, registry).bookingCount).toBe(6);
  });
});
