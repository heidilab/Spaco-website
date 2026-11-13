import { conflictIdsFor } from './venueConflicts';
// Server-side venue registry (Admin SDK) — mirror of venueRegistry.ts
// for API routes / RSC. Same fallback-to-static behaviour.

import { adminDb } from './firebaseAdmin';
import { Venue } from '@/types';
import { venues as staticVenues } from './venues';

let cache: Venue[] | null = null;
let cacheAt = 0;
const TTL_MS = 60 * 1000;

/** Registry read that also says where the list came from. `fromFirestore`
 *  is false when Firestore was unreachable or empty and the coded venue
 *  list was returned instead — callers that must not act on a guess (a
 *  server-side 404, say) check it. `maxAgeMs` tightens the 60s cache for
 *  one call, e.g. to confirm a miss against a venue that was just 上架. */
export async function loadVenueRegistryServer(
  opts: { maxAgeMs?: number } = {},
): Promise<{ venues: Venue[]; fromFirestore: boolean }> {
  const maxAge = Math.min(opts.maxAgeMs ?? TTL_MS, TTL_MS);
  if (cache && Date.now() - cacheAt < maxAge) return { venues: cache, fromFirestore: true };
  try {
    const snap = await adminDb.collection('venues').get();
    if (!snap.empty) {
      const list = snap.docs.map((d) => ({ ...(d.data() as Venue), id: d.id }));
      list.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.id.localeCompare(b.id));
      cache = list;
      cacheAt = Date.now();
      return { venues: list, fromFirestore: true };
    }
  } catch (err) {
    console.warn('[venueRegistryServer] load failed, using static venues:', err);
  }
  return { venues: staticVenues.map((v) => ({ ...v, active: true })), fromFirestore: false };
}

export async function loadAllVenuesServer(): Promise<Venue[]> {
  return (await loadVenueRegistryServer()).venues;
}

export async function loadActiveVenuesServer(): Promise<Venue[]> {
  return (await loadAllVenuesServer()).filter((v) => v.active !== false);
}

export async function getVenueByIdServer(id: string): Promise<Venue | undefined> {
  return (await loadAllVenuesServer()).find((v) => v.id === id);
}

export async function getVenueBySlugServer(slug: string): Promise<Venue | undefined> {
  return (await loadAllVenuesServer()).find((v) => v.slug === slug);
}

/** Dynamic venuesSharingSpace — same semantics as venueRegistry.ts. */
export async function venuesSharingSpaceServer(venueId: string): Promise<string[]> {
  const all = await loadAllVenuesServer();
  return conflictIdsFor(venueId, all);
}
