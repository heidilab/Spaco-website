// 附加服務管理 — staff settings over the add-on catalog (Heidi 2026-11-13).

import { describe, it, expect, afterEach } from 'vitest';
import { sanitizeAddOnConfig, setAddOnConfig, addOnBlockedBySettings, configuredAddOnPrice } from './addOnConfig';
import {
  addOnUnitPrice, addOnEntryUnitPrice, addOnAvailableAt, addOnMenu, builtInAddOnMenu,
  stampAddOnPrices, calculatePricing,
} from './pricing';
import { addOnRevenueForBooking } from './finance';
import { validateAddOns } from './bookingSecurity';
import { venues } from './venues';
import type { AddOnOptions, BookingRecord } from '@/types';

type Entry = { id: string; quantity: number; options?: AddOnOptions };

const cwb = venues.find((v) => v.id === 'cwb')!;
const tst = venues.find((v) => v.id === 'tst')!;
const wanchai = venues.find((v) => v.id === 'wanchai')!;

afterEach(() => setAddOnConfig({}));

describe('with no settings the catalog is exactly as coded', () => {
  it('keeps every built-in price', () => {
    expect(addOnUnitPrice('bbq-standard', cwb)).toBe(158);
    expect(addOnUnitPrice('bbq-standard', tst)).toBe(138);
    expect(addOnUnitPrice('bbq-premium', cwb)).toBe(328);
    expect(addOnUnitPrice('hotpot-standard', cwb)).toBe(168);
    expect(addOnUnitPrice('hotpot-seafood', cwb)).toBe(348);
    expect(addOnUnitPrice('hotpot-extra-soup', cwb)).toBe(108);
    expect(addOnUnitPrice('drinks', cwb)).toBe(25);
    expect(addOnUnitPrice('bbq-helper', cwb)).toBe(300);
    expect(addOnUnitPrice('bbq-grill', cwb)).toBe(500);
  });

  it('keeps the built-in venue rules', () => {
    expect(addOnAvailableAt('bbq-standard', cwb)).toBe(true);
    expect(addOnAvailableAt('bbq-standard', wanchai)).toBe(false); // no BBQ area
    expect(addOnAvailableAt('drinks', tst)).toBe(false);           // drinks included
    expect(addOnAvailableAt('hotpot-standard', wanchai)).toBe(true);
  });

  it('shows the built-in menus', () => {
    expect(addOnMenu('bbq-standard')).toEqual(builtInAddOnMenu('bbq-standard'));
    expect(addOnMenu('drinks')).toBeNull();
  });
});

describe('prices staff set', () => {
  it('one price for every branch, with a branch price winning over it', () => {
    setAddOnConfig(sanitizeAddOnConfig({ 'bbq-standard': { price: 168, venuePrices: { tst: 148 } } }));
    expect(addOnUnitPrice('bbq-standard', cwb)).toBe(168);
    expect(addOnUnitPrice('bbq-standard', tst)).toBe(148);
    // 20 guests at CWB now pay the new price.
    expect(calculatePricing(cwb, true, 4, 20, [{ id: 'bbq-standard', quantity: 1 }], 0).addOnTotal).toBe(168 * 20);
  });

  it('a booking keeps the price it was sold at', () => {
    // Booked at $158, stamped; then staff raise the price to $168.
    const sold = stampAddOnPrices<Entry>([{ id: 'bbq-standard', quantity: 1 }], cwb);
    expect(sold[0].options?.unitPrice).toBe(158);
    setAddOnConfig(sanitizeAddOnConfig({ 'bbq-standard': { price: 168 } }));
    expect(addOnEntryUnitPrice(sold[0], cwb)).toBe(158);
    expect(calculatePricing(cwb, true, 4, 20, sold, 0).addOnTotal).toBe(158 * 20);
    // …and month close keeps it in the BBQ column at the old amount.
    const booking = { id: 'b', venueId: 'cwb', guestCount: 20, addOns: sold, pricing: {}, payments: [] } as unknown as BookingRecord;
    expect(addOnRevenueForBooking(booking, 'bbq-standard')).toBe(158 * 20);
  });

  it('an edit keeps existing add-ons at their price and sells new ones at today\'s', () => {
    const stored = [{ id: 'bbq-standard', quantity: 1, options: { unitPrice: 158 } }];
    setAddOnConfig(sanitizeAddOnConfig({ 'bbq-standard': { price: 168 }, drinks: { price: 30 } }));
    // The admin form rebuilds entries without their options.
    const rebuilt = stampAddOnPrices<Entry>([{ id: 'bbq-standard', quantity: 1 }, { id: 'drinks', quantity: 1 }], cwb, stored);
    expect(rebuilt[0].options?.unitPrice).toBe(158);
    expect(rebuilt[1].options?.unitPrice).toBe(30);
  });

  it('does not stamp add-ons whose price is not a unit price', () => {
    const out = stampAddOnPrices<Entry>([{ id: 'shisha', quantity: 2 }, { id: 'catering', quantity: 1 }], cwb);
    expect(out.every((a) => a.options?.unitPrice === undefined)).toBe(true);
  });

  it('a customer cannot send their own unit price', () => {
    const out = validateAddOns([{ id: 'bbq-premium', quantity: 1, options: { unitPrice: 1 } }]);
    expect(out[0].options).toEqual({});
  });
});

describe('availability staff set', () => {
  it('switching an add-on off hides it everywhere', () => {
    setAddOnConfig(sanitizeAddOnConfig({ 'hotpot-seafood': { enabled: false } }));
    expect(addOnAvailableAt('hotpot-seafood', cwb)).toBe(false);
    expect(addOnBlockedBySettings('hotpot-seafood', 'cwb')).toBe(true);
    expect(addOnAvailableAt('hotpot-standard', cwb)).toBe(true);
  });

  it('a branch list replaces the built-in rule', () => {
    setAddOnConfig(sanitizeAddOnConfig({ 'bbq-premium': { venueIds: ['cwb'] } }));
    expect(addOnAvailableAt('bbq-premium', cwb)).toBe(true);
    expect(addOnAvailableAt('bbq-premium', tst)).toBe(false);
    expect(addOnBlockedBySettings('bbq-premium', 'tst')).toBe(true);
    expect(addOnBlockedBySettings('bbq-premium', 'cwb')).toBe(false);
  });

  it('the built-in rule alone never blocks a server request', () => {
    // No BBQ at 灣仔 by the built-in rule — hidden for customers, but not
    // a staff setting, so addOnBlockedBySettings stays false.
    expect(addOnBlockedBySettings('bbq-standard', 'wanchai')).toBe(false);
  });
});

describe('menus staff edit', () => {
  it('replaces the built-in menu, falling back to Chinese when English is blank', () => {
    setAddOnConfig(sanitizeAddOnConfig({
      'bbq-standard': { menu: { zh: ['雞翼', '牛肉串'], en: [], notesZh: ['每位一份'], notesEn: [] } },
    }));
    expect(addOnMenu('bbq-standard')).toEqual({
      zh: ['雞翼', '牛肉串'], en: ['雞翼', '牛肉串'], notes: { zh: ['每位一份'], en: ['每位一份'] },
    });
    expect(addOnMenu('bbq-premium')).toEqual(builtInAddOnMenu('bbq-premium'));
  });
});

describe('sanitizeAddOnConfig — nothing malformed reaches a price', () => {
  it('drops bad prices, ids and empty menus', () => {
    const c = sanitizeAddOnConfig({
      'bbq-standard': { price: -5, venuePrices: { cwb: 'abc', tst: 150 } },
      'bbq-premium': { price: 1e9 },
      'DROP TABLE': { price: 10 },
      drinks: { price: '30', menu: { zh: [] } },
      'hotpot-standard': 'nope',
    });
    expect(c['bbq-standard']).toEqual({ venuePrices: { tst: 150 } });
    expect(c['bbq-premium']).toBeUndefined();
    expect(c['DROP TABLE']).toBeUndefined();
    expect(c.drinks).toEqual({ price: 30 });
    expect(c['hotpot-standard']).toBeUndefined();
    expect(configuredAddOnPrice('bbq-standard', 'cwb', c)).toBeNull();
    expect(sanitizeAddOnConfig(null)).toEqual({});
  });
});
