// Which branches the CS 獎金 (sales bonus) page and its daily alert cron
// cover, and which branch a booking's sales belong to — PURE module, no
// firebase, shared by the page and the cron so they can never disagree.
//
// The page and the cron used to hard-code the original four branches, so
// a branch added in 分店管理 (尖沙咀 HART, 2026-10) had no card, no target
// settings and no alerts, and its sales were counted nowhere. Branches now
// come from the venue registry:
//   • the original four keep their existing keys (cwb / sw / tst / wanchai)
//     so saved targets in system/bonus_config and the bonus_alerts dedupe
//     docs keep matching;
//   • every other venue rolls up to its 分店管理 branchKey, so the rooms of
//     a multi-room branch (HART Room A / B / A+B) count as ONE branch.

import type { Venue } from '@/types';

type RegistryVenue = Pick<Venue, 'id' | 'name' | 'active' | 'sortOrder' | 'branchKey' | 'branchName'>;

export interface SalesBranch {
  /** Key used in system/bonus_config.branches and bonus_alerts doc ids. */
  key: string;
  name: { zh: string; en: string };
}

/** The original four, in their long-standing display order. */
const LEGACY_BRANCHES: SalesBranch[] = [
  { key: 'cwb',     name: { zh: '銅鑼灣店', en: 'Causeway Bay' } },
  { key: 'sw',      name: { zh: '上環店',   en: 'Sheung Wan' } },
  { key: 'tst',     name: { zh: '尖沙咀店', en: 'Tsim Sha Tsui' } },
  { key: 'wanchai', name: { zh: '灣仔店',   en: 'Wan Chai' } },
];
const LEGACY_KEYS = new Set(LEGACY_BRANCHES.map((b) => b.key));

/** The branch a venue's sales count toward. */
export function salesBranchKey(venueId: string, venues: readonly RegistryVenue[]): string {
  // 上環 Room A / B / 全層 are one branch (same rule as finance.branchKey).
  if (venueId.startsWith('sw-')) return 'sw';
  if (LEGACY_KEYS.has(venueId)) return venueId;
  return venues.find((v) => v.id === venueId)?.branchKey || venueId;
}

/**
 * Branches to show, in order: the original four, then every other branch
 * in the registry that has an active (上架) space, by its 分店管理 sort
 * order. A branch that already has saved targets (`configuredKeys`) stays
 * listed even if it was later taken offline or removed, so its settings
 * and history never silently vanish.
 */
export function salesBranches(venues: readonly RegistryVenue[], configuredKeys: readonly string[] = []): SalesBranch[] {
  const configured = new Set(configuredKeys);
  const extra = new Map<string, RegistryVenue[]>();
  for (const v of venues) {
    const key = salesBranchKey(v.id, venues);
    if (LEGACY_KEYS.has(key)) continue;
    extra.set(key, [...(extra.get(key) || []), v]);
  }
  const added = Array.from(extra.entries())
    .filter(([key, rooms]) => configured.has(key) || rooms.some((r) => r.active !== false))
    .map(([key, rooms]) => {
      const sorted = [...rooms].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.id.localeCompare(b.id));
      const first = sorted[0];
      return {
        key,
        sortOrder: first.sortOrder ?? 99,
        name: {
          zh: (first.branchName?.zh || first.name?.zh || key).trim(),
          en: (first.branchName?.en || first.name?.en || first.branchName?.zh || key).trim(),
        },
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map(({ key, name }) => ({ key, name }));
  const listed = new Set([...Array.from(LEGACY_KEYS), ...added.map((b) => b.key)]);
  // Saved targets for a branch no longer in the registry: keep the row.
  const orphaned = configuredKeys
    .filter((key) => !listed.has(key))
    .map((key) => ({ key, name: { zh: key, en: key } }));
  return [...LEGACY_BRANCHES, ...added, ...orphaned];
}
