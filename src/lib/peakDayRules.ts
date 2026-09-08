// PURE peak-day resolution (特別日子) — no firebase imports so pricing
// code and tests can use it anywhere. Firestore accessors live in
// peakDays.ts.

import type { PeakDayConfig, PeakDayRule } from '@/types';

/** venueId → branch key (sw-a/sw-b/sw-ab share 'sw'). */
export function peakBranchKey(venueId: string): string {
  return venueId.startsWith('sw-') ? 'sw' : venueId;
}

/** The effective rule for one venue on one date — branch override wins
 *  field-by-field over `all`. Null when nothing applies. */
export function resolvePeakRule(cfg: PeakDayConfig | null | undefined, venueId: string): PeakDayRule | null {
  if (!cfg) return null;
  const branch = cfg.branches?.[peakBranchKey(venueId)];
  const merged: PeakDayRule = {
    surchargePerHead: branch?.surchargePerHead ?? cfg.all?.surchargePerHead,
    minHeadcount: branch?.minHeadcount ?? cfg.all?.minHeadcount,
    minHours: branch?.minHours ?? cfg.all?.minHours,
  };
  const any = (merged.surchargePerHead || 0) > 0
    || (merged.minHeadcount || 0) > 0
    || (merged.minHours || 0) > 0;
  return any ? merged : null;
}

/** Peak floors may only RAISE the venue's own minimums, never lower. */
export function effectiveMinGuests(venueMin: number, rule: PeakDayRule | null): number {
  return Math.max(venueMin, rule?.minHeadcount || 0);
}

export function effectiveMinHours(venueMin: number, rule: PeakDayRule | null): number {
  return Math.max(venueMin, rule?.minHours || 0);
}
