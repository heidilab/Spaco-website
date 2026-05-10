// Static business info per branch. Used by JSON-LD generators (LocalBusiness)
// and `llms.txt`. AI engines / search engines lean heavily on this metadata.

export interface BranchInfo {
  id: string;
  slug: string;
  /** SEO page id matching SEO_PAGES in `lib/seo.ts` */
  seoId: string;
  name: { zh: string; en: string };
  /** Street address only (no district / city / region). */
  streetAddress: { zh: string; en: string };
  /** District name in HK (e.g. 銅鑼灣 / Causeway Bay) */
  district: { zh: string; en: string };
  /** Lat/lng for LocalBusiness `geo`. */
  geo?: { lat: number; lng: number };
  /** Opening hours (Schema.org openingHoursSpecification). */
  openingHours: Array<{
    dayOfWeek: Array<'Monday'|'Tuesday'|'Wednesday'|'Thursday'|'Friday'|'Saturday'|'Sunday'>;
    opens: string;   // "11:00"
    closes: string;  // "23:00"
  }>;
}

// All branches operate 24/7 — Schema.org convention is to express a fully
// open day with opens 00:00 / closes 23:59 across all 7 days.
const ALWAYS_OPEN: BranchInfo['openingHours'] = [
  {
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: '00:00',
    closes: '23:59',
  },
];

export const BRANCH_INFO: BranchInfo[] = [
  {
    id: 'cwb',
    slug: 'causeway-bay',
    seoId: 'branch-cwb',
    name: { zh: '銅鑼灣旗艦店', en: 'Causeway Bay Flagship' },
    streetAddress: { zh: '銅鑼灣禮頓道 26 號', en: '26 Leighton Road, Causeway Bay' },
    district: { zh: '銅鑼灣', en: 'Causeway Bay' },
    openingHours: ALWAYS_OPEN,
  },
  {
    id: 'wanchai',
    slug: 'wan-chai',
    seoId: 'branch-wc',
    name: { zh: '灣仔商務空間', en: 'Wan Chai' },
    streetAddress: { zh: '灣仔吉安街 1 號', en: '1 Kut On Street, Wan Chai' },
    district: { zh: '灣仔', en: 'Wan Chai' },
    openingHours: ALWAYS_OPEN,
  },
  {
    id: 'sw',
    slug: 'sheung-wan',
    seoId: 'branch-sw',
    name: { zh: '上環海景旗艦店', en: 'Sheung Wan Harbour View' },
    streetAddress: { zh: '上環干諾道西 70-72 號', en: '70-72 Connaught Road West, Sheung Wan' },
    district: { zh: '上環', en: 'Sheung Wan' },
    openingHours: ALWAYS_OPEN,
  },
  {
    id: 'tst',
    slug: 'tsim-sha-tsui',
    seoId: 'branch-tst',
    name: { zh: '尖沙咀店', en: 'Tsim Sha Tsui' },
    streetAddress: { zh: '尖沙咀寶勒巷 22-24 號', en: '22-24 Prat Avenue, Tsim Sha Tsui' },
    district: { zh: '尖沙咀', en: 'Tsim Sha Tsui' },
    openingHours: ALWAYS_OPEN,
  },
];

export function branchInfoBySlug(slug: string): BranchInfo | undefined {
  // sw-a / sw-b / sw-ab variants all roll up to the 'sw' branch info
  const base = slug.startsWith('sheung-wan') ? 'sheung-wan' : slug;
  return BRANCH_INFO.find((b) => b.slug === base);
}
