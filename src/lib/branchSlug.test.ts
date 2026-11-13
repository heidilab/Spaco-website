// Server-side 404 for /branches/<slug> must agree with what the client
// page renders — a wrong "missing" here would hide a live venue page.

import { describe, expect, it } from 'vitest';
import { branchPageExists, isCodedBranchSlug, SW_REDIRECT } from './branchSlug';
import { venues as staticVenues } from './venues';
import type { Venue } from '@/types';

const room = (over: Partial<Venue> & Pick<Venue, 'id' | 'slug'>): Venue => ({
  name: { zh: over.id, en: over.id }, subtitle: { zh: '', en: '' }, description: { zh: '', en: '' },
  address: { zh: '', en: '' }, branch: '', capacity: { min: 6, max: 40 }, size: '', vibes: [], amenities: [],
  images: [], pricing: { weekday: { perHead: 50 }, weekend: { perHead: 58 } },
  minHours: { weekday: 4, weekend: 4 }, minGuests: { weekday: 6, weekend: 8 }, ...over,
});

const registry: Venue[] = [
  ...staticVenues.map((v) => ({ ...v, active: true })),
  room({ id: 'hart-a', slug: 'hart-a', branchKey: 'tsthart', active: true }),
  room({ id: 'hart-b', slug: 'hart-b', branchKey: 'tsthart', active: true }),
  room({ id: 'hart-ab', slug: 'hart-ab', branchKey: 'tsthart', active: false }),
  room({ id: 'kt', slug: 'kwun-tong', branchKey: 'kt', active: true }),
  room({ id: 'draft', slug: 'draft-venue', branchKey: 'draft', active: false }),
  room({ id: 'solo-a', slug: 'solo-a', branchKey: 'solo', active: true }),
  room({ id: 'solo-b', slug: 'solo-b', branchKey: 'solo', active: false }),
];

describe('branchPageExists', () => {
  it('unknown slug has no page', () => {
    expect(branchPageExists('does-not-exist', registry)).toBe(false);
    expect(branchPageExists('', registry)).toBe(false);
  });
  it('every coded venue and every live registry venue has a page', () => {
    for (const v of staticVenues) expect(branchPageExists(v.slug, registry)).toBe(true);
    expect(branchPageExists('kwun-tong', registry)).toBe(true);
    expect(branchPageExists('hart-a', registry)).toBe(true);
  });
  it('a multi-space branch key with 2+ live spaces has a page', () => {
    expect(branchPageExists('tsthart', registry)).toBe(true);
  });
  it('a branch key with fewer than 2 live spaces has no page of its own', () => {
    expect(branchPageExists('solo', registry)).toBe(false);
    expect(branchPageExists('draft', registry)).toBe(false);
  });
  it('a 落架 venue has no page', () => {
    expect(branchPageExists('draft-venue', registry)).toBe(false);
    expect(branchPageExists('hart-ab', registry)).toBe(false);
    const cwbOff = registry.map((v) => (v.slug === 'causeway-bay' ? { ...v, active: false } : v));
    expect(branchPageExists('causeway-bay', cwbOff)).toBe(false);
  });
  it('old Sheung Wan room slugs always resolve (they redirect), even if 落架 in the registry', () => {
    const swOff = registry.map((v) => (v.slug in SW_REDIRECT ? { ...v, active: false } : v));
    for (const slug of Object.keys(SW_REDIRECT)) expect(branchPageExists(slug, swOff)).toBe(true);
  });
  it('a coded venue missing from the registry still has its page (coded fallback)', () => {
    expect(branchPageExists('wan-chai', registry.filter((v) => v.slug !== 'wan-chai'))).toBe(true);
  });
});

describe('isCodedBranchSlug', () => {
  it('is true only for coded venues and redirecting slugs', () => {
    for (const v of staticVenues) expect(isCodedBranchSlug(v.slug)).toBe(true);
    expect(isCodedBranchSlug('kwun-tong')).toBe(false);
    expect(isCodedBranchSlug('tsthart')).toBe(false);
    expect(isCodedBranchSlug('does-not-exist')).toBe(false);
    expect(isCodedBranchSlug('toString')).toBe(false);
  });
});
