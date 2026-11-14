// 附加服務管理 — staff-editable settings layered over the add-on catalog
// in lib/pricing.ts (Heidi 2026-11-13: availability, branches, prices and
// menus were only changeable in code).
//
// PURE module — no firebase, and it must not import lib/pricing (pricing
// imports THIS). The settings live in Firestore `site_content/addons`
// (public read, like the rest of site_content) and are loaded by
// addOnConfigClient (browser) / addOnConfigServer (API routes), which
// call setAddOnConfig(). Everything that prices or lists add-ons then
// reads the active settings through lib/pricing's and lib/cateringCatalog's
// accessors.
//
// Empty settings = the catalog exactly as coded, so a missing or
// unreadable doc can never change a price.

export interface AddOnMenu {
  zh: string[];
  en: string[];
  notesZh: string[];
  notesEn: string[];
}

/** One dish of the 美食到會 menu as staff edit it. */
export interface CateringDishSetting {
  /** Code printed on the menu (101, A1 …) — what a booking stores. */
  code: string;
  /** Category id (lib/cateringMenu CATERING_CATEGORIES). */
  category: string;
  zh: string;
  en: string;
  /** Own price — 追加款式 dishes only. */
  price?: number;
  /** true = not offered right now; kept so old bookings still name it. */
  hidden?: boolean;
  tags?: string[];
}

/** One shisha flavour as staff edit it. */
export interface ShishaFlavorSetting {
  /** Letter / short id a booking stores (A, B …). */
  id: string;
  zh: string;
  en: string;
  hidden?: boolean;
}

export interface ShishaPriceSetting {
  /** 1 pipe + 1 head. */
  onePipe?: number;
  /** 2 pipes + 2 heads. */
  twoPipes?: number;
  /** Each head beyond the pipes. */
  extraHead?: number;
  /** Staff set-up, flat. */
  staffSetup?: number;
}

/** Units a 附加服務管理 custom add-on can be sold by. */
export type CustomAddOnUnit = 'person' | 'item' | 'flat';
export const CUSTOM_ADDON_UNITS: readonly CustomAddOnUnit[] = ['person', 'item', 'flat'];
/** The month-close column a custom add-on's money lands in. `other` =
 *  加時/罰款, where everything outside the five sales columns goes. */
export type CustomAddOnCategory = 'bbqHotpot' | 'shisha' | 'cater' | 'drinks' | 'other';
export const CUSTOM_ADDON_CATEGORIES: readonly CustomAddOnCategory[] = ['bbqHotpot', 'shisha', 'cater', 'drinks', 'other'];

/** An add-on staff created in 附加服務管理 — no entry in the coded catalog.
 *  Its id starts with CUSTOM_ADDON_PREFIX; its price is the setting's
 *  `price` / `venuePrices`, exactly like a built-in add-on's. */
export interface CustomAddOnSetting {
  name: { zh: string; en: string };
  description?: { zh: string; en: string };
  unit: CustomAddOnUnit;
  /** `item` only: the most a customer can order. */
  maxQuantity?: number;
  category: CustomAddOnCategory;
  /** true = CS must place a supplier order (the supplier email lists it). */
  supplierOrder?: boolean;
  sortOrder?: number;
}

export interface AddOnSetting {
  /** false = customers cannot pick it anywhere. Staff still can. */
  enabled?: boolean;
  /** Present on a custom add-on (id `x-…`) only: what it is. */
  custom?: CustomAddOnSetting;
  /** Venue ids it is offered at. Absent / null = the built-in rule
   *  (e.g. no BBQ where the venue has no BBQ area). */
  venueIds?: string[] | null;
  /** Unit price for every venue (per person / per item / per hour). */
  price?: number | null;
  /** Unit price at a particular venue — wins over `price`. */
  venuePrices?: Record<string, number>;
  /** Menu shown to customers (BBQ / hotpot packages). `zh` and `en`
   *  (and the two notes lists) are index-aligned. */
  menu?: AddOnMenu | null;

  // ── 美食到會 (`catering`) ──
  /** The whole dish list, replacing the built-in one. */
  dishes?: CateringDishSetting[];
  /** Tier price by tier id (tier-10 …). */
  tierPrices?: Record<string, number>;
  /** Fee per dish beyond the tier's included count. */
  extraDishFee?: number;
  /** Door-to-door delivery fee. */
  doorstepFee?: number;

  // ── Shisha (`shisha`) ──
  /** The whole flavour list, replacing the built-in one. */
  flavors?: ShishaFlavorSetting[];
  shishaPrices?: ShishaPriceSetting;
}

export type AddOnConfig = Record<string, AddOnSetting>;

/** Add-ons whose unit price staff can set. Shisha (tiered by pipes) and
 *  catering (tiers + dishes) have their own price fields above. */
export const PRICE_EDITABLE_ADDON_IDS = [
  'bbq-standard', 'bbq-premium', 'bbq-grill', 'bbq-helper',
  'hotpot-standard', 'hotpot-seafood', 'hotpot-extra-soup',
  'early-setup', 'drinks',
] as const;

/** Add-ons with a customer-facing menu staff can edit. */
export const MENU_EDITABLE_ADDON_IDS = ['bbq-standard', 'bbq-premium', 'hotpot-standard', 'hotpot-seafood'] as const;

const MAX_PRICE = 100000;
const MAX_LINES = 80;
const MAX_LINE_LEN = 200;
const MAX_DISHES = 300;
const MAX_FLAVORS = 40;

function cleanPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? Math.round(n * 100) / 100 : null;
}

const cleanText = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, MAX_LINE_LEN) : '');

/** Index-aligned pair of lists: a row survives when its Chinese text
 *  does; a blank English cell falls back to the Chinese. */
function cleanPairs(zhRaw: unknown, enRaw: unknown): { zh: string[]; en: string[] } {
  const zhList = Array.isArray(zhRaw) ? zhRaw : [];
  const enList = Array.isArray(enRaw) ? enRaw : [];
  const zh: string[] = [];
  const en: string[] = [];
  for (let i = 0; i < zhList.length && zh.length < MAX_LINES; i++) {
    const z = cleanText(zhList[i]);
    if (!z) continue;
    zh.push(z);
    en.push(cleanText(enList[i]) || z);
  }
  return { zh, en };
}

function cleanPriceMap(v: unknown, keyPattern: RegExp): Record<string, number> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [key, p] of Object.entries(v as Record<string, unknown>)) {
    const cp = cleanPrice(p);
    if (cp !== null && keyPattern.test(key)) out[key] = cp;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const ID = /^[a-z0-9-]{1,40}$/;

/** Keep only well-formed settings — applied to whatever comes out of
 *  Firestore or in from the admin form, so a bad value can never reach a
 *  price calculation. */
export function sanitizeAddOnConfig(raw: unknown): AddOnConfig {
  const out: AddOnConfig = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ID.test(id) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const setting: AddOnSetting = {};
    if (v.enabled === false) setting.enabled = false;
    if (Array.isArray(v.venueIds)) {
      setting.venueIds = v.venueIds.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(0, 50);
    }
    const price = cleanPrice(v.price);
    if (price !== null) setting.price = price;
    const venuePrices = cleanPriceMap(v.venuePrices, ID);
    if (venuePrices) setting.venuePrices = venuePrices;
    if (v.menu && typeof v.menu === 'object') {
      const m = v.menu as Record<string, unknown>;
      const items = cleanPairs(m.zh, m.en);
      const notes = cleanPairs(m.notesZh, m.notesEn);
      // A menu needs at least one item to replace the built-in one.
      if (items.zh.length > 0) setting.menu = { zh: items.zh, en: items.en, notesZh: notes.zh, notesEn: notes.en };
    }

    if (isCustomAddOnId(id)) {
      const c = (v.custom && typeof v.custom === 'object' ? v.custom : null) as Record<string, unknown> | null;
      const name = c?.name && typeof c.name === 'object' ? (c.name as Record<string, unknown>) : null;
      const nameZh = cleanText(name?.zh);
      // A custom add-on without a name is nothing — drop the whole entry.
      if (!nameZh) continue;
      const desc = c?.description && typeof c.description === 'object' ? (c.description as Record<string, unknown>) : null;
      const descZh = cleanText(desc?.zh);
      const unit = CUSTOM_ADDON_UNITS.includes(c?.unit as CustomAddOnUnit) ? (c?.unit as CustomAddOnUnit) : 'item';
      const category = CUSTOM_ADDON_CATEGORIES.includes(c?.category as CustomAddOnCategory) ? (c?.category as CustomAddOnCategory) : 'other';
      const custom: CustomAddOnSetting = { name: { zh: nameZh, en: cleanText(name?.en) || nameZh }, unit, category };
      if (descZh) custom.description = { zh: descZh, en: cleanText(desc?.en) || descZh };
      const rawMax = c?.maxQuantity;
      const maxQ = typeof rawMax === 'number' ? rawMax : typeof rawMax === 'string' && rawMax.trim() !== '' ? Number(rawMax) : NaN;
      if (unit === 'item' && Number.isInteger(maxQ) && maxQ >= 1 && maxQ <= 500) custom.maxQuantity = maxQ;
      if (c?.supplierOrder === true) custom.supplierOrder = true;
      if (typeof c?.sortOrder === 'number' && Number.isFinite(c.sortOrder)) custom.sortOrder = Math.round(c.sortOrder);
      setting.custom = custom;
    }

    if (id === 'catering') {
      if (Array.isArray(v.dishes)) {
        const seen = new Set<string>();
        const dishes: CateringDishSetting[] = [];
        for (const d of v.dishes as Array<Record<string, unknown>>) {
          if (!d || typeof d !== 'object' || dishes.length >= MAX_DISHES) continue;
          const code = cleanText(d.code);
          const zh = cleanText(d.zh);
          const category = cleanText(d.category);
          if (!/^[A-Za-z0-9-]{1,10}$/.test(code) || seen.has(code) || !zh || !ID.test(category)) continue;
          seen.add(code);
          const dish: CateringDishSetting = { code, category, zh, en: cleanText(d.en) || zh };
          const p = cleanPrice(d.price);
          if (p !== null && p > 0) dish.price = p;
          if (d.hidden === true) dish.hidden = true;
          if (Array.isArray(d.tags)) {
            const tags = d.tags.filter((t): t is string => typeof t === 'string' && ID.test(t)).slice(0, 6);
            if (tags.length > 0) dish.tags = tags;
          }
          dishes.push(dish);
        }
        if (dishes.length > 0) setting.dishes = dishes;
      }
      const tierPrices = cleanPriceMap(v.tierPrices, ID);
      if (tierPrices) setting.tierPrices = tierPrices;
      const extra = cleanPrice(v.extraDishFee);
      if (extra !== null) setting.extraDishFee = extra;
      const doorstep = cleanPrice(v.doorstepFee);
      if (doorstep !== null) setting.doorstepFee = doorstep;
    }

    if (id === 'shisha') {
      if (Array.isArray(v.flavors)) {
        const seen = new Set<string>();
        const flavors: ShishaFlavorSetting[] = [];
        for (const f of v.flavors as Array<Record<string, unknown>>) {
          if (!f || typeof f !== 'object' || flavors.length >= MAX_FLAVORS) continue;
          const fid = cleanText(f.id);
          const zh = cleanText(f.zh);
          if (!/^[A-Za-z0-9-]{1,10}$/.test(fid) || seen.has(fid) || !zh) continue;
          seen.add(fid);
          flavors.push({ id: fid, zh, en: cleanText(f.en) || zh, ...(f.hidden === true ? { hidden: true } : {}) });
        }
        if (flavors.length > 0) setting.flavors = flavors;
      }
      if (v.shishaPrices && typeof v.shishaPrices === 'object') {
        const sp = v.shishaPrices as Record<string, unknown>;
        const prices: ShishaPriceSetting = {};
        for (const key of ['onePipe', 'twoPipes', 'extraHead', 'staffSetup'] as const) {
          const p = cleanPrice(sp[key]);
          if (p !== null) prices[key] = p;
        }
        if (Object.keys(prices).length > 0) setting.shishaPrices = prices;
      }
    }

    if (Object.keys(setting).length > 0) out[id] = setting;
  }
  return out;
}

// ── active settings (module state, set by the loaders) ──

let active: AddOnConfig = {};
let version = 0;

export function setAddOnConfig(config: AddOnConfig): void {
  active = config;
  version++;
}

export function getAddOnConfig(): AddOnConfig {
  return active;
}

/** Bumps on every setAddOnConfig — lets React memos depend on it. */
export function addOnConfigVersion(): number {
  return version;
}

/** The unit price staff set for an add-on at a venue, or null to fall
 *  back to the built-in price. */
export function configuredAddOnPrice(id: string, venueId: string | undefined, config: AddOnConfig = active): number | null {
  const s = config[id];
  if (!s) return null;
  if (venueId && typeof s.venuePrices?.[venueId] === 'number') return s.venuePrices[venueId];
  return typeof s.price === 'number' ? s.price : null;
}

/** True when staff settings rule the add-on OUT for customers at this
 *  venue: switched off, or limited to other venues. (The built-in rules —
 *  no BBQ area, drinks included — are applied separately.) */
export function addOnBlockedBySettings(id: string, venueId: string, config: AddOnConfig = active): boolean {
  const s = config[id];
  if (!s) return false;
  if (s.enabled === false) return true;
  return Array.isArray(s.venueIds) && !s.venueIds.includes(venueId);
}

// ── custom add-ons (created in 附加服務管理, no code entry) ──

export const CUSTOM_ADDON_PREFIX = 'x-';
export const isCustomAddOnId = (id: string): boolean => id.startsWith(CUSTOM_ADDON_PREFIX);

/** The custom add-ons in a config, in display order. */
export function customAddOnSettings(config: AddOnConfig = active): Array<{ id: string; setting: AddOnSetting; custom: CustomAddOnSetting }> {
  return Object.entries(config)
    .filter(([id, s]) => isCustomAddOnId(id) && !!s.custom)
    .map(([id, s]) => ({ id, setting: s, custom: s.custom as CustomAddOnSetting }))
    .sort((a, b) => (a.custom.sortOrder ?? 99) - (b.custom.sortOrder ?? 99) || a.id.localeCompare(b.id));
}
