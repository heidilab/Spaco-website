/**
 * Branch directory for public navigation (header dropdown, 分店導覽 grid,
 * hero counters). Derived from the venue registry so a branch added in
 * 分店管理 appears everywhere at once — the static list of four stayed
 * hard-coded in several components (HART added 2026-10-24 was invisible).
 *
 * Grouping rule: venues sharing a `branchKey` are one branch (上環模式).
 * A branch's public page is /branches/<slug>:
 *   - single-space branch → the venue's own slug (causeway-bay, wan-chai…)
 *   - multi-space branch  → the branchKey (sheung-wan has its custom page,
 *     every other key renders the generic MultiRoomBranch page).
 * Inactive (落架) venues never appear; a branch whose spaces are all
 * inactive disappears.
 *
 * The pure part is tested; `useBranchDirectory` wraps it for components.
 */
'use client';

import { useEffect, useState } from 'react';
import type { Venue } from '@/types';
import { venues as staticVenues } from './venues';

export interface BranchEntry {
  /** Stable key: branchKey when set, otherwise the venue id. */
  key: string;
  /** Path segment under /branches/. */
  slug: string;
  name: { zh: string; en: string };
  rooms: Venue[];
  sortOrder: number;
  coverImage?: string;
}

/** Legacy ids → the branchKey used by the Sheung Wan rooms before
 *  registry migration. Keeps the static fallback grouping identical. */
const STATIC_BRANCH_KEY: Record<string, string> = { 'sw-a': 'sheung-wan', 'sw-b': 'sheung-wan', 'sw-ab': 'sheung-wan' };

export function groupBranches(venues: Venue[]): BranchEntry[] {
  const byKey = new Map<string, Venue[]>();
  for (const v of venues) {
    if (v.active === false) continue;
    const key = v.branchKey || STATIC_BRANCH_KEY[v.id] || v.id;
    byKey.set(key, [...(byKey.get(key) || []), v]);
  }
  const out: BranchEntry[] = [];
  for (const [key, rooms] of Array.from(byKey.entries())) {
    rooms.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.id.localeCompare(b.id));
    const first = rooms[0];
    // One space = one page at the venue's own slug (keeps /branches/causeway-bay
    // etc. stable even though registry docs carry branchKey === id).
    const single = rooms.length === 1;
    const legacyName = key === 'sheung-wan' ? { zh: '上環海景旗艦店', en: 'Sheung Wan Flagship' } : undefined;
    const nameZh = (first.branchName?.zh || legacyName?.zh || first.name.zh).trim();
    const nameEn = (first.branchName?.en || legacyName?.en || first.name.en).trim();
    out.push({
      key,
      slug: single ? first.slug : key,
      name: { zh: nameZh, en: nameEn },
      rooms,
      sortOrder: Math.min(...rooms.map((r) => r.sortOrder ?? 99)),
      coverImage: rooms.map((r) => r.images?.[0]).find((u) => typeof u === 'string' && /^https?:/.test(u)),
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

/** Static directory used before the registry has loaded. */
export const STATIC_BRANCHES: BranchEntry[] = groupBranches(staticVenues.map((v) => ({ ...v, active: true })));

/** Live directory: static four on first paint, registry once loaded. */
export function useBranchDirectory(): { branches: BranchEntry[]; loaded: boolean } {
  const [branches, setBranches] = useState<BranchEntry[]>(STATIC_BRANCHES);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    import('./venueRegistry')
      .then(({ loadActiveVenues }) => loadActiveVenues())
      .then((list) => { if (active && list.length) setBranches(groupBranches(list)); })
      .catch(() => { /* keep the static directory */ })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  return { branches, loaded };
}
