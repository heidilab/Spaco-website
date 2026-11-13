// 附加服務管理 — the 美食到會 dish list / tier prices and the 水煙 flavours /
// prices staff can edit (Heidi 2026-11-13), and the rule that a booking
// keeps the total it was sold at.

import { describe, it, expect, afterEach } from 'vitest';
import { sanitizeAddOnConfig, setAddOnConfig } from './addOnConfig';
import { cateringItemsAll, cateringItemsOffered, findCateringItem, cateringTiers, cateringExtraDishFee, cateringDoorstepFee } from './cateringCatalog';
import {
  calcCateringTotal, calcShishaPrice, shishaPrices, shishaFlavors, getShishaFlavorLabel, shishaDescription,
  stampAddOnPrices, keepSoldTotals, addOnEntryTotal, addOnSelectionTotal, calculatePricing,
} from './pricing';
import { addOnRevenueForBooking } from './finance';
import { validateAddOns } from './bookingSecurity';
import { CATERING_ITEMS } from './cateringMenu';
import { venues } from './venues';
import type { AddOnOptions, BookingRecord } from '@/types';

type Entry = { id: string; quantity: number; options?: AddOnOptions };
const cwb = venues.find((v) => v.id === 'cwb')!;
const use = (raw: unknown) => { const c = sanitizeAddOnConfig(raw); setAddOnConfig(c); return c; };

afterEach(() => setAddOnConfig({}));

describe('美食到會 — built-in menu when nothing is set', () => {
  it('keeps the coded dishes, tiers and fees', () => {
    expect(cateringItemsAll()).toBe(CATERING_ITEMS);
    expect(cateringTiers().map((t) => t.price)).toEqual([1808, 2390, 2988, 4468, 5920]);
    expect(cateringExtraDishFee()).toBe(155);
    expect(cateringDoorstepFee()).toBe(150);
    expect(calcCateringTotal({ tierId: 'tier-10', dishCodes: [], doorstepDelivery: true })).toBe(1808 + 150);
  });
});

describe('美食到會 — staff edits', () => {
  const dishes = [
    { code: '101', category: 'main', zh: '冷烏冬', en: 'Cold udon' },
    { code: '199', category: 'main', zh: '新菜式', en: '' },
    { code: '102', category: 'main', zh: '牛肉烏冬', en: 'Beef udon', hidden: true },
    { code: 'A1', category: 'addon', zh: '刺身拼盤', en: 'Sashimi', price: 500 },
  ];

  it('replaces the dish list, hides paused dishes from the picker', () => {
    use({ catering: { dishes } });
    expect(cateringItemsAll().map((d) => d.code)).toEqual(['101', '199', '102', 'A1']);
    expect(cateringItemsOffered().map((d) => d.code)).toEqual(['101', '199', 'A1']);
    expect(findCateringItem('199')?.name).toEqual({ zh: '新菜式', en: '新菜式' }); // blank English → Chinese
  });

  it('still names a paused or removed dish on an old booking', () => {
    use({ catering: { dishes } });
    expect(findCateringItem('102')?.name.zh).toBe('牛肉烏冬'); // paused
    expect(findCateringItem('121')?.name.zh).toContain('墨魚天婦羅'); // removed → built-in name
  });

  it('prices from the edited tiers, fees and add-on dish prices', () => {
    use({ catering: { dishes, tierPrices: { 'tier-10': 2000 }, extraDishFee: 160, doorstepFee: 200 } });
    // tier 2000 + 1 add-on dish 500 + door-to-door 200
    expect(calcCateringTotal({ tierId: 'tier-10', dishCodes: ['101', 'A1'], doorstepDelivery: true })).toBe(2700);
    // 13 tier dishes on a 12-dish tier → one extra at 160
    expect(calcCateringTotal({ tierId: 'tier-10', dishCodes: Array(13).fill('101') })).toBe(2160);
  });

  it('drops malformed dishes and duplicate codes', () => {
    const c = use({ catering: { dishes: [
      { code: '101', category: 'main', zh: '冷烏冬' },
      { code: '101', category: 'main', zh: '重複' },
      { code: '', category: 'main', zh: '冇編號' },
      { code: '300', category: 'main', zh: '' },
      { code: '301', category: 'main', zh: '負數價', price: -5 },
    ] } });
    expect(c.catering?.dishes?.map((d) => d.code)).toEqual(['101', '301']);
    expect(c.catering?.dishes?.[1].price).toBeUndefined();
  });
});

describe('水煙 — staff edits', () => {
  it('built-in prices and flavours when nothing is set', () => {
    expect(shishaPrices()).toEqual({ onePipe: 390, twoPipes: 750, extraHead: 250, staffSetup: 180 });
    expect(calcShishaPrice(1, 1)).toBe(390);
    expect(calcShishaPrice(2, 3, true)).toBe(750 + 250 + 180);
    expect(shishaFlavors().map((f) => f.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('uses the edited prices, also in the description customers read', () => {
    use({ shisha: { shishaPrices: { onePipe: 420, extraHead: 280 } } });
    expect(calcShishaPrice(1, 1)).toBe(420);
    expect(calcShishaPrice(2, 3, true)).toBe(750 + 280 + 180);
    expect(shishaDescription('zh')).toContain('$420');
    expect(shishaDescription('zh')).toContain('$750');
  });

  it('replaces the flavour list; a paused flavour stays readable and selectable on its booking', () => {
    use({ shisha: { flavors: [
      { id: 'A', zh: 'A · 芒果', en: 'A · Mango' },
      { id: 'Z', zh: 'Z · 新口味', en: '' },
      { id: 'B', zh: 'B · 蜜桃', en: 'B · Peach', hidden: true },
    ] } });
    expect(shishaFlavors().map((f) => f.id)).toEqual(['A', 'Z']);
    expect(shishaFlavors(['B']).map((f) => f.id)).toEqual(['A', 'Z', 'B']);
    expect(getShishaFlavorLabel('Z', 'en')).toBe('Z · 新口味');
    expect(getShishaFlavorLabel('B', 'zh')).toBe('B · 蜜桃');
    expect(getShishaFlavorLabel('H', 'zh')).toContain('檀香'); // removed → built-in name
  });
});

describe('a booking keeps the total it was sold at', () => {
  const catering: Entry = { id: 'catering', quantity: 1, options: { tierId: 'tier-10', dishCodes: ['101', '102'] } };
  const shisha: Entry = { id: 'shisha', quantity: 2, options: { pipes: 2, flavors: ['A', 'B'] } };

  it('stamps today\'s total when sold, and keeps it after prices change', () => {
    const sold = stampAddOnPrices<Entry>([catering, shisha], cwb);
    expect(sold[0].options?.soldTotal).toBe(1808);
    expect(sold[1].options?.soldTotal).toBe(750);
    use({ catering: { tierPrices: { 'tier-10': 2000 } }, shisha: { shishaPrices: { twoPipes: 800 } } });
    expect(addOnEntryTotal(sold[0])).toBe(1808);
    expect(addOnEntryTotal(sold[1])).toBe(750);
    expect(calculatePricing(cwb, true, 4, 20, sold, 0).addOnTotal).toBe(1808 + 750);
    // …while a new sale gets the new prices.
    expect(addOnSelectionTotal(catering)).toBe(2000);
    expect(addOnSelectionTotal(shisha)).toBe(800);
    // Month close keeps the old booking's 到會 at what it was sold for.
    const booking = { id: 'b', venueId: 'cwb', guestCount: 20, addOns: sold, pricing: {}, payments: [] } as unknown as BookingRecord;
    expect(addOnRevenueForBooking(booking, 'catering')).toBe(1808);
    expect(addOnRevenueForBooking(booking, 'shisha')).toBe(750);
  });

  it('an unchanged selection keeps its total across an edit; a changed one is re-priced', () => {
    const stored = stampAddOnPrices<Entry>([catering, shisha], cwb);
    use({ catering: { tierPrices: { 'tier-10': 2000 } }, shisha: { shishaPrices: { twoPipes: 800 } } });
    // The form rebuilds entries without the stamp; flavours changing is not a price change.
    const same = stampAddOnPrices<Entry>(
      [{ ...catering }, { id: 'shisha', quantity: 2, options: { pipes: 2, flavors: ['C', 'D'] } }], cwb, stored);
    expect(same[0].options?.soldTotal).toBe(1808);
    expect(same[1].options?.soldTotal).toBe(750);
    // One more dish / one more head → today's prices.
    const changed = stampAddOnPrices<Entry>([
      { id: 'catering', quantity: 1, options: { tierId: 'tier-10', dishCodes: ['101', '102', '103'] } },
      { id: 'shisha', quantity: 3, options: { pipes: 2 } },
    ], cwb, stored);
    expect(changed[0].options?.soldTotal).toBe(2000);
    expect(changed[1].options?.soldTotal).toBe(800 + 250);
  });

  it('never trusts a total carried on the incoming entry', () => {
    const forged: Entry = { id: 'catering', quantity: 1, options: { tierId: 'tier-10', dishCodes: [], soldTotal: 1 } };
    expect(keepSoldTotals([forged], null)[0].options?.soldTotal).toBeUndefined();
    expect(stampAddOnPrices<Entry>([forged], cwb)[0].options?.soldTotal).toBe(1808);
    // …and customer requests have it stripped before that.
    const out = validateAddOns([{ id: 'shisha', quantity: 1, options: { pipes: 1, soldTotal: 1 } }]);
    expect(out[0].options).toEqual({ pipes: 1 });
  });
});
