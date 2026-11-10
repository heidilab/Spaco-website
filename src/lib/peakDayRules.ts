// PURE peak-day resolution (特別日子) — no firebase imports so pricing
// code and tests can use it anywhere. Firestore accessors live in
// peakDays.ts.

import type { PeakDayConfig, PeakDayRule, Venue } from '@/types';

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

/** One row of the per-venue overrides in the 特別日子 editor. `key` is the
 *  key under PeakDayConfig.branches — a venue id, which is exactly what
 *  resolvePeakRule looks up first. */
export interface PeakRuleScope {
  key: string;
  name: { zh: string; en: string };
}

/** The original venues, in the editor's long-standing order and labels. */
const LEGACY_PEAK_SCOPES: PeakRuleScope[] = [
  { key: 'cwb',     name: { zh: '銅鑼灣', en: 'CWB' } },
  { key: 'sw-a',    name: { zh: '上環 Room A', en: 'SW Room A' } },
  { key: 'sw-b',    name: { zh: '上環 Room B', en: 'SW Room B' } },
  { key: 'sw-ab',   name: { zh: '上環 全層 A+B', en: 'SW A+B' } },
  { key: 'tst',     name: { zh: '尖沙咀', en: 'TST' } },
  { key: 'wanchai', name: { zh: '灣仔', en: 'WC' } },
];

type PeakScopeVenue = Pick<Venue, 'id' | 'name' | 'active' | 'sortOrder' | 'branchName' | 'roomLabel'>;

/**
 * Venues that can carry their own peak-day rule, in order: the original
 * six, then every other venue in 分店管理 with an active (上架) listing, by
 * its sort order — so the rooms of a branch added there (尖沙咀 HART Room
 * A / B / A+B) can each get a surcharge or minimum. The list used to be
 * hard-coded, which left those rooms with only the 全部分店 rule.
 *
 * `savedKeys` are the keys a date already has rules for: an offline or
 * removed venue stays listed, so re-saving the date never silently drops
 * its rule. The legacy 'sw' group key is not a row — the editor prefills
 * the three 上環 rooms from it.
 */
export function peakRuleScopes(venues: readonly PeakScopeVenue[], savedKeys: readonly string[] = []): PeakRuleScope[] {
  const legacy = new Set(LEGACY_PEAK_SCOPES.map((s) => s.key));
  const saved = new Set(savedKeys);
  const added = venues
    .filter((v) => v.id && !legacy.has(v.id) && v.id !== 'sw' && (v.active !== false || saved.has(v.id)))
    .slice()
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.id.localeCompare(b.id))
    .map((v) => {
      // Multi-room branch: 「分店名 房名」 (same shape as 上環 Room A).
      const room = v.roomLabel?.zh?.trim() || v.roomLabel?.en?.trim();
      const zh = room
        ? `${v.branchName?.zh?.trim() || ''} ${v.roomLabel?.zh?.trim() || room}`.trim()
        : (v.name?.zh?.trim() || v.id);
      const en = room
        ? `${v.branchName?.en?.trim() || v.branchName?.zh?.trim() || ''} ${v.roomLabel?.en?.trim() || room}`.trim()
        : (v.name?.en?.trim() || v.name?.zh?.trim() || v.id);
      return { key: v.id, name: { zh, en } };
    });
  const listed = new Set([...Array.from(legacy), ...added.map((s) => s.key)]);
  const orphaned = savedKeys
    .filter((key, i) => key !== 'sw' && !listed.has(key) && savedKeys.indexOf(key) === i)
    .map((key) => ({ key, name: { zh: key, en: key } }));
  return [...LEGACY_PEAK_SCOPES, ...added, ...orphaned];
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
