// 預訂規則 (site review 2026-11-13, phase 4d): one document for deposit
// tiers, fixed deductions, points and instalment — code and texts agree.

import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_BOOKING_RULES, sanitizeBookingRules, setBookingRules, securityDepositFor, pointsEarnedFor,
  depositTierLines, depositTierSentence, deductionLines, installmentSentence, fillRuleTokens,
} from './bookingRules';
import { calculateSecurityDeposit, calculateDeposit, calculatePricing } from './pricing';
import { pointsToHkd, hkdToPoints } from './bookingMoney';
import { venues } from './venues';

const cwb = venues.find((v) => v.id === 'cwb')!;
afterEach(() => setBookingRules(null));

describe('with nothing saved the coded rules apply', () => {
  it('deposit ladder 1,000 / 2,000 / 4,000 and the HK$10,000 instalment line', () => {
    expect(calculateSecurityDeposit(4000)).toBe(1000);
    expect(calculateSecurityDeposit(4001)).toBe(2000);
    expect(calculateSecurityDeposit(10000)).toBe(2000);
    expect(calculateSecurityDeposit(10001)).toBe(4000);
    expect(calculateDeposit(10000)).toBe(10000);
    expect(calculateDeposit(12000)).toBe(6000);
    expect(calculatePricing(cwb, true, 4, 40, []).canInstallment).toBe(true);
    expect(pointsToHkd(1550)).toBe(15);
    expect(hkdToPoints(15)).toBe(1500);
    expect(pointsEarnedFor(2345.6)).toBe(2345);
  });
});

describe('rules staff save', () => {
  it('change the deposit, the instalment and the points everywhere', () => {
    setBookingRules(sanitizeBookingRules({
      depositTiers: [{ upTo: null, deposit: 8000 }, { upTo: '20000', deposit: '4000' }, { upTo: 5000, deposit: 1500 }],
      pointsPerHkd: 50, pointsEarnPerHkd: 2, installmentThreshold: 20000, installmentPct: 30, balanceDueDaysBefore: 7,
    }));
    expect(securityDepositFor(5000)).toBe(1500);
    expect(securityDepositFor(20000)).toBe(4000);
    expect(securityDepositFor(20001)).toBe(8000);
    expect(calculateSecurityDeposit(12000)).toBe(4000);
    expect(calculateDeposit(15000)).toBe(15000);
    expect(calculateDeposit(30000)).toBe(9000);
    expect(calculatePricing(cwb, true, 4, 40, []).canInstallment).toBe(false);
    expect(pointsToHkd(1550)).toBe(31);
    expect(hkdToPoints(10)).toBe(500);
    expect(pointsEarnedFor(100)).toBe(200);
    expect(depositTierLines('zh')).toEqual([
      '消費 HK$5,000 或以下：按金 HK$1,500',
      '消費 HK$5,000 以上至 HK$20,000：按金 HK$4,000',
      '消費 HK$20,000 以上：按金 HK$8,000',
    ]);
    expect(installmentSentence('zh')).toContain('HK$20,000');
    expect(installmentSentence('zh')).toContain('30%');
    expect(installmentSentence('en')).toContain('7 days');
  });

  it('instalment switched off: everything upfront', () => {
    setBookingRules(sanitizeBookingRules({ installmentThreshold: 0 }));
    expect(calculateDeposit(50000)).toBe(50000);
    expect(calculatePricing(cwb, true, 4, 40, []).canInstallment).toBe(false);
    expect(installmentSentence('zh')).toBe('所有預訂須於確認時付清全數。');
  });

  it('sanitising falls back field by field and keeps an explicit empty deduction list', () => {
    const r = sanitizeBookingRules({ depositTiers: 'nope', deductionItems: [], pointsPerHkd: 0, installmentPct: 150 });
    expect(r.depositTiers).toEqual(DEFAULT_BOOKING_RULES.depositTiers);
    expect(r.deductionItems).toEqual([]);
    expect(r.pointsPerHkd).toBe(100);
    expect(r.installmentPct).toBe(50);
    const d = sanitizeBookingRules({ deductionItems: [
      { id: 'Smoke', zh: '吸煙', amount: '1000' }, { id: 'smoke', zh: 'dupe', amount: 1 }, { id: 'x', zh: '', en: '', amount: 1 }, { id: 'bad id', zh: 'x', amount: 1 },
    ] });
    expect(d.deductionItems).toEqual([{ id: 'smoke', zh: '吸煙', en: '吸煙', amount: 1000 }]);
    expect(deductionLines('zh', d, '-')).toEqual(['吸煙：-HK$1,000']);
  });

  it('fills the tokens in guideline text', () => {
    const out = fillRuleTokens('按金：\n{{DEPOSIT_TIERS}}\n\n{{INSTALLMENT}}\n{{DEDUCTIONS}}', 'zh');
    expect(out).toContain('• 消費 HK$4,000 或以下：按金 HK$1,000');
    expect(out).toContain('• 沒有關閉焗爐：-HK$2,000');
    expect(out).toContain('超過 HK$10,000 可選擇先付 50%');
    expect(out).not.toContain('{{');
    expect(depositTierSentence('en')).toContain('Up to HK$4,000: HK$1,000 deposit');
  });
});
