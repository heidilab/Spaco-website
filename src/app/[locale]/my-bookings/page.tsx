'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useAuth } from '@/contexts/AuthContext';
import { getUserBookings } from '@/lib/firestore';
import { BookingRecord } from '@/types';
import { venues } from '@/lib/venues';
import { CalendarDays, Clock, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import AuthModal from '@/components/auth/AuthModal';

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100/80 text-amber-700 border-amber-200',
  awaiting_payment: 'bg-orange-100/80 text-orange-700 border-orange-200',
  confirmed: 'bg-emerald-100/80 text-emerald-700 border-emerald-200',
  completed: 'bg-sky-100/80 text-sky-700 border-sky-200',
  cancelled: 'bg-rose-100/80 text-rose-700 border-rose-200',
};

const statusLabels: Record<string, { zh: string; en: string }> = {
  pending: { zh: '待處理', en: 'Pending' },
  awaiting_payment: { zh: '待付款', en: 'Awaiting Payment' },
  confirmed: { zh: '已確認', en: 'Confirmed' },
  completed: { zh: '已完成', en: 'Completed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
};

export default function MyBookingsPage() {
  const { user, loading: authLoading } = useAuth();
  const locale = useLocale() as 'zh' | 'en';
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    getUserBookings(user.uid).then((data) => {
      setBookings(data);
      setLoading(false);
    });
  }, [user, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-ink-soft">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="pt-28 min-h-screen relative overflow-hidden">
        <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.5 }} />
        <div className="orb orb-lavender animate-float-medium" style={{ width: 220, height: 220, bottom: '15%', left: '-60px', opacity: 0.45 }} />
        <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-16 text-center relative z-10">
          <div className="glass-card p-10 max-w-md mx-auto">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-pink flex items-center justify-center text-white shadow-glow">
              <CalendarDays size={28} />
            </div>
            <h1 className="text-heading font-display mb-4">
              <span className="text-gradient-warm">
                {locale === 'zh' ? '請先登入' : 'Please Log In'}
              </span>
            </h1>
            <p className="text-ink-soft mb-7">
              {locale === 'zh' ? '登入後即可查看您的預訂記錄' : 'Log in to view your booking history'}
            </p>
            <button onClick={() => setAuthModalOpen(true)} className="btn-primary">
              {locale === 'zh' ? '登入 / 註冊' : 'Log In / Sign Up'}
            </button>
          </div>
          <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="pt-28 min-h-screen relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="orb orb-lavender animate-float-medium" style={{ width: 200, height: 200, bottom: '20%', left: '-60px', opacity: 0.35 }} />

      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 py-12 relative z-10">
        <div className="mb-10">
          <span className="chip mb-3">
            <CalendarDays size={12} className="text-pink" />
            Account
          </span>
          <h1 className="text-heading font-display">
            <span className="text-ink">{locale === 'zh' ? '我的' : 'My'}</span>
            <span>{'\u00A0'}</span>
            <span className="text-gradient-pink">{locale === 'zh' ? '預訂' : 'Bookings'}</span>
          </h1>
        </div>

        {bookings.length === 0 ? (
          <div className="glass-card p-12 text-center max-w-md mx-auto">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/60 flex items-center justify-center text-ink-soft">
              <CalendarDays size={28} />
            </div>
            <p className="text-ink-soft">
              {locale === 'zh' ? '暫無預訂記錄' : 'No bookings yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {bookings.map((booking, i) => {
              const venue = venues.find((v) => v.id === booking.venueId);
              return (
                <motion.div
                  key={booking.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-card p-6 hover:-translate-y-0.5 transition-transform duration-300"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-bold font-display text-lg text-ink">
                          {venue?.name[locale] || booking.venueId}
                        </h3>
                        <span className={`px-3 py-1 rounded-pill text-xs font-medium border ${statusColors[booking.status]}`}>
                          {statusLabels[booking.status]?.[locale] || booking.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-ink-soft">
                        <span className="flex items-center gap-1.5">
                          <CalendarDays size={14} className="text-pink" /> {booking.date}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock size={14} className="text-lavender" /> {booking.startTime} - {booking.endTime}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Users size={14} className="text-coral" /> {booking.guestCount} {locale === 'zh' ? '人' : 'pax'}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold font-display text-gradient-pink">HK${booking.pricing.subtotal.toLocaleString()}</p>
                      <p className="text-xs text-ink-soft">
                        {locale === 'zh' ? '按金' : 'Deposit'}: HK${booking.pricing.deposit.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
