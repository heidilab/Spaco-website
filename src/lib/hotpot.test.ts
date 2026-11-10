import { describe, expect, it } from 'vitest';
import {
  HOTPOT_EXTRA_SOUP_PRICE,
  finalizeHotpotAddOns,
  hotpotSelectionError,
  hotpotSoupBases,
  hotpotSoupSlots,
  hotpotSoupSummary,
  normalizeHotpotAddOns,
  withHotpotSoups,
} from './hotpot';
import { addOns as catalog, calculatePricing, formatAddOnsForStaff } from './pricing';
import { addOnRevenueForBooking } from './finance';
import { bookingNeedsSupplierOrder, buildStaffSupplierOrderEmail } from './email';
import { venues } from './venues';
import type { BookingRecord } from '@/types';

// Heidi 2026-11-10: a hotpot package must come with a soup base. Under 15
// guests pick one of three (an extra soup base is +$88); 15 or more get two
// included, and the two may be the same soup.
const pkg = (soupBases?: string[]) => ({ id: 'hotpot-standard', quantity: 1, ...(soupBases ? { options: { soupBases } } : {}) });
const extra = { id: 'hotpot-extra-soup', quantity: 1 };

describe('hotpot soup-base rules', () => {
  it('gives one pot under 15 guests, two from 15, plus one per paid extra soup', () => {
    expect(hotpotSoupSlots(14, [pkg()])).toBe(1);
    expect(hotpotSoupSlots(15, [pkg()])).toBe(2);
    expect(hotpotSoupSlots(14, [pkg(), extra])).toBe(2);
    expect(hotpotSoupSlots(30, [{ id: 'hotpot-seafood', quantity: 1 }])).toBe(2);
    expect(hotpotSoupSlots(20, [{ id: 'drinks', quantity: 1 }])).toBe(0);
  });

  it('refuses a package with no soup, too few, too many or an unknown soup', () => {
    expect(hotpotSelectionError([pkg()], 10)).toBe('HOTPOT_SOUP_REQUIRED');
    expect(hotpotSelectionError([pkg([])], 10)).toBe('HOTPOT_SOUP_REQUIRED');
    expect(hotpotSelectionError([pkg(['tomato'])], 15)).toBe('HOTPOT_SOUP_REQUIRED');
    expect(hotpotSelectionError([pkg(['tomato', 'mala'])], 14)).toBe('HOTPOT_SOUP_REQUIRED');
    expect(hotpotSelectionError([pkg(['laksa'])], 10)).toBe('HOTPOT_SOUP_REQUIRED');
    expect(hotpotSelectionError([pkg(['tomato', ''])], 15)).toBe('HOTPOT_SOUP_REQUIRED');
  });

  it('accepts a complete selection, including the same soup twice', () => {
    expect(hotpotSelectionError([pkg(['pork-bone'])], 14)).toBeNull();
    expect(hotpotSelectionError([pkg(['tomato', 'mala'])], 15)).toBeNull();
    expect(hotpotSelectionError([pkg(['mala', 'mala'])], 15)).toBeNull();
    expect(hotpotSelectionError([pkg(['tomato', 'tomato']), extra], 8)).toBeNull();
    expect(hotpotSelectionError([{ id: 'drinks', quantity: 1 }], 8)).toBeNull();
  });

  it('refuses an extra soup base without a hotpot package', () => {
    expect(hotpotSelectionError([extra], 8)).toBe('HOTPOT_EXTRA_SOUP_INVALID');
  });

  it('drops the paid extra soup once the headcount includes two, keeping both picks', () => {
    const before = [pkg(['tomato', 'mala']), extra, { id: 'drinks', quantity: 1 }];
    const after = normalizeHotpotAddOns(before, 15);
    expect(after.map((a) => a.id)).toEqual(['hotpot-standard', 'drinks']);
    expect(hotpotSoupBases(after)).toEqual(['tomato', 'mala']);
    expect(hotpotSelectionError(after, 15)).toBeNull();
  });

  it('trims the second pick when the group falls back under 15', () => {
    const after = normalizeHotpotAddOns([pkg(['tomato', 'mala'])], 14);
    expect(hotpotSoupBases(after)).toEqual(['tomato']);
    expect(hotpotSelectionError(after, 14)).toBeNull();
  });

  it('removes an orphaned extra soup and returns the same array when nothing changes', () => {
    expect(normalizeHotpotAddOns([extra], 8)).toEqual([]);
    const settled = [pkg(['tomato']), { id: 'drinks', quantity: 1 }];
    expect(normalizeHotpotAddOns(settled, 8)).toBe(settled);
    const paidExtra = [pkg(['tomato', 'mala', 'mala']), extra];
    expect(normalizeHotpotAddOns(paidExtra, 20, { stripIncludedExtra: false })).toBe(paidExtra);
  });

  it('writes picks onto the package only and strips blanks before storing', () => {
    const list = withHotpotSoups([{ id: 'drinks', quantity: 1 }, pkg()], ['', 'mala']);
    expect(list[0]).toEqual({ id: 'drinks', quantity: 1 });
    expect(list[1].options?.soupBases).toEqual(['', 'mala']);
    expect(finalizeHotpotAddOns(list)[1].options?.soupBases).toEqual(['mala']);
  });

  it('summarises picks for people, collapsing a repeated soup', () => {
    expect(hotpotSoupSummary(['tomato', 'mala'], 'zh')).toBe('蕃茄湯、麻辣湯');
    expect(hotpotSoupSummary(['pork-bone', 'pork-bone'], 'zh')).toBe('豬骨湯 ×2');
    expect(hotpotSoupSummary(['tomato', 'mala'], 'en')).toBe('Tomato Soup, Spicy Mala Soup');
    expect(hotpotSoupSummary(undefined, 'zh')).toBe('');
  });
});

describe('hotpot pricing and staff surfaces', () => {
  const cwb = venues.find((v) => v.id === 'cwb')!;

  it('charges $88 for the extra soup base everywhere money is computed', () => {
    expect(HOTPOT_EXTRA_SOUP_PRICE).toBe(88);
    expect(catalog.find((a) => a.id === 'hotpot-extra-soup')?.pricePerUnit).toBe(88);
    const priced = calculatePricing(cwb, false, 5, 10, [pkg(['tomato', 'mala']), extra]);
    expect(priced.addOnTotal).toBe(168 * 10 + 88);
    expect(priced.breakdown.find((b) => b.label.zh.includes('額外湯底'))?.amount).toBe(88);
    const booking = { venueId: 'cwb', guestCount: 10, addOns: [pkg(['tomato', 'mala']), extra] } as unknown as BookingRecord;
    expect(addOnRevenueForBooking(booking, 'hotpot-extra-soup')).toBe(88);
  });

  it('prices the same at a venue the old list excluded (e.g. 尖沙咀)', () => {
    const tst = venues.find((v) => v.id === 'tst')!;
    const priced = calculatePricing(tst, false, 5, 16, [{ id: 'hotpot-seafood', quantity: 1, options: { soupBases: ['mala', 'mala'] } }]);
    expect(priced.addOnTotal).toBe(348 * 16);
  });

  it('shows the soup picks on the price breakdown and the staff add-on line', () => {
    const priced = calculatePricing(cwb, false, 5, 16, [pkg(['tomato', 'mala'])]);
    expect(priced.breakdown[1].label.zh).toBe('火鍋標準套餐 (16人 x $168) · 湯底：蕃茄湯、麻辣湯');
    expect(formatAddOnsForStaff([pkg(['tomato', 'mala'])], 'zh')).toBe('火鍋標準套餐 (湯底：蕃茄湯、麻辣湯)');
    expect(formatAddOnsForStaff([pkg()], 'zh')).toBe('火鍋標準套餐 (未揀湯底)');
  });

  it('puts the soup picks in the supplier order email and flags a missing pick', () => {
    const base = {
      id: 'b1', venueId: 'cwb', date: '2026-12-01', startTime: '18:00', endTime: '23:00', hours: 5,
      guestCount: 16, adultCount: 16, childCount: 0,
    };
    const chosen = { ...base, addOns: [pkg(['tomato', 'tomato'])] } as unknown as BookingRecord;
    expect(bookingNeedsSupplierOrder(chosen)).toBe(true);
    const html = buildStaffSupplierOrderEmail({ booking: chosen, venueName: '銅鑼灣', customerName: 'Test', adminUrl: 'https://example.test/admin' }).html;
    expect(html).toContain('蕃茄湯 ×2');
    expect(html).not.toContain('須跟進');

    const missing = { ...base, addOns: [pkg()] } as unknown as BookingRecord;
    const missingHtml = buildStaffSupplierOrderEmail({ booking: missing, venueName: '銅鑼灣', customerName: 'Test', adminUrl: 'https://example.test/admin' }).html;
    expect(missingHtml).toContain('客人未揀湯底（應揀 2 個）');
  });
});
