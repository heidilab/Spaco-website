/**
 * Email money-block regression tests — incident #nbWTrtyG.
 *
 * The staff "新預約確認" email showed 小計 HK$1,650 (gross, ignoring the
 * −$150 promo) and labelled the full HK$2,500 payment as 已收按金 — the
 * refundable deposit is actually $1,000 and $2,500 is the grand total.
 * Every confirmation email had the same defect. These tests pin the
 * corrected layout for both the staff and customer templates using that
 * booking's real numbers.
 */

import { describe, it, expect } from 'vitest';
import {
  buildStaffBookingNotificationEmail,
  buildBookingConfirmationEmail,
} from './email';

// #nbWTrtyG: 場租 $1,500 + 飲品 $150 = gross $1,650; DRINK2026 −$150;
// 按金 $1,000; 總額 $2,500; paid in full via FPS.
const nbWTrtyG = {
  subtotal: 1650,
  promoCode: 'DRINK2026',
  promoDiscount: 150,
  deposit: 2500,
  securityDeposit: 1000,
  balanceDue: 0,
};

describe('staff booking notification email (#nbWTrtyG)', () => {
  const { html } = buildStaffBookingNotificationEmail({
    bookingId: 'nbWTrtyGKfCIQw2C50ud',
    venueName: '上環海景旗艦店 - Room A',
    date: '2026-08-02',
    startTime: '15:00',
    endTime: '20:00',
    guestCount: 6,
    customerName: 'Merian Lee',
    ...nbWTrtyG,
    addOnsLine: '無酒精飲品任飲',
    hasBYOFood: false,
    paymentMethod: 'fps',
    adminUrl: 'https://spacohk.com/zh/admin/bookings/x',
  });

  it('小計 is post-promo ($1,500), not gross ($1,650)', () => {
    expect(html).toContain('HK$1,500');
    expect(html).toContain('小計（已扣優惠）');
    expect(html).not.toContain('>HK$1,650<');
  });

  it('shows the promo line', () => {
    expect(html).toContain('DRINK2026');
    expect(html).toContain('−HK$150');
  });

  it('separates 可退按金 ($1,000) from 總額 ($2,500)', () => {
    expect(html).toContain('可退按金');
    expect(html).toContain('HK$1,000');
    expect(html).toContain('總額');
    expect(html).toContain('HK$2,500');
  });

  it('labels the $2,500 as 已付款 — never as 已收按金', () => {
    expect(html).toContain('已付款');
    expect(html).not.toContain('已收按金');
  });
});

describe('customer confirmation email (#nbWTrtyG)', () => {
  const { html } = buildBookingConfirmationEmail({
    customerName: 'Merian Lee',
    venueName: '上環海景旗艦店 - Room A',
    date: '2026-08-02',
    startTime: '15:00',
    endTime: '20:00',
    guestCount: 6,
    ...nbWTrtyG,
    addOnsLine: '無酒精飲品任飲',
    paymentMethod: 'FPS / 銀行轉帳',
    whatsappLink: 'https://wa.me/85292823060',
  });

  it('小計 is post-promo and the deposit/total rows reconcile', () => {
    expect(html).toContain('小計（已扣優惠）');
    expect(html).toContain('HK$1,500');
    expect(html).toContain('可退按金（活動後退還）');
    expect(html).toContain('總額');
    expect(html).toContain('HK$2,500');
    expect(html).toContain('已付款');
  });

  it('omits deposit/total rows for legacy callers without securityDeposit', () => {
    const legacy = buildBookingConfirmationEmail({
      customerName: 'x', venueName: 'v', date: 'd', startTime: 's', endTime: 'e',
      guestCount: 1, subtotal: 1000, deposit: 1000,
      addOnsLine: '', paymentMethod: 'fps', whatsappLink: '',
    });
    expect(legacy.html).not.toContain('可退按金');
    expect(legacy.html).not.toContain('總額');
  });

  it('shows the outstanding balance row for 50%-deposit bookings', () => {
    const half = buildBookingConfirmationEmail({
      customerName: 'x', venueName: 'v', date: 'd', startTime: 's', endTime: 'e',
      guestCount: 1, subtotal: 12000, deposit: 6500, securityDeposit: 1000,
      balanceDue: 6500,
      addOnsLine: '', paymentMethod: 'kpay', whatsappLink: '',
    });
    expect(half.html).toContain('尾數');
    expect(half.html).toContain('HK$6,500');
  });
});
