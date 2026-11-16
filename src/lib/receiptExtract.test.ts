// 單據自動入帳 (2026-11-15): the pure receipt pipeline.
import { describe, it, expect } from 'vitest';
import {
  attachmentPlan, parseReceiptJson, normalizeDate, buildReceiptExpense, findPossibleDuplicate,
  guessBranchKey, columnLetterToIndex, indexToColumnLetter, parseRangeAddress, excelRowValues, tableRowArray,
  MAX_DIRECT_IMAGE_BYTES, findMonthSheet, detectMonthLayout, planMonthWrite, excelDateSerial,
} from './receiptExtract';
import type { ExpenseRecord } from '@/types';

const BRANCHES = [
  { key: 'cwb', zh: '銅鑼灣店', en: 'Causeway Bay' },
  { key: 'sw', zh: '上環海景旗艦店', en: 'Sheung Wan Flagship' },
  { key: 'tst', zh: '尖沙咀店', en: 'Tsim Sha Tsui' },
  { key: 'wanchai', zh: '灣仔店', en: 'Wan Chai' },
];

describe('which files Claude reads, and how', () => {
  it('phone JPEGs and PDFs go straight through', () => {
    expect(attachmentPlan({ name: 'IMG_0012.JPG', size: 2_000_000 })).toEqual({ kind: 'image', mediaType: 'image/jpeg', viaThumbnail: false });
    expect(attachmentPlan({ name: 'e-receipt.pdf', size: 300_000 })).toEqual({ kind: 'pdf', mediaType: 'application/pdf', viaThumbnail: false });
  });
  it('HEIC (iPhone default) and oversized photos use the OneDrive JPEG thumbnail', () => {
    expect(attachmentPlan({ name: 'IMG_0013.HEIC', size: 1_500_000 })?.viaThumbnail).toBe(true);
    expect(attachmentPlan({ name: 'big.jpg', size: MAX_DIRECT_IMAGE_BYTES + 1 })).toEqual({ kind: 'image', mediaType: 'image/jpeg', viaThumbnail: true });
  });
  it('non-receipt files are skipped', () => {
    expect(attachmentPlan({ name: 'notes.docx', size: 100 })).toBeNull();
    expect(attachmentPlan({ name: 'archive.zip', size: 100 })).toBeNull();
  });
});

describe('reading the model reply', () => {
  it('tolerates fences and chatter, and normalises HK$ strings and DD/MM/YYYY dates', () => {
    const r = parseReceiptJson('Sure! ```json\n{"date":"03/11/2026","vendor":"惠康","total":"HK$1,234.50","currency":"HK$","summary":"飲品、紙杯","category":"餐飲/食材","confidence":"HIGH","notes":null}\n``` done');
    expect(r.date).toBe('2026-11-03');
    expect(r.total).toBe(1234.5);
    expect(r.currency).toBe('HKD');
    expect(r.confidence).toBe('high');
    expect(r.vendor).toBe('惠康');
  });
  it('nulls stay null and unknown confidence becomes medium', () => {
    const r = parseReceiptJson('{"date": null, "vendor": null, "total": null, "confidence": "maybe"}');
    expect(r.date).toBeNull(); expect(r.total).toBeNull(); expect(r.confidence).toBe('medium');
  });
  it('date formats', () => {
    expect(normalizeDate('2026-11-03')).toBe('2026-11-03');
    expect(normalizeDate('2026/1/9')).toBe('2026-01-09');
    expect(normalizeDate('9-1-2026')).toBe('2026-01-09');
    expect(normalizeDate('2026年11月3日')).toBe('2026-11-03');
    expect(normalizeDate('yesterday')).toBeNull();
    expect(normalizeDate('31/13/2026')).toBeNull();
  });
  it('rejects a reply with no JSON', () => {
    expect(() => parseReceiptJson('I cannot read this image.')).toThrow();
  });
});

describe('receipt → expense row', () => {
  const file = { driveItemId: 'd1', fileName: 'IMG_1.jpg', webUrl: 'https://1drv.ms/x', createdDateTime: '2026-11-14T18:30:00Z' };
  it('a clean receipt lands in the month of its own date, unreviewed, as source receipt', () => {
    const e = buildReceiptExpense(parseReceiptJson('{"date":"2026-10-30","vendor":"HKT","total":388,"summary":"寬頻","confidence":"high"}'), file, 'cwb');
    expect(e).toMatchObject({ branchKey: 'cwb', month: '2026-10', date: '2026-10-30', amount: 388, source: 'receipt', reviewed: false, item: 'HKT · 寬頻' });
    expect(e.receipt?.flags).toEqual([]);
    expect(e.receipt?.confidence).toBe('high');
  });
  it('no date → upload day in Hong Kong time, flagged; no amount → 0 row flagged low', () => {
    const e = buildReceiptExpense(parseReceiptJson('{"date":null,"vendor":"街市","total":null,"confidence":"high"}'), file, 'sw');
    // 18:30Z on the 14th is 02:30 HKT on the 15th.
    expect(e.date).toBe('2026-11-15'); expect(e.month).toBe('2026-11');
    expect(e.amount).toBe(0);
    expect(e.receipt?.flags).toEqual(expect.arrayContaining(['no_date', 'date_fallback', 'no_amount']));
    expect(e.receipt?.confidence).toBe('low');
  });
  it('foreign currency and multi-receipt photos are flagged, never dropped', () => {
    const e = buildReceiptExpense(parseReceiptJson('{"date":"2026-11-01","vendor":"Taobao","total":120,"currency":"CNY","multipleReceipts":true}'), file, 'tst');
    expect(e.receipt?.flags).toEqual(expect.arrayContaining(['foreign_currency', 'multiple_receipts']));
    expect(e.amount).toBe(120);
  });
  it('possible duplicate = same branch, date and amount among receipt rows only', () => {
    const rows = [
      { id: 'a', branchKey: 'cwb', date: '2026-11-01', amount: 88, source: 'receipt' },
      { id: 'b', branchKey: 'cwb', date: '2026-11-01', amount: 88, source: 'manual' },
    ] as ExpenseRecord[];
    expect(findPossibleDuplicate(rows, { branchKey: 'cwb', date: '2026-11-01', amount: 88 })?.id).toBe('a');
    expect(findPossibleDuplicate(rows, { branchKey: 'sw', date: '2026-11-01', amount: 88 })).toBeUndefined();
    expect(findPossibleDuplicate(rows, { branchKey: 'cwb', date: '2026-11-01', amount: 0 })).toBeUndefined();
  });
});

describe('folder names → branch', () => {
  it('matches Chinese, English and short keys', () => {
    expect(guessBranchKey('銅鑼灣', BRANCHES)).toBe('cwb');
    expect(guessBranchKey('Sheung Wan receipts', BRANCHES)).toBe('sw');
    expect(guessBranchKey('TST', BRANCHES)).toBe('tst');
    expect(guessBranchKey('灣仔單據', BRANCHES)).toBe('wanchai');
    expect(guessBranchKey('2026', BRANCHES)).toBeNull();
  });
});

describe('Excel plumbing', () => {
  it('column letters round-trip', () => {
    expect(columnLetterToIndex('A')).toBe(0); expect(columnLetterToIndex('Z')).toBe(25); expect(columnLetterToIndex('AA')).toBe(26);
    expect(indexToColumnLetter(0)).toBe('A'); expect(indexToColumnLetter(27)).toBe('AB');
  });
  it('parses Graph range addresses', () => {
    expect(parseRangeAddress("'支出 2026'!B3:H40")).toEqual({ sheet: '支出 2026', startCol: 'B', startRow: 3, endCol: 'H', endRow: 40 });
    expect(parseRangeAddress('Sheet1!A1')).toMatchObject({ startCol: 'A', startRow: 1, endCol: 'A', endRow: 1 });
  });
  it('maps a row onto the chosen columns and into a table-row array', () => {
    const row = { id: 'exp1', date: '2026-11-03', item: '惠康 · 飲品', amount: 1234.5, reviewed: true,
      receipt: { driveItemId: 'd', fileName: 'f', vendor: '惠康', webUrl: 'https://1drv.ms/x', confidence: 'high', flags: [] } } as unknown as ExpenseRecord;
    const cells = excelRowValues({ date: 'B', item: 'C', amount: 'E', reviewed: 'F', id: 'H' }, row, { branchName: '銅鑼灣店' });
    expect(cells).toEqual({ B: '2026-11-03', C: '惠康 · 飲品', E: 1234.5, F: '✓', H: 'exp1' });
    expect(tableRowArray(cells, 'B', 7)).toEqual(['2026-11-03', '惠康 · 飲品', null, 1234.5, '✓', null, 'exp1']);
  });
});

describe('month-sheet layout (Financial Master)', () => {
  const names = ['Master', 'Charts', 'DEC-2026', 'NOV-2026', 'OCT-2026', 'BLANK'];
  it('finds the sheet for a month whatever the spelling', () => {
    expect(findMonthSheet(names, '2026-11')).toBe('NOV-2026');
    expect(findMonthSheet(['nov 2026'], '2026-11')).toBe('nov 2026');
    expect(findMonthSheet(['2026-11'], '2026-11')).toBe('2026-11');
    expect(findMonthSheet(['November 2026'], '2026-11')).toBe('November 2026');
    expect(findMonthSheet(names, '2026-03')).toBeNull();
    expect(findMonthSheet(names, 'garbage')).toBeNull();
  });
  it('detects the Vendor | Amount header pair', () => {
    const values = [
      [' NOV- 2026 (CWB)'],
      ['CR', '', '', '', 'DR', '', 'Source'],
      ['Date', 'Time', 'ppl', 'Total ', 'Vendor', 'Amount', 'Source'],
    ];
    expect(detectMonthLayout(values)).toEqual({ headerRow: 3, vendorColumn: 'E', amountColumn: 'F', dateColumn: 'A' });
    expect(detectMonthLayout([['a', 'b']])).toBeNull();
    // Her real banner: Remarks in row 2, the Date column is A (Heidi 2026-11-16).
    const real = [
      [' NOV- 2026 (CWB)'],
      ['CR', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'DR', '', 'Source', 'Returned Deposit', 'Remarks'],
      [], [],
      ['Date', 'Time', 'ppl', 'Rent', 'BBQ/ Hotpot', 'Shisha', '到會', 'Drinks', '會員積分優惠', '信用卡手續費', '加時/罰款', 'Total ', 'Date', 'Payment Methods', 'Amount', 'Total', 'Vendor', 'Amount'],
    ];
    expect(detectMonthLayout(real)).toEqual({ headerRow: 5, vendorColumn: 'Q', amountColumn: 'R', dateColumn: 'A', noteColumn: 'U' });
    expect(excelDateSerial('2026-11-16')).toBe(46342);
    expect(excelDateSerial('1900-03-01')).toBe(61);
    expect(excelDateSerial('nope')).toBeNull();
  });
  it('plans: existing id line, first fully-empty line, total line', () => {
    const layout = { headerRow: 5, vendorColumn: 'Q', amountColumn: 'R', idColumn: 'V' };
    const w = 22; // A..V
    const row = (fill: Record<number, unknown>) => Array.from({ length: w }, (_, i) => fill[i] ?? '');
    const Q = 16, R = 17, L = 11, V = 21;
    const values = [
      row({}), row({}), row({}), row({}), row({ [Q]: 'Vendor', [R]: 'Amount' }),           // rows 1-5
      row({ 0: '2026-11-01', [L]: 3750, [Q]: 'Kpay', [R]: 12 }),                              // 6 booking + expense
      row({ 0: '2026-11-06', [L]: 100 }),                                                 // 7 booking only → not free
      row({ [L]: 0 }),                                                                    // 8 free (SUM shows 0)
      row({ [L]: 0, [Q]: 'Taobao', [R]: 65.81, [V]: 'exp_abc' }),                               // 9 ours
      row({ [Q]: 'Total Expenses: ', [R]: 999 }),                                           // 10
      row({ [Q]: 'Rent', [R]: 35000 }),                                                     // 11 (after total: ignored)
    ];
    expect(planMonthWrite(values, { startCol: 'A', startRow: 1 }, layout, 'exp_abc')).toEqual({ foundRow: 9, freeRow: 8, totalRow: 10 });
    expect(planMonthWrite(values, { startCol: 'A', startRow: 1 }, layout, 'nope')).toEqual({ foundRow: null, freeRow: 8, totalRow: 10 });
    // Block full → no free line; total line still found.
    const full = values.filter((_, i) => i !== 7);
    expect(planMonthWrite(full, { startCol: 'A', startRow: 1 }, layout, 'nope')).toEqual({ foundRow: null, freeRow: null, totalRow: 9 });
  });
  it('a blank line that a payment group above still spans is not free', () => {
    const layout = { headerRow: 5, vendorColumn: 'Q', amountColumn: 'R', idColumn: 'V' };
    const w = 22;
    const row = (fill: Record<number, unknown>) => Array.from({ length: w }, (_, i) => fill[i] ?? '');
    const [L, O, P, Q, R] = [11, 14, 15, 16, 17];
    const values = [
      row({}), row({}), row({}), row({}), row({ [Q]: 'Vendor', [R]: 'Amount' }),
      row({ 0: '2026-11-26', [L]: 4000, [O]: 3850, [P]: 3850, [Q]: '行家' }),      // 6: group 6-7, R6:R7 merged in Excel
      row({}),                                                                       // 7: reserved by =SUM(O6:O7)
      row({ [L]: 0 }),                                                               // 8: free
      row({ [Q]: 'Total Expenses: ' }),
    ];
    const formulas = values.map((v) => v.map(() => ''));
    formulas[5][P] = '=SUM(O6:O7)'; formulas[5][L] = '=SUM(D6:K6)'; formulas[7][L] = '=SUM(D8:K8)';
    formulas[8][R] = '=SUM(R6:R39)'; // block total: long range, ignored
    expect(planMonthWrite(values, { startCol: 'A', startRow: 1 }, layout, 'x', formulas)).toEqual({ foundRow: null, freeRow: 8, totalRow: 9 });
    expect(planMonthWrite(values, { startCol: 'A', startRow: 1 }, layout, 'x')).toEqual({ foundRow: null, freeRow: 7, totalRow: 9 });
  });
});
