// 商業租場使用 — a commercial hire quoted by CS (Heidi 2026-11-13).
//
// Staff type the rent and the 按金; the head count is optional. The typed
// rent must survive every later re-pricing: an add-on edit on a normal
// booking re-derives the rent from venue × guests × hours, which would
// silently replace the agreed figure.

import { describe, it, expect } from 'vitest';
import { calculatePricing, fixedRentOf } from './pricing';
import { monthCloseSales } from './finance';
import { computeGrandTotal } from './bookingMoney';
import { venues } from './venues';
import type { BookingRecord } from '@/types';

const cwb = venues.find((v) => v.id === 'cwb')!;

describe('calculatePricing — typed rent', () => {
  it('uses the typed rent whatever the head count, with no peak surcharge', () => {
    const none = calculatePricing(cwb, true, 4, 0, [], 0, 50, undefined, 12000);
    const many = calculatePricing(cwb, true, 4, 60, [], 0, 50, undefined, 12000);
    expect(none.baseCharge).toBe(12000);
    expect(many.baseCharge).toBe(12000);
    expect(none.subtotal).toBe(12000);
    expect(none.breakdown[0].label.zh).toContain('商業租場');
    expect(none.breakdown.some((r) => r.label.zh.includes('附加費'))).toBe(false);
  });

  it('still prices add-ons by the formula on top of the typed rent', () => {
    // BBQ for 20 of the group (staff head count) + an early set-up hour.
    const p = calculatePricing(cwb, true, 4, 0, [{ id: 'bbq-standard', quantity: 1, options: { pax: 20 } }], 0, 0, undefined, 12000);
    expect(p.addOnTotal).toBe(3160);
    expect(p.subtotal).toBe(15160);
  });

  it('without a typed rent the per-head formula is unchanged', () => {
    const a = calculatePricing(cwb, true, 4, 20, [], 0);
    const b = calculatePricing(cwb, true, 4, 20, [], 0, 0, undefined, undefined);
    expect(b.baseCharge).toBe(a.baseCharge);
    expect(a.baseCharge).toBeGreaterThan(0);
  });
});

describe('fixedRentOf — only commercial bookings pin their rent', () => {
  it('returns the stored rent for a commercial booking, undefined otherwise', () => {
    expect(fixedRentOf({ isCommercial: true, pricing: { baseCharge: 12000 } })).toBe(12000);
    expect(fixedRentOf({ pricing: { baseCharge: 6960 } })).toBeUndefined();
    expect(fixedRentOf(null)).toBeUndefined();
  });
});

describe('a commercial booking in the money helpers and month close', () => {
  const booking = {
    id: 'c', venueId: 'cwb', date: '2026-11-20', status: 'confirmed', isCommercial: true,
    guestCount: 0, adultCount: 0, childCount: 0, addOns: [], payments: [],
    pricing: { baseCharge: 12000, addOnTotal: 0, subtotal: 12000, securityDeposit: 3000, deposit: 15000 },
  } as unknown as BookingRecord;

  it('owes the typed rent plus the typed 按金', () => {
    expect(computeGrandTotal(booking)).toBe(15000);
  });

  it('books the rent under Rent', () => {
    expect(monthCloseSales(booking)).toEqual(expect.objectContaining({ rent: 12000, extPenalty: 0, total: 12000 }));
  });
});
