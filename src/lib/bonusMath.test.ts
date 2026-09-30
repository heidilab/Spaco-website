import { describe, it, expect } from 'vitest';
import { evaluateBonus, sortedTiers } from './bonusMath';

const TIERS = [
  { target: 100000, bonus: 1000 },
  { target: 150000, bonus: 1500 },
  { target: 200000, bonus: 2000 },
];

describe('evaluateBonus', () => {
  it('no tiers achieved below the first target', () => {
    const e = evaluateBonus(50000, TIERS);
    expect(e.achievedTierIndexes).toEqual([]);
    expect(e.totalBonus).toBe(0);
    expect(e.nextTierIndex).toBe(0);
    expect(e.nextTierProgressPct).toBe(50);
  });

  it('80% progress toward the first tier', () => {
    expect(evaluateBonus(80000, TIERS).nextTierProgressPct).toBe(80);
  });

  it('tier 1 achieved, working toward tier 2', () => {
    const e = evaluateBonus(120000, TIERS);
    expect(e.achievedTierIndexes).toEqual([0]);
    expect(e.totalBonus).toBe(1000);
    expect(e.nextTierIndex).toBe(1);
    expect(e.nextTierProgressPct).toBe(80); // 120k / 150k
  });

  it('all tiers achieved', () => {
    const e = evaluateBonus(250000, TIERS);
    expect(e.achievedTierIndexes).toEqual([0, 1, 2]);
    expect(e.totalBonus).toBe(2000);   // highest tier only, NOT 1000+1500+2000
    expect(e.nextTierIndex).toBeNull();
    expect(e.nextTierProgressPct).toBeNull();
  });

  it('pays ONLY the highest tier reached — tiers never stack (Heidi 2026-09-30)', () => {
    // 上環 Sept: $134,464 vs tiers 100k/$1,500 · 130k/$2,500 · 170k/$3,300
    const sw = [{ target: 100000, bonus: 1500 }, { target: 130000, bonus: 2500 }, { target: 170000, bonus: 3300 }];
    expect(evaluateBonus(134464, sw).totalBonus).toBe(2500);   // was wrongly 4,000
    // 尖沙咀: $75,388 vs 50k/$800 · 70k/$1,500 · 90k/$2,200
    const tst = [{ target: 50000, bonus: 800 }, { target: 70000, bonus: 1500 }, { target: 90000, bonus: 2200 }];
    expect(evaluateBonus(75388, tst).totalBonus).toBe(1500);   // was wrongly 2,300
    // 銅鑼灣: $109,255 vs 90k/$1,000 · 118k/$1,500 → tier 1 only
    const cwb = [{ target: 90000, bonus: 1000 }, { target: 118000, bonus: 1500 }, { target: 138000, bonus: 2500 }];
    expect(evaluateBonus(109255, cwb).totalBonus).toBe(1000);
  });

  it('exact target counts as achieved', () => {
    const e = evaluateBonus(100000, TIERS);
    expect(e.achievedTierIndexes).toEqual([0]);
    expect(e.nextTierProgressPct).toBeCloseTo(66.7, 1);
  });

  it('sorts unordered tiers and ignores zero-target rows', () => {
    const messy = [{ target: 200000, bonus: 2000 }, { target: 0, bonus: 999 }, { target: 100000, bonus: 1000 }];
    expect(sortedTiers(messy)[0].target).toBe(0);
    const e = evaluateBonus(100000, messy);
    expect(e.totalBonus).toBe(1000);
    expect(e.nextTierIndex).toBe(1); // the 200k tier after filtering
  });

  it('handles empty tier list', () => {
    const e = evaluateBonus(100000, []);
    expect(e.totalBonus).toBe(0);
    expect(e.nextTierIndex).toBeNull();
  });
});
