'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllBookings } from '@/lib/firestore';
import { aggregateBookings, FinanceFilter, addOnRevenueForBooking, countsForFinance } from '@/lib/finance';
import { venues } from '@/lib/venues';
import {
  BookingRecord, MarketingChannel, MARKETING_CHANNEL_LABELS,
} from '@/types';
import { channelDisplayLabel, getMarketingChannelOptions, type MarketingChannelOption } from '@/lib/marketingChannels';
import { listExpenses, getFinanceConfig } from '@/lib/expenses';
import { commissionForBooking, estimatedKpayFee } from '@/lib/bookingMoney';

// Branch code used in the Sales Record Excel export.
function venueCode(venueId: string): string {
  if (venueId === 'cwb') return 'CWB';
  if (venueId === 'wanchai') return 'WC';
  if (venueId.startsWith('sw-')) return 'SW';
  if (venueId === 'tst') return 'TST';
  return venueId.toUpperCase();
}

const MONTH_NAMES_EN = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/** Pick the most representative month/year from the filter range. Uses
 *  the start date's year+month. */
function rangeMonthYear(fromStr: string): { month: string; year: number } {
  const [y, m] = fromStr.split('-').map(Number);
  return { month: MONTH_NAMES_EN[(m || 1) - 1], year: y || new Date().getFullYear() };
}
import {
  BarChart3, Download, FileSpreadsheet, FileText, TrendingUp,
  Calendar as CalendarIcon, Loader2, MapPin, Tag,
} from 'lucide-react';

// Default range: current month.
function defaultFromTo(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const from = new Date(y, m, 1).toISOString().slice(0, 10);
  const to = new Date(y, m + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export default function FinanceOverviewPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  const canAccess = hasPermission('documents');

  const [allBookings, setAllBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [{ from, to }, setRange] = useState(defaultFromTo());
  // Admin-configured channel options — so aggregated channel ids that
  // aren't built-ins still render their display label.
  const [channelLabelById, setChannelLabelById] = useState<Map<string, MarketingChannelOption>>(new Map());
  useEffect(() => {
    getMarketingChannelOptions()
      .then((opts) => setChannelLabelById(new Map(opts.map((o) => [o.id, o]))))
      .catch(() => {});
  }, []);
  const [branch, setBranch] = useState<string>('all');
  const [channel, setChannel] = useState<FinanceFilter['channel']>('all');

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    getAllBookings()
      .then((b) => setAllBookings(b))
      .finally(() => setLoading(false));
  }, [canAccess]);

  // Preview/test deployments show test bookings in finance so features
  // can actually be verified there (every preview-created booking is
  // auto-stamped isTest). Production hosts never include them.
  const [isPreviewHost, setIsPreviewHost] = useState(false);
  useEffect(() => {
    const h = window.location.hostname;
    setIsPreviewHost(h !== 'spacohk.com' && h !== 'www.spacohk.com');
  }, []);
  const result = useMemo(
    () => aggregateBookings(allBookings, { from, to, branch, channel, includeTest: isPreviewHost }),
    [allBookings, from, to, branch, channel, isPreviewHost],
  );

  function channelLabel(ch: string): string {
    if (ch === 'loyalty_member') return locale === 'zh' ? '🌟 老會員' : '🌟 Loyalty';
    if (ch === 'unknown') return locale === 'zh' ? '（未填）' : '(unspecified)';
    return MARKETING_CHANNEL_LABELS[ch as MarketingChannel]?.[locale] || channelLabelById.get(ch)?.[locale] || ch;
  }

  /** Display name for the branch filter — handles the 'sw' group key. */
  function branchLabel(key: string): string {
    if (key === 'all') return locale === 'zh' ? '全部' : 'All';
    if (key === 'sw') return locale === 'zh' ? '上環海景旗艦店' : 'Sheung Wan';
    if (key === 'cwb') return locale === 'zh' ? '銅鑼灣店' : 'Causeway Bay';
    if (key === 'wanchai') return locale === 'zh' ? '灣仔店' : 'Wan Chai';
    if (key === 'tst') return locale === 'zh' ? '尖沙咀店' : 'Tsim Sha Tsui';
    return venues.find((v) => v.id === key)?.name[locale] || key;
  }

  /** Re-apply the current page filter to the raw bookings list — needed
   *  for the per-booking Excel export which iterates over individual
   *  bookings rather than the aggregator's summary buckets. */
  function filteredBookings(): BookingRecord[] {
    return allBookings.filter((b) => {
      // Same predicate as the aggregator — excludes cancelled/pending,
      // test bookings, and unpaid ghost bookings, so the per-booking
      // sheet always reconciles with the Summary numbers.
      if (!countsForFinance(b, { includeTest: isPreviewHost })) return false;
      if (from && b.date < from) return false;
      if (to && b.date > to) return false;
      if (branch !== 'all') {
        const key = b.venueId.startsWith('sw-') ? 'sw' : b.venueId;
        if (key !== branch) return false;
      }
      if (channel && channel !== 'all') {
        const ch = b.marketingChannel || 'unknown';
        if (ch !== channel) return false;
      }
      return true;
    }).sort((a, b2) => a.date.localeCompare(b2.date));
  }

  /** Category breakdown per booking — matches the columns in the Sales
   *  Record template (Rent / Shisha / BBQ / 到會 / Drinks / 加時·罰款). */
  function categoryBreakdown(b: BookingRecord) {
    const rent = b.pricing.baseCharge || 0;
    const shisha = addOnRevenueForBooking(b, 'shisha');
    // Column semantics follow Heidi's Financial Master exactly:
    // 「BBQ/ Hotpot」 is ONE combined column; 「到會」 is catering only.
    const bbqHotpot = addOnRevenueForBooking(b, 'bbq-standard')
      + addOnRevenueForBooking(b, 'bbq-premium')
      + addOnRevenueForBooking(b, 'bbq-grill')
      + addOnRevenueForBooking(b, 'hotpot-standard')
      + addOnRevenueForBooking(b, 'hotpot-seafood')
      + addOnRevenueForBooking(b, 'hotpot-extra-soup');
    const cater = addOnRevenueForBooking(b, 'catering');
    const drinks = addOnRevenueForBooking(b, 'drinks');
    // 加時/罰款 = admin-recorded rental top-ups (post-confirmation
    // extensions) + forfeited security deposit (penalties).
    // Rental top-ups = venue rental + add-on portions of every logged
    // payment. New entries (post-2026-05) split these into
    // rentalAmount + addOnAmount; legacy entries lumped both into
    // rentalAmount so addOnAmount may be undefined. Sum both.
    const topUpRental = (b.payments || [])
      .reduce((s, p) => s + (p.rentalAmount || 0) + (p.addOnAmount || 0), 0);
    const initialRental = rent + shisha + bbqHotpot + cater + drinks; // baseline
    const extensions = Math.max(0, topUpRental - initialRental); // only the delta
    const refund = b.depositRefund as { deductions?: { amount: number }[] } | undefined;
    const penalty = (refund?.deductions || []).reduce((s, d) => s + (d.amount || 0), 0);
    return { rent, shisha, bbqHotpot, cater, drinks, extPenalty: extensions + penalty };
  }

  /** Combine the synthetic initial payment with the audit log so each
   *  booking surfaces every transaction as its own row in the export. */
  function transactionsFor(b: BookingRecord): Array<{ date: string; method: string; amount: number; note?: string }> {
    const tx: Array<{ date: string; method: string; amount: number; note?: string }> = [];
    const logged = b.payments || [];
    const loggedAmount = logged.reduce((s, p) => s + (p.amount || 0), 0);
    const totalPaid = b.pricing.deposit || 0;
    // Synthetic initial row covers LEGACY paid bookings whose deposit
    // predates the payments[] freeze. Never fabricate one for a booking
    // with no paid status — that's how unpaid ghosts grew fake FPS rows.
    const isPaid = b.status === 'confirmed' || b.status === 'completed' || !!b.paymentVerifiedAt;
    const initial = isPaid ? Math.max(0, totalPaid - loggedAmount) : 0;
    if (initial > 0) {
      tx.push({
        date: b.date,  // use booking date as proxy when createdAt isn't easily extractable here
        method: b.paymentMethod || 'stripe',
        amount: initial,
        note: 'Initial confirmation',
      });
    }
    for (const p of logged) {
      const dateStr = typeof p.recordedAt === 'string'
        ? p.recordedAt.slice(0, 10)
        : '';
      tx.push({ date: dateStr, method: p.method, amount: p.amount || 0, note: p.note || undefined });
    }
    return tx;
  }

  /** `2026-09-04` → `2026-09-04 (五)` — Heidi wants weekdays visible. */
  function withWeekday(dateStr: string): string {
    if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;
    const d = new Date(`${dateStr.slice(0, 10)}T00:00:00+08:00`);
    return `${dateStr} (${'日一二三四五六'[d.getDay()]})`;
  }

  async function handleExportExcel() {
    setExporting(true);
    try {
      // xlsx-js-style is a drop-in fork that supports writing cell
      // styles (background, font, borders, alignment) — the OSS xlsx
      // package only reads them.
      const XLSX = await import('xlsx-js-style');
      const wb = XLSX.utils.book_new();
      const { month, year } = rangeMonthYear(from);
      const titleText = ` ${month}- ${year}  Sales Record`;

      // ─── SHEET 1: her Financial Master monthly layout, 19 columns ───
      // A Date | B Time | C ppl | D Rent | E BBQ/Hotpot | F Shisha |
      // G 到會 | H Drinks | I 加時/罰款 | J Total | K TxDate | L Method |
      // M Amount | N TxTotal | O Vendor | P Amount | Q Source |
      // R Returned Deposit | S Remarks — CR+DR on ONE sheet, exactly like
      // the (CWB)2026-2027 Financial Master reference file.
      const cfg = await getFinanceConfig();
      const monthsInRange: string[] = [];
      {
        let cur = from.slice(0, 7);
        const last = to.slice(0, 7);
        while (cur <= last && monthsInRange.length < 24) {
          monthsInRange.push(cur);
          const [yy, mm] = cur.split('-').map(Number);
          cur = `${mm === 12 ? yy + 1 : yy}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}`;
        }
      }
      const branchKeys = branch === 'all' ? ['cwb', 'sw', 'tst', 'wanchai'] : [branch];
      const storedExpenses: Array<{ branchKey: string; item: string; amount: number; source: string }> = [];
      for (const bk of branchKeys) {
        for (const m of monthsInRange) {
          try { storedExpenses.push(...await listExpenses(bk, m)); } catch { /* keep exporting */ }
        }
      }

      const aoa: (string | number)[][] = [];
      aoa.push(['', `${month}-${year} (${branchLabel(branch)}) Sales Record`]);
      aoa.push(['CR', '', '', '', '', '', '', '', '', '', '', '', '', '', 'DR', '', 'Source', 'Returned Deposit', 'Remarks']);
      aoa.push(['Booking Details', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Expenses', '', '', '', '']);
      aoa.push(['', '', '', 'Sales', '', '', '', '', '', '', 'Transaction', '', '', '', '', '', '', '', '']);
      aoa.push([
        'Date', 'Time', 'ppl',
        'Rent', 'BBQ/ Hotpot', 'Shisha', '到會', 'Drinks', '加時/罰款', 'Total',
        'Date', 'Payment Method', 'Amount', 'Total',
        'Vendor', 'Amount',
        '', '', '',
      ]);

      const bookings = filteredBookings();
      let totalSales = 0;
      let totalTransactions = 0;
      let totalRefund = 0;
      let totalExpenses = 0;
      const catSums = { rent: 0, bbqHotpot: 0, shisha: 0, cater: 0, drinks: 0, extPenalty: 0 };

      for (const b of bookings) {
        const cats = categoryBreakdown(b);
        const total = b.pricing.subtotal || 0;
        const txs = transactionsFor(b);
        const sumTx = txs.reduce((s, t) => s + t.amount, 0);
        totalSales += total;
        totalTransactions += sumTx;
        catSums.rent += cats.rent; catSums.bbqHotpot += cats.bbqHotpot;
        catSums.shisha += cats.shisha; catSums.cater += cats.cater;
        catSums.drinks += cats.drinks; catSums.extPenalty += cats.extPenalty;

        // Per-booking DR items — commission + estimated KPay fee, exactly
        // the rows Heidi typed by hand into the Vendor/Amount columns.
        const drItems: Array<{ vendor: string; amount: number }> = [];
        const rule = cfg.commissionRules[b.marketingChannel || ''];
        const comm = commissionForBooking(b, rule);
        if (comm > 0) {
          drItems.push({ vendor: channelDisplayLabel(b, 'zh'), amount: comm });
          totalExpenses += comm;
        }
        const fee = estimatedKpayFee(b, cfg.kpayFeePct);
        if (fee > 0) {
          drItems.push({ vendor: 'Kpay', amount: fee });
          totalExpenses += fee;
        }

        const timeStr = b.endDate && b.endDate !== b.date
          ? `${b.startTime}-${b.endTime} (+1d)`
          : `${b.startTime}-${b.endTime}`;
        const pplEquiv = (b.adultCount ?? b.guestCount) + 0.5 * (b.childCount ?? 0);
        const pplStr = (b.childCount ?? 0) > 0
          ? `${pplEquiv} (${b.adultCount ?? b.guestCount}A+${b.childCount}C)`
          : `${b.guestCount}`;
        const src = b.marketingChannel === 'loyalty_member'
          ? 'Loyalty Member'
          : b.marketingChannel
            ? channelDisplayLabel(b, 'zh') + (b.marketingChannelOther ? `: ${b.marketingChannelOther}` : '')
            : '';
        const refund = b.depositRefund as { amount?: number } | undefined;
        const refundAmt = refund?.amount ?? '';
        if (typeof refundAmt === 'number') totalRefund += refundAmt;
        const noteParts: string[] = [];
        if (branch === 'all') noteParts.push(venueCode(b.venueId));
        noteParts.push(`#${b.id.slice(0, 8)}`);
        for (const p of (b.payments || [])) if (p.note) noteParts.push(`「${p.note}」`);
        if (b.endDate && b.endDate !== b.date) noteParts.push(`過夜→${b.endDate}`);

        const rowCount = Math.max(1, txs.length, drItems.length);
        for (let i = 0; i < rowCount; i++) {
          const first = i === 0;
          const t = txs[i];
          const d = drItems[i];
          aoa.push([
            first ? withWeekday(b.date) : '',
            first ? timeStr : '',
            first ? pplStr : '',
            first ? cats.rent : '',
            first ? cats.bbqHotpot : '',
            first ? cats.shisha : '',
            first ? cats.cater : '',
            first ? cats.drinks : '',
            first ? cats.extPenalty : '',
            first ? total : '',
            t?.date ? withWeekday(t.date) : '',
            t ? methodLabel(t.method) : '',
            t?.amount ?? '',
            first ? sumTx : '',
            d?.vendor || '',
            d?.amount ?? '',
            first ? src : '',
            first ? refundAmt : '',
            first ? noteParts.join(' ') : (t?.note || ''),
          ]);
        }
      }

      // Monthly stored expenses (recurring + one-off) — appended below the
      // bookings in the Vendor/Amount columns, same as her sheet's tail.
      for (const e of storedExpenses) {
        const vendor = branch === 'all'
          ? `[${venueCode(e.branchKey === 'sw' ? 'sw-a' : e.branchKey)}] ${e.item}`
          : e.item;
        aoa.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', vendor, e.amount, '', '', '']);
        totalExpenses += e.amount;
      }

      // Footer — mirrors her layout: category sums row with Total
      // Expenses + Total returned deposit, then Total Sales, then Profit.
      const profit = totalSales - totalExpenses;
      aoa.push([]);
      aoa.push([
        'TOTAL', '', '',
        catSums.rent, catSums.bbqHotpot, catSums.shisha, catSums.cater, catSums.drinks, catSums.extPenalty, totalSales,
        '', '', '', totalTransactions,
        'Total Expenses', totalExpenses,
        'Total returned deposit', totalRefund, '',
      ]);
      aoa.push(['', '', '', '', '', '', '', '', 'Total Sales Amount', totalSales, '', '', '', '', '', '', '', '', '']);
      aoa.push(['', '', '', '', '', '', '', '', '', '', '', '', '', 'Profit :', profit, '', '', '', '']);

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      ws['!merges'] = [
        { s: { r: 0, c: 1 }, e: { r: 0, c: 18 } },   // title
        { s: { r: 1, c: 0 }, e: { r: 1, c: 13 } },   // CR band
        { s: { r: 2, c: 0 }, e: { r: 2, c: 13 } },   // Booking Details
        { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } },    // (Date/Time/ppl group)
        { s: { r: 3, c: 3 }, e: { r: 3, c: 9 } },    // Sales
        { s: { r: 3, c: 10 }, e: { r: 3, c: 13 } },  // Transaction
        { s: { r: 1, c: 14 }, e: { r: 1, c: 15 } },  // DR
        { s: { r: 2, c: 14 }, e: { r: 2, c: 15 } },  // Expenses
        { s: { r: 1, c: 16 }, e: { r: 4, c: 16 } },  // Source
        { s: { r: 1, c: 17 }, e: { r: 4, c: 17 } },  // Returned Deposit
        { s: { r: 1, c: 18 }, e: { r: 4, c: 18 } },  // Remarks
      ];

      ws['!cols'] = [
        { wch: 12 }, { wch: 15 }, { wch: 12 },
        { wch: 10 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 11 }, { wch: 11 },
        { wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 11 },
        { wch: 18 }, { wch: 11 },
        { wch: 20 }, { wch: 15 }, { wch: 34 },
      ];

      // ─── STYLE PASS ───
      const thin = { style: 'thin', color: { rgb: '999999' } };
      const border = { top: thin, bottom: thin, left: thin, right: thin };
      const PINK = 'FFE0EA';
      const PINK_LIGHT = 'FFF0F5';
      const ORANGE = 'FFE0CC';
      const PURPLE = 'EADBFD';
      const GREEN = 'D9F2E6';
      const GRAY = 'EAEAEA';
      const BLUE = 'D9EAFE';
      const TITLE_BG = 'FF6B9D';
      const COL_HEADER_BG = 'F4F4F4';

      const HEADER_ROW = 4;
      const lastCol = 18;
      const lastRow = aoa.length - 1;

      const setStyle = (r: number, c: number, st: object) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!ws[ref]) ws[ref] = { t: 's', v: '' };
        ws[ref].s = { ...(ws[ref].s || {}), ...st };
      };
      const headerFill = (r: number, c: number): string | null => {
        if (r === 0) return TITLE_BG;
        if (r === HEADER_ROW) return COL_HEADER_BG;
        if (c <= 9) return r === 3 ? PINK_LIGHT : PINK;
        if (c >= 10 && c <= 13) return r === 3 ? BLUE : null;
        if (c === 14 || c === 15) return ORANGE;
        if (c === 16) return PURPLE;
        if (c === 17) return GREEN;
        if (c === 18) return GRAY;
        return null;
      };
      for (let r = 0; r <= HEADER_ROW; r++) {
        for (let c = 0; c <= lastCol; c++) {
          const fill = headerFill(r, c);
          const style: Record<string, unknown> = {
            font: { bold: true, sz: r === 0 ? 16 : 11, color: { rgb: r === 0 ? 'FFFFFF' : '1A1A1A' } },
            alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
            border,
          };
          if (fill) style.fill = { patternType: 'solid', fgColor: { rgb: fill } };
          setStyle(r, c, style);
        }
      }
      ws['!rows'] = ws['!rows'] || [];
      ws['!rows'][0] = { hpt: 28 };
      ws['!rows'][4] = { hpt: 24 };
      // Money columns get an explicit "$" number format (whole dollars
      // stay clean, cents show when present); every data cell is centred
      // — both per Heidi's 2026-09-07 review of the export.
      const MONEY_COLS = new Set([3, 4, 5, 6, 7, 8, 9, 12, 13, 15, 17]);
      for (let r = HEADER_ROW + 1; r <= lastRow; r++) {
        for (let c = 0; c <= lastCol; c++) {
          const isBlankRow = aoa[r]?.every((v) => v === '' || v === undefined);
          if (isBlankRow) continue;
          const isTotalRow = aoa[r]?.[0] === 'TOTAL' || aoa[r]?.[13] === 'Profit :' || aoa[r]?.[8] === 'Total Sales Amount';
          const style: Record<string, unknown> = {
            font: { sz: 11, bold: !!isTotalRow },
            alignment: { horizontal: 'center', vertical: 'center' },
            border,
          };
          if (isTotalRow) style.fill = { patternType: 'solid', fgColor: { rgb: 'F4F4F4' } };
          const v = aoa[r]?.[c];
          if (MONEY_COLS.has(c) && typeof v === 'number') {
            style.numFmt = Number.isInteger(v) ? '"$"#,##0' : '"$"#,##0.00';
          }
          // Profit / footer money cells sit outside MONEY_COLS rows too
          if (typeof v === 'number' && (aoa[r]?.[13] === 'Profit :' || aoa[r]?.[8] === 'Total Sales Amount' || isTotalRow)) {
            if (c >= 3) style.numFmt = Number.isInteger(v) ? '"$"#,##0' : '"$"#,##0.00';
          }
          setStyle(r, c, style);
        }
      }

      XLSX.utils.book_append_sheet(wb, ws, `${month}-${year}`);

      // ─── SHEET 2: Summary ───
      // Expenses + profit now live ON sheet 1 (her single-sheet format);
      // the Summary sheet mirrors the headline totals.
      const summary: (string | number)[][] = [
        ['Filter / 篩選', ''],
        ['Date / 日期', `${from} → ${to}`],
        ['Branch / 分店', branchLabel(branch)],
        ['Channel / 推廣渠道', channel === 'all' ? 'All / 全部' : channelLabel(channel as string)],
        [],
        ['Total Revenue / 總收入', result.totalRevenue],
        ['Bookings / 預訂數', result.bookingCount],
        ['Rental / 場租', result.rentalRevenue],
        ['Add-ons / 附加服務', result.addOnRevenue],
        ['Deposit Deductions / 按金扣減', result.depositDeductionsRevenue],
        ['Future Revenue / 未來預訂收入', result.futureRevenue],
        ['Future Bookings / 未來預訂數', result.futureBookingCount],
      ];
      summary.push([]);
      summary.push(['Total Expenses / 總支出', totalExpenses]);
      summary.push(['Profit / 利潤', profit]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

      // ─── SHEET 3: Channel breakdown ───
      const channelRows = [
        ['Channel / 推廣渠道', 'Bookings / 預訂數', 'Revenue / 收入'],
        ...result.byChannel.map((r) => [channelLabel(r.channel), r.bookings, r.revenue]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(channelRows), 'Channels');

      const filename = `SPACO-${month}-${year}-Sales-Record.xlsx`;
      XLSX.writeFile(wb, filename);
    } finally {
      setExporting(false);
    }
  }

  function methodLabel(m: string): string {
    if (m === 'kpay') return 'KPay';
    if (m === 'stripe') return 'Stripe';
    if (m === 'fps') return 'FPS';
    if (m === 'bank') return 'Bank';
    if (m === 'cash') return 'Cash';
    if (m === 'other') return 'Other';
    return m;
  }

  async function handleExportPdf() {
    setExporting(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      // Landscape A4: 842 × 595pt — fits the 16-col booking table.
      const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
      const fmt = (n: number) => `$${n.toLocaleString()}`;
      const { month, year } = rangeMonthYear(from);

      // Brand colors (rgb tuples for jspdf-autotable).
      const PINK = [255, 107, 157] as [number, number, number];
      const PINK_SOFT = [255, 240, 245] as [number, number, number];
      const ORANGE = [255, 176, 136] as [number, number, number];
      const ORANGE_SOFT = [255, 232, 220] as [number, number, number];
      const BLUE_SOFT = [217, 234, 254] as [number, number, number];
      const GREEN_SOFT = [217, 242, 230] as [number, number, number];
      const PURPLE_SOFT = [234, 219, 253] as [number, number, number];
      const GRAY = [100, 100, 100] as [number, number, number];
      const CHARCOAL = [26, 26, 26] as [number, number, number];

      // ─── Page header (top of every page) ───
      const drawHeader = () => {
        // Pink title bar
        doc.setFillColor(...PINK);
        doc.rect(0, 0, 842, 50, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text(`SPACO ${month}-${year} Sales Record`, 30, 32);
        // Filter chip line
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(255, 255, 255);
        const filterText = `Date: ${from} → ${to}  ·  Branch: ${branchLabel(branch)}  ·  Channel: ${channel === 'all' ? 'All' : channelLabel(channel as string)}`;
        doc.text(filterText, 30, 44);
      };
      drawHeader();
      let cursorY = 70;

      // ─── KPI cards row ───
      const kpis: Array<{ label: string; value: string; fill: [number, number, number] }> = [
        { label: 'Total Revenue', value: fmt(result.totalRevenue), fill: PINK_SOFT },
        { label: 'Bookings', value: String(result.bookingCount), fill: PINK_SOFT },
        { label: 'Rental', value: fmt(result.rentalRevenue), fill: ORANGE_SOFT },
        { label: 'Add-ons', value: fmt(result.addOnRevenue), fill: BLUE_SOFT },
        { label: 'Deposit Kept', value: fmt(result.depositDeductionsRevenue), fill: GREEN_SOFT },
        { label: 'Future Revenue', value: `${fmt(result.futureRevenue)} (${result.futureBookingCount})`, fill: PURPLE_SOFT },
      ];
      const cardW = 125, cardH = 50, cardGap = 8, marginX = 30;
      kpis.forEach((k, i) => {
        const x = marginX + i * (cardW + cardGap);
        doc.setFillColor(...k.fill);
        doc.roundedRect(x, cursorY, cardW, cardH, 6, 6, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...GRAY);
        doc.text(k.label, x + 8, cursorY + 14);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...CHARCOAL);
        doc.text(k.value, x + 8, cursorY + 34);
      });
      cursorY += cardH + 14;

      // ─── Section header helper ───
      const sectionHeader = (title: string, color: [number, number, number]) => {
        if (cursorY > 520) {
          doc.addPage();
          drawHeader();
          cursorY = 70;
        }
        doc.setFillColor(...color);
        doc.roundedRect(30, cursorY, 782, 18, 4, 4, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...CHARCOAL);
        doc.text(title, 38, cursorY + 13);
        cursorY += 24;
      };

      // ─── Aggregate breakdowns ───
      sectionHeader('Monthly Revenue', PINK_SOFT);
      autoTable(doc, {
        startY: cursorY,
        margin: { left: 30, right: 30 },
        head: [['Month', 'Revenue', 'Bookings']],
        body: result.monthly.map((r) => [r.month, fmt(r.revenue), r.bookings]),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, lineColor: [200, 200, 200], lineWidth: 0.5 },
        headStyles: { fillColor: PINK, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

      sectionHeader('By Branch', ORANGE_SOFT);
      autoTable(doc, {
        startY: cursorY,
        margin: { left: 30, right: 30 },
        head: [['Branch', 'Revenue', 'Bookings']],
        body: result.byBranch.map((r) => [r.branchName.en, fmt(r.revenue), r.bookings]),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, lineColor: [200, 200, 200], lineWidth: 0.5 },
        headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

      sectionHeader('Add-ons', BLUE_SOFT);
      autoTable(doc, {
        startY: cursorY,
        margin: { left: 30, right: 30 },
        head: [['Add-on', 'Bookings', 'Revenue']],
        body: result.byAddOn.map((r) => [r.name.en, r.bookings, fmt(r.revenue)]),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, lineColor: [200, 200, 200], lineWidth: 0.5 },
        headStyles: { fillColor: [99, 102, 241], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

      sectionHeader('Marketing Channel', PURPLE_SOFT);
      autoTable(doc, {
        startY: cursorY,
        margin: { left: 30, right: 30 },
        head: [['Channel', 'Bookings', 'Revenue']],
        body: result.byChannel.map((r) => {
          const ch = r.channel === 'loyalty_member' ? 'Loyalty Member'
            : r.channel === 'unknown' ? '(unspecified)'
            : MARKETING_CHANNEL_LABELS[r.channel as MarketingChannel]?.en || channelLabelById.get(r.channel)?.en || r.channel;
          return [ch, r.bookings, fmt(r.revenue)];
        }),
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, lineColor: [200, 200, 200], lineWidth: 0.5 },
        headStyles: { fillColor: [139, 92, 246], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });

      // ─── New page: per-booking detail (Sales Record style) ───
      doc.addPage();
      drawHeader();
      cursorY = 70;
      sectionHeader('Booking Details (per transaction)', PINK_SOFT);

      const bookings = filteredBookings();
      // Build flat rows: one row per transaction; sales cols only on
      // the first transaction row of each booking.
      const bodyRows: (string | number)[][] = [];
      let totalSales = 0;
      let totalTx = 0;
      for (const b of bookings) {
        const cats = categoryBreakdown(b);
        const txs = transactionsFor(b);
        const total = b.pricing.subtotal || 0;
        const sumTx = txs.reduce((s, t) => s + t.amount, 0);
        totalSales += total;
        totalTx += sumTx;

        const timeStr = b.endDate && b.endDate !== b.date
          ? `${b.startTime}-${b.endTime} (+1d)`
          : `${b.startTime}-${b.endTime}`;
        const pplStr = (b.childCount ?? 0) > 0
          ? `${b.guestCount} (${b.adultCount ?? b.guestCount}A+${b.childCount}C)`
          : `${b.guestCount}`;
        const src = b.marketingChannel === 'loyalty_member'
          ? 'Loyalty'
          : b.marketingChannel
            ? channelDisplayLabel(b, 'en')
            : '';
        const refund = b.depositRefund as { amount?: number } | undefined;
        const refundAmt = refund?.amount ?? '';

        const rowCount = Math.max(1, txs.length);
        for (let i = 0; i < rowCount; i++) {
          const first = i === 0;
          const t = txs[i];
          bodyRows.push([
            first ? venueCode(b.venueId) : '',
            first ? b.date : '',
            first ? timeStr : '',
            first ? pplStr : '',
            first ? (cats.rent || '') : '',
            first ? (cats.shisha || '') : '',
            first ? (cats.bbqHotpot || '') : '',
            first ? (cats.cater || '') : '',
            first ? (cats.drinks || '') : '',
            first ? (cats.extPenalty || '') : '',
            first ? total : '',
            t ? methodLabel(t.method) : '',
            t?.amount ?? '',
            first ? src : '',
            first ? refundAmt : '',
            first ? `#${b.id.slice(0, 6)}` : '',
          ]);
        }
      }
      // TOTAL footer row
      bodyRows.push([
        'TOTAL', '', '', '', '', '', '', '', '', '', totalSales, '', totalTx, '', '', '',
      ]);

      autoTable(doc, {
        startY: cursorY,
        margin: { left: 30, right: 30 },
        head: [[
          'Branch', 'Date', 'Time', 'ppl',
          'Rent', 'Shisha', 'BBQ', 'Catering', 'Drinks', 'Ext/Pnl', 'Total',
          'Method', 'Paid',
          'Source', 'Refund', 'Ref',
        ]],
        body: bodyRows.map((r) => r.map((c) => typeof c === 'number' ? fmt(c) : c)),
        styles: { font: 'helvetica', fontSize: 7, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.4, overflow: 'linebreak' },
        headStyles: { fillColor: PINK, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 8 },
        alternateRowStyles: { fillColor: [250, 247, 244] },
        columnStyles: {
          0: { halign: 'center', cellWidth: 38 },
          1: { halign: 'center', cellWidth: 52 },
          2: { halign: 'center', cellWidth: 60 },
          3: { halign: 'center', cellWidth: 50 },
          4: { halign: 'right', cellWidth: 42 },
          5: { halign: 'right', cellWidth: 42 },
          6: { halign: 'right', cellWidth: 42 },
          7: { halign: 'right', cellWidth: 50 },
          8: { halign: 'right', cellWidth: 42 },
          9: { halign: 'right', cellWidth: 50 },
          10: { halign: 'right', cellWidth: 52, fontStyle: 'bold' },
          11: { halign: 'center', cellWidth: 46 },
          12: { halign: 'right', cellWidth: 50 },
          13: { halign: 'center', cellWidth: 56 },
          14: { halign: 'right', cellWidth: 46 },
          15: { halign: 'center', cellWidth: 44 },
        },
        // Bold last row (TOTAL) with darker fill.
        didParseCell: (data) => {
          if (data.row.index === bodyRows.length - 1) {
            data.cell.styles.fillColor = [240, 240, 240];
            data.cell.styles.fontStyle = 'bold';
          }
        },
        // Footer note on each page.
        didDrawPage: () => {
          const pageH = doc.internal.pageSize.getHeight();
          doc.setFontSize(7);
          doc.setTextColor(...GRAY);
          doc.text('SPACO · Cholliman Inc.', 30, pageH - 16);
          const pageNum = (doc as unknown as { internal: { getCurrentPageInfo: () => { pageNumber: number } } })
            .internal.getCurrentPageInfo().pageNumber;
          doc.text(`Page ${pageNum}`, 800, pageH - 16, { align: 'right' });
        },
      });

      doc.save(`SPACO-${month}-${year}-Sales-Record.pdf`);
    } finally {
      setExporting(false);
    }
  }

  if (!canAccess) {
    return <div className="text-center py-20 text-ink-soft">{locale === 'zh' ? '無權限存取' : 'Access Denied'}</div>;
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-pill bg-white/60 border border-charcoal/10 mb-4">
            <BarChart3 size={14} className="text-pink" />
            <span className="text-xs font-medium text-ink-soft">Finance</span>
          </div>
          <h1 className="text-heading">
            {locale === 'zh' ? '財務' : 'Finance'} <span className="text-gradient-pink">{locale === 'zh' ? '總覽' : 'Overview'}</span>
          </h1>
          <p className="mt-2 text-ink-soft text-sm max-w-2xl">
            {locale === 'zh'
              ? '篩選日期 / 分店 / 推廣渠道，睇收入分布。包括未來月份預訂收入。可輸出 Excel / PDF 月結。'
              : 'Filter by date / branch / acquisition channel. Includes future-booked revenue. Export to Excel / PDF.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportExcel} disabled={exporting || loading} className="btn-primary flex items-center gap-2 disabled:opacity-40">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Excel
          </button>
          <button onClick={handleExportPdf} disabled={exporting || loading} className="px-4 py-2 rounded-xl bg-white/70 border border-charcoal/10 text-sm font-semibold hover:bg-white flex items-center gap-2 disabled:opacity-40">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-card p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1">
              {locale === 'zh' ? '由' : 'From'}
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1">
              {locale === 'zh' ? '至' : 'To'}
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1">
              <MapPin size={11} className="inline mr-1" />
              {locale === 'zh' ? '分店' : 'Branch'}
            </label>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
            >
              <option value="all">{locale === 'zh' ? '全部' : 'All'}</option>
              <option value="cwb">{locale === 'zh' ? '銅鑼灣店' : 'Causeway Bay'}</option>
              <option value="wanchai">{locale === 'zh' ? '灣仔店' : 'Wan Chai'}</option>
              <option value="sw">{locale === 'zh' ? '上環海景旗艦店' : 'Sheung Wan'}</option>
              <option value="tst">{locale === 'zh' ? '尖沙咀店' : 'Tsim Sha Tsui'}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-soft mb-1">
              <Tag size={11} className="inline mr-1" />
              {locale === 'zh' ? '推廣渠道' : 'Channel'}
            </label>
            <select
              value={channel || 'all'}
              onChange={(e) => setChannel(e.target.value as FinanceFilter['channel'])}
              className="w-full px-3 py-2 rounded-xl border-2 border-charcoal/15 text-sm bg-white/85"
            >
              <option value="all">{locale === 'zh' ? '全部' : 'All'}</option>
              <option value="loyalty_member">{locale === 'zh' ? '🌟 老會員' : '🌟 Loyalty Member'}</option>
              {(Object.keys(MARKETING_CHANNEL_LABELS) as MarketingChannel[]).map((c) => (
                <option key={c} value={c}>{MARKETING_CHANNEL_LABELS[c][locale]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {([
            { label: locale === 'zh' ? '本月' : 'This month', fn: () => defaultFromTo() },
            { label: locale === 'zh' ? '上月' : 'Last month', fn: () => {
              const now = new Date(); now.setMonth(now.getMonth() - 1);
              const y = now.getFullYear(); const m = now.getMonth();
              return { from: new Date(y, m, 1).toISOString().slice(0, 10), to: new Date(y, m + 1, 0).toISOString().slice(0, 10) };
            } },
            { label: locale === 'zh' ? '今年' : 'YTD', fn: () => {
              const y = new Date().getFullYear();
              return { from: `${y}-01-01`, to: new Date().toISOString().slice(0, 10) };
            } },
            { label: locale === 'zh' ? '未來' : 'Future', fn: () => {
              const today = new Date().toISOString().slice(0, 10);
              const end = new Date(); end.setMonth(end.getMonth() + 6);
              return { from: today, to: end.toISOString().slice(0, 10) };
            } },
          ] as const).map((preset) => (
            <button
              key={preset.label}
              onClick={() => setRange(preset.fn())}
              className="px-3 py-1 rounded-pill text-xs font-medium bg-white/60 border border-charcoal/10 hover:bg-white"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="glass-card p-10 text-center text-ink-soft">
          <Loader2 size={20} className="animate-spin inline mr-2" /> Loading…
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard
              label={locale === 'zh' ? '總收入' : 'Total Revenue'}
              value={`HK$${result.totalRevenue.toLocaleString()}`}
              sub={locale === 'zh' ? `${result.bookingCount} 張預訂` : `${result.bookingCount} bookings`}
              gradient
            />
            <StatCard
              label={locale === 'zh' ? '場租' : 'Rental'}
              value={`HK$${result.rentalRevenue.toLocaleString()}`}
            />
            <StatCard
              label={locale === 'zh' ? '附加服務' : 'Add-ons'}
              value={`HK$${result.addOnRevenue.toLocaleString()}`}
            />
            <StatCard
              label={locale === 'zh' ? '按金扣減' : 'Deductions'}
              value={`HK$${result.depositDeductionsRevenue.toLocaleString()}`}
            />
          </div>

          {/* Future revenue highlight */}
          <div className="glass-card p-5 mb-6 bg-gradient-to-br from-pink/10 to-peach/10 border-pink/25">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shrink-0">
                <TrendingUp size={18} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-ink-soft">{locale === 'zh' ? '未來預訂收入（已 lock in）' : 'Future Revenue (locked in)'}</p>
                <p className="text-2xl font-bold text-gradient-pink">HK${result.futureRevenue.toLocaleString()}</p>
                <p className="text-xs text-ink-soft mt-0.5">
                  {locale === 'zh' ? `${result.futureBookingCount} 張預訂仍未到日期` : `${result.futureBookingCount} bookings not yet held`}
                </p>
              </div>
            </div>
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Table title={locale === 'zh' ? '每月收入' : 'Monthly Revenue'} icon={<CalendarIcon size={14} />}
              rows={result.monthly.map((r) => [r.month, `HK$${r.revenue.toLocaleString()}`, `${r.bookings}`])}
              headers={[locale === 'zh' ? '月份' : 'Month', locale === 'zh' ? '收入' : 'Revenue', locale === 'zh' ? '張數' : 'Bookings']}
              empty={locale === 'zh' ? '範圍內冇預訂' : 'No bookings in range'} />

            <Table title={locale === 'zh' ? '分店收入' : 'Revenue by Branch'} icon={<MapPin size={14} />}
              rows={result.byBranch.map((r) => [r.branchName[locale], `HK$${r.revenue.toLocaleString()}`, `${r.bookings}`])}
              headers={[locale === 'zh' ? '分店' : 'Branch', locale === 'zh' ? '收入' : 'Revenue', locale === 'zh' ? '張數' : 'Bookings']}
              empty={locale === 'zh' ? '冇' : 'None'} />

            <Table title={locale === 'zh' ? '附加服務' : 'Add-ons'} icon={<Tag size={14} />}
              rows={result.byAddOn.map((r) => [r.name[locale], `${r.bookings}`, `HK$${r.revenue.toLocaleString()}`])}
              headers={[locale === 'zh' ? '項目' : 'Item', locale === 'zh' ? '張數' : 'Bookings', locale === 'zh' ? '收入' : 'Revenue']}
              empty={locale === 'zh' ? '冇 add-on' : 'No add-ons'} />

            <Table title={locale === 'zh' ? '推廣渠道' : 'Marketing Channel'} icon={<Tag size={14} />}
              rows={result.byChannel.map((r) => [channelLabel(r.channel), `${r.bookings}`, `HK$${r.revenue.toLocaleString()}`])}
              headers={[locale === 'zh' ? '渠道' : 'Channel', locale === 'zh' ? '張數' : 'Bookings', locale === 'zh' ? '收入' : 'Revenue']}
              empty={locale === 'zh' ? '冇' : 'None'} />
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, gradient }: { label: string; value: string; sub?: string; gradient?: boolean }) {
  return (
    <div className={`p-5 rounded-3xl ${gradient ? 'bg-gradient-to-br from-pink/15 to-peach/15 border border-pink/25' : 'glass-card'}`}>
      <p className="text-xs text-ink-soft mb-1">{label}</p>
      <p className={`text-2xl font-bold ${gradient ? 'text-gradient-pink' : 'text-ink'}`}>{value}</p>
      {sub && <p className="text-xs text-ink-soft mt-1">{sub}</p>}
    </div>
  );
}

function Table({ title, icon, headers, rows, empty }: { title: string; icon: React.ReactNode; headers: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="glass-card p-5">
      <h3 className="font-bold mb-3 flex items-center gap-2 text-sm">
        {icon} {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft py-4 text-center">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/40">
              {headers.map((h) => (
                <th key={h} className="text-left py-2 text-xs font-semibold text-ink-soft uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-white/30 last:border-0">
                {r.map((c, j) => (
                  <td key={j} className="py-2">{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
