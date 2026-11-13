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
 * The pure part (`groupBranches`) lives in lib/branchGrouping so server
 * components can use it too; `useBranchDirectory` wraps it for components.
 */
'use client';

import { useEffect, useState } from 'react';
import { venues as staticVenues } from './venues';
import { groupBranches, type BranchEntry } from './branchGrouping';

export { groupBranches, type BranchEntry } from './branchGrouping';

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
