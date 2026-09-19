// PURE peak-day resolution (特別日子) — no firebase imports so pricing
// code and tests can use it anywhere. Firestore accessors live in
// peakDays.ts.

import type { PeakDayConfig, PeakDayRule } from '@/types';

/** venueId → branch key (sw-a/sw-b/sw-ab share 'sw'). */
export function peakBranchKey(venueId: string): string {
  return venueId.startsWith('sw-') ? 'sw' : venueId;
}

/** The effective rule for one venue on one date. Precedence per field:
 *  exact room key (sw-a / sw-b / sw-ab — Heidi 2026-09-17: the three
 *  上環 rooms configure independently) → legacy branch group ('sw') →
 *  `all`. Non-SW venues: room key === group key, so nothing changes. */
export function resolvePeakRule(cfg: PeakDayConfig | null | undefined, venueId: string): PeakDayRule | null {
  if (!cfg) return null;
  const room = cfg.branches?.[venueId];
  const group = cfg.branches?.[peakBranchKey(venueId)];
  const merged: PeakDayRule = {
    surchargePerHead: room?.surchargePerHead ?? group?.surchargePerHead ?? cfg.all?.surchargePerHead,
    minHeadcount: room?.minHeadcount ?? group?.minHeadcount ?? cfg.all?.minHeadcount,
    minHours: room?.minHours ?? group?.minHours ?? cfg.all?.minHours,
    forceWeekendRate: room?.forceWeekendRate ?? group?.forceWeekendRate ?? cfg.all?.forceWeekendRate,
  };
  const any = (merged.surchargePerHead || 0) > 0
    || (merged.minHeadcount || 0) > 0
    || (merged.minHours || 0) > 0
    || merged.forceWeekendRate === true;
  return any ? merged : null;
}

/** Peak floors may only RAISE the venue's own minimums, never lower. */
export function effectiveMinGuests(venueMin: number, rule: PeakDayRule | null): number {
  return Math.max(venueMin, rule?.minHeadcount || 0);
}

export function effectiveMinHours(venueMin: number, rule: PeakDayRule | null): number {
  return Math.max(venueMin, rule?.minHours || 0);
}

/**
 * 上環全場優先 (Heidi 2026-09-20): true when `venueId` (sw-a / sw-b)
 * must NOT be bookable separately on this peak date yet — the date is
 * flagged full-floor-first and the release moment (date 00:00 HKT −
 * swSplitReleaseDays days) hasn't arrived. sw-ab and non-SW venues are
 * never blocked. Existing A+B bookings block A/B afterwards through the
 * normal conflict checks, so no full-floor lookup is needed here.
 */
export function swSplitBlocked(
  cfg: PeakDayConfig | null | undefined,
  venueId: string,
  nowMs: number = Date.now(),
): boolean {
  if (!cfg?.swFullFloorFirst) return false;
  if (venueId !== 'sw-a' && venueId !== 'sw-b') return false;
  const releaseDays = Math.max(0, cfg.swSplitReleaseDays || 0);
  const dateStartMs = new Date(`${cfg.date}T00:00:00+08:00`).getTime();
  const releaseMs = dateStartMs - releaseDays * 24 * 60 * 60 * 1000;
  return nowMs < releaseMs;
}
