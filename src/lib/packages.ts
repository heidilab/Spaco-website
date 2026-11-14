/**
 * Pre-built event packages — fixed price, fixed scope, simplified booking.
 * Each package is bookable via /book/package/{slug}.
 *
 * Since the site review (2026-11-13, phase 4c) the packages are DATA:
 * staff edit them in 套餐管理 (/admin/packages), stored in
 * `site_content/packages` { items: EventPackage[] }. The coded list below
 * is the seed and the fallback while nothing is saved. Everything reads
 * through allPackages() / getPackageBySlug() / getPackagesByVenueId() /
 * getPackagesByCategory(), which follow the saved list once a loader
 * (lib/packageRegistryClient in the browser, lib/packageRegistryServer in
 * API routes) has activated it with setPackageRegistry().
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
  /** Short branch name for the 揀分店 switcher / family page buttons when
   *  the same package runs at several branches. */
  branchLabel?: { zh: string; en: string };
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
  /** Latest END time (booking must finish by this time, 24h "HH:mm").
   *  Omit for 24-hour venues (e.g. the Wan Chai mahjong package) — the
   *  customer can start at any quarter-hour and the session is allowed
   *  to roll over into the next day. */
  latestEnd?: string;
  /** Minimum advance days required (e.g. 5 = booking date must be ≥ today + 5). */
  minAdvanceDays?: number;
  /** Marketing copy for the family / corporate page card */
  pitch: { zh: string; en: string };
  /** Optional per-head add-ons (e.g. BBQ catering) — booking page renders
   *  a checkbox + headcount input for each. */
  addOns?: PackageAddOn[];
  /** Number of guests included in the base package price. Optional —
   *  packages without a per-head rule leave this unset. */
  basePax?: number;
  /** HK$ surcharge per guest beyond `basePax`. Pairs with `basePax`. */
  extraPaxPrice?: number;
  /** false = 停售: not offered to customers or in the staff form; a
   *  booking that already carries the slug still resolves it. */
  active?: boolean;
  /** Display order in lists (lower first). */
  sortOrder?: number;
}

export const PACKAGE_CATEGORIES: PackageCategory[] = ['birthday', 'mahjong', 'corporate'];

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
  branchLabel: { zh: '銅鑼灣店', en: 'Causeway Bay' },
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
 * Same $6,800 birthday package at the TST HART branch — the whole floor
 * (Hart Room A+B, registry id `hart-ab`) for 3 hours. Heidi 2026-10-24:
 * 「呢間新分店係同銅鑼灣一樣，會做 HK$6,800 生日包場 package」. Hours and
 * notice period copied from CWB until Heidi says otherwise.
 */
export const BIRTHDAY_HART_PACKAGE: EventPackage = {
  ...BIRTHDAY_CWB_PACKAGE,
  slug: 'birthday-hart',
  venueId: 'hart-ab',
  branchLabel: { zh: '尖沙咀 HART', en: 'TST HART' },
  name: {
    zh: '尖沙咀 HART 生日包場 Package',
    en: 'TST HART Birthday Package',
  },
  includes: {
    zh: [
      '尖沙咀 HART 店全場（Room A+B）3 小時包場',
      '基本氣球佈置',
      '無酒精飲品任飲',
      '不限人頭（場地容納上限為準）',
    ],
    en: [
      'Full venue exclusive (Room A+B, 3 hours) at TST HART',
      'Basic balloon decoration',
      'Unlimited non-alcoholic drinks',
      'Unlimited guests (within venue capacity)',
    ],
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
  earliestStart: '00:00',
  // No latestEnd — Wan Chai is 24-hour, so start anytime and let the
  // 8-hour session roll over to the next day if needed.
  minAdvanceDays: 2,
  // Default 4 guests included; each extra guest +$300 ("每位 $300").
  basePax: 4,
  extraPaxPrice: 300,
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
  deposit: 2000,
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
  BIRTHDAY_HART_PACKAGE,
  MAHJONG_WANCHAI_PACKAGE,
  CORPORATE_TST_PACKAGE,
];

// ── the package registry (套餐管理) ──

let active: EventPackage[] | null = null;
let loaded = false;
let version = 0;

/** Activate the saved packages (null = nothing saved → the coded list). */
export function setPackageRegistry(list: EventPackage[] | null): void {
  active = list;
  loaded = true;
  version++;
}
export function packageRegistryVersion(): number { return version; }
export function packageRegistryLoaded(): boolean { return loaded; }

/** Every package, saved or coded, 停售 ones included, in display order. */
export function allPackages(): EventPackage[] {
  return [...(active ?? ALL_PACKAGES)].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
}

/** Packages on sale. */
export function activePackages(): EventPackage[] {
  return allPackages().filter((p) => p.active !== false);
}

/** One package by slug — 停售 ones too, so old bookings still read. */
export function getPackageBySlug(slug: string): EventPackage | undefined {
  return allPackages().find((p) => p.slug === slug);
}

/** Packages on sale at a given venue (by venue.id). */
export function getPackagesByVenueId(venueId: string): EventPackage[] {
  return activePackages().filter((p) => p.venueId === venueId);
}

/** Sibling packages of one category on sale (e.g. the birthday package at
 *  every branch that runs it) — drives the 揀分店 switcher on the package page. */
export function getPackagesByCategory(category: PackageCategory): EventPackage[] {
  return activePackages().filter((p) => p.category === category);
}

// ── sanitising what comes out of Firestore / the admin form ──

const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TEXT = 300;
const MAX_LINES = 40;

const text = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pair = (v: unknown): { zh: string; en: string } | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const zh = text(o.zh); const en = text(o.en);
  if (!zh && !en) return null;
  return { zh: zh || en, en: en || zh };
};
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean).slice(0, MAX_LINES) : []);
const money = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 100) / 100 : null;
};
const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** One well-formed package from raw data, or null. */
export function sanitizePackage(raw: unknown): EventPackage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const slug = text(r.slug, 40).toLowerCase();
  const name = pair(r.name);
  const venueId = text(r.venueId, 60);
  const price = money(r.price);
  const deposit = money(r.deposit);
  const durationRaw = typeof r.durationHours === 'number' ? r.durationHours : Number(r.durationHours);
  const durationHours = Number.isFinite(durationRaw) && durationRaw > 0 && durationRaw <= 24 && (durationRaw * 4) % 1 === 0 ? durationRaw : null;
  const earliestStart = text(r.earliestStart, 5);
  if (!SLUG.test(slug) || !name || !venueId || price === null || deposit === null || durationHours === null || !HHMM.test(earliestStart)) return null;
  const category = PACKAGE_CATEGORIES.includes(r.category as PackageCategory) ? (r.category as PackageCategory) : 'birthday';
  const includesRaw = r.includes && typeof r.includes === 'object' ? (r.includes as Record<string, unknown>) : {};
  const zhLines = lines(includesRaw.zh);
  const enLines = lines(includesRaw.en);
  const pkg: EventPackage = {
    slug, category, venueId, name,
    shortDesc: pair(r.shortDesc) ?? { zh: '', en: '' },
    includes: { zh: zhLines, en: enLines.length > 0 ? enLines : zhLines },
    price, deposit, durationHours,
    allowedDaysOfWeek: Array.isArray(r.allowedDaysOfWeek)
      ? Array.from(new Set(r.allowedDaysOfWeek.map((d) => int(d, 0, 6)).filter((d): d is number => d !== null))).sort()
      : [],
    earliestStart,
    pitch: pair(r.pitch) ?? { zh: '', en: '' },
  };
  const branchLabel = pair(r.branchLabel);
  if (branchLabel) pkg.branchLabel = branchLabel;
  const latestEnd = text(r.latestEnd, 5);
  if (HHMM.test(latestEnd)) pkg.latestEnd = latestEnd;
  const minAdvance = int(r.minAdvanceDays, 0, 365);
  if (minAdvance !== null && minAdvance > 0) pkg.minAdvanceDays = minAdvance;
  const basePax = int(r.basePax, 1, 500);
  const extraPax = money(r.extraPaxPrice);
  if (basePax !== null && extraPax !== null) { pkg.basePax = basePax; pkg.extraPaxPrice = extraPax; }
  if (Array.isArray(r.addOns)) {
    const seen = new Set<string>();
    const addOns: PackageAddOn[] = [];
    for (const a of r.addOns as Array<Record<string, unknown>>) {
      if (!a || typeof a !== 'object' || addOns.length >= 20) continue;
      const id = text(a.id, 40).toLowerCase();
      const label = pair(a.label);
      const pricePerPerson = money(a.pricePerPerson);
      if (!SLUG.test(id) || seen.has(id) || !label || pricePerPerson === null) continue;
      seen.add(id);
      const description = pair(a.description);
      addOns.push({ id, label, pricePerPerson, ...(description ? { description } : {}) });
    }
    if (addOns.length > 0) pkg.addOns = addOns;
  }
  if (r.active === false) pkg.active = false;
  const sortOrder = int(r.sortOrder, 0, 999);
  if (sortOrder !== null) pkg.sortOrder = sortOrder;
  return pkg;
}

/** The saved list, well-formed rows only; null when there is none. */
export function sanitizePackages(raw: unknown): EventPackage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: EventPackage[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const pkg = sanitizePackage(item);
    if (!pkg || seen.has(pkg.slug) || out.length >= 100) continue;
    seen.add(pkg.slug);
    out.push(pkg);
  }
  return out.length > 0 ? out : null;
}
