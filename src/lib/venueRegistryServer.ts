import { conflictIdsFor } from './venueConflicts';
// Server-side venue registry (Admin SDK) — mirror of venueRegistry.ts
// for API routes / RSC. Same fallback-to-static behaviour.

import { adminDb } from './firebaseAdmin';
import { Venue } from '@/types';
import { venues as staticVenues } from './venues';

let cache: Venue[] | null = null;
let cacheAt = 0;
const TTL_MS = 60 * 1000;

export async function loadAllVenuesServer(): Promise<Venue[]> {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const snap = await adminDb.collection('venues').get();
    if (!snap.empty) {
      const list = snap.docs.map((d) => ({ ...(d.data() as Venue), id: d.id }));
      list.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.id.localeCompare(b.id));
      cache = list;
      cacheAt = Date.now();
      return list;
    }
  } catch (err) {
    console.warn('[venueRegistryServer] load failed, using static venues:', err);
  }
  return staticVenues.map((v) => ({ ...v, active: true }));
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
