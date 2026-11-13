'use client';

// 月結 (Finance Phase 3) — one-click month close per branch.
//
// Replaces the manual month-end ritual on Heidi's Financial Master:
//   P&L        sales − (stored expenses + derived commissions + KPay fee)
//   分紅        per-branch split defaults, tweakable per month, snapshot
//              saved on the month_close doc; rows mirror her sheet footer
//   KPay 對帳   upload the monthly KPay statements → each booking takes
//              the actual fee of its own payments, whichever month they
//              were paid in (lib/kpayReconcile); payments whose statement
//              is not uploaded yet keep the estimate
//   Master     financial-year rollup table + Excel export shaped like
//              her Financial Master workbook: the Master tab, then one
//              tab per month (OCT-2026, SEP-2026 …) in her monthly layout
//              (lib/financialMasterSheet)
//
// All sales/expense numbers stay DERIVED (same shared helpers as the
// Sales Record export) — the doc stores only splits and the closed flag;
// KPay statements are stored once per statement month, for all branches.

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllBookings } from '@/lib/firestore';
import { branchKey as branchKeyOf, countsForFinance, financeBranches, monthCloseSales } from '@/lib/finance';
import { buildMasterMonthSheet, type MasterSheetBooking } from '@/lib/financialMasterSheet';
import { masterSheetToWorksheet } from '@/lib/financialMasterXlsx';
import { bookingTransactions } from '@/lib/salesRecord';
import { channelDisplayLabel } from '@/lib/marketingChannels';
import { loadAllVenues } from '@/lib/venueRegistry';
import { settlementCashTiming } from '@/lib/settlementDebt';
import { listExpenses, getFinanceConfig, saveFinanceConfig, type FinanceConfig } from '@/lib/expenses';
import { getBonusConfig } from '@/lib/bonus';
import { salesSalaryForMonth, salesSalaryLabel, type SalesSalary } from '@/lib/salesSalary';
import { commissionForBooking, splitAmounts, adminDiscountAmount } from '@/lib/bookingMoney';
import { getMonthClose, saveMonthClose, listKpayStatements, saveKpayStatement, deleteKpayStatement } from '@/lib/monthClose';
import { parseKpayStatement, statementMonthOf, type KpayStatementSummary, type KpayStatementTxn, type StoredKpayStatement } from '@/lib/kpayStatement';
import { reconcileKpayFees, kpayFeeOf, sumKpayFees, type BookingKpayFee, type KpayFeeLine } from '@/lib/kpayReconcile';
import type { BookingRecord, BonusConfig, ExpenseRecord, MonthCloseRecord, ProfitSplitParty, Venue } from '@/types';
import {
  CalendarCheck, Loader2, Lock, Unlock, Upload, Plus, Trash2,
  FileSpreadsheet, Check,
} from 'lucide-react';

// Branch tabs come from the venue registry (finance.financeBranches): the
// original four keep their keys, so existing month_closes docs still
// match, and a branch added in 分店管理 closes as ONE branch under its
// branchKey — 尖沙咀 HART's three rooms → `tsthart` (owner decision 2026-11-10).
// These are just the short labels the original four have always shown.
const BRANCH_LABELS: Record<string, { zh: string; en: string }> = {
  cwb: { zh: '銅鑼灣', en: 'CWB' },
  sw: { zh: '上環', en: 'SW' },
  tst: { zh: '尖沙咀', en: 'TST' },
  wanchai: { zh: '灣仔', en: 'WC' },
};
const MONTH_NAMES_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** `2026-08` → `AUG-2026` (her Master's month label). */
function monthLabel(m: string): string {
  const [y, mm] = m.split('-').map(Number);
  return `${MONTH_NAMES_EN[(mm || 1) - 1]}-${y}`;
}

/** Financial year (APR→MAR) containing the given YYYY-MM. */
function fyMonths(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const mm = ((3 + i) % 12) + 1; // APR..MAR
    const yy = startYear + (mm < 4 ? 1 : 0);
    out.push(`${yy}-${String(mm).padStart(2, '0')}`);
  }
  return out;
}

function fmt(n: number): string {
  return n.toLocaleString('en-HK', { maximumFractionDigits: 2 });
}

/** Payment rail as her sheet writes it (FPS / Kpay …). */
function masterMethodLabel(m: string): string {
  const refund = /^退款\((.+)\)$/.exec(m);
  if (refund) return `退款(${masterMethodLabel(refund[1])})`;
  const labels: Record<string, string> = { kpay: 'Kpay', fps: 'FPS', bank: 'FPS', cash: 'Cash', stripe: 'Stripe', other: 'Other' };
  return labels[m] || m;
}

interface MonthNumbers {
  sales: number;
  stored: number;
  /** Sales staff pay of the branch this month: 底薪 (CS 獎金 page) + the
   *  bonus tier reached — one expense line (Heidi 2026-11-13). */
  salary: SalesSalary;
  commissions: number;
  commissionByChannel: Record<string, number>;
  /** 折扣優惠/賠償 given on the month's bookings — an expense. */
  discounts: number;
  /** KPay fee of this month's bookings: actual for every payment found
   *  on an uploaded statement + estimate for the rest. */
  kpayFee: number;
  kpayActual: number;
  kpayEstimated: number;
  kpayActualLines: number;
  kpayEstimatedLines: number;
  /** Per-booking breakdown behind kpayFee (bookings with KPay payments). */
  kpayRows: Array<{ id: string; date: string; name: string; fee: BookingKpayFee }>;
  expenses: number;
  profit: number;
  count: number;
  channelSales: Record<string, number>;
  channelCounts: Record<string, number>;
  /** Sales by column of her monthly sheet — they add up to `sales`.
   *  pointsPromo is negative (會員積分 / 優惠碼: points redeemed + promo
   *  codes); cardSurcharge is 信用卡手續費. */
  cats: { rent: number; bbqHotpot: number; shisha: number; cater: number; drinks: number; pointsPromo: number; cardSurcharge: number; extPenalty: number; lateCollections: number };
  /** The month's rows as they go on the Financial Master monthly tab. */
  sheetBookings: MasterSheetBooking[];
  /** This month's bookings with settlement debt not received by month end. */
  uncollected: Array<{ id: string; amount: number }>;
  /** Earlier months' settlement debt received in this month (補收舊單欠款). */
  lateList: Array<{ id: string; eventMonth: string; amount: number }>;
}

export default function MonthClosePage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();
  // Admin-only since 2026-09-07 — CS must not see expenses/close data.
  const canAccess = hasPermission('staff');
  const isAdminRole = hasPermission('staff');

  const [branch, setBranch] = useState('cwb');
  const [month, setMonth] = useState(currentMonth());
  const [allBookings, setAllBookings] = useState<BookingRecord[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [config, setConfig] = useState<FinanceConfig | null>(null);
  const [bonusCfg, setBonusCfg] = useState<BonusConfig>({ branches: {} });
  const [mc, setMc] = useState<MonthCloseRecord | null>(null);
  // Stored expense rows of each FY month (totals for the P&L, the rows
  // themselves for the monthly tabs of the export).
  const [fyExpenseRows, setFyExpenseRows] = useState<Record<string, ExpenseRecord[]>>({});
  const fyExpenses = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [m, rows] of Object.entries(fyExpenseRows)) out[m] = rows.reduce((sum, r) => sum + (r.amount || 0), 0);
    return out;
  }, [fyExpenseRows]);
  const [fyCloses, setFyCloses] = useState<Record<string, MonthCloseRecord | null>>({});
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [isPreviewHost, setIsPreviewHost] = useState(false);
  useEffect(() => {
    const h = window.location.hostname;
    setIsPreviewHost(h !== 'spacohk.com' && h !== 'www.spacohk.com');
  }, []);

  // Splits being edited for THIS month.
  const [splits, setSplits] = useState<ProfitSplitParty[]>([]);
  // Uploaded KPay statements — one per statement month, ALL branches.
  const [statements, setStatements] = useState<StoredKpayStatement[]>([]);
  // KPay statement upload preview (before saving).
  interface StmtPreview {
    summary: KpayStatementSummary;
    fileName: string;
    /** Statement month (交易日期) the file will be stored under. */
    month: string;
    transactions: KpayStatementTxn[];
    /** Rows that found their booking. */
    matchedCount: number;
    unmatched: KpayStatementTxn[];
    /** A statement for this month is already stored and gets replaced. */
    replaces: boolean;
  }
  const [stmtPreviews, setStmtPreviews] = useState<StmtPreview[]>([]);
  const [stmtError, setStmtError] = useState<string | null>(null);
  const [stmtSaving, setStmtSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  function say(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  async function load() {
    setLoading(true);
    setStmtPreviews([]); setStmtError(null);
    try {
      const months = fyMonths(month);
      const [all, cfg, close, registry, stmts] = await Promise.all([
        getAllBookings(),
        getFinanceConfig(),
        getMonthClose(branch, month),
        // Falls back to the static venues if the registry is unreachable
        // (then only the original four branches are listed).
        loadAllVenues(),
        listKpayStatements(),
      ]);
      setAllBookings(all);
      setStatements(stmts);
      setVenues(registry);
      setConfig(cfg);
      setMc(close);
      setBonusCfg(await getBonusConfig());
      setSplits(close?.splits?.length ? close.splits : (cfg.profitSplits[branch] || []));
      // FY stored expenses + closes (for the Master table and export).
      const expEntries = await Promise.all(months.map(async (m) => {
        try { return [m, await listExpenses(branch, m)] as const; }
        catch { return [m, [] as ExpenseRecord[]] as const; }
      }));
      setFyExpenseRows(Object.fromEntries(expEntries));
      const closeEntries = await Promise.all(months.map(async (m) => {
        try { return [m, m === month ? close : await getMonthClose(branch, m)] as const; }
        catch { return [m, null] as const; }
      }));
      setFyCloses(Object.fromEntries(closeEntries));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (canAccess && user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess, user, branch, month]);

  // Every booking's KPay fee, from ALL uploaded statements: a booking's
  // payments are looked up in the statement of the month each was PAID
  // in, so an October booking paid in August takes its fee from the
  // August statement. Payments not on any uploaded statement keep the %
  // estimate. Runs over every booking so a statement row can always find
  // its booking, whatever month or branch it belongs to.
  const recon = useMemo(
    () => reconcileKpayFees(allBookings, statements, config?.kpayFeePct ?? 0),
    [allBookings, statements, config],
  );

  /** Everything derived for one month, from already-loaded bookings. */
  function computeMonth(m: string): MonthNumbers {
    const rows = allBookings.filter((b) =>
      countsForFinance(b, { includeTest: isPreviewHost })
      && b.date.startsWith(m)
      && branchKeyOf(b.venueId, venues) === branch);
    const cats = { rent: 0, bbqHotpot: 0, shisha: 0, cater: 0, drinks: 0, pointsPromo: 0, cardSurcharge: 0, extPenalty: 0, lateCollections: 0 };
    let sales = 0, commissions = 0, discounts = 0;
    const kpayRows: MonthNumbers['kpayRows'] = [];
    const sheetBookings: MasterSheetBooking[] = [];
    rows.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));
    const channelSales: Record<string, number> = {};
    const channelCounts: Record<string, number> = {};
    const commissionByChannel: Record<string, number> = {};
    const uncollected: Array<{ id: string; amount: number }> = [];
    const lateList: Array<{ id: string; eventMonth: string; amount: number }> = [];
    for (const b of rows) {
      // 收到先計 (Heidi 2026-10-18): settlement debt still unpaid, or paid
      // only after this month ended, is not this month's revenue. It comes
      // off 加時/罰款 first (where deductions sit), then off rent.
      const timing = settlementCashTiming(b, { includeTest: isPreviewHost });
      if (timing.excludedFromEventMonth > 0) uncollected.push({ id: b.id, amount: timing.excludedFromEventMonth });
      // Her monthly sheet's Sales columns; Total is their sum, so it
      // includes 加時/罰款 and 信用卡手續費 (Heidi 2026-11-13).
      const c = monthCloseSales(b, timing.excludedFromEventMonth);
      const total = c.total;
      sales += total;
      cats.rent += c.rent; cats.bbqHotpot += c.bbqHotpot; cats.shisha += c.shisha;
      cats.cater += c.cater; cats.drinks += c.drinks; cats.extPenalty += c.extPenalty;
      cats.pointsPromo += c.pointsPromo; cats.cardSurcharge += c.cardSurcharge;
      // DR lines of this booking — the Vendor / Amount rows beside it.
      const drItems: Array<{ vendor: string; amount: number }> = [];
      if (config) {
        const comm = commissionForBooking(b, config.commissionRules[b.marketingChannel || '']);
        commissions += comm;
        if (comm > 0) {
          const cch = b.marketingChannel || 'unknown';
          commissionByChannel[cch] = (commissionByChannel[cch] || 0) + comm;
          drItems.push({ vendor: channelDisplayLabel(b, 'zh') || cch, amount: comm });
        }
      }
      const kf = kpayFeeOf(recon, b.id);
      if (kf.lines.length > 0) {
        kpayRows.push({ id: b.id, date: b.date, name: b.customerName || '', fee: kf });
        if (kf.fee !== 0) drItems.push({ vendor: kf.lines.some((l) => !l.actual) ? 'Kpay（含估算）' : 'Kpay', amount: kf.fee });
      }
      const disc = adminDiscountAmount(b);
      discounts += disc;
      if (disc > 0) drItems.push({ vendor: `折扣優惠${b.adminDiscount?.note ? `（${b.adminDiscount.note}）` : ''}`, amount: disc });
      const ch = b.marketingChannel || 'unknown';
      channelSales[ch] = (channelSales[ch] || 0) + total;
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;

      const kids = b.childCount ?? 0;
      const adults = b.adultCount ?? b.guestCount;
      const refund = b.depositRefund as { amount?: number } | undefined;
      const remarks: string[] = [`#${b.id.slice(0, 8)}`];
      if (b.customerName) remarks.push(b.customerName);
      for (const p of (b.payments || [])) if (p.note) remarks.push(`「${p.note}」`);
      if (b.endDate && b.endDate !== b.date) remarks.push(`過夜→${b.endDate}`);
      if (timing.excludedFromEventMonth > 0) remarks.push(`結算欠款 $${fmt(timing.excludedFromEventMonth)} 未收，未計入本月`);
      sheetBookings.push({
        date: b.date,
        time: `${b.startTime}-${b.endTime}`,
        ppl: kids > 0 ? adults + 0.5 * kids : (b.guestCount || ''),
        rent: c.rent, bbqHotpot: c.bbqHotpot, shisha: c.shisha, cater: c.cater, drinks: c.drinks,
        pointsPromo: c.pointsPromo, cardSurcharge: c.cardSurcharge, extPenalty: c.extPenalty,
        // What actually moved: credited amount + any card surcharge on top
        // (the figure on the KPay statement).
        transactions: bookingTransactions(b).map((t) => ({
          date: t.date, method: masterMethodLabel(t.method), amount: Math.round((t.amount + t.surcharge) * 100) / 100,
        })),
        expenses: drItems,
        source: b.marketingChannel === 'loyalty_member'
          ? 'Loyalty Member'
          : channelDisplayLabel(b, 'zh') + (b.marketingChannelOther ? `: ${b.marketingChannelOther}` : ''),
        returnedDeposit: typeof refund?.amount === 'number' ? refund.amount : null,
        remarks: remarks.join(' '),
      });
    }
    // Settlement debt from EARLIER months received in this month: income of
    // this month, listed with the original booking and month.
    for (const b of allBookings) {
      if (!countsForFinance(b, { includeTest: isPreviewHost }) || branchKeyOf(b.venueId, venues) !== branch || b.date.slice(0, 7) >= m) continue;
      for (const l of settlementCashTiming(b, { includeTest: isPreviewHost }).late) {
        if (l.month !== m) continue;
        cats.lateCollections += l.amount;
        lateList.push({ id: b.id, eventMonth: b.date.slice(0, 7), amount: l.amount });
        sheetBookings.push({
          date: b.date, time: '補收舊單欠款', ppl: '',
          rent: 0, bbqHotpot: 0, shisha: 0, cater: 0, drinks: 0, pointsPromo: 0, cardSurcharge: 0, extPenalty: l.amount,
          transactions: [], expenses: [], source: '', returnedDeposit: null,
          remarks: `#${b.id.slice(0, 8)} ${b.customerName || ''} 原月份 ${monthLabel(b.date.slice(0, 7))}，今個月先收到`.replace(/\s+/g, ' '),
        });
      }
    }
    sales += cats.lateCollections;
    kpayRows.sort((a, b) => a.date.localeCompare(b.date));
    const kpay = sumKpayFees(kpayRows.map((r) => r.fee));
    const kpayFee = kpay.fee;
    const stored = fyExpenses[m] || 0;
    // Sales pay: 底薪 + the bonus tier reached on the same sales basis as
    // the CS 獎金 page (Σ pricing.subtotal of the month's bookings).
    const bonusSales = rows.reduce((s, b) => s + (b.pricing.subtotal || 0), 0);
    const salary = salesSalaryForMonth(bonusSales, bonusCfg.branches[branch], m);
    const expenses = stored + salary.total + commissions + kpayFee + discounts;
    return {
      sales, stored, salary, commissions, commissionByChannel, discounts, kpayFee,
      kpayActual: kpay.actualFee, kpayEstimated: kpay.estimatedFee,
      kpayActualLines: kpay.actualLines, kpayEstimatedLines: kpay.estimatedLines, kpayRows,
      expenses, profit: sales - expenses, count: rows.length,
      channelSales, channelCounts, cats, uncollected, lateList, sheetBookings,
    };
  }

  const cur = useMemo(
    () => (loading || !config ? null : computeMonth(month)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, config, allBookings, venues, fyExpenses, fyCloses, month, branch, isPreviewHost, recon, bonusCfg],
  );

  const fy = useMemo(
    () => (loading || !config ? [] : fyMonths(month).map((m) => ({ m, n: computeMonth(m) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, config, allBookings, venues, fyExpenses, fyCloses, month, branch, isPreviewHost, recon, bonusCfg],
  );

  /** The original four, every active branch in 分店管理, and any branch
   *  that already has a saved default split (so its settings and closes
   *  stay reachable if it is later taken offline). */
  const branches = useMemo(
    () => financeBranches(venues, [branch, ...Object.keys(config?.profitSplits || {})]),
    [venues, config, branch],
  );
  function branchLabel(key: string, lang: 'zh' | 'en' = locale): string {
    return BRANCH_LABELS[key]?.[lang] ?? branches.find((b) => b.key === key)?.name[lang] ?? key;
  }

  const isClosed = mc?.status === 'closed';
  const pctSum = splits.reduce((s, p) => s + (Number(p.pct) || 0), 0);

  async function persistSplits(next: ProfitSplitParty[]) {
    setSplits(next);
    try {
      await saveMonthClose(branch, month, { splits: next });
      setMc((prev) => ({ ...(prev || { branchKey: branch, month, status: 'draft' }), splits: next } as MonthCloseRecord));
      setFyCloses((prev) => ({ ...prev, [month]: { ...(prev[month] || { branchKey: branch, month, status: 'draft' }), splits: next } as MonthCloseRecord }));
    } catch {
      say(locale === 'zh' ? '儲存失敗' : 'Save failed');
    }
  }

  /** Read the picked statement files into previews. Nothing is stored
   *  until 確認儲存 — the preview shows which month each file is for and
   *  how many of its rows found their booking. */
  async function handleStatementFiles(files: File[]) {
    setStmtError(null); setStmtPreviews([]);
    const zh = locale === 'zh';
    const previews: StmtPreview[] = [];
    const errors: string[] = [];
    try {
      const XLSX = await import('xlsx-js-style');
      for (const file of files) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        let summary: KpayStatementSummary | null = null;
        for (const name of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true }) as unknown[][];
          summary = parseKpayStatement(rows);
          if (summary) break;
        }
        if (!summary) {
          errors.push(zh
            ? `${file.name}：未能認出呢個檔案嘅格式 — 請將 statement 傳俾技術同事對一對欄位名稱。`
            : `${file.name}: could not recognize this statement format.`);
          continue;
        }
        const transactions = summary.transactions || [];
        // Fees are matched to bookings row by row; a file with totals only
        // cannot say which booking a fee belongs to.
        if (transactions.length === 0) {
          errors.push(zh
            ? `${file.name}：呢份檔案冇逐筆交易明細，對唔到訂單。請喺 KPay 匯出有「交易結算」明細嘅月結單。`
            : `${file.name}: no per-transaction rows, so fees cannot be matched to bookings.`);
          continue;
        }
        const stmtMonth = statementMonthOf(summary);
        if (!stmtMonth) {
          errors.push(zh
            ? `${file.name}：睇唔到呢份結單屬於邊個月（冇「交易日期」同交易時間）。`
            : `${file.name}: cannot tell which month this statement covers.`);
          continue;
        }
        if (previews.some((p) => p.month === stmtMonth)) {
          errors.push(zh
            ? `${file.name}：同一次揀咗兩份 ${monthLabel(stmtMonth)} 嘅結單，只用第一份。`
            : `${file.name}: a second ${monthLabel(stmtMonth)} statement was picked; only the first is used.`);
          continue;
        }
        const candidate: StoredKpayStatement = {
          month: stmtMonth, fileName: file.name,
          rowCount: summary.rowCount, gross: summary.gross, fee: summary.fee, transactions,
        };
        const matches = reconcileKpayFees(allBookings, [candidate], 0).matches;
        previews.push({
          summary, fileName: file.name, month: stmtMonth, transactions,
          matchedCount: matches.filter((x) => x.bookingId).length,
          unmatched: matches.filter((x) => !x.bookingId).map((x) => x.txn),
          replaces: statements.some((x) => x.month === stmtMonth),
        });
      }
    } catch {
      errors.push(zh ? '讀取檔案失敗' : 'Failed to read file');
    }
    previews.sort((x, y) => x.month.localeCompare(y.month));
    setStmtPreviews(previews);
    setStmtError(errors.length ? errors.join('\n') : null);
  }

  async function applyStatements() {
    if (!user || stmtPreviews.length === 0) return;
    setStmtSaving(true);
    try {
      for (const p of stmtPreviews) {
        await saveKpayStatement({
          month: p.month, fileName: p.fileName,
          rowCount: p.summary.rowCount, gross: p.summary.gross, fee: p.summary.fee,
          transactions: p.transactions, uploadedBy: user.uid,
        });
      }
      setStatements(await listKpayStatements());
      setStmtPreviews([]);
      say(locale === 'zh' ? '已儲存結單，手續費已按訂單重新對數' : 'Statements saved — fees re-matched per booking');
    } catch {
      say(locale === 'zh' ? '儲存失敗' : 'Save failed');
    } finally {
      setStmtSaving(false);
    }
  }

  async function removeStatement(stmtMonth: string) {
    const zh = locale === 'zh';
    if (!window.confirm(zh
      ? `刪除 ${monthLabel(stmtMonth)} 結單？喺嗰個月俾錢嘅訂單會轉返用估算手續費（所有分店）。`
      : `Delete the ${monthLabel(stmtMonth)} statement? Payments made that month fall back to the estimated fee (all branches).`)) return;
    try {
      await deleteKpayStatement(stmtMonth);
      setStatements(await listKpayStatements());
      say(zh ? '已刪除結單' : 'Statement deleted');
    } catch {
      say(zh ? '刪除失敗' : 'Delete failed');
    }
  }

  async function toggleClose() {
    if (!user) return;
    if (isClosed) {
      await saveMonthClose(branch, month, { status: 'draft' });
    } else {
      await saveMonthClose(branch, month, {
        status: 'closed',
        splits,
        closedAt: new Date().toISOString(),
        closedBy: user.uid,
      });
    }
    say(isClosed
      ? (locale === 'zh' ? '已重開月份' : 'Month reopened')
      : (locale === 'zh' ? '月份已關閉' : 'Month closed'));
    load();
  }

  async function saveSplitsAsDefault() {
    if (!config) return;
    const next = { ...config, profitSplits: { ...config.profitSplits, [branch]: splits } };
    await saveFinanceConfig(next);
    setConfig(next);
    say(locale === 'zh' ? '已儲存為此分店預設' : 'Saved as branch default');
  }

  // ── Master-style Excel export (financial-year rollup) ──
  async function handleExportMaster() {
    setExporting(true);
    try {
      const XLSX = await import('xlsx-js-style');
      const wb = XLSX.utils.book_new();
      const months = fyMonths(month);
      const [fyStartY] = months[0].split('-');
      const bl = branchLabel(branch, 'en');
      const aoa: (string | number)[][] = [];

      // Style bookkeeping — every cell's number format is recorded
      // EXPLICITLY as rows are pushed. A previous column-position
      // heuristic leaked '%' formats from the overview table into the
      // JUL column of the tables below it (Heidi 2026-09-07).
      const fmts = new Map<string, 'money' | 'pct' | 'int'>();
      const headerRows = new Set<number>();
      const totalRows = new Set<number>();
      const tableRanges: Array<{ r1: number; r2: number; c2: number }> = [];
      const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
      const mark = (r: number, cols: number[], f: 'money' | 'pct' | 'int') => {
        for (const c of cols) fmts.set(`${r}:${c}`, f);
      };

      // ── Table 1: FY overview ──
      aoa.push([`${fyStartY}-${Number(fyStartY) + 1} Financial Year (${bl})`]);
      aoa.push([]);
      const t1Start = aoa.length;
      headerRows.add(aoa.length);
      aoa.push(['', 'Total Sales', 'Total Expenses', 'Profit', 'GP', 'Number of Booking', 'Average sales of each booking', 'Reubird', '', '行家', '', 'CommonRoom', '']);
      headerRows.add(aoa.length);
      aoa.push(['', '', '', '', '', '', '', 'Sales', '%', 'Sales', '%', 'Sales', '%']);
      // channel bands span two columns; left columns span both header rows
      merges.push(
        { s: { r: t1Start, c: 7 }, e: { r: t1Start, c: 8 } },
        { s: { r: t1Start, c: 9 }, e: { r: t1Start, c: 10 } },
        { s: { r: t1Start, c: 11 }, e: { r: t1Start, c: 12 } },
        ...[0, 1, 2, 3, 4, 5, 6].map((c) => ({ s: { r: t1Start, c }, e: { r: t1Start + 1, c } })),
      );
      const MONEY = 'money' as const, PCT = 'pct' as const, INT = 'int' as const;
      const tot = { sales: 0, expenses: 0, profit: 0, count: 0, reubird: 0, agent: 0, commonroom: 0 };
      for (const { m, n } of fy) {
        const reubird = n.channelSales['reubird'] || 0;
        const agent = n.channelSales['agent'] || 0;
        const commonroom = n.channelSales['commonroom'] || 0;
        tot.sales += n.sales; tot.expenses += n.expenses; tot.profit += n.profit; tot.count += n.count;
        tot.reubird += reubird; tot.agent += agent; tot.commonroom += commonroom;
        const r = aoa.length;
        mark(r, [1, 2, 3, 6, 7, 9, 11], MONEY); mark(r, [4, 8, 10, 12], PCT); mark(r, [5], INT);
        aoa.push([
          monthLabel(m),
          n.sales || '', n.expenses || '', n.profit || '',
          n.sales ? n.profit / n.sales : '',
          n.count || '', n.count ? n.sales / n.count : '',
          reubird || '', n.sales ? reubird / n.sales : '',
          agent || '', n.sales ? agent / n.sales : '',
          commonroom || '', n.sales ? commonroom / n.sales : '',
        ]);
      }
      {
        const r = aoa.length;
        totalRows.add(r);
        mark(r, [1, 2, 3, 6, 7, 9, 11], MONEY); mark(r, [4, 8, 10, 12], PCT); mark(r, [5], INT);
        aoa.push([
          'Total :', tot.sales, tot.expenses, tot.profit,
          tot.sales ? tot.profit / tot.sales : '',
          tot.count, tot.count ? tot.sales / tot.count : '',
          tot.reubird, tot.sales ? tot.reubird / tot.sales : '',
          tot.agent, tot.sales ? tot.agent / tot.sales : '',
          tot.commonroom, tot.sales ? tot.commonroom / tot.sales : '',
        ]);
      }
      tableRanges.push({ r1: t1Start, r2: aoa.length - 1, c2: 12 });

      // ── Table 2: profit-split payouts per month ──
      aoa.push([]);
      const partyNames = Array.from(new Set(fy.flatMap(({ m }) => {
        const c = fyCloses[m];
        const sp = c?.splits?.length ? c.splits : (config?.profitSplits[branch] || []);
        return sp.map((p) => p.name);
      })));
      const t2Start = aoa.length;
      headerRows.add(aoa.length);
      aoa.push(['Profit Split', ...partyNames]);
      const partyTotals = partyNames.map(() => 0);
      for (const { m, n } of fy) {
        const c = fyCloses[m];
        const sp = c?.splits?.length ? c!.splits! : (config?.profitSplits[branch] || []);
        const rowAmounts = splitAmounts(n.profit, sp);
        const r = aoa.length;
        mark(r, partyNames.map((_, i) => i + 1), MONEY);
        aoa.push([
          monthLabel(m),
          ...partyNames.map((name, i) => {
            const hit = rowAmounts.find((x) => x.name === name);
            if (!hit || !n.sales) return '';
            partyTotals[i] += hit.amount;
            return hit.amount;
          }),
        ]);
      }
      {
        const r = aoa.length;
        totalRows.add(r);
        mark(r, partyNames.map((_, i) => i + 1), MONEY);
        aoa.push(['Total :', ...partyTotals]);
      }
      tableRanges.push({ r1: t2Start, r2: aoa.length - 1, c2: partyNames.length });

      // ── Table 3: commission paid per channel per month (行家 /
      // Reubird / CommonRoom …) — the section her Master keeps at H24. ──
      aoa.push([]);
      const COMM_LABELS: Record<string, string> = { reubird: 'Reubird', agent: '行家', commonroom: 'CommonRoom' };
      const commChannels = Array.from(new Set([
        ...Object.keys(config?.commissionRules || {}),
        ...fy.flatMap(({ n }) => Object.keys(n.commissionByChannel)),
      ]));
      const t3Start = aoa.length;
      headerRows.add(aoa.length);
      aoa.push(['Commission 佣金', ...commChannels.map((c) => COMM_LABELS[c] || c), 'Total']);
      const commTotals = commChannels.map(() => 0);
      let commGrand = 0;
      for (const { m, n } of fy) {
        const r = aoa.length;
        mark(r, [...commChannels.map((_, i) => i + 1), commChannels.length + 1], MONEY);
        let rowSum = 0;
        const cells = commChannels.map((c, i) => {
          const v = n.commissionByChannel[c] || 0;
          commTotals[i] += v; rowSum += v;
          return v || '';
        });
        commGrand += rowSum;
        aoa.push([monthLabel(m), ...cells, rowSum || '']);
      }
      {
        const r = aoa.length;
        totalRows.add(r);
        mark(r, [...commChannels.map((_, i) => i + 1), commChannels.length + 1], MONEY);
        aoa.push(['Total :', ...commTotals, commGrand]);
      }
      tableRanges.push({ r1: t3Start, r2: aoa.length - 1, c2: commChannels.length + 1 });

      // ── Table 4: sales income proportion (category × month) ──
      aoa.push([]);
      const t4Start = aoa.length;
      headerRows.add(aoa.length);
      aoa.push([`${bl} Sales Income Proportion`, ...months.map(monthLabel)]);
      // Rows in her Master's order; they add up to each month's Total Sales.
      const catKeys: Array<[keyof MonthNumbers['cats'], string]> = [
        ['rent', 'Rent'], ['bbqHotpot', 'BBQ/Hotpot'], ['shisha', 'Shisha'],
        ['cater', '到會'], ['drinks', 'Drinks'],
        ['pointsPromo', '會員積分 / 優惠碼'], ['cardSurcharge', '信用卡手續費'],
        ['extPenalty', '加時/罰款'],
        ['lateCollections', '補收舊單欠款'],
      ];
      for (const [k, label] of catKeys) {
        const r = aoa.length;
        mark(r, months.map((_, i) => i + 1), MONEY);
        aoa.push([label, ...fy.map(({ n }) => n.cats[k] || '')]);
      }
      tableRanges.push({ r1: t4Start, r2: aoa.length - 1, c2: months.length });

      // ── Table 5: guest sources (booking counts × month) ──
      aoa.push([]);
      const chIds = Array.from(new Set(fy.flatMap(({ n }) => Object.keys(n.channelCounts))));
      const t5Start = aoa.length;
      headerRows.add(aoa.length);
      aoa.push([`${bl} Guest Sources`, ...months.map(monthLabel)]);
      for (const ch of chIds) {
        const r = aoa.length;
        mark(r, months.map((_, i) => i + 1), INT);
        aoa.push([ch, ...fy.map(({ n }) => n.channelCounts[ch] || '')]);
      }
      tableRanges.push({ r1: t5Start, r2: aoa.length - 1, c2: months.length });

      // Pad every row to 13 columns so blank cells exist for borders.
      const WIDTH = 13;
      for (const row of aoa) while (row.length < WIDTH) row.push('');

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = merges;
      ws['!cols'] = [{ wch: 22 }, ...Array.from({ length: WIDTH - 1 }, () => ({ wch: 13 }))];

      const thin = { style: 'thin', color: { rgb: 'B7B7B7' } };
      const inTable = (r: number, c: number) =>
        tableRanges.some((t) => r >= t.r1 && r <= t.r2 && c <= t.c2);
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;
          const isHeader = headerRows.has(r);
          const isTotal = totalRows.has(r);
          const style: Record<string, unknown> = {
            alignment: { horizontal: c === 0 && r >= 1 && !isHeader ? 'left' : 'center', vertical: 'center' },
            font: { bold: r === 0 || isHeader || isTotal, sz: r === 0 ? 14 : 11 },
          };
          if (inTable(r, c)) style.border = { top: thin, bottom: thin, left: thin, right: thin };
          if (isHeader) (style as { fill?: unknown }).fill = { fgColor: { rgb: 'D9E1F2' } };
          if (isTotal) (style as { fill?: unknown }).fill = { fgColor: { rgb: 'FFF2CC' } };
          if (typeof cell.v === 'number') {
            const f = fmts.get(`${r}:${c}`);
            if (f === 'pct') (style as { numFmt?: string }).numFmt = '0.0%';
            else if (f === 'int') (style as { numFmt?: string }).numFmt = '#,##0';
            else if (f === 'money') (style as { numFmt?: string }).numFmt = Number.isInteger(cell.v) ? '"$"#,##0' : '"$"#,##0.00';
          }
          cell.s = style;
        }
      }
      XLSX.utils.book_append_sheet(wb, ws, 'Master');

      // ── One tab per month, newest first — her OCT-2026 / SEP-2026 … tabs.
      // Built from the same rows as the figures above, so each tab's
      // Total Sales / Total Expenses / Profit equal its Master row.
      for (const { m, n } of [...fy].reverse()) {
        const storedRows = fyExpenseRows[m] || [];
        if (n.sheetBookings.length === 0 && storedRows.length === 0 && n.salary.total === 0) continue;
        const [yy, mm] = m.split('-').map(Number);
        const c = fyCloses[m];
        const sheet = buildMasterMonthSheet({
          title: ` ${MONTH_NAMES_EN[mm - 1]}- ${yy} (${bl})`,
          bookings: n.sheetBookings,
          storedExpenses: [
            ...storedRows.map((e) => ({ vendor: e.item, amount: e.amount || 0 })),
            // Sales Salary（底薪 + 獎金）as its own expense row.
            ...(n.salary.total > 0 ? [{ vendor: salesSalaryLabel(n.salary), amount: n.salary.total }] : []),
          ],
          splits: c?.splits?.length ? c.splits : (config?.profitSplits[branch] || []),
        });
        XLSX.utils.book_append_sheet(wb, masterSheetToWorksheet(XLSX, sheet), monthLabel(m));
      }
      XLSX.writeFile(wb, `SPACO-${bl}-${fyStartY}-${Number(fyStartY) + 1}-Master.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  if (!canAccess) {
    return <div className="p-8 text-gray-500">{locale === 'zh' ? '冇權限' : 'No access'}</div>;
  }

  const zh = locale === 'zh';
  const splitRows = cur ? splitAmounts(cur.profit, splits) : [];

  /** （實際）/（部分估算）/（估算） next to a month's KPay fee. */
  function kpayStatusLabel(n: MonthNumbers): string {
    if (n.kpayEstimatedLines === 0 && n.kpayActualLines > 0) return zh ? '（實際）' : ' (actual)';
    if (n.kpayEstimatedLines > 0 && n.kpayActualLines > 0) return zh ? '（部分估算）' : ' (part est.)';
    return zh ? '（估算）' : ' (est.)';
  }
  /** Where one fee line came from, in words. */
  function kpaySourceLabel(l: KpayFeeLine): string {
    const sm = l.statementMonth ? monthLabel(l.statementMonth) : '';
    if (l.actual) return zh ? `${sm} 結單` : `${sm} statement`;
    if (l.reason === 'refund') return zh ? '估算 · 退款' : 'Estimate · refund';
    if (l.reason === 'not-in-statement') return zh ? `估算 · ${sm} 結單入面搵唔到呢筆` : `Estimate · not on the ${sm} statement`;
    return sm
      ? (zh ? `估算 · 未上載 ${sm} 結單` : `Estimate · ${sm} statement not uploaded`)
      : (zh ? '估算 · 付款日期不明' : 'Estimate · payment date unknown');
  }
  // What the KPay 對帳 card needs for the selected month + branch.
  const kpayLines = cur ? cur.kpayRows.flatMap((r) => r.fee.lines) : [];
  /** Statement months this month's bookings still wait for → payment count. */
  const kpayMissing: Record<string, number> = {};
  for (const l of kpayLines) {
    if (!l.actual && l.reason === 'statement-missing' && l.statementMonth) {
      kpayMissing[l.statementMonth] = (kpayMissing[l.statementMonth] || 0) + 1;
    }
  }
  const kpayNotInStatement = kpayLines.filter((l) => !l.actual && l.reason === 'not-in-statement').length;
  /** Per stored statement: rows that found a booking, rows that did not,
   *  and rows whose booking is left out of finance (cancelled, test …) —
   *  KPay still charged those fees, but they sit in no month's P&L. */
  const stmtMatchStats: Record<string, {
    matched: number; unmatched: KpayStatementTxn[]; excluded: Array<{ txn: KpayStatementTxn; bookingId: string }>;
  }> = {};
  const countedIds = new Set(allBookings.filter((b) => countsForFinance(b, { includeTest: isPreviewHost })).map((b) => b.id));
  for (const mt of recon.matches) {
    const st = stmtMatchStats[mt.month] || (stmtMatchStats[mt.month] = { matched: 0, unmatched: [], excluded: [] });
    if (!mt.bookingId) { st.unmatched.push(mt.txn); continue; }
    st.matched++;
    if (!countedIds.has(mt.bookingId)) st.excluded.push({ txn: mt.txn, bookingId: mt.bookingId });
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarCheck className="w-6 h-6 text-pink" />
          {zh ? '月結' : 'Month Close'}
        </h1>
        <div className="flex items-center gap-2">
          <input
            type="month" value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm"
          />
          <button
            onClick={handleExportMaster}
            disabled={exporting || loading}
            className="btn-secondary flex items-center gap-1.5 text-sm disabled:opacity-40"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {zh ? '匯出 Master' : 'Export Master'}
          </button>
        </div>
      </div>

      {isPreviewHost && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2">
          🧪 {zh ? '測試環境 — 數字包含測試訂單，只供驗收功能' : 'Test environment — numbers include test bookings'}
        </div>
      )}
      {flash && (
        <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-2 flex items-center gap-2">
          <Check className="w-4 h-4" /> {flash}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {branches.map(({ key: b }) => (
          <button
            key={b} onClick={() => setBranch(b)}
            className={`px-4 py-1.5 rounded-full text-sm border ${branch === b ? 'bg-pink text-white border-pink' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            {branchLabel(b)}
          </button>
        ))}
      </div>

      {loading || !cur ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {/* ── P&L ── */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">
                {monthLabel(month)} · {branchLabel(branch)}
                {isClosed && (
                  <span className="ml-2 text-xs bg-gray-800 text-white rounded-full px-2 py-0.5 inline-flex items-center gap-1">
                    <Lock className="w-3 h-3" /> {zh ? '已關閉' : 'Closed'}
                  </span>
                )}
              </h2>
              <button
                onClick={toggleClose}
                disabled={!isAdminRole}
                className={`text-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40 ${isClosed ? 'bg-gray-100 hover:bg-gray-200' : 'bg-gray-900 text-white hover:bg-gray-700'}`}
              >
                {isClosed ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                {isClosed ? (zh ? '重開月份' : 'Reopen') : (zh ? '關閉月份' : 'Close month')}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500">{zh ? '總銷售' : 'Total Sales'}</div>
                <div className="text-xl font-bold">${fmt(cur.sales)}</div>
                <div className="text-xs text-gray-400">{cur.count} {zh ? '張訂單' : 'bookings'}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500">{zh ? '總支出' : 'Total Expenses'}</div>
                <div className="text-xl font-bold">${fmt(cur.expenses)}</div>
                <div className="text-xs text-gray-400">
                  {zh ? '固定/雜項' : 'Stored'} ${fmt(cur.stored)}{cur.salary.total > 0 ? ` · ${zh ? 'Sales 人工' : 'Sales pay'} $${fmt(cur.salary.total)}${cur.salary.bonus > 0 ? (zh ? `（底薪 $${fmt(cur.salary.base)} + 獎金 $${fmt(cur.salary.bonus)}）` : ` (base $${fmt(cur.salary.base)} + bonus $${fmt(cur.salary.bonus)})`) : ''}` : ''} · {zh ? '佣金' : 'Comm'} ${fmt(cur.commissions)} · KPay ${fmt(cur.kpayFee)}{kpayStatusLabel(cur)}{cur.discounts > 0 ? ` · ${zh ? '折扣/賠償' : 'Discounts'} $${fmt(cur.discounts)}` : ''}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500">{zh ? '利潤' : 'Profit'}</div>
                <div className={`text-xl font-bold ${cur.profit < 0 ? 'text-red-600' : 'text-green-700'}`}>${fmt(cur.profit)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-gray-500">GP%</div>
                <div className="text-xl font-bold">{cur.sales ? `${((cur.profit / cur.sales) * 100).toFixed(1)}%` : '—'}</div>
              </div>
            </div>
            {(cur.uncollected.length > 0 || cur.lateList.length > 0) && (
              <div className="mt-3 grid md:grid-cols-2 gap-3 text-xs">
                {cur.uncollected.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="font-semibold text-amber-800 mb-1">
                      {zh ? '結算欠款未收（不計入今個月）' : 'Settlement debt not received (excluded this month)'}
                    </div>
                    {cur.uncollected.map((u) => (
                      <div key={u.id} className="flex justify-between text-amber-900">
                        <a href={`/${locale}/admin/bookings/${u.id}`} className="underline">#{u.id.slice(0, 8)}</a>
                        <span>${fmt(u.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {cur.lateList.length > 0 && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <div className="font-semibold text-emerald-800 mb-1">
                      {zh ? '補收舊單欠款（已計入今個月總銷售）' : 'Earlier settlement debt received (in this month’s sales)'}
                    </div>
                    {cur.lateList.map((l, i) => (
                      <div key={`${l.id}-${i}`} className="flex justify-between text-emerald-900">
                        <a href={`/${locale}/admin/bookings/${l.id}`} className="underline">#{l.id.slice(0, 8)} · {zh ? '原月份' : 'from'} {l.eventMonth}</a>
                        <span>${fmt(l.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 分紅 ── */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">{zh ? '分紅（今個月）' : 'Profit Split (this month)'}</h2>
              {isAdminRole && !isClosed && (
                <div className="flex gap-2">
                  <button
                    onClick={() => persistSplits([...splits, { name: '', pct: 0 }])}
                    className="text-sm text-pink hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />{zh ? '加一份' : 'Add party'}
                  </button>
                  <button onClick={saveSplitsAsDefault} className="text-sm text-gray-500 hover:underline">
                    {zh ? '儲存為預設' : 'Save as default'}
                  </button>
                </div>
              )}
            </div>
            {pctSum !== 100 && (
              <div className="text-xs text-amber-600 mb-2">
                ⚠️ {zh ? `百分比合共 ${pctSum}%（唔係 100%）` : `Percentages total ${pctSum}% (not 100%)`}
              </div>
            )}
            <table className="w-full text-sm">
              <tbody>
                {splits.map((p, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-2 pr-2">
                      <input
                        value={p.name}
                        disabled={isClosed || !isAdminRole}
                        placeholder={zh ? '名稱' : 'Name'}
                        onChange={(e) => setSplits(splits.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                        onBlur={() => persistSplits(splits)}
                        className="border rounded px-2 py-1 w-36 disabled:bg-gray-50"
                      />
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      <input
                        type="number" value={p.pct}
                        disabled={isClosed || !isAdminRole}
                        onChange={(e) => setSplits(splits.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) } : x))}
                        onBlur={() => persistSplits(splits)}
                        className="border rounded px-2 py-1 w-20 text-right disabled:bg-gray-50"
                      /> %
                    </td>
                    <td className="py-2 text-right font-semibold">
                      ${fmt(cur.profit * (Number(p.pct) || 0) / 100)}
                    </td>
                    <td className="py-2 pl-2 w-8">
                      {isAdminRole && !isClosed && (
                        <button onClick={() => persistSplits(splits.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {splitRows.length === 0 && (
                  <tr><td className="py-3 text-gray-400">{zh ? '未設定分紅' : 'No split configured'}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── KPay 對帳 ── */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="font-semibold mb-1">{zh ? 'KPay 對帳' : 'KPay Reconciliation'}</h2>
            <p className="text-xs text-gray-500 mb-3">
              {zh
                ? '手續費跟訂單走：每張訂單嘅每筆 KPay 付款，都會去返「俾錢嗰個月」嘅結單度對返嗰筆交易嘅手續費，再加埋。所以 10 月嘅訂單如果 8 月已經俾錢，就用 8 月結單嗰筆數。'
                : 'Fees follow the booking: each KPay payment of a booking is looked up on the statement of the month it was paid in, and the fees are added up.'}
            </p>

            <div className="text-sm">
              {zh ? '本月訂單 KPay 手續費' : 'KPay fee of this month’s bookings'}：<b>${fmt(cur.kpayFee)}</b>{kpayStatusLabel(cur)}
              {cur.kpayRows.length > 0 && (
                <span className="text-gray-500">
                  {' — '}{zh ? '實際' : 'actual'} ${fmt(cur.kpayActual)}（{cur.kpayActualLines} {zh ? '筆' : 'payments'}）
                  {cur.kpayEstimatedLines > 0 && <> · {zh ? '估算' : 'estimated'} ${fmt(cur.kpayEstimated)}（{cur.kpayEstimatedLines} {zh ? '筆' : 'payments'}，{config?.kpayFeePct}%）</>}
                </span>
              )}
            </div>

            {Object.keys(kpayMissing).length > 0 && (
              <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠️ {zh ? '仲未上載以下月份嘅結單，相關付款暫時用估算：' : 'Statements not uploaded yet — these payments use the estimate: '}
                <b>{Object.keys(kpayMissing).sort().map((sm) => `${monthLabel(sm)}（${kpayMissing[sm]} ${zh ? '筆' : ''}）`).join('、')}</b>
              </div>
            )}
            {kpayNotInStatement > 0 && (
              <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠️ {zh
                  ? `有 ${kpayNotInStatement} 筆記錄為 KPay 嘅付款，喺已上載嘅結單入面搵唔到（例如唔係經網站收、或者人手記錄嘅付款方式唔啱），暫時用估算 — 請睇下面明細覆核。`
                  : `${kpayNotInStatement} payment(s) recorded as KPay are not on the uploaded statements; they use the estimate — please review below.`}
              </div>
            )}
            {mc?.kpayStatement && statements.length === 0 && (
              <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠️ {zh
                  ? `呢個月之前上載過「${mc.kpayStatement.fileName}」，但舊做法係將成張結單嘅手續費（$${fmt(mc.kpayStatement.fee)}）入晒落同一個月，已經停用。請喺下面重新上載各月結單一次（可以一次過揀多個檔案）。`
                  : `“${mc.kpayStatement.fileName}” was uploaded here under the old method (whole statement fee on one month), which is no longer used. Please upload the monthly statements again below.`}
              </div>
            )}

            {cur.kpayRows.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="text-xs w-full min-w-[640px]">
                  <thead>
                    <tr className="text-gray-500 border-b">
                      <th className="text-left py-1">{zh ? '訂單（活動日期）' : 'Booking (event date)'}</th>
                      <th className="text-left">{zh ? '付款日期' : 'Paid on'}</th>
                      <th className="text-right">{zh ? 'KPay 收款' : 'Charged'}</th>
                      <th className="text-right">{zh ? '手續費' : 'Fee'}</th>
                      <th className="text-left pl-3">{zh ? '手續費來源' : 'Fee source'}</th>
                      <th className="text-right">{zh ? '訂單合計' : 'Booking total'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cur.kpayRows.map((r) => r.fee.lines.map((l, i) => (
                      <tr key={`${r.id}-${i}`} className={i === 0 ? 'border-t' : ''}>
                        <td className="py-1 pr-2">
                          {i === 0 && (
                            <a href={`/${locale}/admin/bookings/${r.id}`} className="underline">
                              {r.date.slice(5)} · #{r.id.slice(0, 8)}{r.name ? ` · ${r.name}` : ''}
                            </a>
                          )}
                        </td>
                        <td className="whitespace-nowrap">{l.date || '—'}</td>
                        <td className="text-right">${fmt(l.amount)}</td>
                        <td className="text-right">${fmt(l.fee)}</td>
                        <td className={`pl-3 ${l.actual ? 'text-green-700' : 'text-amber-700'}`}>
                          {kpaySourceLabel(l)}{l.payMethod ? ` · ${l.payMethod}` : ''}
                        </td>
                        <td className="text-right font-semibold">{i === 0 ? `$${fmt(r.fee.fee)}` : ''}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-400">{zh ? '本月訂單冇 KPay 付款。' : 'No KPay payments on this month’s bookings.'}</p>
            )}

            {/* Stored statements — shared by every branch and month. */}
            <div className="mt-5 pt-4 border-t space-y-3 text-sm">
              <div className="font-medium">
                {zh ? '已上載嘅 KPay 月結單' : 'Uploaded KPay statements'}
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {zh ? '所有分店、所有月份共用 — 每個月嘅結單上載一次就得' : 'shared by every branch and month — upload each month once'}
                </span>
              </div>
              {statements.length > 0 ? (
                <table className="text-xs w-full max-w-2xl">
                  <thead>
                    <tr className="text-gray-500 border-b">
                      <th className="text-left py-1">{zh ? '結單月份' : 'Statement'}</th>
                      <th className="text-right">{zh ? '筆數' : 'Txns'}</th>
                      <th className="text-right">{zh ? '總額' : 'Gross'}</th>
                      <th className="text-right">{zh ? '手續費' : 'Fee'}</th>
                      <th className="text-right">{zh ? '對到訂單' : 'Matched'}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.map((st) => {
                      const stat = stmtMatchStats[st.month] || { matched: 0, unmatched: [], excluded: [] };
                      return (
                        <tr key={st.month} className="border-b last:border-0 align-top">
                          <td className="py-1">
                            <b>{monthLabel(st.month)}</b> <span className="text-gray-400">{st.fileName}</span>
                            {stat.unmatched.length > 0 && (
                              <details className="text-amber-700">
                                <summary className="cursor-pointer">
                                  {zh ? `${stat.unmatched.length} 筆對唔到訂單（冇計入任何分店）` : `${stat.unmatched.length} not matched to a booking (not counted anywhere)`}
                                </summary>
                                <ul className="mt-1 space-y-0.5 font-mono">
                                  {stat.unmatched.map((t, i) => (
                                    <li key={i}>{t.date || '—'} · {t.orderRef || '—'} · ${fmt(t.amount)}（{zh ? '費' : 'fee'} ${fmt(t.fee)}）</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {stat.excluded.length > 0 && (
                              <details className="text-gray-500">
                                <summary className="cursor-pointer">
                                  {zh
                                    ? `${stat.excluded.length} 筆屬於唔計入財務嘅訂單（已取消／測試等），手續費 $${fmt(stat.excluded.reduce((sum, x) => sum + x.txn.fee, 0))} 冇入任何月份`
                                    : `${stat.excluded.length} on bookings left out of finance (cancelled / test …), fee $${fmt(stat.excluded.reduce((sum, x) => sum + x.txn.fee, 0))} not in any month`}
                                </summary>
                                <ul className="mt-1 space-y-0.5 font-mono">
                                  {stat.excluded.map((x, i) => (
                                    <li key={i}>
                                      {x.txn.date || '—'} · <a href={`/${locale}/admin/bookings/${x.bookingId}`} className="underline">#{x.bookingId.slice(0, 8)}</a> · ${fmt(x.txn.amount)}（{zh ? '費' : 'fee'} ${fmt(x.txn.fee)}）
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </td>
                          <td className="text-right">{st.rowCount}</td>
                          <td className="text-right">${fmt(st.gross)}</td>
                          <td className="text-right font-semibold">${fmt(st.fee)}</td>
                          <td className="text-right">{stat.matched}/{st.transactions.length}</td>
                          <td className="text-right pl-2">
                            {isAdminRole && (
                              <button onClick={() => removeStatement(st.month)} className="text-gray-300 hover:text-red-500" title={zh ? '刪除結單' : 'Delete statement'}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-gray-500">
                  {zh
                    ? `未上載任何結單 — 所有 KPay 手續費暫時用估算（${config?.kpayFeePct}%）。`
                    : `No statements uploaded — all KPay fees use the ${config?.kpayFeePct}% estimate.`}
                </p>
              )}

              {isAdminRole && (
                <label className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <Upload className="w-4 h-4" />
                  {zh ? '上載 KPay 月結單（可以一次揀多個月）' : 'Upload KPay statements (several months at once)'}
                  <input
                    type="file" accept=".xlsx,.xls,.csv" multiple className="hidden"
                    onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) handleStatementFiles(fs); e.target.value = ''; }}
                  />
                </label>
              )}
              {stmtError && <div className="text-red-600 text-xs whitespace-pre-line">{stmtError}</div>}
              {stmtPreviews.length > 0 && (
                <div className="border rounded-lg p-3 bg-gray-50 space-y-3">
                  {stmtPreviews.map((p) => (
                    <div key={p.month} className="space-y-1">
                      <div className="font-medium">{monthLabel(p.month)} <span className="text-xs font-normal text-gray-500">{p.fileName}</span></div>
                      <div className="text-xs text-gray-600">
                        {p.summary.rowCount} {zh ? '筆交易' : 'transactions'} ·
                        {' '}{zh ? '總額' : 'Gross'} ${fmt(p.summary.gross)} ·
                        {' '}<b>{zh ? '手續費' : 'Fee'} ${fmt(p.summary.fee)}</b> ·
                        {' '}{zh ? `對到訂單 ${p.matchedCount}/${p.transactions.length} 筆` : `${p.matchedCount}/${p.transactions.length} matched to bookings`}
                      </div>
                      {p.replaces && (
                        <div className="text-xs text-amber-700">
                          {zh ? `已經有 ${monthLabel(p.month)} 嘅結單，儲存會取代舊嗰份。` : `A ${monthLabel(p.month)} statement is already stored and will be replaced.`}
                        </div>
                      )}
                      {p.unmatched.length > 0 && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                          ⚠️ {zh
                            ? `${p.unmatched.length} 筆交易對唔到訂單（唔會計入任何分店，請人手覆核）：`
                            : `${p.unmatched.length} transactions could not be matched to bookings (not counted):`}
                          <ul className="mt-1 space-y-0.5">
                            {p.unmatched.slice(0, 8).map((t, i) => (
                              <li key={i} className="font-mono">{t.date || '—'} · {t.orderRef || '—'} · ${fmt(t.amount)} ({zh ? '費' : 'fee'} ${fmt(t.fee)})</li>
                            ))}
                            {p.unmatched.length > 8 && <li>… +{p.unmatched.length - 8}</li>}
                          </ul>
                        </div>
                      )}
                      <div className="text-xs text-gray-400">
                        {zh ? '認到嘅欄位' : 'Matched columns'}: {[p.summary.matched.gross, p.summary.matched.fee, p.summary.matched.net].filter(Boolean).join(' / ') || '—'}
                      </div>
                    </div>
                  ))}
                  <button onClick={applyStatements} disabled={stmtSaving} className="btn-primary text-sm disabled:opacity-50">
                    {stmtSaving ? (zh ? '儲存中…' : 'Saving…') : (zh ? `確認儲存（${stmtPreviews.length} 份結單）` : `Save ${stmtPreviews.length} statement(s)`)}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── FY Master rollup ── */}
          <div className="bg-white rounded-xl border p-5 overflow-x-auto">
            <h2 className="font-semibold mb-3">
              {zh ? '全年概覽' : 'Financial Year'} ({fyMonths(month)[0].slice(0, 4)}-{Number(fyMonths(month)[0].slice(0, 4)) + 1})
            </h2>
            <table className="text-sm min-w-[760px] w-full">
              <thead>
                <tr className="text-gray-500 border-b">
                  <th className="text-left py-2">{zh ? '月份' : 'Month'}</th>
                  <th className="text-right">{zh ? '銷售' : 'Sales'}</th>
                  <th className="text-right">{zh ? '支出' : 'Expenses'}</th>
                  <th className="text-right">{zh ? '利潤' : 'Profit'}</th>
                  <th className="text-right">GP%</th>
                  <th className="text-right">{zh ? '訂單' : 'Bkgs'}</th>
                  <th className="text-right">{zh ? '平均' : 'Avg'}</th>
                  <th className="text-right">{zh ? '狀態' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {fy.map(({ m, n }) => (
                  <tr
                    key={m}
                    className={`border-b last:border-0 ${m === month ? 'bg-pink/5' : ''} ${n.count === 0 ? 'text-gray-300' : ''} cursor-pointer hover:bg-gray-50`}
                    onClick={() => setMonth(m)}
                  >
                    <td className="py-1.5">{monthLabel(m)}</td>
                    <td className="text-right">{n.count ? `$${fmt(n.sales)}` : ''}</td>
                    <td className="text-right">{n.count || n.stored ? `$${fmt(n.expenses)}` : ''}</td>
                    <td className={`text-right ${n.profit < 0 && (n.count || n.stored) ? 'text-red-600' : ''}`}>{n.count || n.stored ? `$${fmt(n.profit)}` : ''}</td>
                    <td className="text-right">{n.sales ? `${((n.profit / n.sales) * 100).toFixed(1)}%` : ''}</td>
                    <td className="text-right">{n.count || ''}</td>
                    <td className="text-right">{n.count ? `$${fmt(n.sales / n.count)}` : ''}</td>
                    <td className="text-right">
                      {fyCloses[m]?.status === 'closed'
                        ? <span className="text-xs text-gray-500 inline-flex items-center gap-0.5"><Lock className="w-3 h-3" />{zh ? '已關' : 'closed'}</span>
                        : ''}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold border-t-2">
                  <td className="py-2">Total :</td>
                  <td className="text-right">${fmt(fy.reduce((s, x) => s + x.n.sales, 0))}</td>
                  <td className="text-right">${fmt(fy.reduce((s, x) => s + x.n.expenses, 0))}</td>
                  <td className="text-right">${fmt(fy.reduce((s, x) => s + x.n.profit, 0))}</td>
                  <td className="text-right">
                    {(() => { const S = fy.reduce((s, x) => s + x.n.sales, 0); const P = fy.reduce((s, x) => s + x.n.profit, 0); return S ? `${((P / S) * 100).toFixed(1)}%` : '—'; })()}
                  </td>
                  <td className="text-right">{fy.reduce((s, x) => s + x.n.count, 0)}</td>
                  <td className="text-right"></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
