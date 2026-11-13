// BBQ 豪華套餐 ($328/位) needs a supplier order too (Heidi 2026-11-13) — the
// supplier-order email used to fire for hotpot / shisha / helper chef /
// catering only, so a premium BBQ booking reached nobody who orders the food.

import { describe, it, expect } from 'vitest';
import { bookingNeedsSupplierOrder, buildStaffSupplierOrderEmail } from './email';
import type { BookingRecord } from '@/types';

const booking = (addOns: BookingRecord['addOns']) => ({
  id: 'bbqPremium0000000000', venueId: 'cwb', date: '2026-12-05', startTime: '18:00', endTime: '23:00', hours: 5,
  status: 'confirmed', guestCount: 20, adultCount: 20, childCount: 0, addOns, payments: [],
  pricing: { baseCharge: 0, addOnTotal: 0, subtotal: 0, securityDeposit: 0, deposit: 0 },
}) as unknown as BookingRecord;

const html = (b: BookingRecord) =>
  buildStaffSupplierOrderEmail({ booking: b, venueName: '銅鑼灣', customerName: 'Test', adminUrl: 'https://example.test/admin' }).html;

describe('supplier order — BBQ 豪華套餐', () => {
  it('a premium BBQ booking triggers the supplier order email', () => {
    expect(bookingNeedsSupplierOrder(booking([{ id: 'bbq-premium', quantity: 1 }]))).toBe(true);
  });

  it('the standard BBQ package alone still does not', () => {
    expect(bookingNeedsSupplierOrder(booking([{ id: 'bbq-standard', quantity: 1 }]))).toBe(false);
  });

  it('lists the package with the number of portions and the amount', () => {
    const out = html(booking([{ id: 'bbq-premium', quantity: 1 }]));
    expect(out).toContain('BBQ 豪華套餐');
    expect(out).toContain('每位 $328');
    expect(out).toContain('6,560'); // 20 × 328
  });

  it('orders only the head count staff set for the package', () => {
    const out = html(booking([{ id: 'bbq-premium', quantity: 1, options: { pax: 12 } }]));
    expect(out).toContain('12位');
    expect(out).toContain('3,936'); // 12 × 328
  });
});
