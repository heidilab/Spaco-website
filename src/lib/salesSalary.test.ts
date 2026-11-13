// Sales pay on the month close (Heidi 2026-11-13): base pay per branch +
// the bonus tier reached that month, as one expense line per branch.

import { describe, it, expect } from 'vitest';
import { salesSalaryForMonth, salesSalaryLabel } from './salesSalary';

const tst = { baseSalary: 1500, tiers: [{ target: 50000, bonus: 800 }, { target: 80000, bonus: 1500 }] };

describe('salesSalaryForMonth', () => {
  it('her example: base 1,500 + tier-1 bonus 800 = 2,300', () => {
    expect(salesSalaryForMonth(52000, tst)).toEqual({ base: 1500, bonus: 800, total: 2300 });
  });
  it('a month under target pays the base only', () => {
    expect(salesSalaryForMonth(30000, tst)).toEqual({ base: 1500, bonus: 0, total: 1500 });
  });
  it('the highest tier reached pays, tiers do not stack', () => {
    expect(salesSalaryForMonth(90000, tst)).toEqual({ base: 1500, bonus: 1500, total: 3000 });
  });
  it('a branch with no settings costs nothing; a branch with only a base pays the base', () => {
    expect(salesSalaryForMonth(90000, undefined)).toEqual({ base: 0, bonus: 0, total: 0 });
    expect(salesSalaryForMonth(90000, { tiers: [] , baseSalary: 1200 })).toEqual({ base: 1200, bonus: 0, total: 1200 });
  });
});

describe('salesSalaryLabel', () => {
  it('names the two parts on the sheet', () => {
    expect(salesSalaryLabel({ base: 1500, bonus: 800, total: 2300 })).toBe('Sales Salary（底薪 $1,500 + 獎金 $800）');
    expect(salesSalaryLabel({ base: 1500, bonus: 0, total: 1500 })).toBe('Sales Salary（底薪 $1,500）');
    expect(salesSalaryLabel({ base: 0, bonus: 0, total: 0 })).toBe('Sales Salary');
  });
});
