/**
 * District landing pages for ads (Heidi 2026-11-13): one page per district
 * listing the branches there — main photo, name, size, capacity, a short
 * intro — each linking to the branch's own page. Not in the site menu;
 * it is where a Google Ads keyword for the district lands
 * (/tsim-sha-tsui-party-room for 「尖沙咀 party room」).
 *
 * Pure: turns the venue registry into the cards the page shows. A branch
 * added or renamed in 分店管理 appears / updates without a code change.
 */
import type { Venue } from '@/types';
import { groupBranches } from './branchGrouping';
import { isCombinedRoom, orderRooms, roomLabel } from './roomOrder';

export interface DistrictDef {
  /** Path segment after the locale, e.g. 'tsim-sha-tsui-party-room'. */
  path: string;
  /** SEO page id (SEO 管理 can override title / description). */
  seoId: string;
  name: { zh: string; en: string };
  /** A branch belongs to the district when its name or address matches. */
  match: RegExp;
}

export const DISTRICTS: Record<'tst', DistrictDef> = {
  tst: {
    path: 'tsim-sha-tsui-party-room',
    seoId: 'landing-tst',
    name: { zh: '尖沙咀', en: 'Tsim Sha Tsui' },
    match: /尖沙咀|tsim\s*sha\s*tsui|\bTST\b/i,
  },
};

export interface DistrictBranchCard {
  key: string;
  /** /branches/<slug> */
  slug: string;
  name: { zh: string; en: string };
  /** Main photo: the first photo of the branch page (venue photo #1 in
   *  分店管理); for a multi-room branch, of its first room that has one. */
  image: string | null;
  /** Size text as entered in 分店管理 — of the whole floor for a
   *  multi-room branch. Empty when not filled in. */
  size: string;
  /** Smallest minimum to largest maximum across the branch's spaces. */
  capacity: { min: number; max: number };
  /** Short intro: the venue's 簡介; '' when none is filled in (the page
   *  then describes the room options instead). */
  intro: { zh: string; en: string };
  address: { zh: string; en: string };
  /** Spaces of a multi-room branch, in display order ([] for one space). */
  rooms: Array<{ label: { zh: string; en: string }; capacity: { min: number; max: number }; combined: boolean }>;
}

const text = (v?: { zh?: string; en?: string }) => `${v?.zh || ''} ${v?.en || ''}`;

/** The branches of a district, in the site's branch order. */
export function districtBranchCards(venues: Venue[], district: DistrictDef): DistrictBranchCard[] {
  return groupBranches(venues)
    .filter((b) => b.rooms.some((r) =>
      district.match.test(text(b.name)) || district.match.test(text(r.branchName))
      || district.match.test(text(r.name)) || district.match.test(text(r.address))))
    .map((b) => {
      const rooms = orderRooms(b.rooms);
      const multi = rooms.length > 1;
      // The space that stands for the whole branch: the biggest one.
      const biggest = [...rooms].sort((a, c) => c.capacity.max - a.capacity.max)[0];
      const withIntro = (loc: 'zh' | 'en') =>
        (biggest.description?.[loc] || rooms.map((r) => r.description?.[loc]).find((d) => !!d && d.trim() !== '') || '').trim();
      const first = rooms[0];
      return {
        key: b.key,
        slug: b.slug,
        name: b.name,
        image: rooms.map((r) => r.images?.[0]).find((u): u is string => typeof u === 'string' && /^https?:/.test(u)) || null,
        size: (biggest.size || rooms.map((r) => r.size).find((s) => !!s) || '').trim(),
        capacity: {
          min: Math.min(...rooms.map((r) => r.capacity.min)),
          max: Math.max(...rooms.map((r) => r.capacity.max)),
        },
        intro: { zh: withIntro('zh'), en: withIntro('en') },
        address: { zh: (first.address?.zh || '').trim(), en: (first.address?.en || first.address?.zh || '').trim() },
        rooms: multi
          ? rooms.map((r) => ({
            label: { zh: roomLabel(r, 'zh'), en: roomLabel(r, 'en') },
            capacity: { min: r.capacity.min, max: r.capacity.max },
            combined: isCombinedRoom(r),
          }))
          : [],
      };
    });
}
