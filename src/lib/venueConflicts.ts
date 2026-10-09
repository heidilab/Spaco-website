import { Venue } from '@/types';
import { VENUE_CONFLICTS as STATIC_CONFLICTS } from './venues';

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
        && me.conflictsWith === undefined && v.conflictsWith === undefined) {
        out.add(v.id);
      }
    }
  }
  return Array.from(out);
}

