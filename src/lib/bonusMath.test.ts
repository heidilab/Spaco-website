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

  it('tier 1 achieved, working toward tier 2 — bonuses are cumulative', () => {
    const e = evaluateBonus(120000, TIERS);
    expect(e.achievedTierIndexes).toEqual([0]);
    expect(e.totalBonus).toBe(1000);
    expect(e.nextTierIndex).toBe(1);
    expect(e.nextTierProgressPct).toBe(80); // 120k / 150k
  });

  it('all tiers achieved', () => {
    const e = evaluateBonus(250000, TIERS);
    expect(e.achievedTierIndexes).toEqual([0, 1, 2]);
    expect(e.totalBonus).toBe(4500);
    expect(e.nextTierIndex).toBeNull();
    expect(e.nextTierProgressPct).toBeNull();
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
