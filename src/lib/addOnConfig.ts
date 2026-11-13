// 附加服務管理 — staff-editable settings layered over the add-on catalog
// in lib/pricing.ts (Heidi 2026-11-13: availability, branches, prices and
// menus were only changeable in code).
//
// PURE module — no firebase, and it must not import lib/pricing (pricing
// imports THIS). The settings live in Firestore `site_content/addons`
// (public read, like the rest of site_content) and are loaded by
// addOnConfigClient (browser) / addOnConfigServer (API routes), which
// call setAddOnConfig(). Everything that prices or lists add-ons then
// reads the active settings through lib/pricing's accessors.
//
// Empty settings = the catalog exactly as coded, so a missing or
// unreadable doc can never change a price.

export interface AddOnMenu {
  zh: string[];
  en: string[];
  notesZh: string[];
  notesEn: string[];
}

export interface AddOnSetting {
  /** false = customers cannot pick it anywhere. Staff still can. */
  enabled?: boolean;
  /** Venue ids it is offered at. Absent / null = the built-in rule
   *  (e.g. no BBQ where the venue has no BBQ area). */
  venueIds?: string[] | null;
  /** Unit price for every venue (per person / per item / per hour). */
  price?: number | null;
  /** Unit price at a particular venue — wins over `price`. */
  venuePrices?: Record<string, number>;
  /** Menu shown to customers (BBQ / hotpot packages). */
  menu?: AddOnMenu | null;
}

export type AddOnConfig = Record<string, AddOnSetting>;

/** Add-ons whose unit price staff can set. Shisha (tiered by pipes) and
 *  catering (priced from its own menu) are toggle / branch only. */
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

function cleanPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? Math.round(n * 100) / 100 : null;
}

function cleanLines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().slice(0, MAX_LINE_LEN))
    .filter(Boolean)
    .slice(0, MAX_LINES);
}

/** Keep only well-formed settings — applied to whatever comes out of
 *  Firestore or in from the admin form, so a bad value can never reach a
 *  price calculation. */
export function sanitizeAddOnConfig(raw: unknown): AddOnConfig {
  const out: AddOnConfig = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,40}$/.test(id) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const setting: AddOnSetting = {};
    if (v.enabled === false) setting.enabled = false;
    if (Array.isArray(v.venueIds)) {
      setting.venueIds = v.venueIds.filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{1,40}$/.test(x)).slice(0, 50);
    }
    const price = cleanPrice(v.price);
    if (price !== null) setting.price = price;
    if (v.venuePrices && typeof v.venuePrices === 'object') {
      const vp: Record<string, number> = {};
      for (const [venueId, p] of Object.entries(v.venuePrices as Record<string, unknown>)) {
        const cp = cleanPrice(p);
        if (cp !== null && /^[a-z0-9-]{1,40}$/.test(venueId)) vp[venueId] = cp;
      }
      if (Object.keys(vp).length > 0) setting.venuePrices = vp;
    }
    if (v.menu && typeof v.menu === 'object') {
      const m = v.menu as Record<string, unknown>;
      const menu: AddOnMenu = {
        zh: cleanLines(m.zh), en: cleanLines(m.en),
        notesZh: cleanLines(m.notesZh), notesEn: cleanLines(m.notesEn),
      };
      // A menu needs at least its Chinese items to replace the built-in one.
      if (menu.zh.length > 0) setting.menu = menu;
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
