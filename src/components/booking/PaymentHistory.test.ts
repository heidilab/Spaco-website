import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BookingRecord } from '@/types';
vi.mock('@/lib/adminApiFetch', () => ({ adminApiFetch: vi.fn() }));
import PaymentHistory from './PaymentHistory';

function fixture(fee?: number): BookingRecord {
  return {
    pricing: { subtotal: 3000, securityDeposit: 1000, total: 4000 },
    balanceDue: 2000,
    payments: [{ amount: 2000, cardSurcharge: fee, method: 'kpay', kind: 'initial', recordedAt: '2026-10-01T12:00:00Z' }],
  } as BookingRecord;
}
describe('payment history card fee display', () => {
  it('shows recorded fee and gross receipt without changing principal or balance', () => {
    const booking = fixture(30);
    const before = JSON.stringify(booking);
    const html = renderToStaticMarkup(React.createElement(PaymentHistory, { booking, locale: 'zh' }));
    expect(html).toContain('HK$2,030');
    expect(html).toContain('HK$2,000');
    expect(html).toContain('信用卡手續費');
    expect(html).toContain('HK$30.00');
    expect(html).toContain('此筆實收（本金＋手續費）');
    expect(JSON.stringify(booking)).toBe(before);
  });
  it('does not invent a fee for legacy or wallet records', () => {
    const html = renderToStaticMarkup(React.createElement(PaymentHistory, { booking: fixture(), locale: 'en' }));
    expect(html).toContain('HK$2,000');
    expect(html).not.toContain('Received (principal + fee)');
    expect(html).not.toContain('NaN');
  });
  it('includes negative refund entries in the received total', () => {
    const booking = fixture(30);
    booking.payments!.push({ amount: -500, method: 'kpay' } as NonNullable<BookingRecord['payments']>[number]);
    const html = renderToStaticMarkup(React.createElement(PaymentHistory, { booking, locale: 'zh' }));
    expect(html).toContain('HK$1,530');
  });
});
