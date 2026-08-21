'use client';

// Admin traffic & attribution report — date-range (default: last 30
// days) visits by source, unique visitors, bookings converted +
// revenue per source, journey stats, and PDF export. Data from
// /api/admin/traffic-report (visits collection is admin-only).

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { adminApiFetch } from '@/lib/adminApiFetch';
import { trafficSourceLabel } from '@/lib/attribution';
import { BarChart3, Users, ShoppingBag, Repeat, Download } from 'lucide-react';

interface SourceRow { visits: number; uniqueVisitors: number; bookings: number; revenue: number }
interface Report {
  from: string;
  to: string;
  totals: {
    visits: number; uniqueVisitors: number; bookings: number;
    attributedBookings: number; unattributedBookings: number;
    avgVisitsBeforeBooking: number | null;
    visitDistribution: number[];
  };
  bySource: Record<string, SourceRow>;
}

function hkDateOffset(daysBack: number): string {
  return new Date(Date.now() + 8 * 3600 * 1000 - daysBack * 86400 * 1000)
    .toISOString().slice(0, 10);
}

export default function AdminTrafficPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  // Default range: last 30 days (inclusive of today).
  const [from, setFrom] = useState(hkDateOffset(29));
  const [to, setTo] = useState(hkDateOffset(0));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canAccess = hasPermission('members');

  useEffect(() => {
    if (!canAccess) return;
    if (!from || !to || from > to) return;
    setLoading(true);
    setError(null);
    adminApiFetch(`/api/admin/traffic-report?from=${from}&to=${to}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`API ${res.status}`);
        setReport(await res.json());
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [from, to, canAccess]);

  if (!canAccess) {
    return <div className="p-8 text-ink-soft">{locale === 'zh' ? '冇權限' : 'No permission'}</div>;
  }

  const rows = report
    ? Object.entries(report.bySource).sort((a, b) => b[1].visits - a[1].visits)
    : [];
  const conv = (r: SourceRow) =>
    r.uniqueVisitors > 0 ? `${Math.round((r.bookings / r.uniqueVisitors) * 1000) / 10}%` : '—';

  // PDF export — English labels (jsPDF's built-in fonts can't render
  // Chinese; English keeps the export dependable).
  const exportPDF = async () => {
    if (!report) return;
    const [{ default: jsPDF }, autoTableMod] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const autoTable = (autoTableMod as unknown as { default: (doc: InstanceType<typeof jsPDF>, opts: Record<string, unknown>) => void }).default;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(16);
    doc.text('SPACO Traffic & Conversion Report', 40, 40);
    doc.setFontSize(10);
    doc.text(`Period: ${report.from} → ${report.to}`, 40, 60);
    doc.text(
      `Visits: ${report.totals.visits}   Unique visitors: ${report.totals.uniqueVisitors}   Bookings: ${report.totals.bookings}   Avg visits before booking: ${report.totals.avgVisitsBeforeBooking ?? '-'}`,
      40, 76,
    );
    autoTable(doc, {
      head: [['Source', 'Visits', 'Unique visitors', 'Bookings', 'Conversion', 'Revenue (HK$)']],
      body: rows.map(([source, r]) => [
        trafficSourceLabel(source, 'en'),
        String(r.visits),
        String(r.uniqueVisitors),
        String(r.bookings),
        conv(r),
        r.revenue > 0 ? r.revenue.toLocaleString() : '-',
      ]),
      startY: 96,
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [236, 72, 153], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 245, 250] },
    });
    doc.save(`spaco-traffic-${report.from}_${report.to}.pdf`);
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="text-accent" size={24} />
          {locale === 'zh' ? '流量與轉換報表' : 'Traffic & Conversion'}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 rounded-xl border border-charcoal/15 bg-white text-sm"
          />
          <span className="text-ink-soft text-sm">{locale === 'zh' ? '至' : 'to'}</span>
          <input
            type="date"
            value={to}
            min={from}
            max={hkDateOffset(0)}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 rounded-xl border border-charcoal/15 bg-white text-sm"
          />
          <button
            type="button"
            onClick={() => { setFrom(hkDateOffset(29)); setTo(hkDateOffset(0)); }}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-pink/10 text-pink hover:bg-pink/20"
          >
            {locale === 'zh' ? '最近 30 日' : 'Last 30 days'}
          </button>
          <button
            type="button"
            onClick={exportPDF}
            disabled={!report || loading}
            className="px-3 py-2 rounded-xl text-xs font-bold bg-gradient-pink text-white disabled:opacity-40 flex items-center gap-1.5"
          >
            <Download size={13} />
            {locale === 'zh' ? '匯出 PDF' : 'Export PDF'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
          {locale === 'zh' ? `載入失敗：${error}` : `Failed: ${error}`}
        </div>
      )}
      {loading ? (
        <div className="animate-pulse text-muted">Loading…</div>
      ) : report && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { icon: BarChart3, label: locale === 'zh' ? '總訪問次數' : 'Visits', value: report.totals.visits.toLocaleString() },
              { icon: Users, label: locale === 'zh' ? '獨立訪客' : 'Unique visitors', value: report.totals.uniqueVisitors.toLocaleString() },
              { icon: ShoppingBag, label: locale === 'zh' ? '訂單數' : 'Bookings', value: report.totals.bookings.toLocaleString() },
              {
                icon: Repeat,
                label: locale === 'zh' ? '成交前平均瀏覽次數' : 'Avg visits before booking',
                value: report.totals.avgVisitsBeforeBooking != null
                  ? `${report.totals.avgVisitsBeforeBooking}${locale === 'zh' ? ' 次' : ''}`
                  : '—',
              },
            ].map((t, i) => (
              <div key={i} className="glass-card p-4">
                <t.icon size={16} className="text-accent mb-2" />
                <p className="text-xl font-bold">{t.value}</p>
                <p className="text-xs text-ink-soft">{t.label}</p>
              </div>
            ))}
          </div>

          {/* Per-source table */}
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal/5 text-xs text-muted uppercase">
                    <th className="text-left px-5 py-3">{locale === 'zh' ? '來源' : 'Source'}</th>
                    <th className="text-right px-5 py-3">{locale === 'zh' ? '訪問' : 'Visits'}</th>
                    <th className="text-right px-5 py-3">{locale === 'zh' ? '獨立訪客' : 'Visitors'}</th>
                    <th className="text-right px-5 py-3">{locale === 'zh' ? '訂單' : 'Bookings'}</th>
                    <th className="text-right px-5 py-3">{locale === 'zh' ? '成交率' : 'Conv.'}</th>
                    <th className="text-right px-5 py-3">{locale === 'zh' ? '營業額' : 'Revenue'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-soft">
                      {locale === 'zh' ? '呢段時間未有數據（追蹤啱啱開始，數據會逐日累積）' : 'No data in this range yet (tracking just started)'}
                    </td></tr>
                  )}
                  {rows.map(([source, r]) => (
                    <tr key={source} className="border-b border-charcoal/5 last:border-0">
                      <td className="px-5 py-3 font-semibold">{trafficSourceLabel(source, locale)}</td>
                      <td className="px-5 py-3 text-right">{r.visits.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right">{r.uniqueVisitors.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right font-semibold">{r.bookings.toLocaleString()}</td>
                      <td className="px-5 py-3 text-right">{conv(r)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-emerald-700">
                        {r.revenue > 0 ? `HK$${r.revenue.toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-ink-soft mt-4 leading-relaxed">
            {locale === 'zh'
              ? '※ 訂單歸因方法：以該客人喺呢段時間內第一次到訪嘅來源計（first-touch）。客人用無痕模式或者冇登入下轉裝置，會當成新訪客——呢個係所有追蹤工具嘅共同限制。PDF 匯出用英文（PDF 引擎唔支援中文字體）。'
              : '※ Bookings attributed to the visitor\'s FIRST visit source in range (first-touch). Incognito / device switches without login count as new visitors.'}
          </p>
        </>
      )}
    </div>
  );
}
