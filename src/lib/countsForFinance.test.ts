/**
 * Finance-inclusion predicate tests — the Aug-2026 reconciliation.
 *
 * Heidi's manual Financial Master said CWB Aug sales were $106,166; the
 * website export said $114,037. The gap was (a) unpaid ghost bookings
 * counted as revenue with fabricated payment rows, and (b) paid TEST
 * bookings. countsForFinance() is the single shared gate for the
 * aggregator, the Excel export, and the future monthly close — these
 * tests pin each exclusion rule to the incident that motivated it.
 */

import { describe, it, expect } from 'vitest';
import { countsForFinance } from './finance';
import type { BookingRecord } from '@/types';

const base = {
  pricing: { baseCharge: 3000, addOnTotal: 0, subtotal: 3000, securityDeposit: 1000, deposit: 4000 },
} as unknown as BookingRecord;

const mk = (over: Partial<BookingRecord>) => ({ ...base, ...over } as BookingRecord);

describe('countsForFinance', () => {
  it('counts a normally paid booking', () => {
    expect(countsForFinance(mk({ status: 'confirmed', payments: [{ amount: 4000 }] } as never))).toBe(true);
  });

  it('counts a legacy paid booking with empty payments[] but a paid status', () => {
    expect(countsForFinance(mk({ status: 'completed', payments: [] } as never))).toBe(true);
  });

  it('excludes GHOST bookings — unpaid, non-paid status (the $114,037 vs $106,166 gap)', () => {
    // Abandoned checkout attempt: awaiting_payment forever, no payments.
    expect(countsForFinance(mk({ status: 'awaiting_payment', payments: [] } as never))).toBe(false);
    // Receipt uploaded but nothing verified/logged yet — money not real.
    expect(countsForFinance(mk({ status: 'awaiting_review', payments: [] } as never))).toBe(false);
  });

  it('excludes TEST bookings even when genuinely paid (the 5 CWB $3,750 KPay tests)', () => {
    expect(countsForFinance(mk({ status: 'confirmed', isTest: true, payments: [{ amount: 4750 }] } as never))).toBe(false);
  });

  it('excludes cancelled / pending / payment_not_completed regardless of payments', () => {
    for (const status of ['cancelled', 'pending', 'payment_not_completed']) {
      expect(countsForFinance(mk({ status, payments: [{ amount: 4000 }] } as never))).toBe(false);
    }
  });

  it('still counts a future confirmed booking that paid its deposit', () => {
    expect(countsForFinance(mk({ status: 'confirmed', date: '2027-01-01', payments: [{ amount: 2000 }] } as never))).toBe(true);
  });
});

// ── monthCloseSales — her Financial Master's Sales columns ──
import { monthCloseSales } from './finance';

describe('monthCloseSales', () => {
  const booking = (over: Record<string, unknown>) => ({
    id: 'b', venueId: 'cwb', date: '2026-10-30', status: 'completed', guestCount: 10,
    pricing: { baseCharge: 0, addOnTotal: 0, subtotal: 0, securityDeposit: 2000, deposit: 0 },
    payments: [],
    ...over,
  }) as unknown as BookingRecord;

  // Heidi's CWB OCT-2026 sheet, the three rows that 月結 used to get wrong.
  const oct10 = booking({
    pricing: { baseCharge: 13224, addOnTotal: 0, subtotal: 13224 },
    payments: [{ amount: 9235, cardSurcharge: 138.53, method: 'kpay' }, { amount: 6989, cardSurcharge: 104.84, method: 'kpay' }],
  });
  const oct30 = booking({
    pricing: { baseCharge: 15370, addOnTotal: 0, subtotal: 15370 },
    depositRefund: { amount: 2840, deductions: [{ label: '加時', amount: 1160 }] },
  });
  const oct31 = booking({
    pricing: { baseCharge: 8700, addOnTotal: 0, subtotal: 8700 },
    depositRefund: { amount: 260, deductions: [{ label: '加時', amount: 1740 }] },
  });

  it('counts 信用卡手續費 the customer paid as sales', () => {
    const s = monthCloseSales(oct10);
    expect(s.cardSurcharge).toBe(243.37);
    expect(s.total).toBe(13467.37);
  });

  it('counts deposit deductions kept (加時/罰款) as sales', () => {
    expect(monthCloseSales(oct30)).toEqual(expect.objectContaining({ rent: 15370, extPenalty: 1160, total: 16530 }));
    expect(monthCloseSales(oct31).total).toBe(10440);
  });

  it('takes 會員積分優惠 off as a negative column', () => {
    const s = monthCloseSales(booking({ pricing: { baseCharge: 5000, subtotal: 5000 }, pointsDiscount: 150 }));
    expect(s.points).toBe(-150);
    expect(s.total).toBe(4850);
  });

  it('every row adds up, with bill items outside the five columns in 加時/罰款', () => {
    // A $500 custom item on the bill: not Rent/BBQ/Shisha/到會/Drinks.
    const s = monthCloseSales(booking({ pricing: { baseCharge: 6000, addOnTotal: 500, subtotal: 6500 } }));
    expect(s.extPenalty).toBe(500);
    expect(s.total).toBe(6500);
    expect(s.rent + s.bbqHotpot + s.shisha + s.cater + s.drinks + s.points + s.cardSurcharge + s.extPenalty).toBe(s.total);
  });

  it('leaves out settlement debt not received: 加時/罰款 first, then rent', () => {
    // $1,740 deducted, $500 of it still owed at month end.
    expect(monthCloseSales(oct31, 500)).toEqual(expect.objectContaining({ rent: 8700, extPenalty: 1240, total: 9940 }));
    // More owed than was deducted: the rest comes off rent.
    expect(monthCloseSales(oct31, 2000)).toEqual(expect.objectContaining({ rent: 8440, extPenalty: 0, total: 8440 }));
  });
});
