import { describe, it, expect } from 'vitest';
import { buildMasterMonthSheet, excelDateSerial, type MasterSheetBooking, type MasterCell } from './financialMasterSheet';

const bk = (
  date: string, time: string, ppl: number | string, sales: Partial<MasterSheetBooking>,
  transactions: Array<[string, string, number]>, expenses: Array<[string, number]>, source: string, returnedDeposit: number,
): MasterSheetBooking => ({
  date, time, ppl, rent: 0, bbqHotpot: 0, shisha: 0, cater: 0, drinks: 0, pointsPromo: 0, cardSurcharge: 0, extPenalty: 0,
  ...sales,
  transactions: transactions.map(([d, method, amount]) => ({ date: d, method, amount })),
  expenses: expenses.map(([vendor, amount]) => ({ vendor, amount })),
  source, returnedDeposit, remarks: '',
});

// Heidi's own OCT-2026 (CWB) tab, 2026-11-13.
const OCT = {
  title: ' OCT- 2026 (CWB)',
  bookings: [
    bk('2026-10-02', '19:00-00:00', 8, { rent: 2320 }, [['2026-09-28', 'FPS', 3320]], [], 'IG', 1000),
    bk('2026-10-09', '19:00-01:00', 20, { rent: 6960, drinks: 500 }, [['2026-09-15', 'Kpay', 8960], ['2026-10-07', 'Kpay', 500]], [['Kpay', 179.74]], 'Google', 2000),
    bk('2026-10-10', '11:00-14:00', '', { rent: 6800 }, [['2026-08-13', 'FPS', 4610], ['2026-08-15', 'FPS', 4190]], [['Brilliant Balloon', 1500]], 'Google', 2000),
    bk('2026-10-10', '17:00-22:00', 38, { rent: 13224, bbqHotpot: 1000, cardSurcharge: 243.37 }, [['2026-09-03', 'Kpay', 9373.53], ['2026-10-10', 'Kpay', 7093.84]], [['Kpay', 463.09]], 'IG', 2000),
    bk('2026-10-18', '14:00-17:00', '', { rent: 6800 }, [['2026-08-24', 'Kpay', 8800]], [['Brilliant Balloon', 1500], ['Kpay', 132]], 'IG', 2000),
    bk('2026-10-30', '19:00-00:00', 53, { rent: 15370, drinks: 1325, extPenalty: 1160 }, [['2026-10-13', 'Kpay', 9395], ['2026-10-28', 'Kpay', 10985], ['2026-10-28', 'Kpay', 315]], [['Kpay', 310.44]], 'Referral', 2840),
    bk('2026-10-31', '21:00-02:00', 30, { rent: 8700, extPenalty: 1740 }, [['2026-10-09', 'FPS', 5350], ['2026-10-31', 'FPS', 5350]], [], 'Reubird', 260),
  ],
  storedExpenses: ([['差餉', 500], ['管理費', 6081], ['sales base salary', 1500], ['Sosim (share)', 12], ['寛頻', 261],
    ['Marketing (share)', 4773.64], ['Cleaning fee', 4336], ['Electricity Fee', 2106], ['Rent', 35000]] as Array<[string, number]>)
    .map(([vendor, amount]) => ({ vendor, amount })),
  splits: [{ name: 'Kenneth', pct: 50 }, { name: 'Heidi', pct: 10 }, { name: 'In Account', pct: 40 }],
};

describe('buildMasterMonthSheet — her OCT-2026 (CWB) tab', () => {
  const sheet = buildMasterMonthSheet(OCT);
  const at = (addr: string): MasterCell | undefined => {
    const c = 'ABCDEFGHIJKLMNOPQRSTU'.indexOf(addr[0]);
    const r = Number(addr.slice(1)) - 1;
    return sheet.cells.find((x) => x.r === r && x.c === c);
  };
  const find = (v: string) => sheet.cells.find((x) => x.v === v)!;

  it('reaches her Total Sales, Total Expenses and Profit', () => {
    expect(sheet.totals).toEqual({ sales: 66142.37, expenses: 58654.91, profit: 7487.46, returned: 12100 });
  });

  it('uses her 21 columns, with 會員積分 / 優惠碼 and 信用卡手續費 before 加時/罰款', () => {
    const header = sheet.cells.filter((x) => x.r === 4).sort((a, b) => a.c - b.c).map((x) => x.v);
    expect(header).toEqual([
      'Date', 'Time', 'ppl', 'Rent', 'BBQ/ Hotpot', 'Shisha', '到會', 'Drinks',
      '會員積分 / 優惠碼', '信用卡手續費', '加時/罰款', 'Total ',
      'Date', 'Payment Methods', 'Amount', 'Total', 'Vendor', 'Amount',
    ]);
    expect(at('S2')?.v).toBe('Source');
    expect(at('T2')?.v).toBe('Returned Deposit');
    expect(at('U2')?.v).toBe('Remarks');
  });

  it('writes a booking as one block: payments down M–O, expenses down Q–R', () => {
    // 2nd booking starts on row 7 (row 6 is the single-row first booking).
    expect(at('A7')?.v).toBe(excelDateSerial('2026-10-09'));
    expect(at('L7')).toEqual(expect.objectContaining({ v: 7460, f: 'SUM(D7:K7)' }));
    expect([at('N7')?.v, at('O7')?.v, at('O8')?.v]).toEqual(['Kpay', 8960, 500]);
    expect(at('P7')).toEqual(expect.objectContaining({ v: 9460, f: 'SUM(O7:O8)' }));
    expect([at('Q7')?.v, at('R7')?.v]).toEqual(['Kpay', 179.74]);
    // Booking-level cells are merged over its two rows; M–O and Q–R are not.
    const merged = (c: number) => sheet.merges.some((m) => m.s.r === 6 && m.e.r === 7 && m.s.c === c && m.e.c === c);
    expect([0, 3, 11, 15, 18, 19, 20].every(merged)).toBe(true);
    expect([12, 13, 14, 16, 17].some(merged)).toBe(false);
  });

  it('keeps her footer formulas, with cached values', () => {
    const exp = find('Total Expenses: ');
    const expenses = sheet.cells.find((x) => x.r === exp.r && x.c === 17)!;
    expect(expenses.v).toBe(58654.91);
    expect(expenses.f).toMatch(/^SUM\(R6:R\d+\)$/);
    const salesLabel = find('Total Sales Amount :');
    expect(sheet.cells.find((x) => x.r === salesLabel.r && x.c === 11)!.v).toBe(66142.37);
    const profit = sheet.cells.find((x) => x.r === find('Profit :').r && x.c === 16)!;
    expect(profit.v).toBe(7487.46);
    expect(sheet.cells.find((x) => x.r === find('To Kenneth (50%) :').r && x.c === 16)!.v).toBeCloseTo(3743.73, 2);
    expect(find('In Account (40%) :')).toBeTruthy(); // not "To In Account"
  });

  it('column sums match her footer row', () => {
    const sums = sheet.cells.filter((x) => x.style === 'sum' && x.c >= 3 && x.c <= 10).sort((a, b) => a.c - b.c).map((x) => x.v);
    expect(sums).toEqual([60174, 1000, 0, 0, 1825, 0, 243.37, 2900]);
  });
});

describe('buildMasterMonthSheet — edge cases', () => {
  it('lays out an empty month without broken ranges', () => {
    const sheet = buildMasterMonthSheet({ title: ' NOV- 2026 (CWB)', bookings: [], storedExpenses: [], splits: [] });
    expect(sheet.totals).toEqual({ sales: 0, expenses: 0, profit: 0, returned: 0 });
    for (const c of sheet.cells) if (c.f) expect(c.f).not.toMatch(/[A-U]0\b/);
  });

  it('keeps a non-date cell as text', () => {
    expect(excelDateSerial('2026-10-10')).toBe(46305);
    expect(excelDateSerial('')).toBeNull();
  });
});
