// KPay fee reconciliation — per BOOKING, across statement months.
//
// PURE module (no firebase, no xlsx) so it is shared by 月結, 支出管理 and
// the Sales Record export, and unit-tested.
//
// A KPay statement lists what was PAID in a month. 月結 books a booking in
// the month of its EVENT. Those are different months all the time: an
// October party is typically paid in August/September (deposit) and
// October (balance). So the fee of a booking is NOT "its share of that
// month's statement" — it is the sum of the fee on each of its own
// payments, each looked up in the statement of the month it was paid in
// (Heidi 2026-11-10: the old upload put a whole statement's fee on the
// selected month).
//
// Matching, in order:
//   1. 外部訂單號 → booking. Our checkout writes `B<bookingId12>_P<epoch>`,
//      so a statement row names its booking exactly.
//   2. Inside that booking, statement rows are paired with the booking's
//      KPay payments (KPay交易號, else same amount, same date first) so a
//      payment with no statement row can be told apart.
//   3. Rows whose order number is not ours fall back to "same date, same
//      amount" against KPay payments still unmatched — only when exactly
//      one payment fits, never a guess.
//
// A KPay payment with no statement row keeps the ESTIMATED fee (% of the
// credited amount, as before) and says why: that month's statement is not
// uploaded yet, or it is uploaded but has no such row (e.g. a payment
// taken on another KPay account and recorded by hand).

import { bookingIdPrefixFromOrderRef, type KpayStatementTxn, type StoredKpayStatement } from './kpayStatement';

/** The slice of a booking this module reads. */
export interface ReconcileBooking {
  id: string;
  payments?: Array<{
    amount?: number;
    cardSurcharge?: number;
    method?: string;
    recordedAt?: unknown;
    kpayTransactionNo?: string;
  }>;
}

export type KpayEstimateReason =
  /** The statement for the month this was paid in has not been uploaded. */
  | 'statement-missing'
  /** That statement is uploaded but carries no row for this payment. */
  | 'not-in-statement'
  /** A refund entry — statements seen so far carry no refund rows. */
  | 'refund';

export interface KpayFeeLine {
  /** HK date the money moved, YYYY-MM-DD ('' when unknown). */
  date: string;
  /** What the gateway charged: credited amount + card surcharge. */
  amount: number;
  fee: number;
  /** True = read off a statement row; false = estimated. */
  actual: boolean;
  /** Statement the fee came from; for an estimate, the statement month
   *  that would carry it ('' when the payment has no usable date). */
  statementMonth: string;
  reason?: KpayEstimateReason;
  payMethod?: string;
}

export interface BookingKpayFee {
  /** actualFee + estimatedFee. */
  fee: number;
  actualFee: number;
  estimatedFee: number;
  lines: KpayFeeLine[];
}

export interface KpayTxnMatch {
  /** Statement month the row came from. */
  month: string;
  txn: KpayStatementTxn;
  bookingId: string | null;
  via: 'order-ref' | 'date-amount' | null;
}

export interface KpayReconciliation {
  byBooking: Map<string, BookingKpayFee>;
  /** Every statement row with the booking it landed on (or null). */
  matches: KpayTxnMatch[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;

const NO_FEE: BookingKpayFee = { fee: 0, actualFee: 0, estimatedFee: 0, lines: [] };

/** Fee of one booking out of a reconciliation (zero when it has none). */
export function kpayFeeOf(rec: KpayReconciliation, bookingId: string): BookingKpayFee {
  return rec.byBooking.get(bookingId) || NO_FEE;
}

/** Stored timestamp (ISO string / Firestore Timestamp / Date) → the HK
 *  calendar date, YYYY-MM-DD. Statements are in HK time, and a payment at
 *  01:00 HKT is still "yesterday" in UTC. */
export function hkDateOf(v: unknown): string {
  let ms: number | null = null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) ms = t;
  } else if (v instanceof Date) {
    ms = v.getTime();
  } else if (v && typeof v === 'object') {
    const o = v as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof o.toMillis === 'function') ms = o.toMillis();
    else if (typeof o.seconds === 'number') ms = o.seconds * 1000;
    else if (typeof o._seconds === 'number') ms = o._seconds * 1000;
  }
  if (ms == null || Number.isNaN(ms)) return '';
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

interface Pay {
  bookingId: string;
  /** Credited amount (the estimate base — surcharge excluded). */
  base: number;
  /** What KPay charged: base + card surcharge. */
  gateway: number;
  date: string;
  txnNo: string;
  matched: boolean;
}

interface Row {
  month: string;
  txn: KpayStatementTxn;
  bookingId: string | null;
  via: KpayTxnMatch['via'];
  /** Paired with one of the booking's payments. */
  paired: boolean;
}

/**
 * Work out every booking's KPay fee from the uploaded statements.
 * Pass ALL bookings (not a month/branch slice): a statement row has to be
 * able to find its booking wherever it sits.
 */
export function reconcileKpayFees(
  bookings: ReconcileBooking[],
  statements: StoredKpayStatement[],
  estimatePct: number,
): KpayReconciliation {
  const pct = estimatePct > 0 ? estimatePct : 0;
  const uploaded = new Set(statements.map((s) => s.month));

  // ── statement rows, de-duplicated across overlapping uploads ──
  const rows: Row[] = [];
  const seenTxnNo = new Set<string>();
  for (const s of [...statements].sort((a, b) => a.month.localeCompare(b.month))) {
    for (const txn of s.transactions || []) {
      if (txn.transactionNo) {
        if (seenTxnNo.has(txn.transactionNo)) continue;
        seenTxnNo.add(txn.transactionNo);
      }
      rows.push({ month: s.month, txn, bookingId: null, via: null, paired: false });
    }
  }

  // ── KPay payments per booking ──
  const paysByBooking = new Map<string, Pay[]>();
  const refundsByBooking = new Map<string, Array<{ amount: number; date: string }>>();
  for (const b of bookings) {
    for (const p of b.payments || []) {
      if (p.method !== 'kpay') continue;
      const base = p.amount || 0;
      if (base === 0) continue;
      const date = hkDateOf(p.recordedAt);
      if (base < 0) {
        const list = refundsByBooking.get(b.id) || [];
        list.push({ amount: base, date });
        refundsByBooking.set(b.id, list);
        continue;
      }
      const list = paysByBooking.get(b.id) || [];
      list.push({
        bookingId: b.id, base, gateway: round2(base + (p.cardSurcharge || 0)),
        date, txnNo: p.kpayTransactionNo || '', matched: false,
      });
      paysByBooking.set(b.id, list);
    }
  }

  // ── 1. 外部訂單號 → booking ──
  const idByPrefix = new Map<string, string>();
  for (const b of bookings) idByPrefix.set(b.id.slice(0, 12), b.id);
  const rowsByBooking = new Map<string, Row[]>();
  for (const row of rows) {
    const prefix = bookingIdPrefixFromOrderRef(row.txn.orderRef);
    if (!prefix) continue;
    const id = idByPrefix.get(prefix) ?? bookings.find((b) => b.id.startsWith(prefix))?.id;
    if (!id) continue;
    row.bookingId = id;
    row.via = 'order-ref';
    const list = rowsByBooking.get(id) || [];
    list.push(row);
    rowsByBooking.set(id, list);
  }

  // ── 2. pair each booking's rows with its payments ──
  const pair = (row: Row, pay: Pay) => { row.paired = true; pay.matched = true; };
  rowsByBooking.forEach((bRows, id) => {
    const pays = paysByBooking.get(id) || [];
    const passes: Array<(row: Row, pay: Pay) => boolean> = [
      (row, pay) => !!pay.txnNo && pay.txnNo === row.txn.transactionNo,
      (row, pay) => sameMoney(pay.gateway, row.txn.amount) && !!pay.date && pay.date === row.txn.date,
      (row, pay) => sameMoney(pay.gateway, row.txn.amount),
      // Amount differs (e.g. the entry was corrected by hand later) but it
      // is clearly the same payment — pairing it stops the fee being
      // counted twice, once actual and once estimated.
      (row, pay) => !!pay.date && pay.date === row.txn.date,
    ];
    for (const fits of passes) {
      for (const row of bRows) {
        if (row.paired) continue;
        const pay = pays.find((p) => !p.matched && fits(row, p));
        if (pay) pair(row, pay);
      }
    }
    const openRows = bRows.filter((r) => !r.paired);
    const openPays = pays.filter((p) => !p.matched);
    // One of each left over: the same payment, unless the payment's own
    // statement simply is not uploaded yet (then its row is still to come).
    if (openRows.length === 1 && openPays.length === 1) {
      const payMonth = openPays[0].date.slice(0, 7);
      if (!payMonth || uploaded.has(payMonth)) pair(openRows[0], openPays[0]);
    }
  });

  // ── 3. rows with no order number of ours: same date + same amount ──
  const allPays: Pay[] = [];
  paysByBooking.forEach((list) => allPays.push(...list));
  for (const row of rows) {
    if (row.bookingId) continue;
    const open = allPays.filter((p) => !p.matched);
    let hits = row.txn.transactionNo ? open.filter((p) => p.txnNo === row.txn.transactionNo) : [];
    if (hits.length === 0 && row.txn.date) {
      hits = open.filter((p) => p.date === row.txn.date && sameMoney(p.gateway, row.txn.amount));
    }
    if (hits.length !== 1) continue; // none, or ambiguous — leave for a human
    row.bookingId = hits[0].bookingId;
    row.via = 'date-amount';
    pair(row, hits[0]);
  }

  // ── fee lines per booking ──
  const acc = new Map<string, { lines: KpayFeeLine[]; actual: number; estBase: number }>();
  const slot = (id: string) => {
    let s = acc.get(id);
    if (!s) { s = { lines: [], actual: 0, estBase: 0 }; acc.set(id, s); }
    return s;
  };
  for (const row of rows) {
    if (!row.bookingId) continue;
    const s = slot(row.bookingId);
    s.actual += row.txn.fee;
    s.lines.push({
      date: row.txn.date || '', amount: row.txn.amount, fee: row.txn.fee,
      actual: true, statementMonth: row.month,
      ...(row.txn.payMethod ? { payMethod: row.txn.payMethod } : {}),
    });
  }
  for (const pay of allPays) {
    if (pay.matched) continue;
    const s = slot(pay.bookingId);
    const month = pay.date.slice(0, 7);
    s.estBase += pay.base;
    s.lines.push({
      date: pay.date, amount: pay.gateway, fee: round2(pay.base * pct / 100),
      actual: false, statementMonth: month,
      reason: month && uploaded.has(month) ? 'not-in-statement' : 'statement-missing',
    });
  }
  refundsByBooking.forEach((list, id) => {
    const s = slot(id);
    for (const r of list) {
      s.estBase += r.amount;
      s.lines.push({
        date: r.date, amount: r.amount, fee: round2(r.amount * pct / 100),
        actual: false, statementMonth: r.date.slice(0, 7), reason: 'refund',
      });
    }
  });

  const byBooking = new Map<string, BookingKpayFee>();
  acc.forEach((s, id) => {
    const actualFee = round2(s.actual);
    // One rounding over the whole estimated base — identical to
    // bookingMoney.estimatedKpayFee when nothing is matched.
    const estimatedFee = round2(s.estBase * pct / 100);
    s.lines.sort((a, b) => a.date.localeCompare(b.date));
    byBooking.set(id, { fee: round2(actualFee + estimatedFee), actualFee, estimatedFee, lines: s.lines });
  });

  return {
    byBooking,
    matches: rows.map((r) => ({ month: r.month, txn: r.txn, bookingId: r.bookingId, via: r.via })),
  };
}

/** Totals of a set of bookings' fees — what a month/branch P&L shows. */
export function sumKpayFees(fees: BookingKpayFee[]): {
  fee: number; actualFee: number; estimatedFee: number; actualLines: number; estimatedLines: number;
} {
  let actual = 0, est = 0, actualLines = 0, estimatedLines = 0;
  for (const f of fees) {
    actual += f.actualFee; est += f.estimatedFee;
    for (const l of f.lines) { if (l.actual) actualLines++; else estimatedLines++; }
  }
  return {
    fee: round2(actual + est), actualFee: round2(actual), estimatedFee: round2(est),
    actualLines, estimatedLines,
  };
}
