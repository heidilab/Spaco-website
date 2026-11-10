import { describe, expect, it } from 'vitest';
import {
  HOTPOT_EXTRA_SOUP_PRICE,
  finalizeHotpotAddOns,
  hkDaysUntil,
  hotpotExtraSoupOffset,
  hotpotTooLate,
  hotpotSelectionError,
  hotpotSoupBases,
  hotpotSoupSlots,
  hotpotSoupSummary,
  normalizeHotpotAddOns,
  withHotpotSoups,
} from './hotpot';
import { addOns as catalog, adultEquivalent, calculatePricing, formatAddOnsForStaff } from './pricing';
import { addOnRevenueForBooking } from './finance';
import { bookingNeedsSupplierOrder, buildStaffSupplierOrderEmail } from './email';
import { venues } from './venues';
import type { BookingRecord } from '@/types';

// Heidi 2026-11-10: a hotpot package must come with a soup base. The 15 line
// is the CHARGED headcount (a child counts ½). Under 15 pick one of three (an
// extra soup base is +$108); 15 or more get two included, and the two may be
// the same soup. Every number passed below is that charged headcount.
const pkg = (soupBases?: string[]) => ({ id: 'hotpot-standard', quantity: 1, ...(soupBases ? { options: { soupBases } } : {}) });
const extra = { id: 'hotpot-extra-soup', quantity: 1 };

describe('hotpot soup-base rules', () => {
  it('counts a child as half: 7 adults + 3 children is 8.5, not 10', () => {
    expect(hotpotSoupSlots(adultEquivalent(7, 3), [pkg()])).toBe(1);
    // 16 heads but only 14 charged → still one soup.
    expect(hotpotSoupSlots(adultEquivalent(12, 4), [pkg()])).toBe(1);
    // 14 adults + 2 children = 15 charged → two soups.
    expect(hotpotSoupSlots(adultEquivalent(14, 2), [pkg()])).toBe(2);
    expect(hotpotSoupSlots(14.5, [pkg()])).toBe(1);
  });

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

describe('a booking that grows to 15 offsets the extra soup it paid for', () => {
  const booked = [pkg(['tomato', 'mala']), extra, { id: 'drinks', quantity: 1 }];

  it('offsets $108 only when the charged headcount crosses from under 15 to 15', () => {
    expect(hotpotExtraSoupOffset(booked, 12, 15)).toBe(108);
    expect(hotpotExtraSoupOffset(booked, 14.5, 15.5)).toBe(108);
    expect(hotpotExtraSoupOffset(booked, 12, 14)).toBe(0);   // still under 15
    expect(hotpotExtraSoupOffset(booked, 15, 18)).toBe(0);   // was already 15+
    expect(hotpotExtraSoupOffset([pkg(['tomato'])], 12, 16)).toBe(0); // no extra soup bought
    expect(hotpotExtraSoupOffset([extra], 12, 16)).toBe(0);  // no hotpot package
  });

  it('nets the offset against the added guests and keeps both soups', () => {
    const cwb = venues.find((v) => v.id === 'cwb')!;
    const before = calculatePricing(cwb, false, 5, 12, booked);
    const afterAddOns = normalizeHotpotAddOns(booked, 15);
    const after = calculatePricing(cwb, false, 5, 15, afterAddOns);
    const perGuest = cwb.pricing.weekday.perHead * 5 + 168 + 25; // rent + hotpot + drinks
    expect(after.subtotal - before.subtotal).toBe(3 * perGuest - 108);
    expect(hotpotSoupBases(afterAddOns)).toEqual(['tomato', 'mala']);
    expect(hotpotSelectionError(afterAddOns, 15)).toBeNull();
  });
});

describe('hotpot needs 3 days notice', () => {
  const now = Date.parse('2026-11-10T15:00:00+08:00');
  it('counts whole Hong Kong calendar days', () => {
    expect(hkDaysUntil('2026-11-10', now)).toBe(0);
    expect(hkDaysUntil('2026-11-13', now)).toBe(3);
    // 23:30 HKT is still the 10th in Hong Kong, even though UTC has not rolled over either.
    expect(hkDaysUntil('2026-11-13', Date.parse('2026-11-10T23:30:00+08:00'))).toBe(3);
    // 00:30 HKT on the 11th is already the 11th in Hong Kong (the 10th in UTC).
    expect(hkDaysUntil('2026-11-13', Date.parse('2026-11-11T00:30:00+08:00'))).toBe(2);
  });
  it('refuses an event 2 days away and accepts one 3 days away', () => {
    expect(hotpotTooLate('2026-11-11', now)).toBe(true);
    expect(hotpotTooLate('2026-11-12', now)).toBe(true);
    expect(hotpotTooLate('2026-11-13', now)).toBe(false);
  });
});

describe('hotpot pricing and staff surfaces', () => {
  const cwb = venues.find((v) => v.id === 'cwb')!;

  it('charges $108 for the extra soup base everywhere money is computed', () => {
    expect(HOTPOT_EXTRA_SOUP_PRICE).toBe(108);
    expect(catalog.find((a) => a.id === 'hotpot-extra-soup')?.pricePerUnit).toBe(108);
    const priced = calculatePricing(cwb, false, 5, 10, [pkg(['tomato', 'mala']), extra]);
    expect(priced.addOnTotal).toBe(168 * 10 + 108);
    expect(priced.breakdown.find((b) => b.label.zh.includes('額外湯底'))?.amount).toBe(108);
    const booking = { venueId: 'cwb', guestCount: 10, addOns: [pkg(['tomato', 'mala']), extra] } as unknown as BookingRecord;
    expect(addOnRevenueForBooking(booking, 'hotpot-extra-soup')).toBe(108);
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
