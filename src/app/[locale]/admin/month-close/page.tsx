'use client';

// 月結 (Finance Phase 3) — one-click month close per branch.
//
// Replaces the manual month-end ritual on Heidi's Financial Master:
//   P&L        sales − (stored expenses + derived commissions + KPay fee)
//   分紅        per-branch split defaults, tweakable per month, snapshot
//              saved on the month_close doc; rows mirror her sheet footer
//   KPay 對帳   upload the monthly KPay statement → actual fee replaces
//              the estimate everywhere for that month
//   Master     financial-year rollup table + Excel export in her
//              Master-sheet layout
//
// All sales/expense numbers stay DERIVED (same shared helpers as the
// Sales Record export) — the doc stores only splits, the reconciled fee
// and the closed flag.

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllBookings } from '@/lib/firestore';
import { branchKey as branchKeyOf, countsForFinance, salesCategoryBreakdown } from '@/lib/finance';
import { listExpenses, getFinanceConfig, saveFinanceConfig, type FinanceConfig } from '@/lib/expenses';
import { commissionForBooking, estimatedKpayFee, splitAmounts } from '@/lib/bookingMoney';
import { getMonthClose, saveMonthClose } from '@/lib/monthClose';
import { parseKpayStatement, type KpayStatementSummary } from '@/lib/kpayStatement';
import type { BookingRecord, MonthCloseRecord, ProfitSplitParty } from '@/types';
import {
  CalendarCheck, Loader2, Lock, Unlock, Upload, Plus, Trash2,
  FileSpreadsheet, Check,
} from 'lucide-react';

const BRANCHES = ['cwb', 'sw', 'tst', 'wanchai'];
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

interface MonthNumbers {
  sales: number;
  stored: number;
  commissions: number;
  kpayFee: number;      // actual when reconciled, else estimate
  kpayIsActual: boolean;
  expenses: number;
  profit: number;
  count: number;
  channelSales: Record<string, number>;
  channelCounts: Record<string, number>;
  cats: { rent: number; bbqHotpot: number; shisha: number; cater: number; drinks: number; extPenalty: number };
}

export default function MonthClosePage() {
  const locale = useLocale() as 'zh' | 'en';
  const { user, hasPermission } = useAuth();
  const canAccess = hasPermission('documents');
  const isAdminRole = hasPermission('staff');

  const [branch, setBranch] = useState('cwb');
  const [month, setMonth] = useState(currentMonth());
  const [allBookings, setAllBookings] = useState<BookingRecord[]>([]);
  const [config, setConfig] = useState<FinanceConfig | null>(null);
  const [mc, setMc] = useState<MonthCloseRecord | null>(null);
  const [fyExpenses, setFyExpenses] = useState<Record<string, number>>({});
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
  // KPay statement upload preview (before applying).
  const [stmtPreview, setStmtPreview] = useState<(KpayStatementSummary & { fileName: string }) | null>(null);
  const [stmtError, setStmtError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  function say(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  async function load() {
    setLoading(true);
    setStmtPreview(null); setStmtError(null);
    try {
      const months = fyMonths(month);
      const [all, cfg, close] = await Promise.all([
        getAllBookings(),
        getFinanceConfig(),
        getMonthClose(branch, month),
      ]);
      setAllBookings(all);
      setConfig(cfg);
      setMc(close);
      setSplits(close?.splits?.length ? close.splits : (cfg.profitSplits[branch] || []));
      // FY stored-expense totals + closes (for the Master table).
      const expEntries = await Promise.all(months.map(async (m) => {
        try {
          const rows = await listExpenses(branch, m);
          return [m, rows.reduce((s, r) => s + (r.amount || 0), 0)] as const;
        } catch { return [m, 0] as const; }
      }));
      setFyExpenses(Object.fromEntries(expEntries));
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

  /** Everything derived for one month, from already-loaded bookings. */
  function computeMonth(m: string): MonthNumbers {
    const rows = allBookings.filter((b) =>
      countsForFinance(b, { includeTest: isPreviewHost })
      && b.date.startsWith(m)
      && branchKeyOf(b.venueId) === branch);
    const cats = { rent: 0, bbqHotpot: 0, shisha: 0, cater: 0, drinks: 0, extPenalty: 0 };
    let sales = 0, commissions = 0, kpayEst = 0;
    const channelSales: Record<string, number> = {};
    const channelCounts: Record<string, number> = {};
    for (const b of rows) {
      const total = b.pricing.subtotal || 0;
      sales += total;
      const c = salesCategoryBreakdown(b);
      cats.rent += c.rent; cats.bbqHotpot += c.bbqHotpot; cats.shisha += c.shisha;
      cats.cater += c.cater; cats.drinks += c.drinks; cats.extPenalty += c.extPenalty;
      if (config) {
        commissions += commissionForBooking(b, config.commissionRules[b.marketingChannel || '']);
        kpayEst += estimatedKpayFee(b, config.kpayFeePct);
      }
      const ch = b.marketingChannel || 'unknown';
      channelSales[ch] = (channelSales[ch] || 0) + total;
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;
    }
    const close = fyCloses[m];
    const kpayIsActual = typeof close?.kpayActualFee === 'number';
    const kpayFee = kpayIsActual ? (close!.kpayActualFee as number) : kpayEst;
    const stored = fyExpenses[m] || 0;
    const expenses = stored + commissions + kpayFee;
    return {
      sales, stored, commissions, kpayFee, kpayIsActual,
      expenses, profit: sales - expenses, count: rows.length,
      channelSales, channelCounts, cats,
    };
  }

  const cur = useMemo(
    () => (loading || !config ? null : computeMonth(month)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, config, allBookings, fyExpenses, fyCloses, month, branch, isPreviewHost],
  );

  const fy = useMemo(
    () => (loading || !config ? [] : fyMonths(month).map((m) => ({ m, n: computeMonth(m) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, config, allBookings, fyExpenses, fyCloses, month, branch, isPreviewHost],
  );

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

  async function handleStatementFile(file: File) {
    setStmtError(null); setStmtPreview(null);
    try {
      const XLSX = await import('xlsx-js-style');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      let summary: KpayStatementSummary | null = null;
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true }) as unknown[][];
        summary = parseKpayStatement(rows);
        if (summary) break;
      }
      if (!summary) {
        setStmtError(locale === 'zh'
          ? '未能認出呢個檔案嘅格式 — 請將 statement 傳俾技術同事對一對欄位名稱。'
          : 'Could not recognize this statement format.');
        return;
      }
      setStmtPreview({ ...summary, fileName: file.name });
    } catch {
      setStmtError(locale === 'zh' ? '讀取檔案失敗' : 'Failed to read file');
    }
  }

  async function applyStatement() {
    if (!stmtPreview) return;
    await saveMonthClose(branch, month, {
      kpayActualFee: stmtPreview.fee,
      kpayStatement: {
        fileName: stmtPreview.fileName,
        rowCount: stmtPreview.rowCount,
        gross: stmtPreview.gross,
        fee: stmtPreview.fee,
        net: stmtPreview.net,
      },
    });
    setStmtPreview(null);
    say(locale === 'zh' ? '已套用實際 KPay 手續費' : 'Actual KPay fee applied');
    load();
  }

  async function clearStatement() {
    await saveMonthClose(branch, month, { kpayActualFee: null, kpayStatement: null });
    say(locale === 'zh' ? '已還原為估算' : 'Reverted to estimate');
    load();
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
      const bl = BRANCH_LABELS[branch]?.en || branch.toUpperCase();
      const aoa: (string | number)[][] = [];
      aoa.push([`${fyStartY}-${Number(fyStartY) + 1} Financial Year (${bl})`]);
      aoa.push([]);
      aoa.push(['', 'Total Sales', 'Total Expenses', 'Profit', 'GP', 'Number of Booking', 'Average sales of each booking', 'Reubird', '', '行家', '', 'CommonRoom', '']);
      aoa.push(['', '', '', '', '', '', '', 'Sales', '%', 'Sales', '%', 'Sales', '%']);
      const tot = { sales: 0, expenses: 0, profit: 0, count: 0, reubird: 0, agent: 0, commonroom: 0 };
      for (const { m, n } of fy) {
        const reubird = n.channelSales['reubird'] || 0;
        const agent = n.channelSales['agent'] || 0;
        const commonroom = n.channelSales['commonroom'] || 0;
        tot.sales += n.sales; tot.expenses += n.expenses; tot.profit += n.profit; tot.count += n.count;
        tot.reubird += reubird; tot.agent += agent; tot.commonroom += commonroom;
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
      aoa.push([
        'Total :', tot.sales, tot.expenses, tot.profit,
        tot.sales ? tot.profit / tot.sales : '',
        tot.count, tot.count ? tot.sales / tot.count : '',
        tot.reubird, tot.sales ? tot.reubird / tot.sales : '',
        tot.agent, tot.sales ? tot.agent / tot.sales : '',
        tot.commonroom, tot.sales ? tot.commonroom / tot.sales : '',
      ]);

      // Split payouts per month — one column block per party.
      aoa.push([]);
      const partyNames = Array.from(new Set(fy.flatMap(({ m }) => {
        const c = fyCloses[m];
        const sp = c?.splits?.length ? c.splits : (config?.profitSplits[branch] || []);
        return sp.map((p) => p.name);
      })));
      aoa.push(['Profit Split', ...partyNames]);
      for (const { m, n } of fy) {
        const c = fyCloses[m];
        const sp = c?.splits?.length ? c!.splits! : (config?.profitSplits[branch] || []);
        const rowAmounts = splitAmounts(n.profit, sp);
        aoa.push([
          monthLabel(m),
          ...partyNames.map((name) => {
            const hit = rowAmounts.find((x) => x.name === name);
            return hit && n.sales ? hit.amount : '';
          }),
        ]);
      }

      // Sales income proportion — category rows × month columns.
      aoa.push([]);
      aoa.push([`${bl} Sales Income Proportion`, ...months.map(monthLabel)]);
      const catKeys: Array<[keyof MonthNumbers['cats'], string]> = [
        ['rent', 'Rent'], ['bbqHotpot', 'BBQ/Hotpot'], ['shisha', 'Shisha'],
        ['cater', '到會'], ['drinks', 'Drinks'], ['extPenalty', '加時/罰款'],
      ];
      for (const [k, label] of catKeys) {
        aoa.push([label, ...fy.map(({ n }) => n.cats[k] || '')]);
      }

      // Guest sources — channel booking counts × months.
      aoa.push([]);
      const chIds = Array.from(new Set(fy.flatMap(({ n }) => Object.keys(n.channelCounts))));
      aoa.push([`${bl} Guest Sources`, ...months.map(monthLabel)]);
      for (const ch of chIds) {
        aoa.push([ch, ...fy.map(({ n }) => n.channelCounts[ch] || '')]);
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 14 }, ...Array.from({ length: 13 }, () => ({ wch: 12 }))];
      // Light styling: bold title + header rows, $ formats on money cells.
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (!cell) continue;
          cell.s = {
            font: { bold: r === 0 || r === 2 || r === 3 || String(aoa[r]?.[0] || '').startsWith('Total') },
            alignment: { horizontal: 'center', vertical: 'center' },
          };
          if (typeof cell.v === 'number') {
            const isPct = aoa[3]?.[c] === '%' || aoa[2]?.[c] === 'GP';
            if (isPct) cell.s.numFmt = '0.0%';
            else if (cell.v > 200) cell.s.numFmt = Number.isInteger(cell.v) ? '"$"#,##0' : '"$"#,##0.00';
          }
        }
      }
      XLSX.utils.book_append_sheet(wb, ws, 'Master');
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

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarCheck className="w-6 h-6 text-primary-600" />
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
        {BRANCHES.map((b) => (
          <button
            key={b} onClick={() => setBranch(b)}
            className={`px-4 py-1.5 rounded-full text-sm border ${branch === b ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            {BRANCH_LABELS[b][locale]}
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
                {monthLabel(month)} · {BRANCH_LABELS[branch][locale]}
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
                  {zh ? '固定/雜項' : 'Stored'} ${fmt(cur.stored)} · {zh ? '佣金' : 'Comm'} ${fmt(cur.commissions)} · KPay ${fmt(cur.kpayFee)}{cur.kpayIsActual ? (zh ? '（實際）' : ' (actual)') : (zh ? '（估算）' : ' (est.)')}
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
          </div>

          {/* ── 分紅 ── */}
          <div className="bg-white rounded-xl border p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">{zh ? '分紅（今個月）' : 'Profit Split (this month)'}</h2>
              {isAdminRole && !isClosed && (
                <div className="flex gap-2">
                  <button
                    onClick={() => persistSplits([...splits, { name: '', pct: 0 }])}
                    className="text-sm text-primary-600 hover:underline flex items-center gap-1"
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
            <h2 className="font-semibold mb-2">{zh ? 'KPay 對帳' : 'KPay Reconciliation'}</h2>
            {mc?.kpayStatement ? (
              <div className="text-sm space-y-1">
                <div className="text-green-700 flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  {zh ? '已用實際手續費' : 'Using actual fee'}: <b>${fmt(mc.kpayStatement.fee)}</b>
                  <span className="text-gray-400">({mc.kpayStatement.fileName} · {mc.kpayStatement.rowCount} {zh ? '筆' : 'rows'} · {zh ? '總額' : 'gross'} ${fmt(mc.kpayStatement.gross)})</span>
                </div>
                {isAdminRole && !isClosed && (
                  <button onClick={clearStatement} className="text-xs text-gray-500 hover:underline">
                    {zh ? '還原為估算' : 'Revert to estimate'}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-gray-500">
                  {zh
                    ? `而家用緊估算 KPay 手續費 $${fmt(cur.kpayFee)}（${config?.kpayFeePct}%）。上載 KPay 月結單（Excel/CSV）就會轉用實際數。`
                    : `Currently using the estimated KPay fee $${fmt(cur.kpayFee)} (${config?.kpayFeePct}%). Upload the monthly statement to use actuals.`}
                </p>
                {isAdminRole && !isClosed && (
                  <label className="inline-flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-50">
                    <Upload className="w-4 h-4" />
                    {zh ? '上載 KPay 月結單' : 'Upload KPay statement'}
                    <input
                      type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleStatementFile(f); e.target.value = ''; }}
                    />
                  </label>
                )}
                {stmtError && <div className="text-red-600 text-xs">{stmtError}</div>}
                {stmtPreview && (
                  <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="font-medium">{stmtPreview.fileName}</div>
                    <div className="text-xs text-gray-600">
                      {stmtPreview.rowCount} {zh ? '筆交易' : 'transactions'} ·
                      {' '}{zh ? '總額' : 'Gross'} ${fmt(stmtPreview.gross)} ·
                      {' '}<b>{zh ? '手續費' : 'Fee'} ${fmt(stmtPreview.fee)}</b> ·
                      {' '}{zh ? '淨結算' : 'Net'} ${fmt(stmtPreview.net)}
                    </div>
                    <div className="text-xs text-gray-400">
                      {zh ? '認到嘅欄位' : 'Matched columns'}: {[stmtPreview.matched.gross, stmtPreview.matched.fee, stmtPreview.matched.net].filter(Boolean).join(' / ') || '—'}
                    </div>
                    <button onClick={applyStatement} className="btn-primary text-sm">
                      {zh ? '確認套用' : 'Apply'}
                    </button>
                  </div>
                )}
              </div>
            )}
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
                    className={`border-b last:border-0 ${m === month ? 'bg-primary-50/50' : ''} ${n.count === 0 ? 'text-gray-300' : ''} cursor-pointer hover:bg-gray-50`}
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
