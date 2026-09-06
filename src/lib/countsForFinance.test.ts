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
