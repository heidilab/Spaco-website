// 單據自動入帳 — the network half: OneDrive folder → Claude → `expenses`
// → Heidi's Excel. Driven by /api/cron/onedrive-receipts every 15 min and
// by the 「立即同步」 button.
//
// State:
//   system/onedrive_receipts   what she picked (one folder per branch, Excel) + deltaLinks
//   receipt_files/{driveItemId} one doc per file seen: queued → done | error | skipped | no_branch
//   expenses/{id}               the row itself (source 'receipt'), read by 支出管理 and 月結
//
// Scanning and processing are separate steps so a slow Claude call never
// loses a delta page: every new file is queued first, the deltaLink is
// advanced, then up to `maxFiles` queued files are read per run.

import 'server-only';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import {
  GraphError, folderDelta, getItem, downloadContent, downloadThumbnailJpeg, displayPath,
  getReceiptsConfig, saveReceiptsConfig, getUsedRangeAddress, getTableRange, tableAddRow, tableDeleteRow,
  readRange, writeCell, deleteSheetRow, listWorksheetNames, getUsedRange, clearRange, insertCellsDown, type DriveItem,
} from './msgraph';
import {
  attachmentPlan, parseReceiptJson, buildReceiptExpense, findPossibleDuplicate, excelRowValues, tableRowArray,
  parseRangeAddress, receiptPrompt, RECEIPT_SYSTEM_PROMPT, findMonthSheet, detectMonthLayout, planMonthWrite, excelDateSerial,
  type ParsedReceipt, type BranchOption,
} from './receiptExtract';
import { callClaudeWithAttachment } from './llm';
import { financeBranches } from './finance';
import { loadAllVenuesServer } from './venueRegistryServer';
import { sendStaffPush } from './webPushServer';
import type { ExpenseRecord, OneDriveExcelTarget, OneDriveReceiptsConfig } from '@/types';

export type ReceiptFileStatus = 'queued' | 'done' | 'error' | 'skipped' | 'no_branch';

export interface ReceiptFileDoc {
  id: string;
  name: string;
  size?: number;
  mimeType?: string;
  webUrl?: string;
  createdDateTime?: string;
  parentId?: string;
  folderPath?: string;
  status: ReceiptFileStatus;
  attempts: number;
  error?: string;
  branchKey?: string;
  expenseId?: string;
  fileDeleted?: boolean;
  queuedAt?: unknown;
  processedAt?: unknown;
}

const FILES = 'receipt_files';
const MAX_ATTEMPTS = 3;

export async function branchOptions(): Promise<BranchOption[]> {
  try {
    const registry = await loadAllVenuesServer();
    return financeBranches(registry).map((b) => ({ key: b.key, zh: b.name.zh, en: b.name.en }));
  } catch {
    return [
      { key: 'cwb', zh: '銅鑼灣店', en: 'Causeway Bay' }, { key: 'sw', zh: '上環海景旗艦店', en: 'Sheung Wan Flagship' },
      { key: 'tst', zh: '尖沙咀店', en: 'Tsim Sha Tsui' }, { key: 'wanchai', zh: '灣仔店', en: 'Wan Chai' },
    ];
  }
}

// ── Step 1: scan ───────────────────────────────────────────────────────

export interface ScanResult { seen: number; queued: number; deleted: number; resynced: boolean; folders: number }

/** Scan every branch folder (each keeps its own delta link). Month
 *  sub-folders need no setup: delta covers the whole sub-tree. */
export async function scanReceiptsFolder(cfg?: OneDriveReceiptsConfig): Promise<ScanResult> {
  const config = cfg || await getReceiptsConfig();
  if (config.branchFolders.length === 0) throw new Error('no branch folder chosen');
  const result: ScanResult = { seen: 0, queued: 0, deleted: 0, resynced: false, folders: 0 };
  const deltaLinks: Record<string, string> = { ...(config.deltaLinks || {}) };
  const errors: string[] = [];
  for (const folder of config.branchFolders) {
    try {
      const r = await scanOneFolder(folder, deltaLinks[folder.id] || 'latest');
      deltaLinks[folder.id] = r.deltaLink;
      result.seen += r.seen; result.queued += r.queued; result.deleted += r.deleted;
      result.resynced = result.resynced || r.resynced;
      result.folders++;
    } catch (e) {
      errors.push(`${folder.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await saveReceiptsConfig({ deltaLinks, lastScanAt: FieldValue.serverTimestamp(), lastScanError: errors.join(' | ').slice(0, 400) });
  if (result.folders === 0 && errors.length > 0) throw new Error(errors[0]);
  return result;
}

async function scanOneFolder(
  folder: { id: string; name: string }, deltaLink: string,
): Promise<{ seen: number; queued: number; deleted: number; resynced: boolean; deltaLink: string }> {
  let resynced = false;
  let delta;
  try {
    delta = await folderDelta(folder.id, deltaLink);
  } catch (e) {
    // 410 Gone = token too old; Graph hands back a fresh enumeration. We
    // restart from 'latest' instead so years of old receipts are not
    // re-read as new expenses.
    if (e instanceof GraphError && e.status === 410) {
      delta = await folderDelta(folder.id, 'latest');
      resynced = true;
    } else throw e;
  }
  let queued = 0; let deleted = 0;
  for (const item of delta.items) {
    if (item.id === folder.id) continue;
    const ref = adminDb.collection(FILES).doc(item.id);
    if (item.deleted) {
      const snap = await ref.get();
      if (snap.exists) {
        const d = snap.data() as ReceiptFileDoc;
        await ref.set({ fileDeleted: true }, { merge: true });
        if (d.expenseId) {
          await adminDb.collection('expenses').doc(d.expenseId).set({ receipt: { fileDeleted: true } }, { merge: true }).catch(() => {});
        }
        deleted++;
      }
      continue;
    }
    if (!item.file) continue;
    const snap = await ref.get();
    const base = {
      name: item.name, size: item.size || 0, mimeType: item.file.mimeType || '', webUrl: item.webUrl || '',
      createdDateTime: item.createdDateTime || '', parentId: item.parentReference?.id || '',
      folderPath: displayPath(item), fileDeleted: false,
    };
    if (!snap.exists) {
      await ref.set({ ...base, status: 'queued', attempts: 0, queuedAt: FieldValue.serverTimestamp() });
      queued++;
    } else {
      // Renamed / moved / re-uploaded: keep its status, refresh the facts.
      await ref.set(base, { merge: true });
    }
  }
  return { seen: delta.items.length, queued, deleted, resynced, deltaLink: delta.deltaLink };
}

// ── Step 2: read queued files ──────────────────────────────────────────

export interface ProcessResult {
  processed: number;
  created: Array<{ id: string; item: string; amount: number; branchKey: string; flags: string[] }>;
  errors: string[];
}

/** Branch for a file: walk up its parents (month sub-folder → year
 *  sub-folder → …) until one is a chosen branch folder. */
async function resolveBranch(parentId: string, cfg: OneDriveReceiptsConfig, cache: Map<string, DriveItem>): Promise<string | null> {
  const byId = new Map(cfg.branchFolders.map((b) => [b.id, b.branchKey]));
  let cur = parentId;
  for (let i = 0; i < 8 && cur; i++) {
    const hit = byId.get(cur);
    if (hit) return hit;
    let it = cache.get(cur);
    if (!it) {
      try { it = await getItem(cur); cache.set(cur, it); } catch { return null; }
    }
    cur = it.parentReference?.id || '';
  }
  return null;
}

const UNREADABLE: ParsedReceipt = {
  date: null, vendor: null, total: null, currency: 'HKD', summary: null, category: null,
  confidence: 'low', multipleReceipts: false, notes: 'Claude 無法讀出內容',
};

export async function processQueuedReceipts(maxFiles = 4, cfg?: OneDriveReceiptsConfig): Promise<ProcessResult> {
  const config = cfg || await getReceiptsConfig();
  const result: ProcessResult = { processed: 0, created: [], errors: [] };
  const snap = await adminDb.collection(FILES).where('status', 'in', ['queued', 'error']).limit(50).get();
  const docs = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as ReceiptFileDoc))
    .filter((d) => !d.fileDeleted && (d.attempts || 0) < MAX_ATTEMPTS)
    .sort((a, b) => (a.createdDateTime || '').localeCompare(b.createdDateTime || ''))
    .slice(0, maxFiles);
  if (docs.length === 0) return result;

  const branches = await branchOptions();
  const branchName = (key: string) => branches.find((b) => b.key === key)?.zh || key;
  const parentCache = new Map<string, DriveItem>();

  for (const f of docs) {
    const ref = adminDb.collection(FILES).doc(f.id);
    try {
      const branchKey = await resolveBranch(f.parentId || '', config, parentCache);
      if (!branchKey) {
        await ref.set({ status: 'no_branch', processedAt: FieldValue.serverTimestamp() }, { merge: true });
        continue;
      }
      const plan = attachmentPlan({ name: f.name, size: f.size, mimeType: f.mimeType });
      if (!plan) {
        await ref.set({ status: 'skipped', error: 'unsupported file type', processedAt: FieldValue.serverTimestamp() }, { merge: true });
        continue;
      }
      const bytes = plan.viaThumbnail ? await downloadThumbnailJpeg(f.id) : await downloadContent(f.id);
      const base64 = Buffer.from(bytes).toString('base64');
      let parsed: ParsedReceipt;
      try {
        const text = await callClaudeWithAttachment({
          system: RECEIPT_SYSTEM_PROMPT, prompt: receiptPrompt(f.name),
          attachment: { kind: plan.kind, mediaType: plan.mediaType, base64 },
        });
        parsed = parseReceiptJson(text);
      } catch (e) {
        // A reply we cannot parse still becomes a row (0, flagged) — Heidi
        // asked for everything to show up; API/network errors retry instead.
        if (e instanceof Error && /no JSON|unterminated/.test(e.message)) parsed = UNREADABLE;
        else throw e;
      }
      const expense = buildReceiptExpense(parsed, {
        driveItemId: f.id, fileName: f.name, webUrl: f.webUrl, folderPath: f.folderPath, createdDateTime: f.createdDateTime,
      }, branchKey);

      // Same branch + date + amount already on a receipt row → flag it.
      const dupSnap = await adminDb.collection('expenses')
        .where('branchKey', '==', branchKey).where('date', '==', expense.date).where('source', '==', 'receipt').get();
      const dup = findPossibleDuplicate(dupSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ExpenseRecord)), expense);
      if (dup && expense.receipt) {
        expense.receipt.flags = [...expense.receipt.flags, 'possible_duplicate'];
        expense.receipt.possibleDuplicateOf = dup.id;
      }

      const docRef = adminDb.collection('expenses').doc();
      await docRef.set({ ...expense, receipt: { ...expense.receipt, extractedAt: FieldValue.serverTimestamp() }, createdAt: FieldValue.serverTimestamp() });
      const saved = { id: docRef.id, ...expense } as ExpenseRecord;
      const excel = await syncExpenseToExcel(saved, 'upsert', config, branchName(branchKey));
      if (excel) await docRef.set({ excel }, { merge: true });

      await ref.set({ status: 'done', branchKey, expenseId: docRef.id, error: '', processedAt: FieldValue.serverTimestamp() }, { merge: true });
      result.processed++;
      result.created.push({ id: docRef.id, item: expense.item, amount: expense.amount, branchKey, flags: expense.receipt?.flags || [] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${f.name}: ${msg}`);
      await ref.set({ status: 'error', error: msg.slice(0, 500), attempts: FieldValue.increment(1), processedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
  return result;
}

// ── Excel mirror ───────────────────────────────────────────────────────

type ExcelState = NonNullable<ExpenseRecord['excel']>;

/** Write/refresh (or remove) this row in Heidi's workbook. Returns the
 *  state to store on the expense, or null when no workbook is configured.
 *  Never throws — an Excel hiccup must not undo the expense itself. */
export async function syncExpenseToExcel(
  row: ExpenseRecord, op: 'upsert' | 'delete', cfg?: OneDriveReceiptsConfig, branchNameZh?: string,
): Promise<ExcelState | null> {
  const config = cfg || await getReceiptsConfig();
  const x = config.excelByBranch?.[row.branchKey] || config.excel;
  if (!x || !x.itemId) return null;
  const mode = x.mode || (x.vendorColumn ? 'month' : 'sheet');
  if (mode === 'month') return syncMonthSheet(row, op, x);
  if (!x.worksheet || !x.columns?.id) return null;
  try {
    const idCol = x.columns.id.toUpperCase();
    const headerRow = x.headerRow || 1;
    const used = parseRangeAddress(await getUsedRangeAddress(x.itemId, x.worksheet));
    const lastRow = Math.max(used.endRow, headerRow);
    let foundRow: number | null = null;
    if (lastRow > headerRow) {
      const ids = await readRange(x.itemId, x.worksheet, `${idCol}${headerRow + 1}:${idCol}${lastRow}`);
      const idx = ids.findIndex((r) => String(r[0] ?? '') === row.id);
      if (idx >= 0) foundRow = headerRow + 1 + idx;
    }
    if (op === 'delete') {
      if (foundRow !== null) {
        if (x.table) {
          const tr = parseRangeAddress((await getTableRange(x.itemId, x.table)).address);
          await tableDeleteRow(x.itemId, x.table, foundRow - tr.startRow - 1);
        } else {
          await deleteSheetRow(x.itemId, x.worksheet, foundRow);
        }
      }
      return { synced: true, syncedAt: FieldValue.serverTimestamp(), workbookId: x.itemId };
    }
    const cells = excelRowValues(x.columns, row, { branchName: branchNameZh || row.branchKey });
    if (foundRow !== null) {
      for (const [col, v] of Object.entries(cells)) {
        if (col === idCol) continue;
        await writeCell(x.itemId, x.worksheet, `${col}${foundRow}`, v);
      }
    } else if (x.table) {
      const tr = await getTableRange(x.itemId, x.table);
      const addr = parseRangeAddress(tr.address);
      await tableAddRow(x.itemId, x.table, tableRowArray(cells, addr.startCol, tr.columnCount));
    } else {
      const newRow = lastRow + 1;
      for (const [col, v] of Object.entries(cells)) await writeCell(x.itemId, x.worksheet, `${col}${newRow}`, v);
    }
    return { synced: true, syncedAt: FieldValue.serverTimestamp(), workbookId: x.itemId };
  } catch (e) {
    return { synced: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 400), workbookId: x.itemId };
  }
}

/** Month-sheet mode — her Financial Master layout. The expense month
 *  picks the sheet (2026-11 → NOV-2026); the line goes in the Expenses
 *  block: `item` under Vendor, `amount` under Amount, the SPACO ID in the
 *  ID column (V by default, outside her layout) so the same line is found
 *  again on edit / delete. Nothing else on the sheet is touched: a free
 *  line is one that is empty in every column, and when the block is full
 *  two cells are inserted above its last line so 「Total Expenses」 keeps
 *  summing. Never throws. */
async function syncMonthSheet(row: ExpenseRecord, op: 'upsert' | 'delete', x: OneDriveExcelTarget): Promise<ExcelState> {
  const fail = (error: string, extra: Partial<ExcelState> = {}): ExcelState =>
    ({ synced: false, error: error.slice(0, 400), workbookId: x.itemId, ...extra });
  try {
    const idColumn = (x.idColumn || 'V').toUpperCase();
    const names = await listWorksheetNames(x.itemId);
    const sheet = findMonthSheet(names, row.month);
    if (!sheet) return fail(`Excel 入面搵唔到 ${row.month} 嘅月份 sheet（例如 ${monthSheetLabel(row.month)}）— 開咗嗰張 sheet 之後會自動補寫`);
    const used = await getUsedRange(x.itemId, sheet);
    const origin = parseRangeAddress(used.address);
    const detected = detectMonthLayout(used.values, origin);
    const layout = detected || (x.vendorColumn && x.amountColumn
      ? { headerRow: x.headerRow || 5, vendorColumn: x.vendorColumn.toUpperCase(), amountColumn: x.amountColumn.toUpperCase() }
      : null);
    if (!layout) return fail(`「${sheet}」sheet 搵唔到 Vendor / Amount 標題`);
    const plan = planMonthWrite(used.values, origin, { ...layout, idColumn }, row.id, used.formulas);
    const V = layout.vendorColumn; const A = layout.amountColumn;
    // Date / Remarks: what she saved wins ('' = don't write); else what the sheet shows.
    const pick = (saved: string | undefined, found: string | undefined) =>
      (saved === undefined ? found : saved.trim() ? saved.trim().toUpperCase() : undefined);
    const D = pick(x.dateColumn, layout.dateColumn); const N = pick(x.noteColumn, layout.noteColumn);
    const cols = [V, A, idColumn, ...(D ? [D] : []), ...(N ? [N] : [])];
    if (op === 'delete') {
      if (plan.foundRow !== null) {
        for (const col of cols) await clearRange(x.itemId, sheet, `${col}${plan.foundRow}:${col}${plan.foundRow}`);
      }
      return { synced: true, syncedAt: FieldValue.serverTimestamp(), workbookId: x.itemId, sheet };
    }
    let target = plan.foundRow ?? plan.freeRow;
    if (target === null) {
      if (plan.totalRow !== null) {
        // Block full: open a line above its last entry (inside the SUM range).
        target = Math.max(layout.headerRow + 1, plan.totalRow - 1);
        await insertCellsDown(x.itemId, sheet, `${V}${target}:${A}${target}`);
        if (idColumn !== V && idColumn !== A) await insertCellsDown(x.itemId, sheet, `${idColumn}${target}:${idColumn}${target}`);
      } else {
        target = origin.endRow + 1;
      }
    }
    // Label the ID column once per sheet so she knows what it is.
    const hdr = (used.values[layout.headerRow - origin.startRow] || [])[columnIdx(idColumn) - columnIdx(origin.startCol)];
    if (plan.foundRow === null && (hdr === undefined || hdr === null || hdr === '')) {
      await writeCell(x.itemId, sheet, `${idColumn}${layout.headerRow}`, 'SPACO ID').catch(() => {});
    }
    await writeCell(x.itemId, sheet, `${V}${target}`, row.item);
    await writeCell(x.itemId, sheet, `${A}${target}`, row.amount);
    if (D) {
      const serial = excelDateSerial(row.date);
      if (serial !== null) await writeCell(x.itemId, sheet, `${D}${target}`, serial, 'd/m/yyyy;@');
    }
    if (N) await writeCell(x.itemId, sheet, `${N}${target}`, (row.note || row.receipt?.summary || '').slice(0, 200));
    if (plan.foundRow === null) await writeCell(x.itemId, sheet, `${idColumn}${target}`, row.id);
    return { synced: true, syncedAt: FieldValue.serverTimestamp(), workbookId: x.itemId, sheet, row: target };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function columnIdx(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function monthSheetLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const abbr = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][+m[2] - 1] || m[2];
  return `${abbr}-${m[1]}`;
}

/** Rows whose Excel write failed earlier (month sheet not created yet,
 *  Graph hiccup) get another go on every run. */
export async function resyncPendingExcel(cfg: OneDriveReceiptsConfig, max = 10): Promise<{ retried: number; fixed: number }> {
  const snap = await adminDb.collection('expenses')
    .where('source', '==', 'receipt').where('excel.synced', '==', false).limit(max).get();
  let fixed = 0;
  for (const d of snap.docs) {
    const row = { id: d.id, ...d.data() } as ExpenseRecord;
    const excel = await syncExpenseToExcel(row, 'upsert', cfg);
    if (!excel) continue;
    await d.ref.set({ excel }, { merge: true });
    if (excel.synced) fixed++;
  }
  return { retried: snap.size, fixed };
}

// ── Edits from 支出管理 ─────────────────────────────────────────────────

export interface ReceiptExpensePatch {
  item?: string; amount?: number; date?: string; note?: string; reviewed?: boolean;
}

export async function updateReceiptExpense(id: string, patch: ReceiptExpensePatch, uid: string): Promise<ExpenseRecord> {
  const ref = adminDb.collection('expenses').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('expense not found');
  const before = { id, ...snap.data() } as ExpenseRecord;
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), updatedBy: uid };
  if (typeof patch.item === 'string' && patch.item.trim()) update.item = patch.item.trim().slice(0, 100);
  if (typeof patch.amount === 'number' && Number.isFinite(patch.amount) && patch.amount >= 0) update.amount = Math.round(patch.amount * 100) / 100;
  if (typeof patch.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) { update.date = patch.date; update.month = patch.date.slice(0, 7); }
  if (typeof patch.note === 'string') update.note = patch.note.slice(0, 300);
  if (typeof patch.reviewed === 'boolean') {
    update.reviewed = patch.reviewed;
    update.reviewedAt = patch.reviewed ? FieldValue.serverTimestamp() : null;
    update.reviewedBy = patch.reviewed ? uid : null;
  }
  await ref.set(update, { merge: true });
  const after = { ...before, ...update } as ExpenseRecord;
  if (after.source === 'receipt') {
    const branches = await branchOptions();
    const excel = await syncExpenseToExcel(after, 'upsert', undefined, branches.find((b) => b.key === after.branchKey)?.zh);
    if (excel) { await ref.set({ excel }, { merge: true }); after.excel = excel; }
  }
  return after;
}

export async function deleteReceiptExpense(id: string): Promise<void> {
  const ref = adminDb.collection('expenses').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  const row = { id, ...snap.data() } as ExpenseRecord;
  if (row.source === 'receipt') {
    await syncExpenseToExcel(row, 'delete');
    if (row.receipt?.driveItemId) {
      // Let the file be re-read if she deletes the row by mistake and
      // re-uploads; mark rather than delete so history stays.
      await adminDb.collection(FILES).doc(row.receipt.driveItemId).set({ status: 'skipped', error: 'row deleted in 支出管理', expenseId: '' }, { merge: true }).catch(() => {});
    }
  }
  await ref.delete();
}

// ── Whole run ──────────────────────────────────────────────────────────

export interface IngestSummary {
  scan?: ScanResult;
  process?: ProcessResult;
  excelRetry?: { retried: number; fixed: number };
  skipped?: string;
  error?: string;
}

export async function runReceiptIngest(opts: { maxFiles?: number } = {}): Promise<IngestSummary> {
  const cfg = await getReceiptsConfig();
  if (cfg.branchFolders.length === 0) return { skipped: 'no branch folder chosen' };
  const summary: IngestSummary = {};
  try {
    summary.scan = await scanReceiptsFolder(cfg);
    const fresh = await getReceiptsConfig();
    summary.process = await processQueuedReceipts(opts.maxFiles ?? 4, fresh);
    summary.excelRetry = await resyncPendingExcel(fresh).catch(() => ({ retried: 0, fixed: 0 }));
    const n = summary.process.created.length;
    if (n > 0) {
      const attention = summary.process.created.filter((c) => c.flags.length > 0).length;
      await sendStaffPush({
        title: '單據已自動入帳',
        body: `${n} 張新單據已入支出管理${attention ? `，${attention} 張需要留意` : ''}，請核數。`,
        url: '/zh/admin/expenses',
        tag: 'onedrive-receipts',
      });
    }
  } catch (e) {
    summary.error = e instanceof Error ? e.message : String(e);
    await saveReceiptsConfig({ lastScanError: summary.error.slice(0, 400) }).catch(() => {});
  }
  return summary;
}

export async function listRecentReceiptFiles(limit = 30): Promise<ReceiptFileDoc[]> {
  const snap = await adminDb.collection(FILES).orderBy('queuedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const data = d.data() as ReceiptFileDoc & { queuedAt?: { toDate?: () => Date }; processedAt?: { toDate?: () => Date } };
    return {
      ...data, id: d.id,
      queuedAt: data.queuedAt?.toDate ? data.queuedAt.toDate().toISOString() : undefined,
      processedAt: data.processedAt?.toDate ? data.processedAt.toDate().toISOString() : undefined,
    };
  });
}
