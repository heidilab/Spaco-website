// Finance Phase 3 — KPay monthly statement parser (月結對帳).
//
// PURE module (no firebase, no xlsx import) — the caller reads the
// uploaded file with xlsx into a rows-of-cells array and hands it here.
// KPay statement layouts vary and we have no fixed spec, so columns are
// detected heuristically from the header row by keyword. The summary it
// returns (gross / fee / net) replaces the estimated KPay fee for the
// month once Heidi confirms the numbers on screen.

export interface KpayStatementSummary {
  rowCount: number;
  gross: number;
  fee: number;
  net: number;
  /** Which header labels were matched — shown in the UI so a wrong
   *  column guess is visible instead of silent. */
  matched: { gross?: string; fee?: string; net?: string };
}

const FEE_KEYWORDS = ['手續費', '服務費', 'fee', 'charge', 'mdr', 'commission'];
const NET_KEYWORDS = ['淨', '結算', 'net', 'settle', 'payout'];
const GROSS_KEYWORDS = ['交易金額', '金額', 'amount', 'gross', 'total'];

function cellText(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = cellText(v).replace(/[$,＄，\s]/g, '').replace(/^HKD?/i, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function findColumn(header: unknown[], keywords: string[], exclude: string[] = []): number {
  for (let c = 0; c < header.length; c++) {
    const h = cellText(header[c]).toLowerCase();
    if (!h) continue;
    if (exclude.some((k) => h.includes(k))) continue;
    if (keywords.some((k) => h.includes(k))) return c;
  }
  return -1;
}

/**
 * Parse a KPay statement given as raw rows (xlsx sheet_to_json with
 * header:1, or parsed CSV). Returns null when no usable header row is
 * found — the UI then asks Heidi to send us the statement format.
 */
export function parseKpayStatement(rows: unknown[][]): KpayStatementSummary | null {
  // Find the header row: first row within the top 20 that yields a fee
  // or net column. Statements often carry title/merchant banner rows.
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const header = rows[r] || [];
    const feeCol = findColumn(header, FEE_KEYWORDS);
    const netCol = findColumn(header, NET_KEYWORDS, FEE_KEYWORDS);
    if (feeCol < 0 && netCol < 0) continue;
    const grossCol = findColumn(header, GROSS_KEYWORDS, [...FEE_KEYWORDS, ...NET_KEYWORDS]);

    let rowCount = 0, gross = 0, fee = 0, net = 0;
    for (let i = r + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const g = grossCol >= 0 ? toNumber(row[grossCol]) : 0;
      const f = feeCol >= 0 ? toNumber(row[feeCol]) : 0;
      const n = netCol >= 0 ? toNumber(row[netCol]) : 0;
      if (g === 0 && f === 0 && n === 0) continue;
      // Skip an embedded totals row — it would double everything.
      const label = cellText(row[0]).toLowerCase();
      if (label.includes('total') || label.includes('合計') || label.includes('總')) continue;
      rowCount++;
      gross += g; fee += Math.abs(f); net += n;
    }
    if (rowCount === 0) continue;
    // Fee column missing but gross+net present → fee is the difference.
    if (feeCol < 0 && grossCol >= 0 && netCol >= 0) fee = Math.max(0, gross - net);
    const round2 = (x: number) => Math.round(x * 100) / 100;
    return {
      rowCount,
      gross: round2(gross),
      fee: round2(fee),
      net: round2(net),
      matched: {
        gross: grossCol >= 0 ? cellText(header[grossCol]) : undefined,
        fee: feeCol >= 0 ? cellText(header[feeCol]) : undefined,
        net: netCol >= 0 ? cellText(header[netCol]) : undefined,
      },
    };
  }
  return null;
}
