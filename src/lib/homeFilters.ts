// Home-page 篩選 on the venues' OWN attributes (site review 2026-11-13,
// phase 4e). The filter used to be three hand-kept id lists in
// lib/venues.ts that only knew the original six spaces; a branch added in
// 分店管理 was shown in every filter state. Every venue — static or from
// the registry — carries capacity, vibes and amenities, so the filter
// reads those. PURE module.

import type { FilterState, Venue } from '@/types';

/** '6-10' → [6, 10]; the top bucket is open-ended. */
export function capacityRange(option: string): [number, number] | null {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(option.trim());
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (!(lo >= 0) || !(hi >= lo)) return null;
  return [lo, hi >= 100 ? Infinity : hi];
}

/** Does this venue satisfy every active filter? */
export function venueMatchesFilters(venue: Venue, filters: FilterState): boolean {
  if (filters.capacity) {
    const range = capacityRange(filters.capacity);
    if (range) {
      const [lo, hi] = range;
      // The group size the customer has in mind must fit the room: the
      // room takes at least `lo` people (its max ≥ lo) and its minimum
      // does not exceed the group (its min ≤ hi).
      if (!((venue.capacity?.max ?? 0) >= lo && (venue.capacity?.min ?? 0) <= hi)) return false;
    }
  }
  if (filters.vibe && !(venue.vibes || []).includes(filters.vibe)) return false;
  for (const a of filters.amenities || []) {
    if (!(venue.amenities || []).includes(a)) return false;
  }
  return true;
}

export function hasActiveFilter(filters: FilterState): boolean {
  return !!(filters.capacity || filters.vibe || (filters.amenities && filters.amenities.length > 0));
}

/** The venues that match; all of them when nothing is filtered. */
export function filterVenueList(venues: Venue[], filters: FilterState): Venue[] {
  if (!hasActiveFilter(filters)) return venues;
  return venues.filter((v) => venueMatchesFilters(v, filters));
}

export interface FallbackSuggestion {
  type: 'upsell' | 'alternative';
  message: { zh: string; en: string };
  venues: Venue[];
}

/** One venue per branch, in display order. */
function onePerBranch(venues: Venue[]): Venue[] {
  const seen = new Set<string>();
  return [...venues]
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
    .filter((v) => {
      const key = v.branchKey || v.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** What to show when nothing matches: the closest venues from the list
 *  itself, not a fixed set of ids. */
export function fallbackSuggestions(filters: FilterState, venues: Venue[]): FallbackSuggestion[] {
  const live = venues.filter((v) => v.active !== false);
  const out: FallbackSuggestion[] = [];
  const range = filters.capacity ? capacityRange(filters.capacity) : null;

  // A private kitchen is a feature of a few larger rooms: offer them even
  // though they ask for more people, and the rooms that fit the group.
  if (filters.amenities.includes('private-kitchen') && range && range[1] <= 10) {
    const kitchens = live.filter((v) => (v.amenities || []).includes('private-kitchen'));
    if (kitchens.length > 0) {
      out.push({
        type: 'upsell',
        message: {
          zh: `獨立廚房只限${kitchens.map((v) => v.name.zh).join('／')}提供，設有最低人數要求（${Math.min(...kitchens.map((v) => v.capacity.min))} 人起）。你仍可選擇包場獨享。`,
          en: `A private kitchen is only in ${kitchens.map((v) => v.name.en).join(' / ')}, with a minimum of ${Math.min(...kitchens.map((v) => v.capacity.min))} guests. You can still book the whole space.`,
        },
        venues: kitchens,
      });
    }
    const small = onePerBranch(live.filter((v) => v.capacity.min <= range[1] && !(v.amenities || []).includes('private-kitchen'))).slice(0, 3);
    if (small.length > 0) {
      out.push({
        type: 'alternative',
        message: {
          zh: `若需符合 ${filters.capacity} 人預算，推薦以下空間，歡迎自攜外賣到會或加購 BBQ。`,
          en: `For a ${filters.capacity} person budget, we recommend these spaces. Catering delivery or a BBQ add-on is available.`,
        },
        venues: small,
      });
    }
  }

  if (out.length === 0) {
    // Drop the filters one at a time, keeping the venues that satisfy most.
    const scored = live.map((v) => {
      let score = 0;
      if (filters.capacity && venueMatchesFilters(v, { capacity: filters.capacity, vibe: null, amenities: [] })) score += 2;
      if (filters.vibe && venueMatchesFilters(v, { capacity: null, vibe: filters.vibe, amenities: [] })) score += 1;
      for (const a of filters.amenities) if ((v.amenities || []).includes(a)) score += 1;
      return { v, score };
    });
    scored.sort((a, b) => b.score - a.score || (a.v.sortOrder ?? 99) - (b.v.sortOrder ?? 99));
    out.push({
      type: 'alternative',
      message: {
        zh: '未能完全匹配您的篩選條件。以下為最接近的推薦空間，歡迎查看詳情或聯絡我們訂製方案。',
        en: 'No exact match for your filters. Here are our closest recommendations — feel free to explore or contact us for a custom arrangement.',
      },
      venues: onePerBranch(scored.map((s) => s.v)).slice(0, 3),
    });
  }
  return out;
}
