// Server-side venue registry (Admin SDK) — mirror of venueRegistry.ts
// for API routes / RSC. Same fallback-to-static behaviour.

import { adminDb } from './firebaseAdmin';
import { Venue } from '@/types';
import { venues as staticVenues, VENUE_CONFLICTS as STATIC_CONFLICTS } from './venues';

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
  const me = all.find((v) => v.id === venueId);
  if (!me) return STATIC_CONFLICTS[venueId] || [venueId];
  const out = new Set<string>([venueId]);
  for (const c of me.conflictsWith || []) out.add(c);
  for (const v of all) {
    if (v.id !== venueId && (v.conflictsWith || []).includes(venueId)) out.add(v.id);
  }
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
