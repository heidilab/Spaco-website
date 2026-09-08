import { describe, it, expect } from 'vitest';
import { resolvePeakRule, effectiveMinGuests, effectiveMinHours, peakBranchKey } from './peakDayRules';
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

  it('sw rooms resolve through the sw branch key', () => {
    expect(peakBranchKey('sw-ab')).toBe('sw');
    const sw = resolvePeakRule(XMAS, 'sw-a')!;
    expect(sw.surchargePerHead).toBe(50);
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
