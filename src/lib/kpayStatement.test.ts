import { describe, it, expect } from 'vitest';
import { parseKpayStatement } from './kpayStatement';
import { splitAmounts } from './bookingMoney';

describe('parseKpayStatement — real KPay layout (AUG-2026 statement)', () => {
  // Faithful replica of her statement's structure: banner rows, merchant
  // block, 交易對賬匯總 summary, then a detail table with long numeric
  // order ids that must never be summed as money.
  const realShape = [
    ['曼驊企業有限公司 (ONLINE)交易賬單'],
    ['商戶基本信息'],
    ['商戶名稱', '商戶英文名稱', '商戶號', '交易日期'],
    ['曼驊企業有限公司 (ONLINE)', 'CHOLLIMAN INCORPORATION LIMITED (ONLINE)', '852124324500007', '202608'],
    ['交易對賬匯總'],
    ['交易筆數', '交易幣種', '交易總金額', '小費總額', '交易手續費總額', '本地幣種', '本地總金額'],
    ['3', 'HKD', 12570, 0.0, 237.62, 'HKD', 12570],
    ['交易結算'],
    ['KPay交易號', '商戶訂單號', 'KPay訂單號', '參考號', '外部訂單號', '交易類型', '交易狀態', '關聯交易號', '支付金額', '支付幣種', '本地金額', '本地幣種', '小費金額', '手續費', 'BNPL機構', '消費區間', '交易賬號', 'KPay終端號', '支付方式', '錢包類型'],
    ['2026083100391413', '2026083118202200001', '2026083118202200001', null, 'B4qK_P1', 'PayMe H5', '處理成功', null, 9250.0, 'HKD', 9250.0, 'HKD', 0.0, 138.75, null, '', '8f5a', null, 'PayMe', ''],
    ['2026083100182630', '2026083113310900001', '2026083113310900001', null, 'BGUM_P1', 'TOKEN交易', '處理成功', null, 2740.0, 'HKD', 2740.0, 'HKD', 0.0, 52.06, null, 'Domestic', '5595', null, 'Mastercard', ''],
    ['2026083000011159', '2026083004382700001', '2026083004382700001', null, 'Bq9G_B1', '支付寶H5支付', '處理成功', null, 580.0, 'HKD', 580.0, 'HKD', 0.0, 11.02, null, '', '2088', null, '支付寶', 'AlipayHK'],
  ];

  it('uses the 交易對賬匯總 summary block as authoritative', () => {
    const s = parseKpayStatement(realShape as unknown[][])!;
    expect(s).not.toBeNull();
    expect(s.rowCount).toBe(3);
    expect(s.gross).toBe(12570);
    expect(s.fee).toBe(237.62);
    expect(s.net).toBe(12332.38);
    expect(s.matched.fee).toContain('手續費');
  });

  it('falls back to the detail table when the summary block is missing', () => {
    const noSummary = [realShape[0], ...realShape.slice(7)];
    const s = parseKpayStatement(noSummary as unknown[][])!;
    expect(s.rowCount).toBe(3);
    expect(s.gross).toBe(12570);
    expect(s.fee).toBeCloseTo(201.83, 2); // 138.75 + 52.06 + 11.02
  });

  it('excludes non-successful rows in the detail table', () => {
    const withRefund = [
      realShape[8],
      ...realShape.slice(9),
      ['2026089900000001', '2026089900001', '2026089900001', null, 'X', '退款', '已退款', null, 500.0, 'HKD', 500.0, 'HKD', 0.0, 7.5, null, '', 'x', null, 'PayMe', ''],
    ];
    const s = parseKpayStatement(withRefund as unknown[][])!;
    expect(s.rowCount).toBe(3);
    expect(s.gross).toBe(12570);
  });

  it('never mistakes 16-digit order ids for money', () => {
    const s = parseKpayStatement(realShape as unknown[][])!;
    expect(s.gross).toBeLessThan(1e6);
  });
});

describe('parseKpayStatement — generic fallback', () => {
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
