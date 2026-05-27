'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useAuth } from '@/contexts/AuthContext';
import { getBooking } from '@/lib/firestore';
import { getVenueById } from '@/lib/venues';
import { BookingRecord } from '@/types';
import { CreditCard, Building2, ArrowRight, LogIn } from 'lucide-react';
import { motion } from 'framer-motion';
import AuthModal from '@/components/auth/AuthModal';

export default function PayBalancePage() {
  const locale = useLocale() as 'zh' | 'en';
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const bookingId = params.id as string;
  const slug = params.branchSlug as string;

  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<'stripe' | 'fps' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // Don't bounce to '/' — keep the customer on this URL so when they
      // log in via AuthModal the useEffect re-runs and loads the booking.
      // (Heidi 2026-05-28: #uD9WqI2P couldn't reach the payment page from
      // the WhatsApp link because the homepage redirect dropped the URL.)
      setLoading(false);
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

  if (error || !booking) {
    return (
      <div className="pt-28 min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center space-y-4">
          <p className="text-rose-500">{error || 'Error'}</p>
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

  const venue = getVenueById(booking.venueId);
  const venueName = venue?.name[locale] || booking.branchSlug;
  const balance = booking.balanceDue ?? 0;

  async function handleProceed() {
    if (!selected || !booking) return;
    setSubmitting(true);
    try {
      if (selected === 'stripe') {
        const res = await fetch('/api/stripe/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId: booking.id,
            amount: balance,
            deposit: booking.pricing.deposit,
            venueName: `${venueName} (${locale === 'zh' ? '尾數' : 'balance'})`,
            customerEmail: user?.email,
            isBalancePayment: true,
          }),
        });
        if (!res.ok) throw new Error(`Checkout API ${res.status}`);
        const { sessionUrl } = await res.json();
        if (!sessionUrl) throw new Error('No checkout URL returned');
        window.location.href = sessionUrl;
      } else {
        // Offline — reuse the offline page (it shows payment details + upload)
        router.push(`/book/${slug}/pay-offline/${booking.id}`);
      }
    } catch (err) {
      console.error(err);
      setError(locale === 'zh' ? '處理失敗，請重試' : 'Processing failed, please retry');
      setSubmitting(false);
    }
  }

  return (
    <div className="pt-28 pb-20 relative overflow-hidden">
      <div className="orb orb-pink animate-float-slow" style={{ width: 280, height: 280, top: '-60px', right: '-60px', opacity: 0.4 }} />
      <div className="max-content mx-auto px-6 md:px-12 lg:px-20 relative z-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-xl mx-auto space-y-6">
          <div>
            <h1 className="text-heading font-display">
              <span className="text-gradient-pink">{locale === 'zh' ? '繳付尾數' : 'Pay Balance'}</span>
            </h1>
            <p className="text-ink-soft mt-2 text-sm">
              {venueName} • {booking.date}
            </p>
            <p className="text-ink-soft mt-1 text-sm">
              {locale === 'zh' ? '尾數' : 'Balance'}：
              <span className="font-bold text-ink ml-1">HK${balance.toLocaleString()}</span>
            </p>
          </div>

          <div className="space-y-3">
            <Option
              selected={selected === 'stripe'}
              onClick={() => setSelected('stripe')}
              icon={<CreditCard size={22} />}
              title={locale === 'zh' ? '信用卡網上付款' : 'Online Credit Card'}
              subtitle={locale === 'zh' ? '透過 Stripe 安全付款' : 'Secure Stripe checkout'}
            />
            <Option
              selected={selected === 'fps'}
              onClick={() => setSelected('fps')}
              icon={<Building2 size={22} />}
              title={locale === 'zh' ? '線下付款（FPS / 銀行轉賬）' : 'Offline (FPS / Bank Transfer)'}
              subtitle={locale === 'zh' ? '上載付款截圖' : 'Upload payment screenshot'}
            />
          </div>

          {error && <p className="text-sm text-rose-500 text-center">{error}</p>}

          <button
            disabled={!selected || submitting}
            onClick={handleProceed}
            className="w-full bg-accent text-white py-4 rounded-xl font-bold text-lg hover:bg-accent/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (locale === 'zh' ? '處理中…' : 'Processing…') : (locale === 'zh' ? '付款' : 'Pay')}
            {!submitting && <ArrowRight size={18} />}
          </button>
        </motion.div>
      </div>
    </div>
  );
}

function Option({
  selected,
  onClick,
  icon,
  title,
  subtitle,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-5 rounded-xl border transition-colors ${
        selected ? 'border-accent bg-accent/5' : 'border-charcoal/15 bg-white/60 hover:border-charcoal/30'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className={`mt-0.5 ${selected ? 'text-accent' : 'text-ink-soft'}`}>{icon}</div>
        <div className="flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <p className="text-xs text-ink-soft mt-0.5">{subtitle}</p>
        </div>
        <div className={`w-5 h-5 rounded-full border-2 mt-1 flex items-center justify-center ${selected ? 'border-accent' : 'border-charcoal/25'}`}>
          {selected && <div className="w-2.5 h-2.5 rounded-full bg-accent" />}
        </div>
      </div>
    </button>
  );
}
