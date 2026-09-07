// CS monthly sales-bonus math (獎金) — PURE module, no firebase.
//
// Each branch has admin-configured tiers: hit tier 1's sales target →
// earn tier 1's bonus, keep going for tier 2, etc. Tiers are CUMULATIVE:
// a month that reaches tier 2 pays tier1.bonus + tier2.bonus. Sales are
// calendar-month (same countsForFinance + pricing.subtotal basis as the
// month close, resetting on the 1st).

import type { BonusTier } from '@/types';

export interface BonusEvaluation {
  /** Indexes (into the sorted tiers) whose target is met. */
  achievedTierIndexes: number[];
  /** Sum of bonuses across achieved tiers. */
  totalBonus: number;
  /** The next unachieved tier's index, or null when all tiers are hit. */
  nextTierIndex: number | null;
  /** Progress toward the next unachieved tier, 0–100 (100 = at target).
   *  Null when every tier is achieved. */
  nextTierProgressPct: number | null;
}

/** Tiers sorted ascending by target — the canonical evaluation order. */
export function sortedTiers(tiers: BonusTier[]): BonusTier[] {
  return [...tiers].sort((a, b) => a.target - b.target);
}

export function evaluateBonus(sales: number, tiersIn: BonusTier[]): BonusEvaluation {
  const tiers = sortedTiers(tiersIn).filter((t) => t.target > 0);
  const achievedTierIndexes: number[] = [];
  let totalBonus = 0;
  let nextTierIndex: number | null = null;
  for (let i = 0; i < tiers.length; i++) {
    if (sales >= tiers[i].target) {
      achievedTierIndexes.push(i);
      totalBonus += tiers[i].bonus;
    } else {
      nextTierIndex = i;
      break;
    }
  }
  const nextTierProgressPct = nextTierIndex === null
    ? null
    : Math.min(100, Math.round((sales / tiers[nextTierIndex].target) * 1000) / 10);
  return { achievedTierIndexes, totalBonus, nextTierIndex, nextTierProgressPct };
}
