// Which /branches/<slug> addresses have a page — shared by the client
// page (branches/[slug]/page.tsx) and its server layout, so the server can
// answer a real HTTP 404 for an unknown slug instead of serving a 200
// shell that only turns into "not found" after the browser loads venues.

import type { Venue } from '@/types';
import { getVenueBySlug } from './venues';

// Old Sheung Wan single-room URLs redirect (client-side) to the unified
// branch page, whose anchors (#sw-a, #sw-b, #sw-ab) keep deep links working.
export const SW_REDIRECT: Record<string, string> = {
  'sheung-wan-a':  '/branches/sheung-wan#sw-a',
  'sheung-wan-b':  '/branches/sheung-wan#sw-b',
  'sheung-wan-ab': '/branches/sheung-wan#sw-ab',
};

/** Slugs the server never needs the registry for: they are in the coded
 *  venue list (or redirect), so the page always has something to render
 *  first. A 落架 coded venue is still caught by the client page. */
export function isCodedBranchSlug(slug: string): boolean {
  return Object.hasOwn(SW_REDIRECT, slug) || !!getVenueBySlug(slug);
}

/** True when /branches/<slug> renders a page for this registry list —
 *  the same rules as branches/[slug]/page.tsx: a redirecting Sheung Wan
 *  slug, a multi-space branch key with 2+ live spaces, or a single venue
 *  (registry first, coded list as fallback) that is not 落架. */
export function branchPageExists(slug: string, registry: Venue[]): boolean {
  if (Object.hasOwn(SW_REDIRECT, slug)) return true;
  const slugIsVenue = registry.some((v) => v.slug === slug);
  const rooms = registry.filter((v) => v.branchKey === slug && v.active !== false && !slugIsVenue);
  if (rooms.length > 1) return true;
  const venue = registry.find((v) => v.slug === slug) ?? getVenueBySlug(slug);
  return !!venue && venue.active !== false;
}
