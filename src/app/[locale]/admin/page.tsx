'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { getBookingsForDate, getAllBookings } from '@/lib/firestore';
import { BookingRecord } from '@/types';
import { venues } from '@/lib/venues';
import { CalendarDays, Clock, Users, TrendingUp } from 'lucide-react';

export default function AdminDashboard() {
  const locale = useLocale() as 'zh' | 'en';
  const [todayBookings, setTodayBookings] = useState<BookingRecord[]>([]);
  const [allBookings, setAllBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Compute today on the client only (avoids SSR / client time mismatch)
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    Promise.all([
      getBookingsForDate(today),
      getAllBookings(),
    ]).then(([todayData, allData]) => {
      setTodayBookings(todayData);
      setAllBookings(allData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const pendingCount = allBookings.filter((b) => b.status === 'pending' || b.status === 'awaiting_payment').length;
  const confirmedCount = allBookings.filter((b) => b.status === 'confirmed').length;
  const totalRevenue = allBookings
    .filter((b) => b.status === 'confirmed' || b.status === 'completed')
    .reduce((sum, b) => sum + (b.pricing?.subtotal || 0), 0);

  const stats = [
    {
      label: { zh: '今日預訂', en: "Today's Bookings" },
      value: todayBookings.length,
      icon: CalendarDays,
      gradient: 'bg-gradient-cool',
    },
    {
      label: { zh: '待處理', en: 'Pending' },
      value: pendingCount,
      icon: Clock,
      gradient: 'bg-gradient-warm',
    },
    {
      label: { zh: '已確認', en: 'Confirmed' },
      value: confirmedCount,
      icon: Users,
      gradient: 'bg-gradient-pink',
    },
    {
      label: { zh: '總收入', en: 'Total Revenue' },
      value: `HK$${totalRevenue.toLocaleString()}`,
      icon: TrendingUp,
      gradient: 'bg-gradient-sunset',
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <span className="chip mb-3">
          <TrendingUp size={12} className="text-pink" />
          Admin
        </span>
        <h1 className="text-heading font-display">
          <span className="text-ink">{locale === 'zh' ? '控制' : 'Dash'}</span>
          <span>{'\u00A0'}</span>
          <span className="text-gradient-pink">{locale === 'zh' ? '中心' : 'board'}</span>
        </h1>
      </div>

      {loading ? (
        <div className="animate-pulse text-ink-soft">Loading...</div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {stats.map((stat, i) => (
              <div key={i} className="glass-card p-6">
                <div className={`w-11 h-11 rounded-2xl ${stat.gradient} flex items-center justify-center text-white shadow-glow mb-4`}>
                  <stat.icon size={20} />
                </div>
                <p className="text-xs text-ink-soft uppercase tracking-wider font-semibold">{stat.label[locale]}</p>
                <p className="text-2xl font-bold font-display text-ink mt-1">{stat.value}</p>
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
                  <div key={booking.id} className="glass-card p-5 flex items-center justify-between hover:-translate-y-0.5 transition-transform">
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
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
