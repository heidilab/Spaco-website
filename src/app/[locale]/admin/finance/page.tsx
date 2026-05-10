'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getAllBookings } from '@/lib/firestore';
import { aggregateBookings, FinanceFilter } from '@/lib/finance';
import { venues } from '@/lib/venues';
import {
  BookingRecord, MarketingChannel, MARKETING_CHANNEL_LABELS,
} from '@/types';
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

  const result = useMemo(
    () => aggregateBookings(allBookings, { from, to, branch, channel }),
    [allBookings, from, to, branch, channel],
  );

  function channelLabel(ch: string): string {
    if (ch === 'loyalty_member') return locale === 'zh' ? '🌟 老會員' : '🌟 Loyalty';
    if (ch === 'unknown') return locale === 'zh' ? '（未填）' : '(unspecified)';
    return MARKETING_CHANNEL_LABELS[ch as MarketingChannel]?.[locale] || ch;
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

  async function handleExportExcel() {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      // Summary sheet
      const summary = [
        [locale === 'zh' ? '篩選' : 'Filter', ''],
        [locale === 'zh' ? '日期' : 'Date range', `${from} → ${to}`],
        [locale === 'zh' ? '分店' : 'Branch', branchLabel(branch)],
        [locale === 'zh' ? '推廣渠道' : 'Channel', channel === 'all' ? (locale === 'zh' ? '全部' : 'All') : channelLabel(channel as string)],
        [],
        [locale === 'zh' ? '總收入' : 'Total Revenue', result.totalRevenue],
        [locale === 'zh' ? '預訂數' : 'Bookings', result.bookingCount],
        [locale === 'zh' ? '場租收入' : 'Rental', result.rentalRevenue],
        [locale === 'zh' ? '附加服務收入' : 'Add-ons', result.addOnRevenue],
        [locale === 'zh' ? '按金扣減' : 'Deposit Deductions', result.depositDeductionsRevenue],
        [locale === 'zh' ? '未來預訂收入' : 'Future Revenue', result.futureRevenue],
        [locale === 'zh' ? '未來預訂數' : 'Future Bookings', result.futureBookingCount],
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summary);
      XLSX.utils.book_append_sheet(wb, wsSummary, locale === 'zh' ? '摘要' : 'Summary');

      // Monthly
      const monthly = [
        [locale === 'zh' ? '月份' : 'Month', locale === 'zh' ? '收入' : 'Revenue', locale === 'zh' ? '預訂數' : 'Bookings'],
        ...result.monthly.map((r) => [r.month, r.revenue, r.bookings]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(monthly), locale === 'zh' ? '每月' : 'Monthly');

      // Branch
      const branchRows = [
        [locale === 'zh' ? '分店' : 'Branch', locale === 'zh' ? '收入' : 'Revenue', locale === 'zh' ? '預訂數' : 'Bookings'],
        ...result.byBranch.map((r) => [r.branchName[locale], r.revenue, r.bookings]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(branchRows), locale === 'zh' ? '分店' : 'Branch');

      // Add-ons
      const addOnRows = [
        [locale === 'zh' ? '附加服務' : 'Add-on', locale === 'zh' ? '預訂數' : 'Bookings', locale === 'zh' ? '收入' : 'Revenue'],
        ...result.byAddOn.map((r) => [r.name[locale], r.bookings, r.revenue]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(addOnRows), locale === 'zh' ? '附加服務' : 'Add-ons');

      // Channels
      const channelRows = [
        [locale === 'zh' ? '推廣渠道' : 'Channel', locale === 'zh' ? '預訂數' : 'Bookings', locale === 'zh' ? '收入' : 'Revenue'],
        ...result.byChannel.map((r) => [channelLabel(r.channel), r.bookings, r.revenue]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(channelRows), locale === 'zh' ? '推廣' : 'Channels');

      const filename = `SPACO-finance-${from}-to-${to}.xlsx`;
      XLSX.writeFile(wb, filename);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPdf() {
    setExporting(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const fmt = (n: number) => `HK$${n.toLocaleString()}`;
      let y = 60;
      doc.setFontSize(20);
      doc.text('SPACO Finance Overview', 40, y);
      y += 25;
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Date: ${from} → ${to}`, 40, y); y += 14;
      doc.text(`Branch: ${branchLabel(branch)}`, 40, y); y += 14;
      doc.text(`Channel: ${channel === 'all' ? 'All' : String(channel)}`, 40, y); y += 26;

      doc.setTextColor(0);
      doc.setFontSize(13);
      doc.text('Summary', 40, y); y += 18;
      doc.setFontSize(11);
      const sumLines = [
        `Total Revenue: ${fmt(result.totalRevenue)}`,
        `Bookings: ${result.bookingCount}`,
        `Rental: ${fmt(result.rentalRevenue)}`,
        `Add-ons: ${fmt(result.addOnRevenue)}`,
        `Deposit Deductions: ${fmt(result.depositDeductionsRevenue)}`,
        `Future Revenue: ${fmt(result.futureRevenue)} (${result.futureBookingCount} bookings)`,
      ];
      for (const l of sumLines) { doc.text(l, 40, y); y += 16; }
      y += 12;

      const writeTable = (title: string, headers: string[], rows: (string | number)[][]) => {
        if (y > 720) { doc.addPage(); y = 60; }
        doc.setFontSize(13); doc.text(title, 40, y); y += 18;
        doc.setFontSize(10);
        doc.setTextColor(100); doc.text(headers.join('   |   '), 40, y); y += 14;
        doc.setTextColor(0);
        for (const r of rows) {
          if (y > 760) { doc.addPage(); y = 60; }
          doc.text(r.map((x) => typeof x === 'number' ? fmt(x) : String(x)).join('   |   '), 40, y);
          y += 14;
        }
        y += 14;
      };

      writeTable('Monthly', ['Month', 'Revenue', 'Bookings'],
        result.monthly.map((r) => [r.month, r.revenue, r.bookings]));
      writeTable('By Branch', ['Branch', 'Revenue', 'Bookings'],
        result.byBranch.map((r) => [r.branchName.en, r.revenue, r.bookings]));
      writeTable('By Add-on', ['Add-on', 'Bookings', 'Revenue'],
        result.byAddOn.map((r) => [r.name.en, r.bookings, r.revenue]));
      writeTable('By Channel', ['Channel', 'Bookings', 'Revenue'],
        result.byChannel.map((r) => [channelLabel(r.channel), r.bookings, r.revenue]));

      doc.save(`SPACO-finance-${from}-to-${to}.pdf`);
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
