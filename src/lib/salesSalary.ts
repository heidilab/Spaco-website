// Sales (CS) pay per branch per month — PURE module, no firebase.
//
// Heidi 2026-11-13: the month-close Excel must carry the sales staff's
// pay as an expense of each branch: a fixed base (底薪, set per branch on
// the CS 獎金 page) plus the bonus tier that branch reached that month
// (「1500 加 800 等於 2300 蚊，係每間分店各自計數」). The bonus uses the same
// sales basis and tier rule as the CS 獎金 page (bonusMath.evaluateBonus:
// highest tier reached, tiers never stack).
//
// The base is dated. One CS earns $6,000 split across the branches: four
// branches → $1,500 each; a fifth opens → $1,200 each from that month on.
// A single figure would have rewritten July–October too, so each branch
// keeps a list of 「由 YYYY-MM 起 $X」 and a month takes the latest entry
// that had started by then.

import { evaluateBonus } from './bonusMath';
import type { BaseSalaryPeriod, BranchBonusConfig } from '@/types';

export interface SalesSalary {
  /** 底薪 for the branch in that month (0 when none applies). */
  base: number;
  /** Bonus of the highest tier reached this month (0 when none). */
  bonus: number;
  /** base + bonus — the expense line. */
  total: number;
}

/** Periods in the order they take effect ('' = from the start, first). */
export function sortedSalaryPeriods(periods: readonly BaseSalaryPeriod[]): BaseSalaryPeriod[] {
  return [...periods]
    .filter((p) => Number.isFinite(p.amount) && p.amount >= 0 && (p.fromMonth === '' || /^\d{4}-\d{2}$/.test(p.fromMonth)))
    .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
}

/** The 底薪 in force in `month`: the latest period that had started by
 *  then. Before the first dated period there is none (0) unless an
 *  undated ('' = from the start) period or the legacy single figure
 *  exists. */
export function baseSalaryForMonth(cfg: BranchBonusConfig | undefined, month: string): number {
  if (!cfg) return 0;
  const periods = sortedSalaryPeriods(cfg.baseSalaryHistory || []);
  if (periods.length === 0) return Math.max(0, cfg.baseSalary || 0);
  let amount = 0;
  for (const p of periods) {
    if (p.fromMonth === '' || p.fromMonth <= month) amount = p.amount;
    else break;
  }
  return Math.max(0, amount);
}

export function salesSalaryForMonth(sales: number, cfg: BranchBonusConfig | undefined, month: string): SalesSalary {
  const base = baseSalaryForMonth(cfg, month);
  const bonus = cfg?.tiers?.length ? evaluateBonus(sales, cfg.tiers).totalBonus : 0;
  return { base, bonus, total: Math.round((base + bonus) * 100) / 100 };
}

/** The expense line as it reads on the sheet, e.g.
 *  「Sales Salary（底薪 $1,500 + 獎金 $800）」. */
export function salesSalaryLabel(s: SalesSalary, lang: 'zh' | 'en' = 'zh'): string {
  const money = (n: number) => `$${n.toLocaleString('en-HK', { maximumFractionDigits: 2 })}`;
  const parts: string[] = [];
  if (s.base > 0) parts.push(lang === 'zh' ? `底薪 ${money(s.base)}` : `base ${money(s.base)}`);
  if (s.bonus > 0) parts.push(lang === 'zh' ? `獎金 ${money(s.bonus)}` : `bonus ${money(s.bonus)}`);
  return parts.length ? `Sales Salary（${parts.join(' + ')}）` : 'Sales Salary';
}
