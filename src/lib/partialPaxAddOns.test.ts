// Per-person food packages charged for only part of the group
// (options.pax) — Heidi 2026-11-13.
//
// A customer books for 39 and asks staff for BBQ for 20 of them. Staff
// were typing a custom item "BBQ Package For 20ppl $3,160", which month
// close could not tell from a penalty: the money went to 加時/罰款 instead
// of BBQ/Hotpot. The package itself now carries the head count.

import { describe, it, expect } from 'vitest';
import { calculatePricing, addOnPartialPax, formatAddOnsForStaff } from './pricing';
import { addOnRevenueForBooking, monthCloseSales, salesCategoryBreakdown } from './finance';
import { validateAddOns } from './bookingSecurity';
import { venues } from './venues';
import type { BookingRecord } from '@/types';

const cwb = venues.find((v) => v.id === 'cwb')!;

describe('calculatePricing — package for part of the group', () => {
  // 33 adults + 6 children = 39 guests, 36 adult-equivalents.
  const price = (addOns: Parameters<typeof calculatePricing>[4]) =>
    calculatePricing(cwb, true, 5, 39, addOns, 6);

  it('charges the whole group when no head count is set', () => {
    const p = price([{ id: 'bbq-standard', quantity: 1 }]);
    expect(p.addOnTotal).toBe(158 * 36);
  });

  it('charges only the head count staff entered — her $3,160 for 20', () => {
    const p = price([{ id: 'bbq-standard', quantity: 1, options: { pax: 20 } }]);
    expect(p.addOnTotal).toBe(3160);
    expect(p.subtotal).toBe(p.baseCharge + 3160);
    expect(p.breakdown.some((row) => row.label.zh.includes('20位') && row.amount === 3160)).toBe(true);
  });

  it('works for the premium BBQ and both hotpot packages', () => {
    expect(price([{ id: 'bbq-premium', quantity: 1, options: { pax: 10 } }]).addOnTotal).toBe(3280);
    expect(price([{ id: 'hotpot-standard', quantity: 1, options: { pax: 12 } }]).addOnTotal).toBe(168 * 12);
    expect(price([{ id: 'hotpot-seafood', quantity: 1, options: { pax: 12 } }]).addOnTotal).toBe(348 * 12);
  });

  it('ignores a head count on anything else, and junk values', () => {
    // Drinks are always the whole group (promos depend on it).
    const whole = price([{ id: 'drinks', quantity: 1 }]).addOnTotal;
    expect(price([{ id: 'drinks', quantity: 1, options: { pax: 2 } }]).addOnTotal).toBe(whole);
    expect(addOnPartialPax({ id: 'bbq-standard', options: { pax: 0 } })).toBeNull();
    expect(addOnPartialPax({ id: 'bbq-standard', options: { pax: -5 } })).toBeNull();
    expect(addOnPartialPax({ id: 'bbq-standard' })).toBeNull();
    expect(addOnPartialPax({ id: 'bbq-standard', options: { pax: 20 } })).toBe(20);
  });
});

describe('month close — the money lands in BBQ/Hotpot, not 加時/罰款', () => {
  const booking = (addOns: BookingRecord['addOns'], addOnTotal: number) => ({
    id: 'b', venueId: 'cwb', date: '2026-11-20', status: 'confirmed',
    guestCount: 39, adultCount: 33, childCount: 6,
    addOns, payments: [],
    pricing: { baseCharge: 10440, addOnTotal, subtotal: 10440 + addOnTotal, securityDeposit: 2000, deposit: 0 },
  }) as unknown as BookingRecord;

  it('a package for 20 is $3,160 of BBQ/Hotpot', () => {
    const b = booking([{ id: 'bbq-standard', quantity: 1, options: { pax: 20 } }], 3160);
    expect(addOnRevenueForBooking(b, 'bbq-standard')).toBe(3160);
    expect(salesCategoryBreakdown(b).bbqHotpot).toBe(3160);
    expect(monthCloseSales(b)).toEqual(expect.objectContaining({ rent: 10440, bbqHotpot: 3160, extPenalty: 0, total: 13600 }));
  });

  it('the old custom-item workaround put the same money in 加時/罰款', () => {
    const b = booking([{ id: 'custom-1', quantity: 1, options: { customName: 'BBQ Package For 20ppl', customPrice: 3160 } }], 3160);
    expect(monthCloseSales(b)).toEqual(expect.objectContaining({ bbqHotpot: 0, extPenalty: 3160, total: 13600 }));
  });
});

describe('staff-only: a customer cannot set the head count', () => {
  it('validateAddOns drops options.pax from customer requests', () => {
    const out = validateAddOns([
      { id: 'bbq-standard', quantity: 1, options: { pax: 1 } },
      { id: 'hotpot-standard', quantity: 1, options: { pax: 1, soupBases: ['tomato'] } },
    ]);
    expect(out[0].options).toEqual({});
    expect(out[1].options).toEqual({ soupBases: ['tomato'] });
    for (const a of out) expect(addOnPartialPax(a)).toBeNull();
  });
});

describe('staff labels — the cleaner and the supplier see the number', () => {
  it('names the head count on a partial package', () => {
    expect(formatAddOnsForStaff([{ id: 'bbq-standard', quantity: 1, options: { pax: 20 } }], 'zh')).toContain('×20位');
    expect(formatAddOnsForStaff([{ id: 'bbq-standard', quantity: 1 }], 'zh')).not.toContain('×');
    expect(formatAddOnsForStaff([{ id: 'hotpot-standard', quantity: 1, options: { pax: 12, soupBases: ['tomato'] } }], 'zh')).toContain('12位');
  });
});
