/**
 * Pre-built event packages — fixed price, fixed scope, simplified booking.
 * Each package is bookable via /book/package/{slug}.
 */

export type PackageCategory = 'birthday' | 'mahjong' | 'corporate';

/** Optional per-person add-on (e.g. BBQ catering at +$138/head). */
export interface PackageAddOn {
  id: string;
  label: { zh: string; en: string };
  /** Short description shown next to the toggle */
  description?: { zh: string; en: string };
  /** Price per person, HK$ */
  pricePerPerson: number;
}

export interface EventPackage {
  slug: string;
  /** Category drives UI bits like the chip label and whether the booking
   *  flow shows the decoration-style picker (birthday only). */
  category: PackageCategory;
  /** Allowed venue ids (other branches won't appear). Single id for now. */
  venueId: string;
  name: { zh: string; en: string };
  shortDesc: { zh: string; en: string };
  /** Bullet list of inclusions */
  includes: { zh: string[]; en: string[] };
  /** Fixed package price (HK$) */
  price: number;
  /** Refundable deposit (HK$) */
  deposit: number;
  /** Fixed duration in hours — admin cannot change */
  durationHours: number;
  /** Allowed days of week (0 = Sun, 6 = Sat). Empty = all days. */
  allowedDaysOfWeek: number[];
  /** Earliest start time (24h "HH:mm") */
  earliestStart: string;
  /** Latest END time (booking must finish by this time) */
  latestEnd: string;
  /** Minimum advance days required (e.g. 5 = booking date must be ≥ today + 5). */
  minAdvanceDays?: number;
  /** Marketing copy for the family / corporate page card */
  pitch: { zh: string; en: string };
  /** Optional per-head add-ons (e.g. BBQ catering) — booking page renders
   *  a checkbox + headcount input for each. */
  addOns?: PackageAddOn[];
}

/** Localized chip label for a package category. */
export const CATEGORY_LABEL: Record<PackageCategory, { zh: string; en: string }> = {
  birthday:  { zh: '生日包場套餐', en: 'Birthday Package'  },
  mahjong:   { zh: '麻雀包場套餐', en: 'Mahjong Package'   },
  corporate: { zh: '企業包場套餐', en: 'Corporate Package' },
};

export const BIRTHDAY_CWB_PACKAGE: EventPackage = {
  slug: 'birthday-cwb',
  category: 'birthday',
  venueId: 'cwb',
  name: {
    zh: '銅鑼灣店生日包場 Package',
    en: 'Causeway Bay Birthday Package',
  },
  shortDesc: {
    zh: '$6,800 全包．3 小時專屬包場．不限人頭',
    en: '$6,800 all-in · 3-hour exclusive · unlimited guests',
  },
  includes: {
    zh: [
      '銅鑼灣店全場 3 小時包場',
      '基本氣球佈置',
      '無酒精飲品任飲',
      '不限人頭（場地容納上限為準）',
    ],
    en: [
      'Full venue exclusive (3 hours) at Causeway Bay',
      'Basic balloon decoration',
      'Unlimited non-alcoholic drinks',
      'Unlimited guests (within venue capacity)',
    ],
  },
  price: 6800,
  deposit: 2000,
  durationHours: 3,
  allowedDaysOfWeek: [0, 1, 2, 3, 4, 5, 6], // every day
  earliestStart: '08:00',
  latestEnd: '17:00',
  minAdvanceDays: 5,
  pitch: {
    zh: '$6,800 全包．3 小時專屬包場．不限人頭．無酒精飲品任飲．基本氣球佈置',
    en: '$6,800 flat · 3-hour exclusive · unlimited guests · drinks & balloons included',
  },
};

/**
 * Mahjong package — Wan Chai only, weekday (Sun–Thu) 8-hour exclusive
 * for a 4-person mahjong table. Flat $1,200 with non-alcoholic drinks
 * unlimited; works out to $300 per head.
 */
export const MAHJONG_WANCHAI_PACKAGE: EventPackage = {
  slug: 'mahjong-wanchai',
  category: 'mahjong',
  venueId: 'wanchai',
  name: {
    zh: '灣仔店麻雀四人局，血戰到底 Package',
    en: 'Wan Chai Mahjong Marathon Package',
  },
  shortDesc: {
    zh: '$1,200 平日 · 8 小時包場 · 4 人麻雀枱 · 無酒精飲品任飲',
    en: '$1,200 weekday · 8-hour exclusive · 4-player mahjong · unlimited soft drinks',
  },
  includes: {
    zh: [
      '灣仔店場地包場 8 小時',
      '4 人一枱（麻雀四人局）',
      '無酒精飲品任飲',
      '平日（星期日至四）適用',
    ],
    en: [
      'Wan Chai exclusive (8 hours)',
      '4 players, one mahjong table',
      'Unlimited non-alcoholic drinks',
      'Sun – Thu weekdays only',
    ],
  },
  price: 1200,
  deposit: 1000,
  durationHours: 8,
  // 0 = Sun, 4 = Thu — 平日（日至四）only
  allowedDaysOfWeek: [0, 1, 2, 3, 4],
  earliestStart: '08:00',
  latestEnd: '24:00',
  minAdvanceDays: 2,
  pitch: {
    zh: '$1,200 平日 8 小時包場．4 人麻雀枱．每位平均 $300．無酒精飲品任飲',
    en: '$1,200 weekday · 8-hour exclusive · 4-player mahjong · ~$300/head · drinks included',
  },
};

/**
 * Corporate Chill package — TST only, weekday (Mon–Thu) 5-hour exclusive
 * for team gatherings. Flat $4,800 with non-alcoholic drinks unlimited;
 * BBQ catering available as an add-on at +$138/person.
 */
export const CORPORATE_TST_PACKAGE: EventPackage = {
  slug: 'corporate-tst',
  category: 'corporate',
  venueId: 'tst',
  name: {
    zh: '尖沙咀店企業包場 Package',
    en: 'TST Corporate Chill Package',
  },
  shortDesc: {
    zh: '$4,800 平日 · 5 小時包場 · 無酒精飲品任飲 · 適合 12–50 人',
    en: '$4,800 weekday · 5-hour exclusive · drinks included · 12–50 guests',
  },
  includes: {
    zh: [
      '場地全包場（800呎室內複式 + 400呎私家露台）',
      '投影機使用',
      '無酒精飲品任飲',
      '麻雀 ×2',
      'Pool Table',
      '街機',
      'Sound System ×2',
      'Board Game',
      'Switch',
      'Poker Table',
    ],
    en: [
      'Full venue exclusive (800 sqft duplex + 400 sqft private terrace)',
      'Projector access',
      'Unlimited non-alcoholic drinks',
      '2× Mahjong tables',
      'Pool Table',
      'Arcade machines',
      '2× Sound System',
      'Board games',
      'Nintendo Switch',
      'Poker table',
    ],
  },
  price: 4800,
  deposit: 1000,
  durationHours: 5,
  // 1 = Mon, 4 = Thu — 平日（一至四）only
  allowedDaysOfWeek: [1, 2, 3, 4],
  earliestStart: '09:00',
  latestEnd: '17:00',
  minAdvanceDays: 3,
  pitch: {
    zh: '九龍核心，5 小時包場．無酒精飲品任飲．娛樂設施齊全．適合 12–50 人團隊聚會',
    en: 'Kowloon core, 5-hour exclusive · drinks included · full amenities · 12–50 guest team events',
  },
  addOns: [
    {
      id: 'bbq',
      label: { zh: 'BBQ 美食套餐', en: 'BBQ Catering' },
      description: {
        zh: '美食到會 +$138/位（按人數計）',
        en: 'Food catering +$138/person',
      },
      pricePerPerson: 138,
    },
  ],
};

export const ALL_PACKAGES: EventPackage[] = [
  BIRTHDAY_CWB_PACKAGE,
  MAHJONG_WANCHAI_PACKAGE,
  CORPORATE_TST_PACKAGE,
];

export function getPackageBySlug(slug: string): EventPackage | undefined {
  return ALL_PACKAGES.find((p) => p.slug === slug);
}

/** Packages bookable at a given venue (by venue.id). */
export function getPackagesByVenueId(venueId: string): EventPackage[] {
  return ALL_PACKAGES.filter((p) => p.venueId === venueId);
}
