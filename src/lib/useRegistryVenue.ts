'use client';

// Venue lookup for customer pages that used the static `getVenueById`
// (src/lib/venues.ts) and therefore knew nothing about spaces created in
// 分店管理 (HART rooms): the name fell back to the slug and repricing was
// skipped. Registry snapshot first, static array as fallback; the hook
// re-renders once the registry has loaded.

import { useEffect, useState } from 'react';
import type { Venue } from '@/types';
import { getVenueById } from './venues';
import { loadAllVenues, venuesSnapshot } from './venueRegistry';

/** Synchronous, registry-first lookup — safe inside event handlers once
 *  `useVenueRegistryReady()` / `useRegistryVenue()` has run on the page. */
export function findVenueNow(venueId: string | undefined | null): Venue | undefined {
  if (!venueId) return undefined;
  return venuesSnapshot().find((v) => v.id === venueId) ?? getVenueById(venueId);
}

/** Triggers the registry load and re-renders the caller when it lands. */
export function useVenueRegistryReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let on = true;
    loadAllVenues().catch(() => {}).finally(() => { if (on) setReady(true); });
    return () => { on = false; };
  }, []);
  return ready;
}

export function useRegistryVenue(venueId: string | undefined | null): Venue | undefined {
  useVenueRegistryReady();
  return findVenueNow(venueId);
}
