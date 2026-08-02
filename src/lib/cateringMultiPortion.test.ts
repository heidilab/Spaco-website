/**
 * Catering multi-portion regression tests.
 *
 * Heidi's spec: a customer may order MANY portions of the same dish
 * (e.g. 20× dish 102). `dishCodes` carries one entry per portion, so the
 * same code repeats. These tests pin that pricing counts ENTRIES — a
 * `.includes()`-style dedupe once collapsed repeated portions into one,
 * undercharging and (worse) sending the supplier a one-line order for a
 * twenty-portion booking.
 */

import { describe, it, expect } from 'vitest';
import { calcCateringTotal } from './pricing';

// Fixtures from cateringMenu.ts: tier-10 = 12 picks / $1,808;
// extra dish fee $155; A1 addon dish $298.
const TIER = 'tier-10';
const TIER_PRICE = 1808;
const EXTRA_FEE = 155;

describe('calcCateringTotal — repeated dishCodes', () => {
  it('same dish 20× counts as 20 portions toward the tier', () => {
    // 20 portions of dish 102 on a 12-pick tier → 8 extras.
    const total = calcCateringTotal({ tierId: TIER, dishCodes: Array(20).fill('102') });
    expect(total).toBe(TIER_PRICE + 8 * EXTRA_FEE);
  });

  it('mixed repeats count per entry, not per distinct dish', () => {
    // 10× '102' + 2× '103' = 12 portions = exactly the tier, no extras.
    const total = calcCateringTotal({
      tierId: TIER,
      dishCodes: [...Array(10).fill('102'), '103', '103'],
    });
    expect(total).toBe(TIER_PRICE);
  });

  it('repeated A1-A10 addon dishes charge their own price × qty', () => {
    const total = calcCateringTotal({
      tierId: TIER,
      dishCodes: ['102', 'A1', 'A1', 'A1'],
    });
    // 1 non-addon portion (within tier) + 3 × $298 addon drinks.
    expect(total).toBe(TIER_PRICE + 3 * 298);
  });

  it('legacy unique-code bookings price exactly as before', () => {
    const total = calcCateringTotal({ tierId: TIER, dishCodes: ['101', '102', '103'] });
    expect(total).toBe(TIER_PRICE);
  });

  it('unknown codes are ignored rather than crashing or charging', () => {
    const total = calcCateringTotal({ tierId: TIER, dishCodes: ['102', 'ZZZ', 'ZZZ'] });
    expect(total).toBe(TIER_PRICE);
  });
});
