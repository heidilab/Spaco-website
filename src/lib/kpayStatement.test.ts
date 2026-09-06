import { describe, it, expect } from 'vitest';
import { parseKpayStatement } from './kpayStatement';
import { splitAmounts } from './bookingMoney';

describe('parseKpayStatement', () => {
  it('parses an English-header statement with banner rows', () => {
    const rows = [
      ['KPay Merchant Statement'],
      ['Merchant: SPACO'],
      ['Date', 'Transaction Amount', 'Fee', 'Net Settlement'],
      ['2026-08-02', 1000, 15, 985],
      ['2026-08-15', '2,500.00', '37.50', '2,462.50'],
      ['Total', 3500, 52.5, 3447.5],
    ];
    const s = parseKpayStatement(rows)!;
    expect(s.rowCount).toBe(2);
    expect(s.gross).toBe(3500);
    expect(s.fee).toBe(52.5);
    expect(s.net).toBe(3447.5);
  });

  it('parses a Chinese-header statement and derives fee from gross-net', () => {
    const rows = [
      ['日期', '交易金額', '結算金額'],
      ['2026-08-02', '$1,000', '$985'],
      ['2026-08-15', '$2,000', '$1,970'],
    ];
    const s = parseKpayStatement(rows)!;
    expect(s.rowCount).toBe(2);
    expect(s.gross).toBe(3000);
    expect(s.fee).toBe(45); // 3000 - 2955
    expect(s.net).toBe(2955);
  });

  it('treats negative fee cells as positive charges', () => {
    const rows = [
      ['Date', 'Amount', '手續費'],
      ['2026-08-02', 1000, -15],
    ];
    const s = parseKpayStatement(rows)!;
    expect(s.fee).toBe(15);
  });

  it('returns null for an unrecognizable file', () => {
    expect(parseKpayStatement([['hello'], ['world']])).toBeNull();
    expect(parseKpayStatement([])).toBeNull();
  });
});

describe('splitAmounts', () => {
  it('matches her CWB AUG-2026 Master figures exactly (unrounded)', () => {
    const out = splitAmounts(28972.69, [
      { name: 'Kenneth', pct: 50 }, { name: 'Heidi', pct: 25 }, { name: 'In Account', pct: 25 },
    ]);
    expect(out[0].amount).toBeCloseTo(14486.345, 6);
    expect(out[1].amount).toBeCloseTo(7243.1725, 6);
    expect(out[2].amount).toBeCloseTo(7243.1725, 6);
  });
});
