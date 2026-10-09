'use client';

// 控制中心 — Heidi's 2026-09-28 layout:
//   快捷鍵     新增預訂連結 | 新增排程 | 單據管理 | 總日曆
//   統計       今日預訂 · 待核實入數紙 (→ 核實頁)
//   分店營業   each branch's CURRENT-MONTH sales (same countsForFinance
//             × pricing.subtotal basis as 月結, so numbers agree)
//   今日預訂   list (unchanged)
// Data stays cheap on mobile: server-side count for receipts + a
// date-bounded month query for branch sales — never the whole
// bookings collection (2026-09-15 lesson).

import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { getBookingsForDate } from '@/lib/firestore';
import { getCountFromServer, getDocs, query, collection, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BookingRecord } from '@/types';
import { venues } from '@/lib/venues';
import { branchKey as branchKeyOf, countsForFinance } from '@/lib/finance';
import {
  CalendarDays, TrendingUp, Link2, CalendarPlus, FileText,
  CalendarRange, Receipt, ChevronRight,
} from 'lucide-react';

const BRANCHES = ['cwb', 'sw', 'tst', 'wanchai'];
const BRANCH_LABELS: Record<string, { zh: string; en: string }> = {
  cwb: { zh: '銅鑼灣', en: 'CWB' },
  sw: { zh: '上環', en: 'SW' },
  tst: { zh: '尖沙咀', en: 'TST' },
  wanchai: { zh: '灣仔', en: 'WC' },
};

export default function AdminDashboard() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canManageBookings = hasPermission('bookings');
  const locale = useLocale() as 'zh' | 'en';
  const [todayBookings, setTodayBookings] = useState<BookingRecord[]>([]);
  const [receiptCount, setReceiptCount] = useState(0);
  const [branchSales, setBranchSales] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !canManageBookings) { setLoading(false); return; }
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const month = today.slice(0, 7);
    const isPreviewHost = !['spacohk.com', 'www.spacohk.com'].includes(window.location.hostname);
    const bookingsCol = collection(db, 'bookings');
    Promise.all([
      getBookingsForDate(today),
      // 待核實入數紙 — same status the 核實 page lists.
      getCountFromServer(query(bookingsCol, where('status', '==', 'awaiting_review'))),
      // Current month's bookings only (date-bounded — small query).
      getDocs(query(
        bookingsCol,
        where('date', '>=', `${month}-01`),
        where('date', '<=', `${month}-31`),
      )),
    ]).then(([todayData, receipts, monthSnap]) => {
      setTodayBookings(todayData);
      setReceiptCount(receipts.data().count);
      const sales: Record<string, number> = {};
      for (const d of monthSnap.docs) {
        const b = { id: d.id, ...d.data() } as BookingRecord;
        if (!countsForFinance(b, { includeTest: isPreviewHost })) continue;
        const bk = branchKeyOf(b.venueId);
        sales[bk] = (sales[bk] || 0) + (b.pricing?.subtotal || 0);
      }
      setBranchSales(sales);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [authLoading, canManageBookings]);

  const quickActions = [
    { href: '/admin/bookings/new', icon: Link2, label: { zh: '新增預訂連結', en: 'New booking link' } },
    { href: '/admin/calendar?new=1', icon: CalendarPlus, label: { zh: '新增排程', en: 'Add schedule' } },
    { href: '/admin/documents', icon: FileText, label: { zh: '單據管理', en: 'Documents' } },
    { href: '/admin/calendar', icon: CalendarRange, label: { zh: '總日曆', en: 'Calendar' } },
  ];

  if (!canManageBookings) return (
    <div className="space-y-4">
      <h1 className="text-heading">{locale === 'zh' ? '工作日曆' : 'Work calendar'}</h1>
      <Link href="/admin/calendar" className="btn-primary">{locale === 'zh' ? '開啟總日曆' : 'Open calendar'}</Link>
    </div>
  );

  const monthLabel = new Date().getMonth() + 1;

  return (
    <div>
      <div className="mb-8">
        <span className="chip mb-3">
          <TrendingUp size={12} className="text-pink" />
          Admin
        </span>
        <h1 className="text-heading font-display">
          <span className="text-ink">{locale === 'zh' ? '控制' : 'Dash'}</span>
          <span>{' '}</span>
          <span className="text-gradient-pink">{locale === 'zh' ? '中心' : 'board'}</span>
        </h1>
      </div>

      {/* 快捷鍵 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {quickActions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="glass-card p-4 flex items-center gap-3 hover:-translate-y-0.5 transition-transform"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shadow-glow shrink-0">
              <a.icon size={18} />
            </div>
            <span className="font-semibold text-sm text-ink">{a.label[locale]}</span>
          </Link>
        ))}
      </div>

      {loading ? (
        <div className="animate-pulse text-ink-soft">Loading...</div>
      ) : (
        <>
          {/* 今日預訂 + 待核實入數紙 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <div className="glass-card p-6">
              <div className="w-11 h-11 rounded-2xl bg-gradient-cool flex items-center justify-center text-white shadow-glow mb-4">
                <CalendarDays size={20} />
              </div>
              <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold">
                {locale === 'zh' ? '今日預訂' : "Today's Bookings"}
              </p>
              <p className="text-2xl font-bold font-display text-ink mt-1">{todayBookings.length}</p>
            </div>
            <Link
              href="/admin/receipts"
              className={`glass-card p-6 hover:-translate-y-0.5 transition-transform block ${receiptCount > 0 ? 'ring-2 ring-amber-300' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="w-11 h-11 rounded-2xl bg-gradient-warm flex items-center justify-center text-white shadow-glow mb-4">
                  <Receipt size={20} />
                </div>
                <ChevronRight size={16} className="text-ink-soft mt-1" />
              </div>
              <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold">
                {locale === 'zh' ? '待核實入數紙' : 'Receipts to verify'}
              </p>
              <p className={`text-2xl font-bold font-display mt-1 ${receiptCount > 0 ? 'text-amber-600' : 'text-ink'}`}>
                {receiptCount}
              </p>
            </Link>
          </div>

          {/* 分店本月營業額 */}
          <h2 className="text-xl font-bold font-display mb-4 text-ink">
            {locale === 'zh' ? `${monthLabel} 月分店營業額` : `Branch sales — month ${monthLabel}`}
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {BRANCHES.map((bk) => (
              <div key={bk} className="glass-card p-5">
                <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold">
                  {BRANCH_LABELS[bk][locale]}
                </p>
                <p className="text-xl font-bold font-display text-gradient-pink mt-1">
                  HK${(branchSales[bk] || 0).toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          {/* Today's Bookings */}
          <h2 className="text-xl font-bold font-display mb-4 text-ink">
            {locale === 'zh' ? '今日預訂' : "Today's Bookings"}
          </h2>
          {todayBookings.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <p className="text-ink-soft">
                {locale === 'zh' ? '今日暫無預訂' : 'No bookings today'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayBookings.map((booking) => {
                const venue = venues.find((v) => v.id === booking.venueId);
                return (
                  <Link
                    key={booking.id}
                    href={`/admin/bookings/${booking.id}`}
                    className="glass-card p-5 flex items-center justify-between hover:-translate-y-0.5 transition-transform"
                  >
                    <div>
                      <p className="font-semibold font-display text-ink">{venue?.name[locale] || booking.venueId}</p>
                      <p className="text-sm text-ink-soft">
                        {booking.startTime} - {booking.endTime} | {booking.guestCount} {locale === 'zh' ? '人' : 'pax'}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-pill text-xs font-medium border ${
                      booking.status === 'confirmed' ? 'bg-emerald-100/80 text-emerald-700 border-emerald-200' :
                      booking.status === 'pending' ? 'bg-amber-100/80 text-amber-700 border-amber-200' :
                      'bg-white/60 text-ink-soft border-white/70'
                    }`}>
                      {booking.status}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
