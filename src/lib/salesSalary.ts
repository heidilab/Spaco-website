// Sales (CS) pay per branch per month — PURE module, no firebase.
//
// Heidi 2026-11-13: the month-close Excel must carry the sales staff's
// pay as an expense of each branch: a fixed base (底薪, set per branch on
// the CS 獎金 page) plus the bonus tier that branch reached that month
// (「1500 加 800 等於 2300 蚊，係每間分店各自計數」). The bonus uses the same
// sales basis and tier rule as the CS 獎金 page (bonusMath.evaluateBonus:
// highest tier reached, tiers never stack).

import { evaluateBonus } from './bonusMath';
import type { BranchBonusConfig } from '@/types';

export interface SalesSalary {
  /** 底薪 for the branch (0 when none is set). */
  base: number;
  /** Bonus of the highest tier reached this month (0 when none). */
  bonus: number;
  /** base + bonus — the expense line. */
  total: number;
}

export function salesSalaryForMonth(sales: number, cfg: BranchBonusConfig | undefined): SalesSalary {
  const base = Math.max(0, cfg?.baseSalary || 0);
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
