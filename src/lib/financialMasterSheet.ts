// Monthly tab of Heidi's Financial Master workbook (`OCT-2026`, …).
//
// PURE module (no xlsx, no firebase): it lays the sheet out as plain
// cells with formulas and a style tag each; 月結 turns that into a real
// worksheet. Calibrated against her own file
// (CWB2026-2027 Financial Master.xlsx, tabs SEP-2026 / OCT-2026). Her
// column I reads 會員積分優惠; it now also carries promo-code discounts,
// hence 會員積分 / 優惠碼 (her call, 2026-11-13):
//
//   A Date | B Time | C ppl
//   D Rent | E BBQ/ Hotpot | F Shisha | G 到會 | H Drinks
//   I 會員積分 / 優惠碼 | J 信用卡手續費 | K 加時/罰款 | L Total (=SUM(D:K))
//   M Date | N Payment Methods | O Amount | P Total      (Transaction)
//   Q Vendor | R Amount                                   (DR / Expenses)
//   S Source | T Returned Deposit | U Remarks
//
// One booking = one block: its payments run down M–O, its expenses down
// Q–R, and the booking-level cells are merged over the block. The month's
// stored expenses follow in Q–R, then the totals, Total Sales Amount,
// Profit and the split rows — the same formulas she types by hand.

export interface MasterSheetBooking {
  /** Event date, YYYY-MM-DD. */
  date: string;
  time: string;
  ppl: number | string;
  rent: number;
  bbqHotpot: number;
  shisha: number;
  cater: number;
  drinks: number;
  /** 會員積分 / 優惠碼 — negative. */
  pointsPromo: number;
  cardSurcharge: number;
  extPenalty: number;
  transactions: Array<{ date: string; method: string; amount: number }>;
  expenses: Array<{ vendor: string; amount: number }>;
  source: string;
  returnedDeposit: number | null;
  remarks: string;
}

export interface MasterSheetInput {
  /** e.g. ` OCT- 2026 (CWB)`. */
  title: string;
  bookings: MasterSheetBooking[];
  /** The month's stored expenses (rent, 管理費, one-offs …). */
  storedExpenses: Array<{ vendor: string; amount: number }>;
  splits: Array<{ name: string; pct: number }>;
}

export type MasterCellStyle =
  | 'title' | 'bandCR' | 'bandDR' | 'bandSource' | 'bandDeposit' | 'bandRemarks'
  | 'group' | 'header'
  | 'date' | 'text' | 'money' | 'moneyBold' | 'txDate' | 'remarks'
  | 'sum' | 'label' | 'footMoney' | 'footLabel';

export interface MasterCell {
  r: number;
  c: number;
  v: string | number;
  /** Formula without the leading `=`; `v` is its cached result. */
  f?: string;
  style: MasterCellStyle;
}

export interface MasterSheet {
  cells: MasterCell[];
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
  /** Column widths in characters, A→U. */
  cols: number[];
  rowCount: number;
  /** First and last row (0-based) of the bordered table body. */
  bodyRows: { first: number; last: number };
  totals: { sales: number; expenses: number; profit: number; returned: number };
}

const COL = 'ABCDEFGHIJKLMNOPQRSTU';
const LAST_COL = 20; // U
const r2 = (x: number) => Math.round(x * 100) / 100;

/** YYYY-MM-DD → Excel date serial (so the cell is a real date she can
 *  reformat, like the ones in her sheet). Null when not a date. */
export function excelDateSerial(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) + 25569;
}

export function buildMasterMonthSheet(input: MasterSheetInput): MasterSheet {
  const cells: MasterCell[] = [];
  const merges: MasterSheet['merges'] = [];
  const put = (r: number, c: number, v: string | number, style: MasterCellStyle, f?: string) => {
    cells.push(f ? { r, c, v, f, style } : { r, c, v, style });
  };
  const merge = (r1: number, c1: number, r2_: number, c2: number) => {
    if (r1 !== r2_ || c1 !== c2) merges.push({ s: { r: r1, c: c1 }, e: { r: r2_, c: c2 } });
  };
  const ref = (r: number, c: number) => `${COL[c]}${r + 1}`;

  // ── header block (rows 1–5) ──
  put(0, 0, input.title, 'title'); merge(0, 0, 0, LAST_COL);
  put(1, 0, 'CR', 'bandCR'); merge(1, 0, 1, 15);
  put(1, 16, 'DR', 'bandDR'); merge(1, 16, 1, 17);
  put(1, 18, 'Source', 'bandSource'); merge(1, 18, 4, 18);
  put(1, 19, 'Returned Deposit', 'bandDeposit'); merge(1, 19, 4, 19);
  put(1, 20, 'Remarks', 'bandRemarks'); merge(1, 20, 4, 20);
  put(2, 0, 'Booking Details', 'group'); merge(2, 0, 2, 15);
  put(2, 16, 'Expenses', 'group'); merge(2, 16, 3, 17);
  put(3, 0, '', 'group'); merge(3, 0, 3, 2);
  put(3, 3, 'Sales', 'group'); merge(3, 3, 3, 11);
  put(3, 12, 'Transaction', 'group'); merge(3, 12, 3, 15);
  const headers = [
    'Date', 'Time', 'ppl', 'Rent', 'BBQ/ Hotpot', 'Shisha', '到會', 'Drinks',
    '會員積分 / 優惠碼', '信用卡手續費', '加時/罰款', 'Total ',
    'Date', 'Payment Methods', 'Amount', 'Total', 'Vendor', 'Amount',
  ];
  headers.forEach((h, c) => put(4, c, h, 'header'));

  // ── bookings ──
  const FIRST = 5;
  let r = FIRST;
  let sales = 0, expenses = 0, returned = 0;
  const BOOKING_LEVEL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 18, 19, 20];
  for (const b of input.bookings) {
    const span = Math.max(1, b.transactions.length, b.expenses.length);
    const serial = excelDateSerial(b.date);
    put(r, 0, serial ?? b.date, serial == null ? 'text' : 'date');
    put(r, 1, b.time, 'text');
    put(r, 2, b.ppl, 'text');
    // Zero columns stay blank, as on her sheet.
    const salesCols = [b.rent, b.bbqHotpot, b.shisha, b.cater, b.drinks, b.pointsPromo, b.cardSurcharge, b.extPenalty];
    salesCols.forEach((v, i) => put(r, 3 + i, v || '', 'money'));
    const total = r2(salesCols.reduce((s, v) => s + v, 0));
    put(r, 11, total, 'moneyBold', `SUM(${ref(r, 3)}:${ref(r, 10)})`);
    sales += total;
    b.transactions.forEach((t, i) => {
      const ts = excelDateSerial(t.date);
      put(r + i, 12, ts ?? t.date, ts == null ? 'text' : 'txDate');
      put(r + i, 13, t.method, 'text');
      put(r + i, 14, t.amount, 'money');
    });
    if (b.transactions.length > 0) {
      const txTotal = r2(b.transactions.reduce((s, t) => s + t.amount, 0));
      put(r, 15, txTotal, 'money', `SUM(${ref(r, 14)}:${ref(r + b.transactions.length - 1, 14)})`);
    } else {
      put(r, 15, '', 'money');
    }
    b.expenses.forEach((e, i) => {
      put(r + i, 16, e.vendor, 'text');
      put(r + i, 17, e.amount, 'money');
      expenses += e.amount;
    });
    put(r, 18, b.source, 'text');
    put(r, 19, b.returnedDeposit ?? '', 'money');
    returned += b.returnedDeposit || 0;
    put(r, 20, b.remarks, 'remarks');
    if (span > 1) for (const c of BOOKING_LEVEL) merge(r, c, r + span - 1, c);
    r += span;
  }
  const lastBookingRow = r - 1;

  // ── the month's stored expenses, in the Vendor / Amount columns ──
  for (const e of input.storedExpenses) {
    put(r, 11, 0, 'moneyBold', `SUM(${ref(r, 3)}:${ref(r, 10)})`);
    put(r, 16, e.vendor, 'text');
    put(r, 17, e.amount, 'money');
    expenses += e.amount;
    r++;
  }
  // Always at least one body row, so the SUM ranges below are valid.
  if (r === FIRST) { put(r, 11, 0, 'moneyBold', `SUM(${ref(r, 3)}:${ref(r, 10)})`); r++; }
  const LAST = r - 1;

  // ── totals ──
  const sumOf = (pick: (b: MasterSheetBooking) => number) =>
    r2(input.bookings.reduce((s, b) => s + pick(b), 0));
  const colSums = [
    sumOf((b) => b.rent), sumOf((b) => b.bbqHotpot), sumOf((b) => b.shisha), sumOf((b) => b.cater),
    sumOf((b) => b.drinks), sumOf((b) => b.pointsPromo), sumOf((b) => b.cardSurcharge), sumOf((b) => b.extPenalty),
  ];
  colSums.forEach((v, i) => put(r, 3 + i, v, 'sum', `SUM(${ref(FIRST, 3 + i)}:${ref(LAST, 3 + i)})`));
  sales = r2(sales); expenses = r2(expenses); returned = r2(returned);
  put(r, 16, 'Total Expenses: ', 'label');
  put(r, 17, expenses, 'footMoney', `SUM(${ref(FIRST, 17)}:${ref(LAST, 17)})`);
  put(r, 18, 'Total returned: ', 'label');
  put(r, 19, returned, 'footMoney', `SUM(${ref(FIRST, 19)}:${ref(Math.max(FIRST, lastBookingRow), 19)})`);
  const expensesRow = r;
  r++;
  put(r, 10, 'Total Sales Amount :', 'label');
  put(r, 11, sales, 'sum', `SUM(${ref(FIRST, 11)}:${ref(LAST, 11)})`);
  const salesRow = r;
  r += 2;
  const profit = r2(sales - expenses);
  put(r, 15, 'Profit :', 'label');
  put(r, 16, profit, 'footMoney', `(${ref(salesRow, 11)})-(${ref(expensesRow, 17)})`);
  const profitRow = r;
  r++;
  for (const s of input.splits) {
    // Her footer: "To Kenneth (50%) :", "To Heidi (10%) :", "In Account (40%) :".
    put(r, 15, `${/^in\b/i.test(s.name) ? '' : 'To '}${s.name} (${s.pct}%) :`, 'footLabel');
    put(r, 16, profit * (s.pct / 100), 'footMoney', `${ref(profitRow, 16)}*${s.pct}%`);
    r++;
  }

  return {
    cells, merges,
    cols: [30, 17, 10, 13, 15, 12, 12, 12, 14, 14, 13, 18, 14, 18, 16, 16, 28, 16, 18, 18, 44],
    rowCount: r,
    bodyRows: { first: FIRST, last: LAST },
    totals: { sales, expenses, profit, returned },
  };
}
