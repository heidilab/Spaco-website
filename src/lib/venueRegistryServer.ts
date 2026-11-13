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

/**
 * The venue every server-side email, calendar title and passcode should
 * name: 分店管理 first, the built-in list only as a fallback. Before
 * 2026-11-13 these read the built-in list alone, so a branch added in
 * 分店管理 showed up in customer emails as its id with no address (site
 * review, phase 2).
 */
export async function resolveVenueServer(id: string | undefined | null): Promise<Venue | undefined> {
  if (!id) return undefined;
  return (await getVenueByIdServer(id)) ?? staticVenues.find((v) => v.id === id);
}

/** 「尖沙咀 HART 店 Room B」-style label for staff surfaces: the branch's
 *  short tag plus the room label of a multi-room branch. */
export function venueStaffLabel(venue: Venue | undefined, venueId: string, lang: 'zh' | 'en' = 'en'): string {
  if (!venue) return venueId;
  const room = venue.roomLabel?.[lang] || venue.roomLabel?.zh;
  const base = venue.branch || venue.branchName?.[lang] || venue.name[lang] || venue.name.zh;
  return room ? `[${room}] ${base}` : base;
}

export async function getVenueBySlugServer(slug: string): Promise<Venue | undefined> {
  return (await loadAllVenuesServer()).find((v) => v.slug === slug);
}

/** Dynamic venuesSharingSpace — same semantics as venueRegistry.ts. */
export async function venuesSharingSpaceServer(venueId: string): Promise<string[]> {
  const all = await loadAllVenuesServer();
  return conflictIdsFor(venueId, all);
}
