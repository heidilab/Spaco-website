import type { AddOnOptions } from '@/types';

/**
 * 火鍋套餐 rules (Heidi 2026-11-10) — ONE place so the booking form, the
 * server checks, the admin editors and the supplier email can never
 * disagree:
 *
 *   • Every hotpot package MUST come with a soup-base choice.
 *   • The headcount that matters is the CHARGED one (計價人數): a child
 *     counts as half an adult, so 7 adults + 3 children = 8.5.
 *   • Under 15 (charged)  → 1 soup base, picked from the three below.
 *     An extra soup base can be bought for +$108 (then a 2nd is picked).
 *   • 15 or more (charged) → 2 soup bases included, no extra charge.
 *     The two picks may be the same soup.
 *   • A booking that later GROWS to 15 keeps its two soups; the extra
 *     soup base it paid for is offset against the cost of the added
 *     guests (see hotpotExtraSoupOffset).
 *   • Hotpot must be ordered at least 3 days before the event.
 *
 * The picks live on the hotpot package's own add-on entry as
 * `options.soupBases` (soup ids, one per pot, duplicates allowed).
 */

type Entry = { id: string; quantity: number; options?: AddOnOptions };

export const HOTPOT_PACKAGE_IDS: readonly string[] = ['hotpot-standard', 'hotpot-seafood'];
export const HOTPOT_EXTRA_SOUP_ID = 'hotpot-extra-soup';
/** Every hotpot add-on id (packages + extra soup base). */
export const HOTPOT_ADDON_IDS: readonly string[] = [...HOTPOT_PACKAGE_IDS, HOTPOT_EXTRA_SOUP_ID];
/** HK$ per extra soup base (groups under the two-soup headcount). */
export const HOTPOT_EXTRA_SOUP_PRICE = 108;
/** CHARGED headcount (adults + ½ per child) from which 2 soup bases are included. */
export const HOTPOT_TWO_SOUP_MIN_EQUIV = 15;
/** Hotpot needs this many days' notice (BBQ / shisha need only 2). */
export const HOTPOT_MIN_ADVANCE_DAYS = 3;

export const HOTPOT_SOUP_BASES: readonly { id: string; name: { zh: string; en: string } }[] = [
  { id: 'tomato',    name: { zh: '蕃茄湯', en: 'Tomato Soup' } },
  { id: 'pork-bone', name: { zh: '豬骨湯', en: 'Pork Bone Soup' } },
  { id: 'mala',      name: { zh: '麻辣湯', en: 'Spicy Mala Soup' } },
];

export function isHotpotPackage(id: string): boolean {
  return HOTPOT_PACKAGE_IDS.includes(id);
}

/** Hotpot package or extra soup base. */
export function isHotpotAddOn(id: string): boolean {
  return HOTPOT_ADDON_IDS.includes(id);
}

export function isHotpotSoupId(id: unknown): id is string {
  return typeof id === 'string' && HOTPOT_SOUP_BASES.some((s) => s.id === id);
}

export function hotpotSoupLabel(id: string, locale: 'zh' | 'en' = 'zh'): string {
  return HOTPOT_SOUP_BASES.find((s) => s.id === id)?.name[locale] || id;
}

/** The hotpot package entry on a booking (standard / seafood), if any. */
export function hotpotPackageEntry<T extends Entry>(addOns: readonly T[] | undefined): T | undefined {
  return (addOns || []).find((a) => isHotpotPackage(a.id) && a.quantity > 0);
}

/** Soup bases included with the package itself for this CHARGED headcount
 *  (adults + ½ per child — pricing.adultEquivalent). */
export function hotpotIncludedSoups(adultEquiv: number): number {
  return adultEquiv >= HOTPOT_TWO_SOUP_MIN_EQUIV ? 2 : 1;
}

/** How many soup bases this booking picks: the included ones plus any
 *  paid extra soup base. 0 when there is no hotpot package. */
export function hotpotSoupSlots(adultEquiv: number, addOns: readonly Entry[] | undefined): number {
  if (!hotpotPackageEntry(addOns)) return 0;
  const extra = (addOns || []).find((a) => a.id === HOTPOT_EXTRA_SOUP_ID)?.quantity || 0;
  return hotpotIncludedSoups(adultEquiv) + Math.max(0, Math.floor(extra));
}

/** Only real soup ids — drops blanks (a pot not picked yet) and junk. */
export function cleanSoupBases(list: unknown): string[] {
  return Array.isArray(list) ? list.filter(isHotpotSoupId) : [];
}

/** The soup picks stored on the booking's hotpot package (real ids only). */
export function hotpotSoupBases(addOns: readonly Entry[] | undefined): string[] {
  return cleanSoupBases(hotpotPackageEntry(addOns)?.options?.soupBases);
}

/** "蕃茄湯、麻辣湯" / "豬骨湯 ×2" — '' when nothing is picked. */
export function hotpotSoupSummary(soupBases: unknown, locale: 'zh' | 'en' = 'zh'): string {
  const counts = new Map<string, number>();
  for (const id of cleanSoupBases(soupBases)) counts.set(id, (counts.get(id) || 0) + 1);
  return Array.from(counts.entries())
    .map(([id, n]) => `${hotpotSoupLabel(id, locale)}${n > 1 ? ` ×${n}` : ''}`)
    .join(locale === 'zh' ? '、' : ', ');
}

/** Put `soupBases` onto the hotpot package entry (and nowhere else).
 *  Blank slots are kept so a half-filled picker round-trips; use
 *  finalizeHotpotAddOns before storing. */
export function withHotpotSoups<T extends Entry>(addOns: readonly T[], soupBases: readonly string[]): T[] {
  const pkg = hotpotPackageEntry(addOns);
  return addOns.map((a) => {
    if (a !== pkg) return a;
    return { ...a, options: { ...(a.options || {}), soupBases: [...soupBases] } };
  });
}

/**
 * Keep an add-on list consistent with the customer rules after the
 * charged headcount or the selection changes:
 *   • an extra soup base without a hotpot package is dropped;
 *   • with `stripIncludedExtra`, the extra soup base is dropped once the
 *     headcount already includes two (nothing to pay for);
 *   • the soup picks are trimmed to the number of pots allowed.
 * Returns the SAME array when nothing changed (safe in a React effect).
 */
export function normalizeHotpotAddOns<T extends Entry>(
  addOns: T[],
  adultEquiv: number,
  { stripIncludedExtra = true }: { stripIncludedExtra?: boolean } = {},
): T[] {
  const pkg = hotpotPackageEntry(addOns);
  let next: T[] = addOns;
  const hasExtra = next.some((a) => a.id === HOTPOT_EXTRA_SOUP_ID);
  if (hasExtra && (!pkg || (stripIncludedExtra && adultEquiv >= HOTPOT_TWO_SOUP_MIN_EQUIV))) {
    next = next.filter((a) => a.id !== HOTPOT_EXTRA_SOUP_ID);
  }
  if (pkg) {
    const slots = hotpotSoupSlots(adultEquiv, next);
    const stored = pkg.options?.soupBases;
    if (Array.isArray(stored) && stored.length > slots) {
      next = withHotpotSoups(next, stored.slice(0, slots));
    }
  }
  return next;
}

/**
 * A confirmed booking that bought the extra soup base while under 15 and
 * then ADDS guests to reach 15: from 15 the package includes two soups,
 * so the extra soup base it paid for is no longer chargeable. It comes off
 * the add-on list (the customer keeps both soups) and its price is thereby
 * offset against what the added guests cost. Returns the HK$ offset —
 * 0 when the rule does not apply.
 */
export function hotpotExtraSoupOffset(
  bookedAddOns: readonly Entry[] | undefined,
  bookedAdultEquiv: number,
  newAdultEquiv: number,
): number {
  if (bookedAdultEquiv >= HOTPOT_TWO_SOUP_MIN_EQUIV || newAdultEquiv < HOTPOT_TWO_SOUP_MIN_EQUIV) return 0;
  if (!hotpotPackageEntry(bookedAddOns)) return 0;
  const qty = (bookedAddOns || []).find((a) => a.id === HOTPOT_EXTRA_SOUP_ID)?.quantity || 0;
  return HOTPOT_EXTRA_SOUP_PRICE * Math.max(0, Math.floor(qty));
}

/**
 * Staff editors rebuild the add-on list from a quantity map, which drops
 * every entry's options — this writes the soup picker's state back onto
 * the hotpot package: real soup ids only, trimmed to the pots this
 * headcount gets. Staff may leave it empty (the customer hasn't decided);
 * the supplier email then flags the booking for follow-up.
 */
export function applyHotpotSoups<T extends Entry>(addOns: T[], picks: readonly string[], adultEquiv: number): T[] {
  if (!hotpotPackageEntry(addOns)) return addOns;
  const soups = cleanSoupBases(picks.slice(0, hotpotSoupSlots(adultEquiv, addOns)));
  return soups.length > 0 ? withHotpotSoups(addOns, soups) : addOns;
}

/** Strip blank / unknown soup picks before the add-ons are stored. */
export function finalizeHotpotAddOns<T extends Entry>(addOns: readonly T[]): T[] {
  return addOns.map((a) => {
    if (!isHotpotPackage(a.id) || !a.options || !('soupBases' in a.options)) return a;
    return { ...a, options: { ...a.options, soupBases: cleanSoupBases(a.options.soupBases) } };
  });
}

export type HotpotSelectionError = 'HOTPOT_SOUP_REQUIRED' | 'HOTPOT_EXTRA_SOUP_INVALID';

/**
 * Customer-booking check: null when the hotpot selection is complete.
 *   HOTPOT_SOUP_REQUIRED       — a package without exactly one pick per pot
 *   HOTPOT_EXTRA_SOUP_INVALID  — an extra soup base with no package
 */
export function hotpotSelectionError(
  addOns: readonly Entry[] | undefined,
  adultEquiv: number,
): HotpotSelectionError | null {
  const list = addOns || [];
  const pkg = hotpotPackageEntry(list);
  if (!pkg) {
    return list.some((a) => a.id === HOTPOT_EXTRA_SOUP_ID && a.quantity > 0) ? 'HOTPOT_EXTRA_SOUP_INVALID' : null;
  }
  const raw = pkg.options?.soupBases;
  const picks = cleanSoupBases(raw);
  const slots = hotpotSoupSlots(adultEquiv, list);
  if (!Array.isArray(raw) || raw.length !== picks.length || picks.length !== slots) return 'HOTPOT_SOUP_REQUIRED';
  return null;
}

/** Whole calendar days (Hong Kong time) from today until `date` (YYYY-MM-DD). */
export function hkDaysUntil(date: string, now: number = Date.now()): number {
  const todayHk = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  return Math.round((Date.parse(date) - Date.parse(todayHk)) / 86400000);
}

/** True when the event is too close to order hotpot (under 3 days away). */
export function hotpotTooLate(date: string, now: number = Date.now()): boolean {
  return hkDaysUntil(date, now) < HOTPOT_MIN_ADVANCE_DAYS;
}
