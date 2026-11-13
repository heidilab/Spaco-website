// Sales pay on the month close (Heidi 2026-11-13): base pay per branch +
// the bonus tier reached that month, as one expense line per branch. The
// base is dated: four branches shared $6,000 as $1,500 each; the fifth
// branch makes it $1,200 each from its month on, and July–October keep
// $1,500.

import { describe, it, expect } from 'vitest';
import { salesSalaryForMonth, salesSalaryLabel, baseSalaryForMonth, sortedSalaryPeriods } from './salesSalary';

const tiers = [{ target: 50000, bonus: 800 }, { target: 80000, bonus: 1500 }];
const tst = {
  tiers,
  baseSalaryHistory: [{ fromMonth: '2026-11', amount: 1200 }, { fromMonth: '2025-07', amount: 1500 }],
};

describe('baseSalaryForMonth — dated 底薪', () => {
  it('October still pays the old share; November the new one', () => {
    expect(baseSalaryForMonth(tst, '2026-10')).toBe(1500);
    expect(baseSalaryForMonth(tst, '2026-07')).toBe(1500);
    expect(baseSalaryForMonth(tst, '2026-11')).toBe(1200);
    expect(baseSalaryForMonth(tst, '2027-03')).toBe(1200);
  });
  it('before the first dated period there is no base', () => {
    expect(baseSalaryForMonth(tst, '2025-06')).toBe(0);
  });
  it('an undated period (from the start) is the floor', () => {
    const cfg = { tiers, baseSalaryHistory: [{ fromMonth: '', amount: 1500 }, { fromMonth: '2026-11', amount: 1200 }] };
    expect(baseSalaryForMonth(cfg, '2024-01')).toBe(1500);
    expect(baseSalaryForMonth(cfg, '2026-12')).toBe(1200);
  });
  it('the legacy single figure applies to every month when there is no history', () => {
    expect(baseSalaryForMonth({ tiers, baseSalary: 1500 }, '2026-01')).toBe(1500);
    expect(baseSalaryForMonth({ tiers, baseSalary: 1500, baseSalaryHistory: [{ fromMonth: '2026-11', amount: 1200 }] }, '2026-01')).toBe(0);
    expect(baseSalaryForMonth(undefined, '2026-01')).toBe(0);
  });
  it('periods are kept in the order they take effect, bad rows dropped', () => {
    expect(sortedSalaryPeriods([{ fromMonth: '2026-11', amount: 1200 }, { fromMonth: 'nope', amount: 1 }, { fromMonth: '', amount: 1500 }]))
      .toEqual([{ fromMonth: '', amount: 1500 }, { fromMonth: '2026-11', amount: 1200 }]);
  });
});

describe('salesSalaryForMonth', () => {
  it('her example: base 1,500 + tier-1 bonus 800 = 2,300 (October, four branches)', () => {
    expect(salesSalaryForMonth(52000, tst, '2026-10')).toEqual({ base: 1500, bonus: 800, total: 2300 });
  });
  it('November, five branches: base 1,200 + the same tier = 2,000', () => {
    expect(salesSalaryForMonth(52000, tst, '2026-11')).toEqual({ base: 1200, bonus: 800, total: 2000 });
  });
  it('a month under target pays the base only; the highest tier reached pays, never summed', () => {
    expect(salesSalaryForMonth(30000, tst, '2026-10')).toEqual({ base: 1500, bonus: 0, total: 1500 });
    expect(salesSalaryForMonth(90000, tst, '2026-10')).toEqual({ base: 1500, bonus: 1500, total: 3000 });
  });
  it('a branch with no settings costs nothing', () => {
    expect(salesSalaryForMonth(90000, undefined, '2026-10')).toEqual({ base: 0, bonus: 0, total: 0 });
  });
});

describe('salesSalaryLabel', () => {
  it('names the two parts on the sheet', () => {
    expect(salesSalaryLabel({ base: 1500, bonus: 800, total: 2300 })).toBe('Sales Salary（底薪 $1,500 + 獎金 $800）');
    expect(salesSalaryLabel({ base: 1500, bonus: 0, total: 1500 })).toBe('Sales Salary（底薪 $1,500）');
    expect(salesSalaryLabel({ base: 0, bonus: 0, total: 0 })).toBe('Sales Salary');
  });
});
