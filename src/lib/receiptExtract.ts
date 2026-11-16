// 單據自動入帳 — the pure half of the OneDrive receipt pipeline.
//
// Everything here is side-effect free so it can be unit-tested: how a
// receipt file is turned into something Claude can read, how Claude's
// answer becomes an expense row, which branch a folder belongs to, and
// how a row maps onto the columns of Heidi's own Excel. The network half
// (Graph calls, Firestore writes, the Claude request) lives in
// receiptIngest.ts / msgraph.ts.

import type { ExcelColumnKey, ExpenseRecord, ExpenseReceiptMeta, ReceiptConfidence } from '@/types';

// ── What Claude can read ───────────────────────────────────────────────

export interface DriveFileLike {
  name: string;
  size?: number;
  mimeType?: string;
}

export interface AttachmentPlan {
  kind: 'image' | 'pdf';
  mediaType: string;
  /** Fetch a server-rendered JPEG thumbnail instead of the original —
   *  HEIC photos (iPhone default) and oversized images. */
  viaThumbnail: boolean;
}

/** Claude's per-image limit is 5 MB; a 12-MP phone JPEG is often ~4 MB,
 *  so anything above this goes through the OneDrive thumbnail renderer. */
export const MAX_DIRECT_IMAGE_BYTES = 4.5 * 1024 * 1024;
/** PDF request limit is 32 MB before base64; keep a wide margin. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};
const THUMBNAIL_ONLY = new Set(['heic', 'heif', 'tif', 'tiff', 'bmp']);

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/** How to hand this file to Claude, or null when it is not a receipt
 *  type we read (Word docs, zips, folders…). */
export function attachmentPlan(file: DriveFileLike): AttachmentPlan | null {
  const ext = fileExtension(file.name);
  const size = file.size ?? 0;
  if (ext === 'pdf' || file.mimeType === 'application/pdf') {
    if (size > MAX_PDF_BYTES) return null;
    return { kind: 'pdf', mediaType: 'application/pdf', viaThumbnail: false };
  }
  if (THUMBNAIL_ONLY.has(ext)) return { kind: 'image', mediaType: 'image/jpeg', viaThumbnail: true };
  const direct = IMAGE_TYPES[ext] || (file.mimeType && file.mimeType.startsWith('image/') ? file.mimeType : '');
  if (!direct) return null;
  if (size > MAX_DIRECT_IMAGE_BYTES) return { kind: 'image', mediaType: 'image/jpeg', viaThumbnail: true };
  return { kind: 'image', mediaType: direct, viaThumbnail: false };
}

// ── Claude's answer → structured receipt ───────────────────────────────

export interface ParsedReceipt {
  date: string | null;          // YYYY-MM-DD
  vendor: string | null;
  total: number | null;         // final amount paid
  currency: string;             // 'HKD' when unsure
  summary: string | null;       // ≤ 80 chars, what was bought
  category: string | null;
  confidence: ReceiptConfidence;
  multipleReceipts: boolean;
  notes: string | null;
}

export const RECEIPT_CATEGORIES = [
  '餐飲/食材', '日用品/耗材', '維修', '水電煤', '租金/管理費', '清潔', '裝修/傢俬', '交通/運輸', '市場推廣', '其他',
];

export const RECEIPT_SYSTEM_PROMPT =
  'You read expense receipts and invoices for SPACO, a Hong Kong party-venue business. '
  + 'Receipts may be printed, handwritten, in Traditional Chinese or English, photographed at an angle, or PDF e-receipts. '
  + 'Answer with ONE JSON object and nothing else — no prose, no markdown fences.';

export function receiptPrompt(fileName: string): string {
  return [
    `File name: ${fileName}`,
    'Extract the receipt into this JSON shape:',
    '{',
    '  "date": "YYYY-MM-DD or null",            // the transaction/payment date on the receipt (Hong Kong writes DD/MM/YYYY)',
    '  "vendor": "shop or company name or null",',
    '  "total": 123.45,                          // the FINAL amount actually paid, after discounts, including service charge and tips; number or null',
    '  "currency": "HKD",                        // ISO code; HKD when the receipt is in HK$ or unmarked',
    '  "summary": "short Traditional Chinese line of what was bought (max 80 chars)",',
    `  "category": "one of: ${RECEIPT_CATEGORIES.join(' | ')}",`,
    '  "confidence": "high | medium | low",      // low when the total or date is hard to read',
    '  "multipleReceipts": false,                // true if the image shows more than one receipt (then total = their sum)',
    '  "notes": "anything uncertain, or null"',
    '}',
    'If a field cannot be read, use null — never guess a number.',
  ].join('\n');
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.toLowerCase() !== 'null' ? t : null;
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD, 2026年11月3日. */
export function normalizeDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  return null;
}

function ymd(y: number, mo: number, d: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Pull the first JSON object out of a model reply (tolerates fences and
 *  stray text) and normalise every field. Throws when there is no JSON. */
export function parseReceiptJson(text: string): ParsedReceipt {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON in model reply');
  // Walk to the matching brace so trailing commentary never breaks parsing.
  let depth = 0; let end = -1; let inStr = false; let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error('unterminated JSON in model reply');
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const conf = str(raw.confidence)?.toLowerCase();
  const currency = (str(raw.currency) || 'HKD').toUpperCase().replace(/^HK\$?$/, 'HKD');
  return {
    date: normalizeDate(raw.date),
    vendor: str(raw.vendor),
    total: num(raw.total),
    currency,
    summary: str(raw.summary)?.slice(0, 80) || null,
    category: str(raw.category),
    confidence: conf === 'high' || conf === 'low' ? conf : 'medium',
    multipleReceipts: raw.multipleReceipts === true,
    notes: str(raw.notes),
  };
}

// ── Receipt → expense row ──────────────────────────────────────────────

export interface ReceiptFileInfo {
  driveItemId: string;
  fileName: string;
  webUrl?: string;
  folderPath?: string;
  /** ISO timestamp the file was created in OneDrive (upload time). */
  createdDateTime?: string;
}

export type NewReceiptExpense = Omit<ExpenseRecord, 'id' | 'createdAt'>;

/** Hong Kong calendar date (YYYY-MM-DD) of an instant. */
export function hkDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Build the expense row for a parsed receipt. Never refuses: an
 *  unreadable amount becomes a 0 row with an 'no_amount' flag so it is
 *  still visible in 支出管理 for Heidi to fix (she asked for full-auto). */
export function buildReceiptExpense(
  parsed: ParsedReceipt,
  file: ReceiptFileInfo,
  branchKey: string,
  now: Date = new Date(),
): NewReceiptExpense {
  const flags: string[] = [];
  let date = parsed.date;
  if (!date) {
    date = hkDate(file.createdDateTime ? new Date(file.createdDateTime) : now);
    flags.push(parsed.total === null && !parsed.vendor ? 'unreadable' : 'no_date');
    flags.push('date_fallback');
  }
  const amount = parsed.total !== null && parsed.total >= 0 ? round2(parsed.total) : 0;
  if (parsed.total === null) flags.push('no_amount');
  if (parsed.multipleReceipts) flags.push('multiple_receipts');
  if (parsed.currency && parsed.currency !== 'HKD') flags.push('foreign_currency');

  const item = itemLabel(parsed, file.fileName);
  const receipt: ExpenseReceiptMeta = {
    driveItemId: file.driveItemId,
    fileName: file.fileName,
    ...(file.webUrl ? { webUrl: file.webUrl } : {}),
    ...(file.folderPath ? { folderPath: file.folderPath } : {}),
    ...(parsed.vendor ? { vendor: parsed.vendor } : {}),
    currency: parsed.currency || 'HKD',
    ...(parsed.category ? { category: parsed.category } : {}),
    confidence: flags.includes('unreadable') || flags.includes('no_amount') ? 'low' : parsed.confidence,
    flags: Array.from(new Set(flags)),
    ...(parsed.summary ? { summary: parsed.summary } : {}),
    ...(parsed.notes ? { readerNotes: parsed.notes } : {}),
  };
  return {
    branchKey,
    month: date.slice(0, 7),
    date,
    item,
    amount,
    source: 'receipt',
    reviewed: false,
    receipt,
    createdBy: 'onedrive-sync',
  };
}

export function itemLabel(parsed: Pick<ParsedReceipt, 'vendor' | 'summary'>, fileName: string): string {
  const parts = [parsed.vendor, parsed.summary].filter((p): p is string => !!p);
  const label = parts.join(' · ').trim();
  return (label || fileName.replace(/\.[a-z0-9]+$/i, '')).slice(0, 100);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Another receipt row for the same branch, date and amount — usually
 *  the same receipt photographed twice. Only flags; never blocks. */
export function findPossibleDuplicate<T extends Pick<ExpenseRecord, 'id' | 'branchKey' | 'date' | 'amount' | 'source'>>(
  existing: readonly T[], candidate: Pick<NewReceiptExpense, 'branchKey' | 'date' | 'amount'>,
): T | undefined {
  if (!(candidate.amount > 0)) return undefined;
  return existing.find((r) => r.source === 'receipt' && r.branchKey === candidate.branchKey
    && r.date === candidate.date && Math.abs(r.amount - candidate.amount) < 0.005);
}

// ── Folder → branch ────────────────────────────────────────────────────

export interface BranchOption { key: string; zh: string; en: string }

const BRANCH_ALIASES: Record<string, string[]> = {
  cwb: ['銅鑼灣', 'causeway', 'cwb'],
  sw: ['上環', 'sheung wan', 'sheungwan', 'sw'],
  tst: ['尖沙咀', 'tsim sha tsui', 'tsimshatsui', 'tst'],
  wanchai: ['灣仔', 'wan chai', 'wanchai', 'wc'],
};

/** Best-guess branch for a folder name, so the mapping UI is pre-filled;
 *  Heidi confirms or changes it. */
export function guessBranchKey(folderName: string, branches: readonly BranchOption[]): string | null {
  const n = (folderName || '').toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
  if (!n) return null;
  for (const b of branches) {
    const names = [b.key, b.zh, b.en, ...(BRANCH_ALIASES[b.key] || [])].map((x) => x.toLowerCase());
    if (names.some((x) => x && (n === x || n.includes(x) || n.replace(/\s/g, '') === x.replace(/\s/g, '')))) return b.key;
  }
  return null;
}

// ── Excel column plumbing ──────────────────────────────────────────────

export function columnLetterToIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToColumnLetter(index: number): string {
  let i = index + 1; let s = '';
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

export interface RangeAddress { sheet: string; startCol: string; startRow: number; endCol: string; endRow: number }

/** "Sheet1!B3:H40" or "'My Sheet'!A1:A1" → parts. Single cells repeat. */
export function parseRangeAddress(address: string): RangeAddress {
  const bang = address.lastIndexOf('!');
  const sheet = bang >= 0 ? address.slice(0, bang).replace(/^'|'$/g, '') : '';
  const ref = bang >= 0 ? address.slice(bang + 1) : address;
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(ref.trim());
  if (!m) throw new Error(`bad range address: ${address}`);
  return {
    sheet,
    startCol: m[1].toUpperCase(), startRow: +m[2],
    endCol: (m[3] || m[1]).toUpperCase(), endRow: +(m[4] || m[2]),
  };
}

export interface ExcelRowContext {
  branchName: string;
}

/** Cell value for each mapped column. Dates go as text (YYYY-MM-DD) so
 *  a plain sheet never shows a raw serial number; amounts as numbers. */
export function excelRowValues(
  columns: Partial<Record<ExcelColumnKey, string>>,
  row: Pick<ExpenseRecord, 'id' | 'date' | 'item' | 'amount' | 'note' | 'reviewed' | 'receipt'>,
  ctx: ExcelRowContext,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const put = (key: ExcelColumnKey, v: string | number | undefined | null) => {
    const col = columns[key];
    if (!col) return;
    out[col.toUpperCase()] = v === undefined || v === null ? '' : v;
  };
  put('id', row.id);
  put('date', row.date);
  put('branch', ctx.branchName);
  put('item', row.item);
  put('vendor', row.receipt?.vendor || '');
  put('amount', row.amount);
  put('category', row.receipt?.category || '');
  put('note', row.note || row.receipt?.summary || '');
  put('reviewed', row.reviewed ? '✓' : '');
  put('link', row.receipt?.webUrl || '');
  return out;
}

/** Values array for `tables/{t}/rows/add`: one slot per table column,
 *  null where nothing is mapped (keeps calculated columns intact). */
export function tableRowArray(
  cells: Record<string, string | number>, tableStartCol: string, columnCount: number,
): Array<string | number | null> {
  const start = columnLetterToIndex(tableStartCol);
  const arr: Array<string | number | null> = new Array(columnCount).fill(null);
  for (const [col, v] of Object.entries(cells)) {
    const i = columnLetterToIndex(col) - start;
    if (i >= 0 && i < columnCount) arr[i] = v;
  }
  return arr;
}

// ── Month-sheet layout (her Financial Master workbooks) ────────────────

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function normSheetName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The sheet for an expense month, e.g. 2026-11 → 「NOV-2026」. Case,
 *  spaces and dashes do not matter (NOV 2026, Nov-2026, 2026-11 …). */
export function findMonthSheet(sheetNames: string[], month: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const yyyy = m[1]; const mi = +m[2] - 1;
  if (mi < 0 || mi > 11) return null;
  const mm = m[2];
  const abbr = MONTH_ABBR[mi]; const full = MONTH_FULL[mi];
  const wanted = new Set([
    `${abbr}${yyyy}`, `${full}${yyyy}`, `${yyyy}${abbr}`, `${yyyy}${full}`,
    `${yyyy}${mm}`, `${mm}${yyyy}`, `${abbr}${yyyy.slice(2)}`, `${yyyy.slice(2)}${abbr}`,
  ]);
  for (const n of sheetNames) if (wanted.has(normSheetName(n))) return n;
  return null;
}

export interface MonthLayout {
  headerRow: number; vendorColumn: string; amountColumn: string;
  /** The sheet's 「Date」 column (A) — Heidi puts an expense's date there. */
  dateColumn?: string;
  /** The 「Remarks」 column (U), from the banner rows above the header. */
  noteColumn?: string;
}

/** Find the 「Vendor | Amount」 header pair in a sheet's used range
 *  (values as Graph returns them; `origin` is the used range's top-left),
 *  plus the first Date column and the Remarks column if present. */
export function detectMonthLayout(
  values: unknown[][], origin: { startCol: string; startRow: number } = { startCol: 'A', startRow: 1 },
): MonthLayout | null {
  const c0 = columnLetterToIndex(origin.startCol);
  const txt = (v: unknown) => String(v ?? '').trim().toLowerCase();
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length - 1; c++) {
      const a = txt(row[c]); const b = txt(row[c + 1]);
      if ((a === 'vendor' || a === '商戶' || a === '供應商') && (a !== b) && /^(amount|金額|hk\$)/.test(b)) {
        const out: MonthLayout = { headerRow: origin.startRow + r, vendorColumn: indexToColumnLetter(c0 + c), amountColumn: indexToColumnLetter(c0 + c + 1) };
        for (let k = 0; k < c; k++) if (/^(date|日期)$/.test(txt(row[k]))) { out.dateColumn = indexToColumnLetter(c0 + k); break; }
        for (let rr = 0; rr <= r && !out.noteColumn; rr++) {
          const hr = values[rr] || [];
          for (let k = 0; k < hr.length; k++) if (/^(remarks?|備註|備注)$/.test(txt(hr[k]))) { out.noteColumn = indexToColumnLetter(c0 + k); break; }
        }
        return out;
      }
    }
  }
  return null;
}

/** Excel serial for a YYYY-MM-DD date (days since 1899-12-30), so the
 *  cell is a real date like the ones she types, not text. */
export function excelDateSerial(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30);
  return Math.round(ms / 86400000);
}

/** What goes in the Vendor / Remarks cells. 支出管理's 項目 is
 *  「vendor · summary」, and her Vendor column holds short names
 *  (Taobao, Brilliant Balloon), so the part before 「 · 」 goes under
 *  Vendor and the rest under Remarks (her note first when she wrote one).
 *  Editing 項目 in 支出管理 therefore updates both cells. */
export function monthSheetCells(row: Pick<ExpenseRecord, 'item' | 'amount' | 'note' | 'receipt'>): { vendor: string; amount: number; note: string } {
  const [head, ...rest] = (row.item || '').split(' · ');
  const vendor = (head || row.item || '').trim().slice(0, 100);
  const tail = rest.join(' · ').trim();
  const note = (row.note?.trim() || tail || row.receipt?.summary || '').slice(0, 200);
  return { vendor, amount: row.amount, note };
}

export interface MonthWritePlan {
  /** Line that already carries this SPACO ID (edit / delete target). */
  foundRow: number | null;
  /** Line with this exact Vendor text + amount but no ID: left by a run
   *  that died mid-write. Reused (or cleared) instead of adding another. */
  orphanRow: number | null;
  /** Another line (no ID, different vendor text) with the same amount —
   *  very likely Heidi typed this expense by hand already. Reported, not
   *  touched: she decides which one stays. */
  sameAmountRow: number | null;
  /** The LAST free line in the Expenses block (just above her fixed
   *  costs — Taobao / 管理費 / Rent sit at the bottom), or null when the
   *  block is full. Receipts stack upward from there (Heidi 2026-11-16). */
  freeRow: number | null;
  /** Line with 「Total Expenses:」 (insert point when the block is full). */
  totalRow: number | null;
}

/** Blank for line-picking purposes: nothing, or a formula that shows 0
 *  (her Total column is =SUM(...) on every line, so empty lines read 0). */
const isBlank = (v: unknown) => v === null || v === undefined || v === '' || v === 0;

/** Where a receipt line goes on a month sheet. `values` is the whole used
 *  range (valuesOnly). A free line is one with nothing in ANY column —
 *  her merged transaction groups and bookings are left alone — and the
 *  last such line (nearest her fixed costs) is the one to use. */
export function planMonthWrite(
  values: unknown[][], origin: { startCol: string; startRow: number },
  layout: MonthLayout & { idColumn: string }, id: string, formulas?: unknown[][],
  match?: { vendors: string[]; amount: number },
): MonthWritePlan {
  const c0 = columnLetterToIndex(origin.startCol);
  const col = (letter: string) => columnLetterToIndex(letter) - c0;
  const vi = col(layout.vendorColumn); const ai = col(layout.amountColumn); const ii = col(layout.idColumn);
  const cell = (r: number, ci: number) => (ci < 0 ? null : (values[r] || [])[ci]);
  const rowNo = (r: number) => origin.startRow + r;
  let foundRow: number | null = null; let orphanRow: number | null = null; let sameAmountRow: number | null = null;
  let freeRow: number | null = null; let totalRow: number | null = null;
  const firstData = layout.headerRow - origin.startRow + 1;
  for (let r = Math.max(0, firstData); r < values.length; r++) {
    const vendor = String(cell(r, vi) ?? '').trim();
    if (/^total\s*expenses?/i.test(vendor)) { totalRow = rowNo(r); break; }
    const idCell = String(cell(r, ii) ?? '');
    if (foundRow === null && idCell === id) foundRow = rowNo(r);
    if (match && idCell === '' && vendor !== '' && Number(cell(r, ai)) === match.amount) {
      if (match.vendors.some((v) => v.trim() === vendor)) { if (orphanRow === null) orphanRow = rowNo(r); }
      else if (sameAmountRow === null) sameAmountRow = rowNo(r);
    }
    if ((values[r] || []).every(isBlank) && !isReservedRow(formulas, r, rowNo(r))) freeRow = rowNo(r);
  }
  return { foundRow, orphanRow, sameAmountRow, freeRow, totalRow };
}

/** A blank line just under a booking whose payment group spans into it
 *  (=SUM(O15:O16) on the line above) belongs to that group — her merged
 *  cells (Kpay fee across the group) sit there, so it is not free. Only
 *  short ranges count; block totals like SUM(R6:R39) are ignored. */
export function isReservedRow(formulas: unknown[][] | undefined, r: number, rowNumber: number): boolean {
  if (!formulas) return false;
  for (let k = 1; k <= 4 && r - k >= 0; k++) {
    for (const f of formulas[r - k] || []) {
      if (typeof f !== 'string' || !f.startsWith('=')) continue;
      const re = /\$?[A-Z]{1,3}\$?(\d+):\$?[A-Z]{1,3}\$?(\d+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f))) {
        const a = +m[1]; const b = +m[2];
        if (b - a > 6) continue;
        if (a < rowNumber && rowNumber <= b) return true;
      }
    }
  }
  return false;
}
