/**
 * REGRESSION TESTS — one block per real production incident.
 *
 * Each test encodes what actually went wrong on a live booking. If a
 * future change breaks one, the build fails before it can reach a
 * customer. Do not delete a case because it "looks redundant" — the two
 * outstanding-balance cases in particular look similar and are exact
 * opposites, and fixing one by breaking the other has happened twice.
 */

import { describe, it, expect } from 'vitest';
import {
  POINTS_PER_HKD, pointsToHkd, hkdToPoints,
  grossSubtotal, computeGrandTotal, netConsumption, displayBillTotal, discountedSubtotal,
  paidBase, surchargePaid, paidGateway, computeBalanceDue,
  amountOwed, hasOutstanding, isSettlementOverflow,
  commissionForBooking, estimatedKpayFee,
} from './bookingMoney';

describe('points conversion', () => {
  // A1 create route stored pointsDiscount = pointsUsed (1pt = $1), a 100x
  // error: a 1,500-point redemption showed as -HK$1,500 instead of -HK$15.
  it('converts at 100 points = HK$1', () => {
    expect(POINTS_PER_HKD).toBe(100);
    expect(pointsToHkd(1500)).toBe(15);
    expect(pointsToHkd(0)).toBe(0);
    expect(hkdToPoints(15)).toBe(1500);
  });

  it('round-trips', () => {
    expect(pointsToHkd(hkdToPoints(42))).toBe(42);
  });

  it('FLOORS redemption to whole dollars so nobody can redeem more than they hold', () => {
    expect(pointsToHkd(1550)).toBe(15);   // not 15.5
    expect(pointsToHkd(99)).toBe(0);
    expect(hkdToPoints(-5)).toBe(0);
  });
});

describe('subtotal convention', () => {
  // Root cause of years of pricing drift: pricing.subtotal had two live
  // conventions (pre-promo gross vs post-promo net). Gross is canonical.
  it('is GROSS, pre-promo: baseCharge + addOnTotal', () => {
    expect(grossSubtotal({ baseCharge: 3000, addOnTotal: 500 })).toBe(3500);
  });

  it('treats missing parts as zero rather than NaN', () => {
    expect(grossSubtotal(undefined)).toBe(0);
    expect(grossSubtotal({ baseCharge: 3000 })).toBe(3000);
  });
});

describe('grand total', () => {
  it('deducts promo AND points, then adds the refundable deposit', () => {
    const b = {
      pricing: { baseCharge: 3000, addOnTotal: 0, securityDeposit: 1000 },
      promoDiscount: 600,
      pointsDiscount: 15,
    };
    expect(computeGrandTotal(b)).toBe(3000 - 600 - 15 + 1000);
  });

  it('never lets discounts push the consumption total negative', () => {
    const b = {
      pricing: { baseCharge: 500, addOnTotal: 0, securityDeposit: 1000 },
      promoDiscount: 9999,
    };
    // Deposit still payable; consumption floors at 0, not -9499.
    expect(computeGrandTotal(b)).toBe(1000);
  });
});

describe('netConsumption — the loyalty-earning basis', () => {
  it('excludes the refundable deposit so points are not credited for it', () => {
    const b = {
      pricing: { baseCharge: 3000, addOnTotal: 500, securityDeposit: 1000 },
      promoDiscount: 600,
      pointsDiscount: 15,
    };
    expect(netConsumption(b)).toBe(3000 + 500 - 600 - 15);
    expect(computeGrandTotal(b)).toBe(netConsumption(b) + 1000);
  });

  it('floors at zero when discounts exceed consumption', () => {
    expect(netConsumption({
      pricing: { baseCharge: 100, addOnTotal: 0, securityDeposit: 1000 },
      promoDiscount: 500,
    })).toBe(0);
  });
});

describe('discountedSubtotal — the displayed 小計 (#nbWTrtyG)', () => {
  it('deducts the promo so a 小計 under a −優惠碼 line reads correctly', () => {
    expect(discountedSubtotal(1650, 150)).toBe(1500);
  });
  it('passes gross through when no promo', () => {
    expect(discountedSubtotal(1650, undefined)).toBe(1650);
  });
  it('floors at zero', () => {
    expect(discountedSubtotal(100, 500)).toBe(0);
  });
});

describe('display bill total (customer-facing 總計)', () => {
  // my-bookings folded points INTO the total (-> $1,900) while showing
  // pricing.deposit as 已付 (-> $3,400), so the two looked swapped and
  // disagreed with the payment page.
  it('EXCLUDES points so they can be shown as a separate redemption line', () => {
    const b = {
      pricing: { baseCharge: 3000, addOnTotal: 0, securityDeposit: 1000 },
      promoDiscount: 600,
      pointsDiscount: 15,
    };
    expect(displayBillTotal(b)).toBe(3400);
    // And it must NOT equal the canonical total when points are in play.
    expect(displayBillTotal(b)).not.toBe(computeGrandTotal(b));
  });

  it('equals the canonical total when no points were redeemed', () => {
    const b = {
      pricing: { baseCharge: 3000, addOnTotal: 0, securityDeposit: 1000 },
      promoDiscount: 600,
    };
    expect(displayBillTotal(b)).toBe(computeGrandTotal(b));
  });

  it('reconciles: 總計 − 已付現金 − 積分 = 0 on a fully settled booking', () => {
    const b = {
      pricing: { baseCharge: 3000, addOnTotal: 0, securityDeposit: 1000 },
      promoDiscount: 600,
      pointsDiscount: 15,
      payments: [{ amount: 3385 }],
    };
    expect(displayBillTotal(b) - paidBase(b) - (b.pointsDiscount || 0)).toBe(0);
    expect(computeBalanceDue(b)).toBe(0);
  });
});

describe('payments', () => {
  // "已付" showed pricing.deposit, which matched neither the credited
  // amount nor what KPay actually charged the customer's card.
  const booking = {
    pricing: { baseCharge: 3000, addOnTotal: 0, securityDeposit: 1000 },
    promoDiscount: 600,
    pointsDiscount: 15,
    payments: [{ amount: 3385, cardSurcharge: 50.78 }],
  };

  it('credits only the base amount to the bill', () => {
    expect(paidBase(booking)).toBe(3385);
  });

  it('reports the gateway gross (base + card fee) for the customer', () => {
    expect(surchargePaid(booking)).toBe(50.78);
    expect(paidGateway(booking)).toBe(3435.78);
  });

  it('does not let the surcharge pay down the bill', () => {
    // Surcharge is KPay's fee, not revenue against the booking.
    expect(computeBalanceDue(booking)).toBe(0);
    expect(paidGateway(booking)).toBeGreaterThan(paidBase(booking));
  });

  it('sums multiple payments (deposit + balance top-up)', () => {
    const b = {
      pricing: { baseCharge: 10000, addOnTotal: 0, securityDeposit: 2000 },
      payments: [{ amount: 6000 }, { amount: 4000 }],
    };
    expect(paidBase(b)).toBe(10000);
    expect(computeBalanceDue(b)).toBe(2000);
  });
});

describe('amountOwed — the outstanding-balance card gate', () => {
  // These two cases are EXACT OPPOSITES. Fixing one by narrowing the gate
  // has broken the other twice in production. Both must stay green.

  it('#2qzYQOU4 — never-paid offline booking: stored balanceDue is 0 but money is owed', () => {
    // Customer sent an FPS transfer late; nothing recorded yet. balanceDue
    // is the balance AFTER the deposit, so it sits at 0 on a fresh booking.
    const b = {
      pricing: { baseCharge: 3000, addOnTotal: 0, securityDeposit: 1000, deposit: 4000 },
      balanceDue: 0,
      payments: [],
    };
    expect(computeBalanceDue(b)).toBe(4000);
    expect(amountOwed(b)).toBe(4000);
    expect(hasOutstanding(b)).toBe(true);   // card MUST show
    expect(isSettlementOverflow(b)).toBe(false);
  });

  it('#LSi5Z31A — settlement overflow: bill fully paid but balanceDue is owed', () => {
    // Deposit settled; deductions exceeded the deposit by $650, written to
    // balanceDue. The original bill is fully paid, so the derived balance
    // is 0 — gating on that alone hid the card and the record button.
    const b = {
      pricing: { baseCharge: 3000, addOnTotal: 0, securityDeposit: 1000 },
      balanceDue: 650,
      payments: [{ amount: 4000 }],
      depositRefund: { amount: 350, settledAt: 'x' },
    };
    expect(computeBalanceDue(b)).toBe(0);
    expect(amountOwed(b)).toBe(650);
    expect(hasOutstanding(b)).toBe(true);   // card MUST show
    expect(isSettlementOverflow(b)).toBe(true);
  });

  it('#AZAyNn7d1r — admin top-up on a completed booking still surfaces', () => {
    const b = {
      pricing: { baseCharge: 4000, addOnTotal: 1000, securityDeposit: 1000 },
      balanceDue: 1000,
      payments: [{ amount: 5000 }],
    };
    expect(amountOwed(b)).toBe(1000);
    expect(hasOutstanding(b)).toBe(true);
  });

  it('stays hidden only when nothing at all is owed', () => {
    const b = {
      pricing: { baseCharge: 3000, addOnTotal: 0, securityDeposit: 1000 },
      balanceDue: 0,
      payments: [{ amount: 4000 }],
    };
    expect(amountOwed(b)).toBe(0);
    expect(hasOutstanding(b)).toBe(false);
  });

  it('takes the larger term when both point at money owed', () => {
    const b = {
      pricing: { baseCharge: 5000, addOnTotal: 0, securityDeposit: 1000 },
      balanceDue: 800,
      payments: [{ amount: 5500 }],
    };
    expect(computeBalanceDue(b)).toBe(500);
    expect(amountOwed(b)).toBe(800);
  });
});

describe('overpayment', () => {
  it('clamps to zero rather than showing a negative balance', () => {
    const b = {
      pricing: { baseCharge: 3000, addOnTotal: 0, securityDeposit: 1000 },
      payments: [{ amount: 5000 }],
    };
    expect(computeBalanceDue(b)).toBe(0);
    expect(amountOwed(b)).toBe(0);
  });
});

describe('commissionForBooking — broker rules (Finance Phase 2)', () => {
  const broker = {
    pricing: { baseCharge: 10000, addOnTotal: 3160, securityDeposit: 2000 },
  };

  it('行家 rule charges RENT ONLY — food/drinks exempt (Heidi 2026-09)', () => {
    expect(commissionForBooking(broker, { pct: 10, base: 'rent' })).toBe(1000);
  });

  it('platform rule (Reubird) charges the full consumption subtotal', () => {
    expect(commissionForBooking(broker, { pct: 10, base: 'total' })).toBe(1316);
  });

  it('per-booking negotiated override wins outright', () => {
    expect(commissionForBooking({ ...broker, commissionOverride: 888 }, { pct: 10, base: 'rent' })).toBe(888);
    expect(commissionForBooking({ ...broker, commissionOverride: 0 }, { pct: 10, base: 'rent' })).toBe(0);
  });

  it('no rule = no commission (Instagram customers are not brokers)', () => {
    expect(commissionForBooking(broker, undefined)).toBe(0);
  });

  it('deposit never enters the base', () => {
    expect(commissionForBooking({ pricing: { baseCharge: 0, addOnTotal: 0, securityDeposit: 2000 } }, { pct: 10, base: 'total' })).toBe(0);
  });
});

describe('estimatedKpayFee', () => {
  it('estimates pct on KPay base amounts only (surcharge + FPS excluded)', () => {
    const b = {
      pricing: { baseCharge: 5000, addOnTotal: 0, securityDeposit: 1000 },
      payments: [
        { amount: 3000, cardSurcharge: 45, method: 'kpay' },
        { amount: 2000, method: 'fps' },
      ] as never,
    };
    expect(estimatedKpayFee(b, 1.5)).toBe(45);
    expect(estimatedKpayFee(b, 0)).toBe(0);
  });
});
