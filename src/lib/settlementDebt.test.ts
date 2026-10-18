import { describe, expect, it } from 'vitest';
import { debtReminderStage, hktMonth, outstandingDebts, settlementCashTiming, settlementDebt, toMillis } from './settlementDebt';

const DAY = 24 * 60 * 60 * 1000;
const settled = Date.parse('2026-10-11T04:00:00Z');
// Heidi's example: bill 4,000 incl. deductions, customer had paid 3,000
// incl. deposit → owes 1,000 after settlement.
const debtor = {
  id: 'oct-booking', status: 'confirmed', date: '2026-10-10', userId: 'u1', branchSlug: 'sheung-wan-a',
  pricing: { baseCharge: 2000, addOnTotal: 0, securityDeposit: 1000 },
  payments: [{ amount: 3000, recordedAt: '2026-10-01T02:00:00Z' }],
  depositRefund: { amount: 0, deductions: [{ amount: 2000 }], refundedAt: { seconds: settled / 1000 } },
  balanceDue: 1000,
};

describe('settlement debt — who is blocked (Heidi 2026-10-18)', () => {
  it('counts the post-settlement shortfall', () => {
    expect(settlementDebt(debtor)).toBe(1000);
    expect(outstandingDebts([debtor])).toEqual([expect.objectContaining({ bookingId: 'oct-booking', amount: 1000 })]);
  });
  it('lifts automatically once balanceDue is cleared, by any payment route', () => {
    expect(settlementDebt({ ...debtor, balanceDue: 0, status: 'completed', payments: [...debtor.payments, { amount: 1000 }] })).toBe(0);
  });
  it('ignores unsettled balances, cancelled and test bookings', () => {
    expect(settlementDebt({ ...debtor, depositRefund: null })).toBe(0);
    expect(settlementDebt({ ...debtor, status: 'cancelled' })).toBe(0);
    expect(settlementDebt({ ...debtor, isTest: true })).toBe(0);
  });
  it('counts test bookings only on the preview site', () => {
    expect(settlementDebt({ ...debtor, isTest: true }, { includeTest: true })).toBe(1000);
    expect(settlementCashTiming({ ...debtor, isTest: true }, { includeTest: true }).excludedFromEventMonth).toBe(1000);
  });
});

describe('reminder emails on day 14 and day 30 only', () => {
  it.each([[13, null], [14, 14], [29, 14], [30, 30], [90, 30]])('day %i → %s', (day, stage) => {
    expect(debtReminderStage(debtor, settled + day * DAY + 1000)).toBe(stage);
  });
  it('never repeats a sent stage and stops after day 30', () => {
    expect(debtReminderStage({ ...debtor, settlementDebtReminder14SentAt: 'x' }, settled + 20 * DAY)).toBeNull();
    expect(debtReminderStage({ ...debtor, settlementDebtReminder14SentAt: 'x' }, settled + 31 * DAY)).toBe(30);
    expect(debtReminderStage({ ...debtor, settlementDebtReminder14SentAt: 'x', settlementDebtReminder30SentAt: 'y' }, settled + 60 * DAY)).toBeNull();
  });
  it('sends nothing once paid', () => {
    expect(debtReminderStage({ ...debtor, balanceDue: 0, status: 'completed', payments: [...debtor.payments, { amount: 1000 }] }, settled + 15 * DAY)).toBeNull();
  });
});

describe('month close — 收到先計', () => {
  it('excludes the unpaid 1,000 from October', () => {
    expect(settlementCashTiming(debtor)).toEqual({ excludedFromEventMonth: 1000, late: [] });
  });
  it('a December payment is December income tagged to the October booking', () => {
    const paidDec = { ...debtor, status: 'completed', balanceDue: 0, payments: [...debtor.payments, { amount: 1000, recordedAt: '2026-12-05T12:00:00.000Z' }] };
    expect(settlementCashTiming(paidDec)).toEqual({ excludedFromEventMonth: 1000, late: [{ month: '2026-12', amount: 1000 }] });
  });
  it('a payment before the end of October stays October revenue', () => {
    const paidOct = { ...debtor, status: 'completed', balanceDue: 0, payments: [...debtor.payments, { amount: 1000, recordedAt: '2026-10-31T15:00:00Z' }] };
    expect(settlementCashTiming(paidOct)).toEqual({ excludedFromEventMonth: 0, late: [] });
  });
  it('uses Hong Kong time at the month boundary', () => {
    expect(hktMonth(Date.parse('2026-10-31T16:30:00Z'))).toBe('2026-11');
    expect(hktMonth(Date.parse('2026-10-31T15:30:00Z'))).toBe('2026-10');
  });
  it('payments before settlement and refunds are never late collections', () => {
    const b = { ...debtor, payments: [...debtor.payments, { amount: -200, recordedAt: '2026-12-01T00:00:00Z' }] };
    expect(settlementCashTiming(b).late).toEqual([]);
    expect(settlementCashTiming({ ...debtor, depositRefund: null }).excludedFromEventMonth).toBe(0);
  });
});

describe('toMillis', () => {
  it('reads every timestamp shape', () => {
    expect(toMillis({ toMillis: () => 5 })).toBe(5);
    expect(toMillis({ _seconds: 2 })).toBe(2000);
    expect(toMillis('2026-10-01T00:00:00Z')).toBe(Date.parse('2026-10-01T00:00:00Z'));
    expect(toMillis(undefined)).toBeNull();
  });
});
