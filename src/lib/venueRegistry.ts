// Dynamic venue registry — venues live in the Firestore `venues`
// collection (admin-managed via /admin/venues 分店管理) with the
// hard-coded src/lib/venues.ts array as seed + emergency fallback.
//
// CLIENT SIDE (this module): loads once per page-load and caches.
// SERVER SIDE: use venueRegistryServer.ts (Admin SDK).
//
// Phase-1 note: existing code that imports the static `venues` array
// keeps working — the registry sits alongside it and call sites are
// migrated surface-by-surface (Phase 2/3 of the 分店管理 project).

import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { Venue } from '@/types';
import { venues as staticVenues, VENUE_CONFLICTS as STATIC_CONFLICTS } from './venues';

let cache: Venue[] | null = null;
let cacheAt = 0;
const TTL_MS = 60 * 1000;

/** All venues (incl. 落架 ones — filter with .active for public UI).
 *  Sorted by sortOrder then name. Falls back to the static array if
 *  Firestore is unreachable or the collection is empty (pre-seed). */
export async function loadAllVenues(): Promise<Venue[]> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const snap = await getDocs(collection(db, 'venues'));
    if (!snap.empty) {
      const list = snap.docs.map((d) => ({ ...(d.data() as Venue), id: d.id }));
      list.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.id.localeCompare(b.id));
      cache = list;
      cacheAt = Date.now();
      return list;
    }
  } catch (err) {
    console.warn('[venueRegistry] Firestore load failed, using static venues:', err);
  }
  return staticVenues.map((v) => ({ ...v, active: true }));
}

/** Public (上架) venues only. */
export async function loadActiveVenues(): Promise<Venue[]> {
  const all = await loadAllVenues();
  return all.filter((v) => v.active !== false);
}

export function invalidateVenueCache(): void {
  cache = null;
}

/** Shared-space conflict ids for a venue list — dynamic replacement for
 *  the hard-coded VENUE_CONFLICTS map. A venue always conflicts with
 *  itself; extra ids come from conflictsWith, plus any venue in the
 *  same spaceGroup that lists it back. */
export function conflictIdsFor(venueId: string, all: Venue[]): string[] {
  const me = all.find((v) => v.id === venueId);
  if (!me) return STATIC_CONFLICTS[venueId] || [venueId];
  const out = new Set<string>([venueId]);
  for (const c of me.conflictsWith || []) out.add(c);
  // Reverse direction: any venue that says it conflicts with me.
  for (const v of all) {
    if (v.id !== venueId && (v.conflictsWith || []).includes(venueId)) out.add(v.id);
  }
  // Same non-empty spaceGroup without explicit lists = all mutually block.
  if (me.spaceGroup) {
    for (const v of all) {
      if (v.id !== venueId && v.spaceGroup === me.spaceGroup
        && !(me.conflictsWith?.length) && !(v.conflictsWith?.length)) {
        out.add(v.id);
      }
    }
  }
  return Array.from(out);
}

/** Default field values applied when creating a venue in 分店管理. */
export function emptyVenue(): Venue {
  return {
    id: '',
    slug: '',
    name: { zh: '', en: '' },
    subtitle: { zh: '', en: '' },
    description: { zh: '', en: '' },
    address: { zh: '', en: '' },
    branch: '',
    capacity: { min: 6, max: 40 },
    size: '',
    vibes: [],
    amenities: [],
    images: [],
    pricing: { weekday: { perHead: 50 }, weekend: { perHead: 58 } },
    minHours: { weekday: 4, weekend: 4 },
    minGuests: { weekday: 6, weekend: 8 },
    active: false,          // new venues start 落架 until Heidi flips them on
    sortOrder: 99,
    bbqAvailable: true,
    drinksIncluded: false,
    earlySetupPricePerHour: 500,
  };
}
