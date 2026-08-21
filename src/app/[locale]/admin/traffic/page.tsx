'use client';

// Admin traffic & attribution report — monthly visits by source,
// unique visitors, bookings converted + revenue per source, and the
// "how many visits before booking" journey stats. Data comes from
// /api/admin/traffic-report (visits collection is admin-only).

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { adminApiFetch } from '@/lib/adminApiFetch';
import { trafficSourceLabel } from '@/lib/attribution';
import { BarChart3, Users, ShoppingBag, Repeat } from 'lucide-react';

interface SourceRow { visits: number; uniqueVisitors: number; bookings: number; revenue: number }
interface Report {
  month: string;
  totals: {
    visits: number; uniqueVisitors: number; bookings: number;
    attributedBookings: number; unattributedBookings: number;
    avgVisitsBeforeBooking: number | null;
    visitDistribution: number[];
  };
  bySource: Record<string, SourceRow>;
}

function currentHkMonth(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
}

export default function AdminTrafficPage() {
  const locale = useLocale() as 'zh' | 'en';
  const { hasPermission } = useAuth();
  const [month, setMonth] = useState(currentHkMonth());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canAccess = hasPermission('members');

  useEffect(() => {
    if (!canAccess) return;
    setLoading(true);
    setError(null);
    adminApiFetch(`/api/admin/traffic-report?month=${month}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`API ${res.status}`);
        setReport(await res.json());
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [month, canAccess]);

  if (!canAccess) {
    return <div className="p-8 text-ink-soft">{locale === 'zh' ? '冇權限' : 'No permission'}</div>;
  }

  const rows = report
    ? Object.entries(report.bySource).sort((a, b) => b[1].visits - a[1].visits)
    : [];
  const conv = (r: SourceRow) =>
    r.uniqueVisitors > 0 ? `${Math.round((r.bookings / r.uniqueVisitors) * 1000) / 10}%` : '—';

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="text-accent" size={24} />
          {locale === 'zh' ? '流量與轉換報表' : 'Traffic & Conversion'}
        </h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="px-3 py-2 rounded-xl border border-charcoal/15 bg-white text-sm"
        />
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
                value: report.totals.avgVisitsBeforeBooking != null ? `${report.totals.avgVisitsBeforeBooking} 次` : '—',
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
                      {locale === 'zh' ? '本月未有數據（追蹤啱啱開始，數據會由今日起累積）' : 'No data this month yet (tracking just started)'}
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
              ? '※ 訂單歸因方法：以該客人本月第一次到訪嘅來源計（first-touch）。「成交前平均瀏覽次數」只計本月內追蹤到旅程嘅成交客。客人用無痕模式或者冇登入下轉裝置，會當成新訪客——呢個係所有追蹤工具嘅共同限制。'
              : '※ Bookings are attributed to the visitor\'s FIRST visit source of the month (first-touch). Incognito mode / device switches without login count as new visitors — a limitation shared by all analytics tools.'}
          </p>
        </>
      )}
    </div>
  );
}
