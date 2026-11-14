// 按金結算 arithmetic (site review 2026-11-13, phase 5, #21) and the
// payment follow-up job's bookkeeping (#8).

import { describe, it, expect } from 'vitest';
import { settlementPlan, cleanDeductions } from './settlementPlan';
import { remainingSteps, nextJobState, MAX_FINALIZATION_ATTEMPTS } from './finalizationSteps';

const booking = (over: Record<string, unknown> = {}) => ({
  userId: 'u1',
  pricing: { baseCharge: 3000, addOnTotal: 500, subtotal: 3500, securityDeposit: 1000, grandTotal: 4500, deposit: 4500 },
  payments: [{ amount: 4500 }],
  promoDiscount: 0, pointsDiscount: 0,
  ...over,
});

describe('settlementPlan', () => {
  it('no deductions: full refund, completed, points on the net spend only', () => {
    const p = settlementPlan(booking(), []);
    expect(p).toMatchObject({ total: 0, refund: 1000, owed: 0, consumedDeposit: 0, status: 'completed', expectedPoints: 3500, pointsPendingOverflow: 0, pointsDelta: 3500 });
  });
  it('deductions within the deposit: the kept part earns points', () => {
    const p = settlementPlan(booking(), [{ label: '冷氣', amount: 800 }, { label: 'x', amount: 0 }, { label: '', amount: 5 }]);
    expect(p.deductions).toEqual([{ label: '冷氣', amount: 800 }]);
    expect(p).toMatchObject({ refund: 200, owed: 0, consumedDeposit: 800, status: 'completed', expectedPoints: 4300, pointsDelta: 4300 });
  });
  it('deductions beyond the deposit: the overflow is owed and its points wait', () => {
    const p = settlementPlan(booking(), [{ label: '加時', amount: 1392 }]);
    expect(p).toMatchObject({ refund: 0, owed: 392, consumedDeposit: 1000, status: 'confirmed', expectedPoints: 4500, pointsPendingOverflow: 392 });
    // Once the overflow was paid and credited, the expectation includes it.
    const paid = settlementPlan(booking({ pointsOverflowCreditedAt: 1, pointsCreditedAt: 1, pointsActuallyCredited: 4892 }), [{ label: '加時', amount: 1392 }]);
    expect(paid).toMatchObject({ expectedPoints: 4892, pointsPendingOverflow: 0, pointsDelta: 0 });
  });
  it('an amendment moves points by the difference, never below what was credited twice', () => {
    const b = booking({ pointsCreditedAt: 1, pointsActuallyCredited: 4300 });
    expect(settlementPlan(b, [{ label: '冷氣', amount: 500 }]).pointsDelta).toBe(-300);
    expect(settlementPlan(b, [{ label: '冷氣', amount: 1000 }]).pointsDelta).toBe(200);
    expect(settlementPlan(booking({ userId: '' }), []).pointsDelta).toBe(0);
  });
  it('promo and points discounts come off the earning base', () => {
    const p = settlementPlan(booking({ promoDiscount: 500, pointsDiscount: 100 }), []);
    expect(p.expectedPoints).toBe(2900);
  });
  it('cleanDeductions drops junk', () => {
    expect(cleanDeductions([{ label: ' a ', amount: '12.345' }, null, { label: 'b', amount: -1 }, { amount: 3 }])).toEqual([{ label: 'a', amount: 12.35 }]);
    expect(cleanDeductions('x')).toEqual([]);
  });
});

describe('payment follow-up job', () => {
  it('retries only what is left, then gives up after the cap', () => {
    expect(remainingSteps(undefined)).toEqual(['slots', 'email', 'lock', 'staff', 'gcal']);
    expect(remainingSteps({ slots: true, email: true, staff: true })).toEqual(['lock', 'gcal']);
    expect(nextJobState(1, [])).toBe('done');
    expect(nextJobState(2, ['gcal'])).toBe('pending');
    expect(nextJobState(MAX_FINALIZATION_ATTEMPTS, ['gcal'])).toBe('failed');
  });
});
