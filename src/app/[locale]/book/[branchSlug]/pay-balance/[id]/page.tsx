'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import { BookingRecord } from '@/types';
import { LogIn } from 'lucide-react';
import { motion } from 'framer-motion';
import AuthModal from '@/components/auth/AuthModal';

export default function PayBalancePage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const bookingId = params.id as string;

  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Starts at true — we auto-redirect to KPay on entry (no picker).
  const [submitting, setSubmitting] = useState(true);
  const [fired, setFired] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // Don't bounce to '/' — keep the customer on this URL so when they
      // log in via AuthModal the useEffect re-runs and loads the booking.
      // (Heidi 2026-05-28: #uD9WqI2P couldn't reach the payment page from
      // the WhatsApp link because the homepage redirect dropped the URL.)
      setLoading(false);
      setSubmitting(false);
      return;
    }
    setLoading(true);
    getBooking(bookingId)
      .then((b) => {
        if (!b) setError(locale === 'zh' ? '找不到預訂記錄' : 'Booking not found');
        else if (b.userId !== user.uid) setError(locale === 'zh' ? '無權查看此預訂（請用預訂時嘅帳號登入）' : 'Not authorized — please sign in with the account used to make this booking');
        else if ((b.balanceDue ?? 0) <= 0) setError(locale === 'zh' ? '此預訂沒有未繳尾數' : 'No outstanding balance');
        else { setBooking(b); setError(null); }
      })
      .finally(() => setLoading(false));
  }, [bookingId, user, authLoading, locale]);

  const venue = booking ? getVenueById(booking.venueId) : null;
  const venueName = venue?.name[locale] || booking?.branchSlug || '';
  const balance = booking?.balanceDue ?? 0;

  async function proceedToKpay() {
    if (!booking) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/kpay/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: booking.id,
          amount: balance,
          venueName: `${venueName} (${locale === 'zh' ? '尾數' : 'balance'})`,
          customerEmail: user?.email,
          isBalancePayment: true,
        }),
      });
      if (!res.ok) throw new Error(`Checkout API ${res.status}`);
      const { sessionUrl } = await res.json();
      if (!sessionUrl) throw new Error('No checkout URL returned');
      window.location.href = sessionUrl;
    } catch (err) {
      console.error(err);
      setError(locale === 'zh' ? '處理失敗，請重試' : 'Processing failed, please retry');
      setSubmitting(false);
    }
  }

  // Auto-fire when booking loads.
  useEffect(() => {
    if (fired || !booking || authLoading || loading) return;
    setFired(true);
    proceedToKpay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking, authLoading, loading]);

  if (authLoading || loading) {
    return <div className="pt-28 min-h-screen flex items-center justify-center"><div className="animate-pulse text-ink-soft">Loading...</div></div>;
  }

  // Not signed in → show inline sign-in prompt instead of redirecting away.
  if (!user) {
    return (
      <div className="pt-28 pb-20 min-h-screen flex items-center justify-center px-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full text-center space-y-6">
          <h1 className="text-heading font-display">
            <span className="text-gradient-pink">{locale === 'zh' ? '繳付尾數' : 'Pay Balance'}</span>
          </h1>
          <p className="text-ink-soft text-sm">
            {locale === 'zh'
              ? '請先登入您預訂時使用的帳號，以繼續繳付尾數。'
              : 'Please sign in with the account used to make this booking to continue.'}
          </p>
          <button
            onClick={() => setAuthOpen(true)}
            className="w-full bg-accent text-white py-4 rounded-xl font-bold text-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2"
          >
            <LogIn size={18} />
            {locale === 'zh' ? '登入' : 'Sign In'}
          </button>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-ink-soft hover:text-ink underline"
          >
            {locale === 'zh' ? '返回主頁' : 'Back to home'}
          </button>
        </motion.div>
        <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
      </div>
    );
  }

  if (error && !booking) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center space-y-4">
          <p className="text-rose-500">{error}</p>
          <button
            onClick={() => router.push('/account')}
            className="text-sm text-ink-soft hover:text-ink underline"
          >
            {locale === 'zh' ? '查看我的預訂' : 'View my bookings'}
          </button>
        </div>
      </div>
    );
  }
  if (!booking) {
    return <div className="pt-28 min-h-screen flex items-center justify-center"><div className="animate-pulse text-ink-soft">Loading...</div></div>;
  }

  return (
    <div className="pt-28 pb-20 relative overflow-hidden min-h-screen flex items-center justify-center">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-md mx-auto text-center space-y-6">
          <h1 className="text-heading font-display">
            <span className="text-gradient-pink">
              {error
                ? (locale === 'zh' ? '處理失敗' : 'Payment Error')
                : (locale === 'zh' ? '正在跳轉到付款頁面' : 'Redirecting to Payment')}
            </span>
          </h1>
          <div>
            <p className="text-ink-soft text-sm">{venueName} • {booking.date}</p>
            <p className="text-ink-soft mt-1 text-sm">
              {locale === 'zh' ? '尾數' : 'Balance'}：
              <span className="font-bold text-ink ml-1">HK${balance.toLocaleString()}</span>
            </p>
          </div>
          {!error && (
            <p className="text-ink-soft text-xs">
              {locale === 'zh'
                ? 'KPay 安全收銀台支援信用卡 / FPS / AlipayHK / WeChat / PayMe / Apple Pay。請稍候…'
                : 'KPay secure cashier supports card / FPS / AlipayHK / WeChat / PayMe / Apple Pay. Hang tight…'}
            </p>
          )}
          {submitting && !error && (
            <div className="flex justify-center pt-2">
              <div className="w-10 h-10 border-3 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {error && (
            <>
              <p className="text-sm text-rose-500">{error}</p>
              <button
                onClick={() => { setFired(false); }}
                className="px-6 py-3 rounded-xl bg-accent text-white font-bold hover:bg-accent/90"
              >
                {locale === 'zh' ? '再試一次' : 'Try again'}
              </button>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
