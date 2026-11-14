// 附加服務管理 → 新增附加服務 (site review 2026-11-13, phase 4a): an add-on
// staff create as data behaves like a coded one everywhere.

import { describe, it, expect, afterEach } from 'vitest';
import { sanitizeAddOnConfig, setAddOnConfig, customAddOnSettings, isCustomAddOnId } from './addOnConfig';
import {
  allAddOns, findAddOn, addOnAvailableAt, addOnUnitPrice, calculatePricing, stampAddOnPrices,
  formatAddOnsForStaff, getAddOnLabel, customAddOnEntryCost,
} from './pricing';
import { addOnRevenueForBooking, salesCategoryBreakdown } from './finance';
import { validateAddOns, BookingInputError } from './bookingSecurity';
import { bookingNeedsSupplierOrder, buildStaffSupplierOrderEmail } from './email';
import { venues } from './venues';
import type { AddOnOptions, BookingRecord } from '@/types';

type Entry = { id: string; quantity: number; options?: AddOnOptions };

const cwb = venues.find((v) => v.id === 'cwb')!;
const tst = venues.find((v) => v.id === 'tst')!;

const CONFIG = sanitizeAddOnConfig({
  'x-cake': { price: 380, custom: { name: { zh: '生日蛋糕', en: 'Birthday cake' }, unit: 'flat', category: 'other', supplierOrder: true, sortOrder: 2 } },
  'x-balloon': { price: 30, venuePrices: { tst: 25 }, custom: { name: { zh: '氣球' }, unit: 'item', maxQuantity: 10, category: 'other', sortOrder: 1 } },
  'x-dessert': { price: 40, custom: { name: { zh: '甜品自助', en: 'Dessert bar' }, description: { zh: '每位一份' }, unit: 'person', category: 'cater' } },
  'x-nameless': { price: 10, custom: { unit: 'item' } },
  'x-off': { price: 10, enabled: false, custom: { name: { zh: '已關閉' }, unit: 'flat', category: 'other' } },
});

afterEach(() => setAddOnConfig({}));

function booking(addOns: Entry[], subtotal = 0): BookingRecord {
  return {
    id: 'b1', venueId: 'cwb', date: '2026-12-01', startTime: '19:00', endTime: '23:00', hours: 4,
    guestCount: 10, adultCount: 8, childCount: 2, addOns,
    pricing: { baseCharge: 2000, addOnTotal: 0, subtotal: subtotal || 2000, securityDeposit: 1000, grandTotal: 3000, deposit: 3000 },
    status: 'confirmed', whatsappPhone: '91234567',
  } as unknown as BookingRecord;
}

describe('sanitizeAddOnConfig — custom add-ons', () => {
  it('keeps well-formed custom add-ons, in order, and drops one without a name', () => {
    const list = customAddOnSettings(CONFIG);
    expect(list.map((c) => c.id)).toEqual(['x-balloon', 'x-cake', 'x-dessert', 'x-off']);
    expect(CONFIG['x-nameless']).toBeUndefined();
    expect(CONFIG['x-balloon'].custom).toEqual({ name: { zh: '氣球', en: '氣球' }, unit: 'item', maxQuantity: 10, category: 'other', sortOrder: 1 });
    expect(CONFIG['x-cake'].custom?.supplierOrder).toBe(true);
    expect(CONFIG['x-dessert'].custom?.description).toEqual({ zh: '每位一份', en: '每位一份' });
  });
  it('falls back to per item / other for unknown unit or column, and ignores `custom` on a built-in id', () => {
    const c = sanitizeAddOnConfig({
      'x-odd': { custom: { name: { zh: 'A' }, unit: 'hour', category: 'rent', maxQuantity: 9999 } },
      'drinks': { price: 30, custom: { name: { zh: 'nope' }, unit: 'flat', category: 'other' } },
    });
    expect(c['x-odd'].custom).toEqual({ name: { zh: 'A', en: 'A' }, unit: 'item', category: 'other' });
    expect(c.drinks).toEqual({ price: 30 });
  });
});

describe('a custom add-on is listed and priced like a coded one', () => {
  it('appears in the catalog with its unit and price', () => {
    setAddOnConfig(CONFIG);
    const ids = allAddOns().map((a) => a.id);
    expect(ids).toContain('x-cake');
    expect(ids.indexOf('x-balloon')).toBeLessThan(ids.indexOf('x-cake'));
    expect(findAddOn('x-balloon')).toMatchObject({ unit: 'item', maxQuantity: 10, pricePerUnit: 30 });
    expect(findAddOn('x-cake')?.maxQuantity).toBe(1);
    expect(addOnUnitPrice('x-balloon', cwb)).toBe(30);
    expect(addOnUnitPrice('x-balloon', tst)).toBe(25);
    expect(getAddOnLabel('x-dessert', 'en')).toBe('Dessert bar');
    expect(findAddOn('x-nope')).toBeUndefined();
  });
  it('is offered unless switched off or limited to other branches', () => {
    setAddOnConfig(CONFIG);
    expect(addOnAvailableAt('x-cake', cwb)).toBe(true);
    expect(addOnAvailableAt('x-off', cwb)).toBe(false);
    setAddOnConfig(sanitizeAddOnConfig({ 'x-cake': { ...CONFIG['x-cake'], venueIds: ['tst'] } }));
    expect(addOnAvailableAt('x-cake', cwb)).toBe(false);
    expect(addOnAvailableAt('x-cake', tst)).toBe(true);
  });
  it('charges flat, per item and per charged guest', () => {
    setAddOnConfig(CONFIG);
    const p = calculatePricing(cwb, false, 4, 10, [
      { id: 'x-cake', quantity: 1 }, { id: 'x-balloon', quantity: 4 }, { id: 'x-dessert', quantity: 1 },
    ], 2);
    // 8 adults + 2 children = 9 charged guests.
    expect(p.addOnTotal).toBe(380 + 4 * 30 + 9 * 40);
    const labels = p.breakdown.map((l) => l.label.zh);
    expect(labels).toContain('生日蛋糕');
    expect(labels).toContain('氣球 (4 x $30)');
    expect(labels.some((l) => l.startsWith('甜品自助 ('))).toBe(true);
  });
  it('stamps the price, name, unit and column it was sold with, and keeps them after deletion', () => {
    setAddOnConfig(CONFIG);
    const sold = stampAddOnPrices<Entry>([{ id: 'x-dessert', quantity: 1 }], cwb);
    expect(sold[0].options).toEqual({ unitPrice: 40, customName: '甜品自助', customUnit: 'person', customCategory: 'cater' });
    // Staff raise the price, then delete the add-on: the booking is unchanged.
    setAddOnConfig(sanitizeAddOnConfig({ 'x-dessert': { ...CONFIG['x-dessert'], price: 60 } }));
    expect(calculatePricing(cwb, false, 4, 10, sold, 2).addOnTotal).toBe(9 * 40);
    setAddOnConfig({});
    const p = calculatePricing(cwb, false, 4, 10, sold, 2);
    expect(p.addOnTotal).toBe(9 * 40);
    expect(p.breakdown.some((l) => l.label.zh.startsWith('甜品自助'))).toBe(true);
    expect(formatAddOnsForStaff(sold, 'zh')).toBe('甜品自助');
    expect(formatAddOnsForStaff([{ id: 'x-balloon', quantity: 3, options: { unitPrice: 30, customName: '氣球', customUnit: 'item' } }], 'zh')).toBe('氣球 ×3');
  });
});

describe('a custom add-on in finance', () => {
  it('is revenue, in the column staff chose', () => {
    setAddOnConfig(CONFIG);
    const b = booking([
      { id: 'x-cake', quantity: 1, options: { unitPrice: 380 } },
      { id: 'x-dessert', quantity: 1, options: { unitPrice: 40 } },
      { id: 'x-balloon', quantity: 2, options: { unitPrice: 30 } },
    ], 2000 + 380 + 360 + 60);
    expect(addOnRevenueForBooking(b, 'x-cake')).toBe(380);
    expect(addOnRevenueForBooking(b, 'x-dessert')).toBe(9 * 40);
    expect(addOnRevenueForBooking(b, 'x-balloon')).toBe(60);
    const c = salesCategoryBreakdown(b);
    expect(c.cater).toBe(360);
    // flat cake + balloons are 'other' → not in the five columns.
    expect(c.bbqHotpot + c.shisha + c.drinks).toBe(0);
  });
  it('uses the stamped column when the add-on is gone', () => {
    const b = booking([{ id: 'x-gone', quantity: 1, options: { unitPrice: 100, customName: '舊項目', customUnit: 'person', customCategory: 'drinks' } }]);
    expect(customAddOnEntryCost(b.addOns[0], 9)).toBe(900);
    expect(salesCategoryBreakdown(b).drinks).toBe(900);
  });
});

describe('a customer request', () => {
  it('may order a custom add-on within its maximum, and never its own name or price', () => {
    setAddOnConfig(CONFIG);
    const out = validateAddOns([{ id: 'x-balloon', quantity: 3, options: { customName: 'hack', unitPrice: 1, customUnit: 'flat' } }]);
    expect(out).toEqual([{ id: 'x-balloon', quantity: 3, options: {} }]);
    expect(() => validateAddOns([{ id: 'x-balloon', quantity: 11 }])).toThrow(BookingInputError);
    expect(() => validateAddOns([{ id: 'x-cake', quantity: 2 }])).toThrow(BookingInputError);
    expect(() => validateAddOns([{ id: 'x-unknown', quantity: 1 }])).toThrow(BookingInputError);
  });
  it('cannot order one that was deleted', () => {
    setAddOnConfig({});
    expect(() => validateAddOns([{ id: 'x-cake', quantity: 1 }])).toThrow(BookingInputError);
  });
});

describe('supplier order email', () => {
  it('lists a custom add-on flagged for a supplier order', () => {
    setAddOnConfig(CONFIG);
    const withCake = booking([{ id: 'x-cake', quantity: 1, options: { unitPrice: 380 } }]);
    const withBalloons = booking([{ id: 'x-balloon', quantity: 2, options: { unitPrice: 30 } }]);
    expect(bookingNeedsSupplierOrder(withCake)).toBe(true);
    expect(bookingNeedsSupplierOrder(withBalloons)).toBe(false);
    const html = buildStaffSupplierOrderEmail({ booking: withCake, venueName: '銅鑼灣', customerName: 'Test', adminUrl: 'https://example.test/admin' }).html;
    expect(html).toContain('生日蛋糕');
    expect(html).toContain('HK$380');
  });
  it('ids: x- prefix', () => {
    expect(isCustomAddOnId('x-cake')).toBe(true);
    expect(isCustomAddOnId('custom-123-0')).toBe(false);
    expect(isCustomAddOnId('drinks')).toBe(false);
  });
});
