// Finance Phase 3 — KPay monthly statement parser (月結對帳).
//
// PURE module (no firebase, no xlsx import) — the caller reads the
// uploaded file with xlsx into a rows-of-cells array and hands it here.
//
// Calibrated against the real statement (AUG-2026, sheet 「交易結算」):
//   row 「交易對賬匯總」 header: 交易筆數 | 交易幣種 | 交易總金額 |
//     小費總額 | 交易手續費總額 | 本地幣種 | 本地總金額
//   …one summary row, then a per-transaction table whose header has
//   支付金額 / 手續費 / 交易狀態 (處理成功) and long numeric order ids —
//   which is why money columns must be matched by LABEL, never by
//   "looks like a number".
//
// Strategy: (1) the summary block is authoritative when present;
// (2) else sum the detail table (successful rows only); (3) else a
// generic keyword fallback for unfamiliar layouts, with an ID guard so
// 16-digit order numbers can never be mistaken for amounts.

export interface KpayStatementTxn {
  /** 外部訂單號 (our outTradeNo, `B<bookingId12>_P<epoch>`), falling
   *  back to 商戶訂單號 when absent. */
  orderRef: string;
  amount: number;
  fee: number;
}

export interface KpayStatementSummary {
  rowCount: number;
  gross: number;
  fee: number;
  net: number;
  /** Which header labels were matched — shown in the UI so a wrong
   *  column guess is visible instead of silent. */
  matched: { gross?: string; fee?: string; net?: string };
  /** Per-transaction rows from the detail table (when present) — used
   *  to split the account-wide fee across branches by booking id. */
  transactions?: KpayStatementTxn[];
  /** YYYY-MM from the merchant block's 交易日期 (e.g. 202608) — lets the
   *  UI warn when the statement doesn't match the selected month. */
  statementMonth?: string;
}

/**
 * `B4qKhjuR566Uk_P1788171615` → `4qKhjuR566Uk` (first 12 chars of the
 * booking id; refunds use an R prefix). Null when the ref isn't ours.
 */
export function bookingIdPrefixFromOrderRef(ref: string): string | null {
  const m = /^[BR]([A-Za-z0-9_-]+?)_[PB]?\d+$/.exec(ref.trim());
  return m ? m[1] : null;
}

function cellText(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = cellText(v).replace(/[$,＄，\s]/g, '').replace(/^HKD?/i, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Anything at or beyond 100M isn't HK-venue money — it's an order id. */
function toMoney(v: unknown): number {
  const n = toNumber(v);
  return Math.abs(n) >= 1e8 ? 0 : n;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** ① The 「交易對賬匯總」 summary block — count / gross / fee on the row
 *  right under its header. Authoritative when present. */
function parseSummaryBlock(rows: unknown[][]): KpayStatementSummary | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const header = (rows[r] || []).map(cellText);
    const countCol = header.findIndex((h) => h.includes('交易筆數') || h.includes('筆數'));
    const feeCol = header.findIndex((h) => h.includes('手續費'));
    const grossCol = header.findIndex((h) => (h.includes('交易總金額') || h.includes('總金額')) && !h.includes('本地') && !h.includes('手續費'));
    if (feeCol < 0 || grossCol < 0) continue;
    // First following row with numbers in those columns.
    for (let i = r + 1; i < Math.min(rows.length, r + 4); i++) {
      const row = rows[i] || [];
      const gross = toMoney(row[grossCol]);
      const fee = toMoney(row[feeCol]);
      if (gross === 0 && fee === 0) continue;
      const count = countCol >= 0 ? Math.round(toNumber(row[countCol])) : 0;
      return {
        rowCount: count,
        gross: round2(gross),
        fee: round2(Math.abs(fee)),
        net: round2(gross - Math.abs(fee)),
        matched: { gross: header[grossCol], fee: header[feeCol] },
      };
    }
  }
  return null;
}

/** ② The per-transaction 「交易結算」 table — header carries 支付金額 +
 *  手續費 (+ 交易狀態). Sums successful rows only. */
function parseDetailTable(rows: unknown[][]): KpayStatementSummary | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const header = (rows[r] || []).map(cellText);
    const payCol = header.findIndex((h) => h === '支付金額' || h.includes('支付金額'));
    const feeCol = header.findIndex((h) => h === '手續費' || (h.includes('手續費') && !h.includes('總額')));
    if (payCol < 0 || feeCol < 0) continue;
    const statusCol = header.findIndex((h) => h.includes('交易狀態') || h.includes('狀態'));
    const extRefCol = header.findIndex((h) => h.includes('外部訂單號'));
    const merchRefCol = header.findIndex((h) => h.includes('商戶訂單號'));
    let rowCount = 0, gross = 0, fee = 0;
    const transactions: KpayStatementTxn[] = [];
    for (let i = r + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const g = toMoney(row[payCol]);
      const f = toMoney(row[feeCol]);
      if (g === 0 && f === 0) continue;
      if (statusCol >= 0) {
        const st = cellText(row[statusCol]);
        if (st && !st.includes('成功')) continue; // refunds/failures excluded
      }
      rowCount++; gross += g; fee += Math.abs(f);
      transactions.push({
        orderRef: cellText(extRefCol >= 0 ? row[extRefCol] : '') || cellText(merchRefCol >= 0 ? row[merchRefCol] : ''),
        amount: round2(g),
        fee: round2(Math.abs(f)),
      });
    }
    if (rowCount === 0) continue;
    return {
      rowCount,
      gross: round2(gross),
      fee: round2(fee),
      net: round2(gross - fee),
      matched: { gross: header[payCol], fee: header[feeCol] },
      transactions,
    };
  }
  return null;
}

const FEE_KEYWORDS = ['手續費', '服務費', 'fee', 'charge', 'mdr', 'commission'];
const NET_KEYWORDS = ['淨', '結算金額', 'net', 'settle', 'payout'];
const GROSS_KEYWORDS = ['交易金額', '金額', 'amount', 'gross', 'total'];

function findColumn(header: unknown[], keywords: string[], exclude: string[] = []): number {
  for (let c = 0; c < header.length; c++) {
    const h = cellText(header[c]).toLowerCase();
    if (!h) continue;
    if (exclude.some((k) => h.includes(k))) continue;
    if (keywords.some((k) => h.includes(k))) return c;
  }
  return -1;
}

/** ③ Generic keyword fallback for statement layouts we haven't seen. */
function parseGeneric(rows: unknown[][]): KpayStatementSummary | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const header = rows[r] || [];
    const feeCol = findColumn(header, FEE_KEYWORDS);
    const netCol = findColumn(header, NET_KEYWORDS, FEE_KEYWORDS);
    if (feeCol < 0 && netCol < 0) continue;
    const grossCol = findColumn(header, GROSS_KEYWORDS, [...FEE_KEYWORDS, ...NET_KEYWORDS]);
    let rowCount = 0, gross = 0, fee = 0, net = 0;
    for (let i = r + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const g = grossCol >= 0 ? toMoney(row[grossCol]) : 0;
      const f = feeCol >= 0 ? toMoney(row[feeCol]) : 0;
      const n = netCol >= 0 ? toMoney(row[netCol]) : 0;
      if (g === 0 && f === 0 && n === 0) continue;
      const label = cellText(row[0]).toLowerCase();
      if (label.includes('total') || label.includes('合計') || label.includes('總')) continue;
      rowCount++;
      gross += g; fee += Math.abs(f); net += n;
    }
    if (rowCount === 0) continue;
    if (feeCol < 0 && grossCol >= 0 && netCol >= 0) fee = Math.max(0, gross - net);
    return {
      rowCount,
      gross: round2(gross),
      fee: round2(fee),
      net: round2(netCol >= 0 ? net : gross - fee),
      matched: {
        gross: grossCol >= 0 ? cellText(header[grossCol]) : undefined,
        fee: feeCol >= 0 ? cellText(header[feeCol]) : undefined,
        net: netCol >= 0 ? cellText(header[netCol]) : undefined,
      },
    };
  }
  return null;
}

/**
 * Parse a KPay statement given as raw rows (xlsx sheet_to_json with
 * header:1, or parsed CSV). Returns null when nothing recognizable is
 * found — the UI then asks Heidi to send us the statement file.
 */
/** YYYY-MM from the merchant block: header cell 交易日期, value 202608. */
function scanStatementMonth(rows: unknown[][]): string | undefined {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const header = (rows[r] || []).map(cellText);
    const c = header.findIndex((h) => h === '交易日期');
    if (c < 0) continue;
    const v = cellText((rows[r + 1] || [])[c]);
    const m = /^(\d{4})(\d{2})$/.exec(v);
    if (m) return `${m[1]}-${m[2]}`;
  }
  return undefined;
}

export function parseKpayStatement(rows: unknown[][]): KpayStatementSummary | null {
  const summary = parseSummaryBlock(rows);
  const detail = parseDetailTable(rows);
  const base = summary
    ? { ...summary, transactions: detail?.transactions }  // totals from the
    //   official summary block, per-txn rows from the detail table
    : (detail || parseGeneric(rows));
  if (!base) return null;
  return { ...base, statementMonth: scanStatementMonth(rows) };
}
