import { describe, it, expect } from 'vitest';
import { resolvePeakRule, effectiveMinGuests, effectiveMinHours, peakBranchKey, swSplitBlocked, peakRuleScopes } from './peakDayRules';
import { calculatePricing } from './pricing';
import { venues } from './venues';
import type { PeakDayConfig } from '@/types';

const XMAS: PeakDayConfig = {
  date: '2026-12-25',
  all: { surchargePerHead: 50, minHeadcount: 8 },
  branches: { cwb: { surchargePerHead: 80, minHours: 4 } },
  note: '聖誕節',
};

describe('resolvePeakRule', () => {
  it('branch override wins field-by-field over all', () => {
    const cwb = resolvePeakRule(XMAS, 'cwb')!;
    expect(cwb.surchargePerHead).toBe(80);  // branch override
    expect(cwb.minHeadcount).toBe(8);       // inherited from all
    expect(cwb.minHours).toBe(4);           // branch-only field
  });

  it('sw rooms resolve through the legacy sw branch key', () => {
    expect(peakBranchKey('sw-ab')).toBe('sw');
    const sw = resolvePeakRule(XMAS, 'sw-a')!;
    expect(sw.surchargePerHead).toBe(50);
  });

  it('exact room key beats the legacy sw group and all', () => {
    const cfg = {
      date: '2026-12-25',
      all: { surchargePerHead: 50 },
      branches: {
        sw: { surchargePerHead: 60 },
        'sw-a': { surchargePerHead: 80, minHeadcount: 6 },
      },
    };
    expect(resolvePeakRule(cfg, 'sw-a')!.surchargePerHead).toBe(80);
    expect(resolvePeakRule(cfg, 'sw-a')!.minHeadcount).toBe(6);
    expect(resolvePeakRule(cfg, 'sw-b')!.surchargePerHead).toBe(60);  // legacy group
    expect(resolvePeakRule(cfg, 'sw-ab')!.surchargePerHead).toBe(60);
    expect(resolvePeakRule(cfg, 'cwb')!.surchargePerHead).toBe(50);   // all
  });

  it('null when no config or empty rule', () => {
    expect(resolvePeakRule(null, 'cwb')).toBeNull();
    expect(resolvePeakRule({ date: 'x', all: {} }, 'cwb')).toBeNull();
  });
});

describe('effective minimums', () => {
  it('peak floor raises but never lowers venue minimums', () => {
    expect(effectiveMinGuests(10, { minHeadcount: 8 })).toBe(10);
    expect(effectiveMinGuests(6, { minHeadcount: 8 })).toBe(8);
    expect(effectiveMinHours(3, { minHours: 4 })).toBe(4);
    expect(effectiveMinHours(3, null)).toBe(3);
  });
});

describe('calculatePricing peak surcharge', () => {
  const venue = venues.find((v) => v.id === 'cwb')!;

  it('adds per-head surcharge once (not per hour), child at half', () => {
    const base = calculatePricing(venue, false, 4, 10, [], 0, 0);
    const peak = calculatePricing(venue, false, 4, 10, [], 0, 50);
    expect(peak.baseCharge - base.baseCharge).toBe(500);   // 10 heads × $50
    expect(peak.subtotal - base.subtotal).toBe(500);
    const withKids = calculatePricing(venue, false, 4, 10, [], 2, 50);
    const withKidsBase = calculatePricing(venue, false, 4, 10, [], 2, 0);
    expect(withKids.baseCharge - withKidsBase.baseCharge).toBe(450); // 8 + 2×0.5 = 9 equiv
  });

  it('shows its own breakdown line and keeps venue line un-inflated', () => {
    const peak = calculatePricing(venue, false, 4, 10, [], 0, 50);
    const line = peak.breakdown.find((b) => b.label.zh.includes('特別日子附加費'));
    expect(line?.amount).toBe(500);
    const noPeak = calculatePricing(venue, false, 4, 10, [], 0, 0);
    expect(peak.breakdown[0].amount).toBe(noPeak.breakdown[0].amount);
    expect(noPeak.breakdown.some((b) => b.label.zh.includes('特別日子'))).toBe(false);
  });
});

describe('forceWeekendRate', () => {
  it('merges branch ?? all and counts as an active rule on its own', () => {
    const cfg = { date: '2026-12-15', all: { forceWeekendRate: true } };
    expect(resolvePeakRule(cfg, 'tst')?.forceWeekendRate).toBe(true);
    const cfg2 = { date: '2026-12-15', branches: { cwb: { forceWeekendRate: true } } };
    expect(resolvePeakRule(cfg2, 'cwb')?.forceWeekendRate).toBe(true);
    expect(resolvePeakRule(cfg2, 'tst')).toBeNull();
  });
});

describe('peakSurchargeOverride (CS-adjusted total)', () => {
  it('replaces the rule-derived amount outright', () => {
    const v = venues.find((x) => x.id === 'cwb')!;
    const adjusted = calculatePricing(v, false, 4, 15, [], 0, 150, 1500);
    const ruled = calculatePricing(v, false, 4, 15, [], 0, 150);
    expect(ruled.subtotal - adjusted.subtotal).toBe(2250 - 1500);
    const line = adjusted.breakdown.find((b) => b.label.zh.includes('特別日子'));
    expect(line?.amount).toBe(1500);
    expect(line?.label.zh).toContain('已調整');
  });
  it('override 0 removes the surcharge entirely', () => {
    const v = venues.find((x) => x.id === 'cwb')!;
    const zero = calculatePricing(v, false, 4, 15, [], 0, 150, 0);
    const none = calculatePricing(v, false, 4, 15, [], 0, 0);
    expect(zero.subtotal).toBe(none.subtotal);
  });
});

describe('swSplitBlocked (上環全場優先)', () => {
  const cfg = {
    date: '2026-12-25',
    all: { surchargePerHead: 50 },
    swFullFloorFirst: true,
    swSplitReleaseDays: 14,
  };
  const ms = (iso: string) => new Date(iso).getTime();

  it('blocks sw-a / sw-b before the release moment', () => {
    const now = ms('2026-12-01T12:00:00+08:00'); // release = 12-11 00:00
    expect(swSplitBlocked(cfg, 'sw-a', now)).toBe(true);
    expect(swSplitBlocked(cfg, 'sw-b', now)).toBe(true);
  });

  it('never blocks 全層 A+B or other venues', () => {
    const now = ms('2026-12-01T12:00:00+08:00');
    expect(swSplitBlocked(cfg, 'sw-ab', now)).toBe(false);
    expect(swSplitBlocked(cfg, 'cwb', now)).toBe(false);
  });

  it('opens A/B at the release moment (date − releaseDays, HKT)', () => {
    expect(swSplitBlocked(cfg, 'sw-a', ms('2026-12-10T23:59:00+08:00'))).toBe(true);
    expect(swSplitBlocked(cfg, 'sw-a', ms('2026-12-11T00:00:01+08:00'))).toBe(false);
  });

  it('releaseDays absent blocks until the date itself', () => {
    const c2 = { date: '2026-12-25', swFullFloorFirst: true };
    expect(swSplitBlocked(c2, 'sw-a', ms('2026-12-24T23:00:00+08:00'))).toBe(true);
    expect(swSplitBlocked(c2, 'sw-a', ms('2026-12-25T00:00:01+08:00'))).toBe(false);
  });

  it('flag off = never blocked', () => {
    expect(swSplitBlocked({ date: '2026-12-25' }, 'sw-a', ms('2026-12-01T00:00:00+08:00'))).toBe(false);
    expect(swSplitBlocked(null, 'sw-a', 0)).toBe(false);
  });
});

// 特別日子 hard-coded the original six venues, so the rooms of a branch
// added in 分店管理 (尖沙咀 HART) could only ever get the 全部分店 rule.
describe('venues that can carry their own peak-day rule', () => {
  const hartBranch = { branchKey: 'tsthart', branchName: { zh: '尖沙咀 HART', en: 'TST HART' } };
  const hart = [
    { id: 'hart-ab', name: { zh: 'Hart Room A+B', en: 'Hart Room A+B' }, roomLabel: { zh: '全層 A+B', en: 'A+B' }, active: true, sortOrder: 52, ...hartBranch },
    { id: 'hart-a',  name: { zh: 'Hart Room A',   en: 'Hart Room A' },   roomLabel: { zh: 'Room A', en: 'Room A' },   active: true, sortOrder: 50, ...hartBranch },
    { id: 'hart-b',  name: { zh: 'Hart Room B',   en: 'Hart Room B' },   roomLabel: { zh: 'Room B' },                 active: true, sortOrder: 51, ...hartBranch },
  ];
  const registry = [...venues.map((v, i) => ({ ...v, active: true, sortOrder: i })), ...hart];
  const LEGACY = ['cwb', 'sw-a', 'sw-b', 'sw-ab', 'tst', 'wanchai'];

  it('lists the original six in their usual order, then each HART room', () => {
    const scopes = peakRuleScopes(registry);
    expect(scopes.map((s) => s.key)).toEqual([...LEGACY, 'hart-a', 'hart-b', 'hart-ab']);
    expect(scopes[0].name).toEqual({ zh: '銅鑼灣', en: 'CWB' });
    expect(scopes[6].name).toEqual({ zh: '尖沙咀 HART Room A', en: 'TST HART Room A' });
    expect(scopes[7].name).toEqual({ zh: '尖沙咀 HART Room B', en: 'TST HART Room B' });
    expect(scopes[8].name).toEqual({ zh: '尖沙咀 HART 全層 A+B', en: 'TST HART A+B' });
  });

  it('uses the venue name for a single-space branch', () => {
    const kt = { id: 'kt', name: { zh: '觀塘店', en: 'Kwun Tong' }, active: true, sortOrder: 10, branchKey: 'kt', branchName: { zh: '觀塘店', en: 'Kwun Tong' } };
    expect(peakRuleScopes([...registry, kt])[6]).toEqual({ key: 'kt', name: { zh: '觀塘店', en: 'Kwun Tong' } });
  });

  it('shows just the original six when the registry is unreachable', () => {
    expect(peakRuleScopes(venues).map((s) => s.key)).toEqual(LEGACY);
    expect(peakRuleScopes([]).map((s) => s.key)).toEqual(LEGACY);
  });

  it('hides an offline venue unless the date already has a rule for it', () => {
    const offline = registry.map((v) => (v.id === 'hart-b' ? { ...v, active: false } : v));
    expect(peakRuleScopes(offline).map((s) => s.key)).toEqual([...LEGACY, 'hart-a', 'hart-ab']);
    expect(peakRuleScopes(offline, ['hart-b']).map((s) => s.key)).toEqual([...LEGACY, 'hart-a', 'hart-b', 'hart-ab']);
  });

  it('keeps a row for a saved rule whose venue left the registry, but not for the legacy sw group', () => {
    expect(peakRuleScopes(registry, ['sw', 'cwb', 'old-venue', 'old-venue']).map((s) => s.key))
      .toEqual([...LEGACY, 'hart-a', 'hart-b', 'hart-ab', 'old-venue']);
  });

  it('a rule saved under a HART room id is the one bookings resolve', () => {
    const cfg: PeakDayConfig = {
      date: '2026-12-25',
      all: { surchargePerHead: 50, minHeadcount: 8 },
      branches: { 'hart-a': { surchargePerHead: 90 }, 'hart-ab': { minHours: 5 } },
    };
    for (const scope of peakRuleScopes(registry)) {
      // Every listed key is a venue id resolvePeakRule can look up.
      expect(resolvePeakRule(cfg, scope.key)).not.toBeNull();
    }
    expect(resolvePeakRule(cfg, 'hart-a')).toMatchObject({ surchargePerHead: 90, minHeadcount: 8 });
    expect(resolvePeakRule(cfg, 'hart-b')).toMatchObject({ surchargePerHead: 50, minHeadcount: 8 });
    expect(resolvePeakRule(cfg, 'hart-ab')).toMatchObject({ surchargePerHead: 50, minHours: 5 });
  });
});
