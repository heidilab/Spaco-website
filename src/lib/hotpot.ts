import type { AddOnOptions } from '@/types';

/**
 * 火鍋套餐 soup-base rules (Heidi 2026-11-10) — ONE place so the booking
 * form, the server check, the admin editors and the supplier email can
 * never disagree:
 *
 *   • Every hotpot package MUST come with a soup-base choice.
 *   • Fewer than 15 guests  → 1 soup base, picked from the three below.
 *     An extra soup base can be bought for +$88 (then a 2nd is picked).
 *   • 15 guests or more     → 2 soup bases included, no extra charge.
 *     The two picks may be the same soup.
 *
 * The picks live on the hotpot package's own add-on entry as
 * `options.soupBases` (soup ids, one per pot, duplicates allowed).
 */

type Entry = { id: string; quantity: number; options?: AddOnOptions };

export const HOTPOT_PACKAGE_IDS: readonly string[] = ['hotpot-standard', 'hotpot-seafood'];
export const HOTPOT_EXTRA_SOUP_ID = 'hotpot-extra-soup';
/** HK$ per extra soup base (groups under the two-soup headcount). */
export const HOTPOT_EXTRA_SOUP_PRICE = 88;
/** Total headcount (adults + children) from which 2 soup bases are included. */
export const HOTPOT_TWO_SOUP_MIN_GUESTS = 15;

export const HOTPOT_SOUP_BASES: readonly { id: string; name: { zh: string; en: string } }[] = [
  { id: 'tomato',    name: { zh: '蕃茄湯', en: 'Tomato Soup' } },
  { id: 'pork-bone', name: { zh: '豬骨湯', en: 'Pork Bone Soup' } },
  { id: 'mala',      name: { zh: '麻辣湯', en: 'Spicy Mala Soup' } },
];

export function isHotpotPackage(id: string): boolean {
  return HOTPOT_PACKAGE_IDS.includes(id);
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

/** Soup bases included with the package itself for this headcount. */
export function hotpotIncludedSoups(guestCount: number): number {
  return guestCount >= HOTPOT_TWO_SOUP_MIN_GUESTS ? 2 : 1;
}

/** How many soup bases this booking picks: the included ones plus any
 *  paid extra soup base. 0 when there is no hotpot package. */
export function hotpotSoupSlots(guestCount: number, addOns: readonly Entry[] | undefined): number {
  if (!hotpotPackageEntry(addOns)) return 0;
  const extra = (addOns || []).find((a) => a.id === HOTPOT_EXTRA_SOUP_ID)?.quantity || 0;
  return hotpotIncludedSoups(guestCount) + Math.max(0, Math.floor(extra));
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
 * guest count or the selection changes:
 *   • an extra soup base without a hotpot package is dropped;
 *   • with `stripIncludedExtra`, the paid extra soup base is dropped once
 *     the headcount already includes two (nothing to pay for);
 *   • the soup picks are trimmed to the number of pots allowed.
 * Returns the SAME array when nothing changed (safe in a React effect).
 */
export function normalizeHotpotAddOns<T extends Entry>(
  addOns: T[],
  guestCount: number,
  { stripIncludedExtra = true }: { stripIncludedExtra?: boolean } = {},
): T[] {
  const pkg = hotpotPackageEntry(addOns);
  let next: T[] = addOns;
  const hasExtra = next.some((a) => a.id === HOTPOT_EXTRA_SOUP_ID);
  if (hasExtra && (!pkg || (stripIncludedExtra && guestCount >= HOTPOT_TWO_SOUP_MIN_GUESTS))) {
    next = next.filter((a) => a.id !== HOTPOT_EXTRA_SOUP_ID);
  }
  if (pkg) {
    const slots = hotpotSoupSlots(guestCount, next);
    const stored = pkg.options?.soupBases;
    if (Array.isArray(stored) && stored.length > slots) {
      next = withHotpotSoups(next, stored.slice(0, slots));
    }
  }
  return next;
}

/**
 * Staff editors rebuild the add-on list from a quantity map, which drops
 * every entry's options — this writes the soup picker's state back onto
 * the hotpot package: real soup ids only, trimmed to the pots this
 * headcount gets. Staff may leave it empty (the customer hasn't decided);
 * the supplier email then flags the booking for follow-up.
 */
export function applyHotpotSoups<T extends Entry>(addOns: T[], picks: readonly string[], guestCount: number): T[] {
  if (!hotpotPackageEntry(addOns)) return addOns;
  const soups = cleanSoupBases(picks.slice(0, hotpotSoupSlots(guestCount, addOns)));
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
  guestCount: number,
): HotpotSelectionError | null {
  const list = addOns || [];
  const pkg = hotpotPackageEntry(list);
  if (!pkg) {
    return list.some((a) => a.id === HOTPOT_EXTRA_SOUP_ID && a.quantity > 0) ? 'HOTPOT_EXTRA_SOUP_INVALID' : null;
  }
  const raw = pkg.options?.soupBases;
  const picks = cleanSoupBases(raw);
  const slots = hotpotSoupSlots(guestCount, list);
  if (!Array.isArray(raw) || raw.length !== picks.length || picks.length !== slots) return 'HOTPOT_SOUP_REQUIRED';
  return null;
}
